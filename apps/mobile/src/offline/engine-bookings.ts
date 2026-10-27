/**
 * Bookings, seat holds, check-in, boarding passes and baggage — port of
 * bookings.service.ts / checkin.service.ts / baggage.service.ts.
 *
 * A booking is created HELD, exactly like the server: the traveller app now
 * has a real M-Pesa payment step (see engine-payments.ts), so seats convert
 * to sold and e-tickets are issued only once the payment settles. Everything
 * after that (cancel, seat hold, check-in, boarding pass, baggage) follows
 * the server exactly.
 */
import {
  AppError,
  buildBcbp,
  checkInWindow,
  type BaggageDto,
  type BaggageEventDto,
  type BaggageStageCode,
  type BoardingPassDto,
  type BookingBreakdownLineDto,
  type BookingDto,
  type BookingStatus,
  type CheckInDto,
  type CheckInResultDto,
  type TicketIssueResultDto,
} from '@kenyaairways/shared';
import {
  assertBookingAccess,
  deriveStatus,
  fail,
  inventoryHold,
  inventoryReleaseHold,
  inventoryReleaseSold,
  issueTickets,
  bookingActor,
  loadBooking,
  loadPassengers,
  loadSegments,
  randomId,
  ticketDtos,
  toBookingDto,
  transitionBooking,
  uniquePnr,
  type Actor,
  type EngineCtx,
  type FlightRow,
} from './engine-support';
import { PASSENGER_FARE_BPS } from '@kenyaairways/shared';
import { priceFare } from './pricing';

const BOOKING_EXPIRE_TTL_SECONDS = 1800;
const CHECK_IN_OPEN_HOURS = 24;
const CHECK_IN_CLOSE_MINUTES = 60;

// ── create ──────────────────────────────────────────────────────────────────

interface PassengerInput {
  type?: string;
  firstName?: string;
  lastName?: string;
  email?: string | null;
  phone?: string | null;
  docType?: string | null;
}

interface SegmentInput {
  flightId?: string;
  fareClassCode?: string;
}

interface CreateBookingInput {
  tripType?: string;
  source?: string;
  segments?: SegmentInput[];
  passengers?: PassengerInput[];
  contactEmail?: string;
  contactPhone?: string;
  locale?: string;
}

export function createBooking(ctx: EngineCtx, actor: Actor, dto: CreateBookingInput): BookingDto {
  const passengers = dto.passengers ?? [];
  const segmentsIn = dto.segments ?? [];
  if (segmentsIn.length === 0) fail('BAD_REQUEST', 'At least one segment is required');

  const counts = countPax(passengers);
  if (counts.adults < 1) fail('BAD_REQUEST', 'At least one adult passenger is required');
  const seatPax = counts.adults + counts.children; // infants travel on laps

  // Resolve segments (flight + open fare) and price them.
  interface ResolvedSeg {
    flight: FlightRow;
    fareClassCode: string;
    pricing: ReturnType<typeof priceFare>;
  }
  const resolved: ResolvedSeg[] = [];
  const seenFlights = new Set<string>();
  for (const seg of segmentsIn) {
    const flightId = seg.flightId ?? '';
    const fareClassCode = (seg.fareClassCode ?? '').toUpperCase();
    if (!flightId || !fareClassCode)
      fail('BAD_REQUEST', 'Each segment needs flightId and fareClassCode');
    if (seenFlights.has(flightId)) fail('BAD_REQUEST', 'A flight may appear only once per booking');
    seenFlights.add(flightId);

    const flight = ctx.db.get<FlightRow>('SELECT * FROM flights WHERE id = ?', [flightId]);
    if (!flight) fail('NOT_FOUND', 'Flight not found');
    if (flight.status === 'CANCELLED')
      fail('CONFLICT', `Flight ${flight.flightNumber} is cancelled`);
    const fare = ctx.db.get<{ baseFareMinor: number }>(
      `SELECT f.baseFareMinor FROM fares f
         JOIN fare_classes fc ON fc.code = f.fareClassCode
        WHERE f.flightId = ? AND f.fareClassCode = ? AND f.saleStatus = 'OPEN' AND fc.active = 1`,
      [flightId, fareClassCode],
    );
    if (!fare) fail('NOT_FOUND', `Fare class ${fareClassCode} is not offered on this flight`);
    const pricing = priceFare(ctx.world.taxRules, {
      routeType: flight.routeType,
      baseFareMinor: fare.baseFareMinor,
      currency: flight.currency,
      todayIso: flight.flightDate,
    });
    resolved.push({ flight, fareClassCode, pricing });
  }

  // Price snapshot: per-passenger-type fares + taxes (infants 10% of base).
  const lines: BookingBreakdownLineDto[] = [];
  let total = 0;
  for (const [index, seg] of resolved.entries()) {
    const infantBase = Math.round((seg.pricing.baseFareMinor * PASSENGER_FARE_BPS.INFANT) / 10_000);
    const fareAmount = seatPax * seg.pricing.baseFareMinor + counts.infants * infantBase;
    lines.push({
      code: `SEG${index + 1}_FARE`,
      label: `${seg.flight.flightNumber} base fare × ${seatPax} passenger(s)${counts.infants ? ` + ${counts.infants} infant(s)` : ''}`,
      amountMinor: fareAmount,
    });
    total += fareAmount;
    for (const tax of seg.pricing.taxes) {
      const amount = seatPax * tax.amountMinor;
      if (amount === 0) continue;
      lines.push({
        code: `SEG${index + 1}_${tax.code}`,
        label: `${seg.flight.flightNumber} · ${tax.name}`,
        amountMinor: amount,
      });
      total += amount;
    }
  }

  const pnr = uniquePnr(ctx.db);
  const nowIso = new Date(ctx.now()).toISOString();
  const expiresIso = new Date(ctx.now() + BOOKING_EXPIRE_TTL_SECONDS * 1000).toISOString();
  const bookingId = randomId('bkg');

  ctx.db.transaction(() => {
    // Inventory: hold each segment's seats (atomic conditional UPDATEs).
    for (const seg of resolved) {
      const held = inventoryHold(ctx.db, seg.flight.id, seg.fareClassCode, seatPax);
      if (!held) {
        throw new AppError(
          'SEAT_UNAVAILABLE',
          `Not enough seats on ${seg.flight.flightNumber} (${seg.fareClassCode})`,
        );
      }
    }

    ctx.db.run(
      `INSERT INTO bookings (id, pnr, userId, status, tripType, source, currency, totalMinor,
                             breakdownJson, contactEmail, contactPhone, adultCount, childCount,
                             infantCount, locale, holdExpiresAt, expiresAt, createdAt)
       VALUES (?, ?, ?, 'HELD', ?, ?, 'KES', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        bookingId,
        pnr,
        actor.user.id,
        normalizeTripType(dto.tripType),
        dto.source ?? 'MOBILE',
        total,
        JSON.stringify(lines),
        dto.contactEmail ?? actor.user.email ?? null,
        dto.contactPhone ?? actor.user.phone ?? null,
        counts.adults,
        counts.children,
        counts.infants,
        dto.locale ?? actor.user.locale,
        expiresIso,
        expiresIso,
        nowIso,
      ],
    );

    resolved.forEach((seg, index) => {
      ctx.db.run(
        `INSERT INTO booking_segments (bookingId, seq, flightId, fareClassCode, originCode,
                                       destinationCode, depUtc, arrUtc, fareMinor, currency)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          bookingId,
          index + 1,
          seg.flight.id,
          seg.fareClassCode,
          seg.flight.originCode,
          seg.flight.destinationCode,
          seg.flight.depUtc,
          seg.flight.arrUtc,
          seg.pricing.totalMinor,
          seg.pricing.currency,
        ],
      );
    });

    passengers.forEach((pax, index) => {
      ctx.db.run(
        `INSERT INTO booking_passengers (id, bookingId, seq, type, firstName, lastName, email, phone, docType)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          randomId('pax'),
          bookingId,
          index + 1,
          normalizePaxType(pax.type),
          (pax.firstName ?? '').trim() || 'Passenger',
          (pax.lastName ?? '').trim() || 'Traveller',
          pax.email?.toLowerCase() ?? null,
          pax.phone ?? null,
          pax.docType ?? null,
        ],
      );
    });

    // The booking stays HELD until a payment settles. The Payment screen
    // creates the M-Pesa attempt (POST /payments) and confirms it from the
    // pasted paybill SMS (POST /payments/:id/mpesa-manual).
  });

  return toBookingDto(ctx, loadBooking(ctx, bookingId));
}

function normalizeTripType(value: string | undefined): string {
  const v = (value ?? 'ONE_WAY').toUpperCase();
  return v === 'ROUND_TRIP' || v === 'OPEN_JAW' ? v : 'ONE_WAY';
}

function normalizePaxType(value: string | undefined): string {
  const v = (value ?? 'ADULT').toUpperCase();
  return v === 'CHILD' || v === 'INFANT' ? v : 'ADULT';
}

function countPax(passengers: PassengerInput[]): {
  adults: number;
  children: number;
  infants: number;
} {
  const counts = { adults: 0, children: 0, infants: 0 };
  for (const p of passengers) {
    const t = normalizePaxType(p.type);
    if (t === 'ADULT') counts.adults += 1;
    else if (t === 'CHILD') counts.children += 1;
    else counts.infants += 1;
  }
  return counts;
}

// ── read / list / cancel ────────────────────────────────────────────────────

export function getBooking(ctx: EngineCtx, actor: Actor, id: string): BookingDto {
  const booking = loadBooking(ctx, id);
  assertBookingAccess(booking, bookingActor(actor));
  return toBookingDto(ctx, booking);
}

export function listMyBookings(
  ctx: EngineCtx,
  actor: Actor,
  pageRaw?: string,
  pageSizeRaw?: string,
): { items: BookingDto[]; page: number; pageSize: number; total: number; hasMore: boolean } {
  const size = Math.min(50, Math.max(1, Number(pageSizeRaw) || 20));
  const page = Math.max(1, Number(pageRaw) || 1);
  const total = (
    ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM bookings WHERE userId = ?', [
      actor.user.id,
    ]) ?? {
      n: 0,
    }
  ).n;
  const rows = ctx.db.all<ReturnType<typeof loadBooking>>(
    'SELECT * FROM bookings WHERE userId = ? ORDER BY createdAt DESC LIMIT ? OFFSET ?',
    [actor.user.id, size, (page - 1) * size],
  );
  return {
    items: rows.map((r) => toBookingDto(ctx, r)),
    page,
    pageSize: size,
    total,
    hasMore: page * size < total,
  };
}

export function cancelBooking(ctx: EngineCtx, actor: Actor, id: string): BookingDto {
  const booking = loadBooking(ctx, id);
  const bkActor = bookingActor(actor);
  assertBookingAccess(booking, bkActor);

  const changed = transitionBooking(ctx, id, 'CANCELLED', (db, current) => {
    const seats = current.adultCount + current.childCount;
    const segments = db.all<{ flightId: string; fareClassCode: string }>(
      'SELECT flightId, fareClassCode FROM booking_segments WHERE bookingId = ? ORDER BY seq',
      [id],
    );
    if (current.status === 'CONFIRMED' || current.status === 'CHECKED_IN') {
      for (const seg of segments) inventoryReleaseSold(db, seg.flightId, seg.fareClassCode, seats);
    } else {
      for (const seg of segments) inventoryReleaseHold(db, seg.flightId, seg.fareClassCode, seats);
    }
    db.run(
      `UPDATE seat_holds SET status = 'RELEASED', releasedAt = ?, activeKey = NULL
        WHERE bookingId = ? AND status IN ('ACTIVE', 'CONVERTED')`,
      [new Date(ctx.now()).toISOString(), id],
    );
  });
  if (!changed) {
    throw new AppError('INVALID_STATE_TRANSITION', `Booking ${booking.pnr} cannot be cancelled`);
  }
  return toBookingDto(ctx, loadBooking(ctx, id));
}

// ── seat hold (port of BookingsService.holdSeat) ────────────────────────────

export function holdSeat(
  ctx: EngineCtx,
  actor: Actor,
  bookingId: string,
  seatLabel: string,
  segmentSeq = 0,
): BookingDto {
  const booking = loadBooking(ctx, bookingId);
  assertBookingAccess(booking, bookingActor(actor));
  if (!['HELD', 'PENDING_PAYMENT', 'CONFIRMED'].includes(booking.status)) {
    throw new AppError(
      'INVALID_STATE_TRANSITION',
      `Cannot select seats while booking is ${booking.status}`,
    );
  }
  const segment = ctx.db.get<{ seq: number; flightId: string }>(
    'SELECT seq, flightId FROM booking_segments WHERE bookingId = ? AND seq = ?',
    [bookingId, segmentSeq + 1],
  );
  if (!segment) fail('BAD_REQUEST', 'Unknown segment');

  insertSeatHold(ctx, bookingId, actor.user.id, segment.flightId, seatLabel);
  return toBookingDto(ctx, loadBooking(ctx, bookingId));
}

export function insertSeatHold(
  ctx: EngineCtx,
  bookingId: string,
  userId: string | null,
  flightId: string,
  seatLabel: string,
): void {
  const flight = ctx.db.get<FlightRow>('SELECT * FROM flights WHERE id = ?', [flightId]);
  if (!flight) fail('NOT_FOUND', 'Flight not found');
  const type = ctx.world.aircraftTypes.get(flight.aircraftTypeCode);
  const seat = type?.seats.find((s) => s.label === seatLabel);
  if (!seat || !seat.active) fail('NOT_FOUND', `Seat ${seatLabel} does not exist`);
  if (seat.blocked) fail('SEAT_UNAVAILABLE', `Seat ${seatLabel} is blocked`);

  // Free lapsed holds first so a seat never stays blocked by a dead row.
  ctx.db.run(
    `UPDATE seat_holds SET status = 'EXPIRED', activeKey = NULL, releasedAt = ?
      WHERE flightId = ? AND seatLabel = ? AND status = 'ACTIVE' AND expiresAt < ?`,
    [new Date(ctx.now()).toISOString(), flightId, seatLabel, new Date(ctx.now()).toISOString()],
  );

  const expiresAt = new Date(ctx.now() + BOOKING_EXPIRE_TTL_SECONDS * 1000).toISOString();
  try {
    ctx.db.run(
      `INSERT INTO seat_holds (id, bookingId, userId, flightId, seatLabel, status, token,
                               activeKey, expiresAt, createdAt)
       VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)`,
      [
        randomId('hld'),
        bookingId,
        userId,
        flightId,
        seatLabel,
        randomId('tok'),
        `${flightId}:${seatLabel}`, // unique index → no double-hold, ever
        expiresAt,
        new Date(ctx.now()).toISOString(),
      ],
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('UNIQUE')) {
      throw new AppError('SEAT_UNAVAILABLE', `Seat ${seatLabel} is already held`);
    }
    throw err;
  }
}

// ── check-in (port of CheckInService.checkIn, with offline leniency) ────────

interface CheckInRowLite {
  id: string;
  bookingId: string;
  passengerId: string;
  flightId: string;
  seatLabel: string | null;
  status: string;
  boardingSequence: number | null;
  gate: string | null;
  checkedInAt: string | null;
  boardingPassId: string | null;
}

function toCheckInDto(row: CheckInRowLite, passengerName: string): CheckInDto {
  return {
    id: row.id,
    bookingId: row.bookingId,
    bookingPassengerId: row.passengerId,
    passengerName,
    flightId: row.flightId,
    seatLabel: row.seatLabel,
    status: row.status as CheckInDto['status'],
    boardingSequence: row.boardingSequence,
    gate: row.gate,
    checkedInAt: row.checkedInAt,
    boardingPassId: row.boardingPassId,
  };
}

export function checkIn(
  ctx: EngineCtx,
  actor: Actor,
  bookingId: string,
  passengerIds?: string[],
): CheckInResultDto {
  const booking = loadBooking(ctx, bookingId);
  const bkActor = bookingActor(actor);
  assertBookingAccess(booking, bkActor);
  if (!['CONFIRMED', 'CHECKED_IN'].includes(booking.status)) {
    throw new AppError(
      'INVALID_STATE_TRANSITION',
      `Passengers can only check in for a confirmed booking — this one is ${booking.status}`,
    );
  }
  const segments = loadSegments(ctx, bookingId);
  const segment = segments[0];
  if (!segment) throw new AppError('INVALID_STATE_TRANSITION', 'Booking has no segments');
  const flight = ctx.db.get<FlightRow>('SELECT * FROM flights WHERE id = ?', [segment.flightId]);
  if (!flight) throw new AppError('NOT_FOUND', 'Flight not found');

  // OFFLINE LENIENCY: skip the TOO_EARLY gate (a device may have been off
  // for days); the 60-minute close cutoff still applies.
  const window = checkInWindow(flight.depUtc, new Date(ctx.now()), {
    openHours: CHECK_IN_OPEN_HOURS,
    closeMinutes: CHECK_IN_CLOSE_MINUTES,
  });
  if (!window.open && window.reason === 'TOO_LATE') {
    throw new AppError(
      'CHECK_IN_CLOSED',
      `Check-in has closed — the cutoff is ${CHECK_IN_CLOSE_MINUTES} minutes before departure`,
    );
  }

  const allPassengers = loadPassengers(ctx, bookingId);
  const requested = passengerIds?.length
    ? allPassengers.filter((p) => passengerIds.includes(p.id))
    : allPassengers;
  if (requested.length === 0) fail('BAD_REQUEST', 'No matching passengers to check in');
  if (passengerIds?.length && requested.length !== new Set(passengerIds).size) {
    fail('BAD_REQUEST', 'passengerIds must belong to this booking');
  }

  const tickets = ctx.db.all<{ passengerId: string; id: string; seatLabel: string | null }>(
    `SELECT passengerId, id, seatLabel FROM tickets WHERE bookingId = ? AND status = 'ISSUED'`,
    [bookingId],
  );
  const ticketByPax = new Map(tickets.map((t) => [t.passengerId, t]));
  if (requested.some((p) => !ticketByPax.has(p.id))) {
    throw new AppError('INVALID_STATE_TRANSITION', 'Tickets must be issued before check-in');
  }

  const existingCheckIns = ctx.db.all<CheckInRowLite & { boardingPassId: string | null }>(
    'SELECT * FROM checkins WHERE bookingId = ?',
    [bookingId],
  );
  const checkedByPax = new Map(existingCheckIns.map((c) => [c.passengerId, c]));
  const alreadyChecked = requested.filter((p) => checkedByPax.get(p.id)?.status === 'CHECKED_IN');
  const pending = requested.filter((p) => checkedByPax.get(p.id)?.status !== 'CHECKED_IN');

  // Seat ownership on this flight right now (labels, since offline seats are
  // template labels rather than DB seat rows).
  const ours = new Set<string>();
  const theirs = new Set<string>();
  for (const h of ctx.db.all<{ seatLabel: string; bookingId: string }>(
    `SELECT seatLabel, bookingId FROM seat_holds WHERE flightId = ? AND status IN ('ACTIVE','CONVERTED')`,
    [flight.id],
  )) {
    (h.bookingId === booking.id ? ours : theirs).add(h.seatLabel);
  }
  for (const t of ctx.db.all<{ seatLabel: string | null; bookingId: string }>(
    `SELECT seatLabel, bookingId FROM tickets WHERE flightId = ? AND status = 'ISSUED' AND seatLabel IS NOT NULL`,
    [flight.id],
  )) {
    (t.bookingId === booking.id ? ours : theirs).add(t.seatLabel as string);
  }
  for (const c of ctx.db.all<{ seatLabel: string | null; bookingId: string }>(
    'SELECT seatLabel, bookingId FROM checkins WHERE flightId = ? AND seatLabel IS NOT NULL',
    [flight.id],
  )) {
    (c.bookingId === booking.id ? ours : theirs).add(c.seatLabel as string);
  }

  const type = ctx.world.aircraftTypes.get(flight.aircraftTypeCode);
  const seatTemplate = (type?.seats ?? [])
    .filter((s) => s.active && !s.blocked)
    .sort((a, b) => a.row - b.row || a.letter.localeCompare(b.letter));
  const free = seatTemplate.filter((s) => !theirs.has(s.label));

  const carrier = ctx.world.carrier || 'F1';
  const flightDigits =
    flight.flightNumber.replace(new RegExp(`^${carrier}`, 'i'), '').replace(/\D/g, '') ||
    flight.flightNumber.replace(/\D/g, '');

  const claimed = new Set<string>();
  let sequence =
    (
      ctx.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM checkins WHERE flightId = ? AND status = 'CHECKED_IN'`,
        [flight.id],
      ) ?? { n: 0 }
    ).n + 1;

  const dtos: CheckInDto[] = [];
  for (const pax of pending) {
    const ticket = ticketByPax.get(pax.id)!;
    const desired = ticket.seatLabel
      ? seatTemplate.find((s) => s.label === ticket.seatLabel)
      : undefined;
    const useDesired =
      desired !== undefined && ours.has(desired.label) && !claimed.has(desired.label);
    const seat = useDesired ? desired : free.find((s) => !claimed.has(s.label));
    if (!seat) {
      throw new AppError(
        'SEAT_UNAVAILABLE',
        `No seat left on ${flight.flightNumber} — please contact the airline`,
      );
    }
    claimed.add(seat.label);

    const nowIso = new Date(ctx.now()).toISOString();
    const row = ctx.db.transaction(() => {
      if (!ours.has(seat.label)) {
        try {
          ctx.db.run(
            `INSERT INTO seat_holds (id, bookingId, userId, flightId, seatLabel, status, token,
                                     activeKey, expiresAt, createdAt, convertedAt)
             VALUES (?, ?, ?, ?, ?, 'CONVERTED', ?, NULL, ?, ?, ?)`,
            [
              randomId('hld'),
              booking.id,
              actor.user.id,
              flight.id,
              seat.label,
              randomId('tok'),
              flight.depUtc,
              nowIso,
              nowIso,
            ],
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (message.includes('UNIQUE')) {
            throw new AppError('SEAT_UNAVAILABLE', `Seat ${seat.label} was just taken`);
          }
          throw err;
        }
      }

      const existing = ctx.db.get<CheckInRowLite>('SELECT * FROM checkins WHERE passengerId = ?', [
        pax.id,
      ]);
      if (existing) {
        ctx.db.run(
          `UPDATE checkins SET seatLabel = ?, status = 'CHECKED_IN', boardingSequence = ?,
                               gate = ?, checkedInAt = ? WHERE passengerId = ?`,
          [seat.label, sequence, flight.gate, nowIso, pax.id],
        );
      } else {
        const id = randomId('chi');
        ctx.db.run(
          `INSERT INTO checkins (id, bookingId, passengerId, flightId, seatLabel, status,
                                 boardingSequence, gate, checkedInAt)
           VALUES (?, ?, ?, ?, ?, 'CHECKED_IN', ?, ?, ?)`,
          [id, booking.id, pax.id, flight.id, seat.label, sequence, flight.gate, nowIso],
        );
      }
      // Keep the coupon and the boarding record in agreement.
      ctx.db.run('UPDATE tickets SET seatLabel = ? WHERE id = ?', [seat.label, ticket.id]);
      return ctx.db.get<CheckInRowLite>('SELECT * FROM checkins WHERE passengerId = ?', [pax.id])!;
    });

    sequence += 1;

    const bcbp = buildBcbp({
      lastName: pax.lastName,
      firstName: pax.firstName,
      pnr: booking.pnr,
      origin: flight.originCode,
      destination: flight.destinationCode,
      carrier,
      flightNumber: flightDigits,
      departureUtc: new Date(flight.depUtc),
      bookingClass: segment.fareClassCode.charAt(0) || 'Y',
      seat: seat.label,
      sequence: row.boardingSequence ?? 1,
    });
    let passId = ctx.db.get<{ id: string }>('SELECT id FROM boarding_passes WHERE checkInId = ?', [
      row.id,
    ])?.id;
    if (passId) {
      ctx.db.run('UPDATE boarding_passes SET bcbp = ? WHERE checkInId = ?', [bcbp, row.id]);
    } else {
      passId = randomId('bp');
      ctx.db.run(
        `INSERT INTO boarding_passes (id, checkInId, bcbp, format, issuedAt) VALUES (?, ?, ?, 'PDF', ?)`,
        [passId, row.id, bcbp, nowIso],
      );
      ctx.db.run('UPDATE checkins SET boardingPassId = ? WHERE id = ?', [passId, row.id]);
    }

    dtos.push(toCheckInDto({ ...row, boardingPassId: passId }, `${pax.firstName} ${pax.lastName}`));
  }

  // Everyone aboard → booking-level CHECKED_IN.
  let bookingStatus = booking.status;
  if (booking.status === 'CONFIRMED') {
    const checkedCount = (
      ctx.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM checkins WHERE bookingId = ? AND status = 'CHECKED_IN'`,
        [booking.id],
      ) ?? { n: 0 }
    ).n;
    if (checkedCount >= allPassengers.length) {
      const flipped = ctx.db.run(
        `UPDATE bookings SET status = 'CHECKED_IN' WHERE id = ? AND status = 'CONFIRMED'`,
        [booking.id],
      );
      if (flipped.changes === 1) bookingStatus = 'CHECKED_IN';
    }
  }

  const merged = new Map<string, CheckInDto>();
  for (const pax of alreadyChecked) {
    const stored = checkedByPax.get(pax.id)!;
    merged.set(pax.id, toCheckInDto(stored, `${pax.firstName} ${pax.lastName}`));
  }
  for (const dto of dtos) merged.set(dto.bookingPassengerId, dto);
  return {
    checkIns: [...merged.values()],
    bookingStatus: bookingStatus as BookingStatus,
  };
}

export function getCheckInsByBooking(
  ctx: EngineCtx,
  actor: Actor,
  bookingId: string,
): CheckInResultDto {
  const booking = loadBooking(ctx, bookingId);
  assertBookingAccess(booking, bookingActor(actor));
  const passengers = loadPassengers(ctx, bookingId);
  const rows = ctx.db.all<CheckInRowLite>('SELECT * FROM checkins WHERE bookingId = ?', [
    bookingId,
  ]);
  const byPax = new Map(rows.map((r) => [r.passengerId, r]));
  const checkIns = passengers
    .map((p) => byPax.get(p.id))
    .filter((r): r is CheckInRowLite => Boolean(r))
    .map((row) => {
      const pax = passengers.find((p) => p.id === row.passengerId);
      return toCheckInDto(row, pax ? `${pax.firstName} ${pax.lastName}` : '');
    });
  return { checkIns, bookingStatus: booking.status as BookingStatus };
}

// ── boarding pass (port of CheckInService.getBoardingPass) ──────────────────

export function getBoardingPass(ctx: EngineCtx, actor: Actor, id: string): BoardingPassDto {
  const pass = ctx.db.get<{
    id: string;
    checkInId: string;
    bcbp: string;
    format: string;
    issuedAt: string;
  }>('SELECT * FROM boarding_passes WHERE id = ? OR checkInId = ?', [id, id]);
  if (!pass) fail('NOT_FOUND', 'Boarding pass not found');
  const checkIn = ctx.db.get<CheckInRowLite & { bookingId: string }>(
    'SELECT * FROM checkins WHERE id = ?',
    [pass.checkInId],
  );
  if (!checkIn) fail('NOT_FOUND', 'Boarding pass not found');
  const booking = loadBooking(ctx, checkIn.bookingId);
  assertBookingAccess(booking, bookingActor(actor));
  const pax = ctx.db.get<{ firstName: string; lastName: string }>(
    'SELECT firstName, lastName FROM booking_passengers WHERE id = ?',
    [checkIn.passengerId],
  );
  const flight = ctx.db.get<FlightRow>('SELECT * FROM flights WHERE id = ?', [checkIn.flightId]);
  if (!flight) fail('NOT_FOUND', 'Flight not found');
  const ticket = ctx.db.get<{ ticketNumber: string }>(
    'SELECT ticketNumber FROM tickets WHERE passengerId = ?',
    [checkIn.passengerId],
  );

  return {
    id: pass.id,
    checkInId: pass.checkInId,
    bcbp: pass.bcbp,
    format: pass.format,
    issuedAt: pass.issuedAt,
    passengerName: pax ? `${pax.firstName} ${pax.lastName}` : '',
    ticketNumber: ticket?.ticketNumber ?? null,
    flightNumber: flight.flightNumber,
    originCode: flight.originCode,
    destinationCode: flight.destinationCode,
    departureUtc: flight.depUtc,
    boardingUtc: flight.boardingUtc,
    gate: checkIn.gate,
    seatLabel: checkIn.seatLabel,
    boardingSequence: checkIn.boardingSequence,
  };
}

// ── baggage (port of BaggageService.forBooking) ─────────────────────────────

const STAGE_ORDER: BaggageStageCode[] = [
  'NOT_ACCEPTED',
  'ACCEPTED',
  'LOADED',
  'IN_TRANSIT',
  'LANDED',
  'ON_BELT',
];

function isAtLeast(current: BaggageStageCode, target: BaggageStageCode): boolean {
  return STAGE_ORDER.indexOf(current) >= STAGE_ORDER.indexOf(target);
}

function stageFor(status: string, actualArrUtc: string | null): BaggageStageCode {
  if (status === 'LANDED' || (actualArrUtc && Date.parse(actualArrUtc) < Date.now())) {
    return 'ON_BELT';
  }
  if (status === 'IN_AIR' || status === 'DEPARTED') return 'IN_TRANSIT';
  if (status === 'BOARDING') return 'LOADED';
  return 'ACCEPTED';
}

export function baggageForBooking(ctx: EngineCtx, actor: Actor, bookingId: string): BaggageDto {
  const booking = loadBooking(ctx, bookingId);
  assertBookingAccess(booking, bookingActor(actor));

  const tickets = ctx.db.all<{
    ticketNumber: string;
    baggageKg: number;
    issuedAt: string | null;
    passengerId: string;
    flightId: string;
  }>('SELECT * FROM tickets WHERE bookingId = ? ORDER BY ticketNumber', [bookingId]);

  const items = tickets.map((row) => {
    const flight = ctx.db.get<FlightRow>('SELECT * FROM flights WHERE id = ?', [row.flightId]);
    if (!flight) fail('NOT_FOUND', 'Flight not found');
    const pax = ctx.db.get<{ firstName: string; lastName: string }>(
      'SELECT firstName, lastName FROM booking_passengers WHERE id = ?',
      [row.passengerId],
    );
    const status = deriveStatus(flight, ctx.now());
    const stage = stageFor(status, null);
    const events: BaggageEventDto[] = [
      {
        code: 'ACCEPTED',
        label: `Accepted at ${flight.originCode}`,
        at: row.issuedAt,
        done: true,
      },
      {
        code: 'LOADED',
        label: `Loaded onto ${flight.flightNumber}`,
        at: flight.boardingUtc,
        done: isAtLeast(stage, 'LOADED'),
      },
      {
        code: 'IN_TRANSIT',
        label: `In transit to ${flight.destinationCode}`,
        at: null,
        done: isAtLeast(stage, 'IN_TRANSIT'),
      },
      {
        code: 'LANDED',
        label: `Landed at ${flight.destinationCode}`,
        at: null,
        done: isAtLeast(stage, 'LANDED'),
      },
      {
        code: 'ON_BELT',
        label: `On the baggage belt at ${flight.destinationCode}`,
        at: null,
        done: isAtLeast(stage, 'ON_BELT'),
      },
    ];
    return {
      ticketNumber: row.ticketNumber,
      passengerName: pax ? `${pax.firstName} ${pax.lastName}` : '',
      weightKg: row.baggageKg,
      originCode: flight.originCode,
      destinationCode: flight.destinationCode,
      flightNumber: flight.flightNumber,
      events,
      current: stage,
    };
  });

  return { bookingId: booking.id, pnr: booking.pnr, items };
}

// ── ticketing (idempotent issue) ────────────────────────────────────────────

export function issueBookingTickets(
  ctx: EngineCtx,
  actor: Actor,
  bookingId: string,
): TicketIssueResultDto {
  const booking = loadBooking(ctx, bookingId);
  assertBookingAccess(booking, bookingActor(actor));
  const result = issueTickets(ctx, bookingId);
  return { tickets: ticketDtos(ctx, result.tickets), alreadyIssued: result.alreadyIssued };
}
