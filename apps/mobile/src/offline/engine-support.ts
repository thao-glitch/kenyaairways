/**
 * Shared plumbing for the on-device engine: request context, actor
 * resolution, the booking/ticket mappers and the inventory state machine.
 *
 * Everything here is a faithful port of the NestJS services at a 1:1 grain —
 * same DTOs, same error codes, same transition rules — so the screens can
 * never tell local answers from PC-backend answers.
 */
import {
  AppError,
  canTransition,
  randomPnr,
  toLocalIso,
  type BookingBreakdownLineDto,
  type ErrorCode,
  type BookingDto,
  type BookingSegmentDto,
  type BookingStatus,
  type Locale,
  type Role,
  type SessionUserDto,
  type TicketDto,
} from '@kenyaairways/shared';
import type { SqlDb } from './db';
import { parseToken as parseLoc } from './session';
import type { LocalRequest } from './types';
import type { World } from './world';

export interface EngineCtx {
  db: SqlDb;
  world: World;
  /** Injectable clock (tests freeze it). */
  now: () => number;
}

export const STAFF_ROLES: Role[] = ['AGENT', 'OPS', 'FINANCE', 'ADMIN'];

/** Payment states a confirm path may claim (port of payments/queues.ts). */
export const PAYMENT_STATUSES_TO_CLAIM: readonly string[] = [
  'REQUIRES_ACTION',
  'PENDING',
  'FAILED',
];

/** Fallback TTL when a caller doesn't supply one (remote tokens: 15 min). */
export const REMOTE_TOKEN_TTL_SEC = 900;

// ── errors ──────────────────────────────────────────────────────────────────

export function fail(code: ErrorCode, message: string): never {
  throw new AppError(code, message);
}

// ── user rows ───────────────────────────────────────────────────────────────

export interface UserRow {
  id: string;
  email: string | null;
  phone: string | null;
  passwordHash: string;
  firstName: string;
  lastName: string;
  role: string;
  status: string;
  locale: string;
  emailVerified: number;
  phoneVerified: number;
  createdAt: string;
}

export function toSessionUser(row: UserRow): SessionUserDto {
  return {
    id: row.id,
    email: row.email,
    phone: row.phone,
    firstName: row.firstName,
    lastName: row.lastName,
    role: row.role as Role,
    locale: row.locale as Locale,
    emailVerified: row.emailVerified === 1,
    phoneVerified: row.phoneVerified === 1,
  };
}

// ── actor resolution ────────────────────────────────────────────────────────

/**
 * The device identity behind a request:
 *  - a `loc.` token minted by this engine (offline login), or
 *  - a bearer token equal to the one stored in `local_session` (a remote
 *    login that happened while the PC was up).
 */
export function resolveActor(
  ctx: EngineCtx,
  req: LocalRequest,
): { user: SessionUserDto; local: boolean } | null {
  const raw = req.authorization?.startsWith('Bearer ')
    ? req.authorization.slice('Bearer '.length).trim()
    : null;
  if (!raw) return null;
  const nowSec = Math.floor(ctx.now() / 1000);

  if (raw.startsWith('loc.')) {
    const uid = requireLocalUid(raw, nowSec);
    const row = ctx.db.get<UserRow>('SELECT * FROM users WHERE id = ?', [uid]);
    return row ? { user: toSessionUser(row), local: true } : null;
  }

  const session = ctx.db.get<{ user_id: string; user_json: string; access_token: string }>(
    'SELECT user_id, user_json, access_token FROM local_session WHERE id = 1',
  );
  if (!session || session.access_token !== raw) return null;
  try {
    const user = JSON.parse(session.user_json) as SessionUserDto;
    // Prefer the live row when the account exists locally (role can change).
    const row = ctx.db.get<UserRow>('SELECT * FROM users WHERE id = ?', [session.user_id]);
    return { user: row ? toSessionUser(row) : user, local: false };
  } catch {
    return null;
  }
}

export function requireLocalUid(raw: string, nowSec: number): string {
  const uid = parseLoc(raw, 'loc', nowSec);
  if (!uid) throw new AppError('TOKEN_EXPIRED', 'Local session expired — sign in again');
  return uid;
}

export type Actor = NonNullable<ReturnType<typeof resolveActor>>;

export function requireAuth(actor: Actor | null): Actor {
  if (!actor) throw new AppError('UNAUTHENTICATED', 'Authentication required');
  return actor;
}

export function requireRole(actor: Actor, roles: Role[]): Actor {
  if (!roles.includes(actor.user.role)) {
    throw new AppError('FORBIDDEN', 'Your account cannot perform this action');
  }
  return actor;
}

/** BookingActor shape the ported services expect. */
export interface BookingActorLike {
  userId: string | null;
  role: Role;
  locale: string;
  phone?: string | null;
}

export function bookingActor(actor: Actor): BookingActorLike {
  return {
    userId: actor.user.id,
    role: actor.user.role,
    locale: actor.user.locale,
    phone: actor.user.phone,
  };
}

export function assertBookingAccess(
  booking: { userId: string | null },
  actor: BookingActorLike,
): void {
  if (STAFF_ROLES.includes(actor.role)) return;
  if (actor.userId && booking.userId === actor.userId) return;
  throw new AppError('FORBIDDEN', 'You do not have access to this booking');
}

// ── local identity persistence ──────────────────────────────────────────────

/**
 * Remember the last successful login (remote OR local) so /auth/me and every
 * owner-guarded endpoint keep working once the PC backend goes down.
 */
export function syncLocalIdentity(
  ctx: EngineCtx,
  user: SessionUserDto,
  tokens: { accessToken: string; refreshToken: string; accessTokenExpiresInSec?: number },
): void {
  const ttl = tokens.accessTokenExpiresInSec ?? REMOTE_TOKEN_TTL_SEC;
  ctx.db.run(
    `INSERT INTO local_session (id, user_id, user_json, access_token, refresh_token, expires_at)
     VALUES (1, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       user_id = excluded.user_id,
       user_json = excluded.user_json,
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       expires_at = excluded.expires_at`,
    [
      user.id,
      JSON.stringify(user),
      tokens.accessToken,
      tokens.refreshToken,
      Math.floor(ctx.now() / 1000) + ttl,
    ],
  );
}

// ── flight helpers ──────────────────────────────────────────────────────────

export interface FlightRow {
  id: string;
  scheduleId: string;
  flightNumber: string;
  originCode: string;
  destinationCode: string;
  routeType: string;
  aircraftTypeCode: string;
  flightDate: string;
  depUtc: string;
  arrUtc: string;
  boardingUtc: string | null;
  status: string;
  gate: string | null;
  delayMinutes: number;
  currency: string;
  saleStatus: string;
}

/**
 * Read-time status derivation: offline flights are never cancelled or
 * delayed, so the wall clock alone drives the progression
 * SCHEDULED → BOARDING → DEPARTED → IN_AIR → LANDED.
 */
export function deriveStatus(flight: FlightRow, nowMs: number): string {
  if (flight.status === 'CANCELLED') return 'CANCELLED';
  const dep = Date.parse(flight.depUtc);
  const arr = Date.parse(flight.arrUtc);
  if (nowMs >= arr) return 'LANDED';
  if (nowMs >= dep + 10 * 60_000) return 'IN_AIR';
  if (nowMs >= dep) return 'DEPARTED';
  if (flight.boardingUtc && nowMs >= Date.parse(flight.boardingUtc)) return 'BOARDING';
  return 'SCHEDULED';
}

export function loadFlight(ctx: EngineCtx, id: string): FlightRow {
  const row = ctx.db.get<FlightRow>('SELECT * FROM flights WHERE id = ?', [id]);
  if (!row) throw new AppError('NOT_FOUND', 'Flight not found');
  return row;
}

// ── inventory (port of InventoryService: single conditional UPDATEs) ────────

/** seatsAvailable = seatsTotal - seatsHeld - seatsSold - seatsBlocked */
export function inventoryHold(
  db: SqlDb,
  flightId: string,
  fareClassCode: string,
  seats: number,
): boolean {
  if (seats <= 0) return true;
  const res = db.run(
    `UPDATE inventory SET seatsHeld = seatsHeld + ?
      WHERE flightId = ? AND fareClassCode = ?
        AND (seatsTotal - seatsHeld - seatsSold - seatsBlocked) >= ?`,
    [seats, flightId, fareClassCode, seats],
  );
  return res.changes === 1;
}

export function inventoryConvertHoldToSold(
  db: SqlDb,
  flightId: string,
  fareClassCode: string,
  seats: number,
): boolean {
  if (seats <= 0) return true;
  const res = db.run(
    `UPDATE inventory SET seatsHeld = max(seatsHeld - ?, 0), seatsSold = seatsSold + ?
      WHERE flightId = ? AND fareClassCode = ? AND seatsHeld >= ?`,
    [seats, seats, flightId, fareClassCode, seats],
  );
  return res.changes === 1;
}

export function inventoryReleaseHold(
  db: SqlDb,
  flightId: string,
  fareClassCode: string,
  seats: number,
): void {
  if (seats <= 0) return;
  db.run(
    `UPDATE inventory SET seatsHeld = max(seatsHeld - ?, 0)
      WHERE flightId = ? AND fareClassCode = ?`,
    [seats, flightId, fareClassCode],
  );
}

export function inventoryReleaseSold(
  db: SqlDb,
  flightId: string,
  fareClassCode: string,
  seats: number,
): void {
  if (seats <= 0) return;
  db.run(
    `UPDATE inventory SET seatsSold = max(seatsSold - ?, 0)
      WHERE flightId = ? AND fareClassCode = ?`,
    [seats, flightId, fareClassCode],
  );
}

// ── booking loading + DTO ───────────────────────────────────────────────────

export interface BookingRow {
  id: string;
  pnr: string;
  userId: string | null;
  status: string;
  tripType: string;
  source: string;
  currency: string;
  totalMinor: number;
  breakdownJson: string;
  contactEmail: string | null;
  contactPhone: string | null;
  adultCount: number;
  childCount: number;
  infantCount: number;
  locale: string;
  holdExpiresAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
}

export interface SegmentRow {
  seq: number;
  bookingId: string;
  flightId: string;
  fareClassCode: string;
  originCode: string;
  destinationCode: string;
  depUtc: string;
  arrUtc: string;
  fareMinor: number;
  currency: string;
  flightNumber: string | null;
  originTz: string | null;
  destTz: string | null;
}

export interface PaxRow {
  id: string;
  bookingId: string;
  seq: number;
  type: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  docType: string | null;
}

export interface HoldRow {
  id: string;
  bookingId: string;
  flightId: string;
  seatLabel: string;
  status: string;
  expiresAt: string;
}

export function loadSegments(ctx: EngineCtx, bookingId: string): SegmentRow[] {
  return ctx.db.all<SegmentRow>(
    `SELECT s.*, f.flightNumber,
            (SELECT timezone FROM airports WHERE code = s.originCode) AS originTz,
            (SELECT timezone FROM airports WHERE code = s.destinationCode) AS destTz
       FROM booking_segments s
       LEFT JOIN flights f ON f.id = s.flightId
      WHERE s.bookingId = ?
      ORDER BY s.seq`,
    [bookingId],
  );
}

export function loadPassengers(ctx: EngineCtx, bookingId: string): PaxRow[] {
  return ctx.db.all<PaxRow>('SELECT * FROM booking_passengers WHERE bookingId = ? ORDER BY seq', [
    bookingId,
  ]);
}

export function loadHolds(ctx: EngineCtx, bookingId: string): HoldRow[] {
  return ctx.db.all<HoldRow>('SELECT * FROM seat_holds WHERE bookingId = ? ORDER BY createdAt', [
    bookingId,
  ]);
}

export function loadBooking(ctx: EngineCtx, id: string): BookingRow {
  const row = ctx.db.get<BookingRow>('SELECT * FROM bookings WHERE id = ?', [id]);
  if (!row) throw new AppError('NOT_FOUND', 'Booking not found');
  return row;
}

export function toBookingDto(ctx: EngineCtx, booking: BookingRow): BookingDto {
  const segments = loadSegments(ctx, booking.id);
  const passengers = loadPassengers(ctx, booking.id);
  const holds = loadHolds(ctx, booking.id);

  const breakdown: BookingBreakdownLineDto[] = (() => {
    try {
      return JSON.parse(booking.breakdownJson) as BookingBreakdownLineDto[];
    } catch {
      return [];
    }
  })();

  const segDtos: BookingSegmentDto[] = segments.map((s) => ({
    seq: s.seq,
    flightId: s.flightId,
    flightNumber: s.flightNumber ?? '',
    originCode: s.originCode,
    destinationCode: s.destinationCode,
    departUtc: s.depUtc,
    arriveUtc: s.arrUtc,
    departLocal: toLocalIso(s.depUtc, s.originTz ?? 'Africa/Nairobi'),
    arriveLocal: toLocalIso(s.arrUtc, s.destTz ?? 'Africa/Nairobi'),
    fareClassCode: s.fareClassCode,
    fareMinor: s.fareMinor,
    currency: s.currency as BookingSegmentDto['currency'],
  }));

  return {
    id: booking.id,
    pnr: booking.pnr,
    status: booking.status as BookingStatus,
    tripType: booking.tripType as BookingDto['tripType'],
    source: booking.source as BookingDto['source'],
    currency: booking.currency as BookingDto['currency'],
    totalMinor: booking.totalMinor,
    breakdown,
    contactEmail: booking.contactEmail,
    contactPhone: booking.contactPhone,
    adultCount: booking.adultCount,
    childCount: booking.childCount,
    infantCount: booking.infantCount,
    locale: booking.locale,
    holdExpiresAt: booking.holdExpiresAt,
    expiresAt: booking.expiresAt,
    createdAt: booking.createdAt,
    segments: segDtos,
    passengers: passengers.map((p) => ({
      seq: p.seq,
      type: p.type as BookingDto['passengers'][number]['type'],
      firstName: p.firstName,
      lastName: p.lastName,
      email: p.email,
      phone: p.phone,
      docType: p.docType as BookingDto['passengers'][number]['docType'],
    })),
    seatHolds: holds.map((h) => ({
      flightId: h.flightId,
      seatLabel: h.seatLabel,
      status: h.status as 'ACTIVE' | 'RELEASED' | 'CONVERTED' | 'EXPIRED',
      expiresAt: h.expiresAt,
    })),
  };
}

// ── booking transitions (port of BookingsService.transition) ────────────────

/**
 * Optimistic status transition guarded by `canTransition`, releasing
 * inventory + seat holds through the caller's callback.
 */
export function transitionBooking(
  ctx: EngineCtx,
  id: string,
  to: BookingStatus,
  release: (db: SqlDb, current: BookingRow) => void,
): boolean {
  return ctx.db.transaction(() => {
    const current = ctx.db.get<BookingRow>('SELECT * FROM bookings WHERE id = ?', [id]);
    if (!current || !canTransition(current.status as BookingStatus, to)) return false;
    const res = ctx.db.run(
      `UPDATE bookings SET status = ?,
              cancelledAt = CASE WHEN ? = 'CANCELLED' THEN ? ELSE cancelledAt END,
                confirmedAt = CASE WHEN ? = 'CONFIRMED' THEN ? ELSE confirmedAt END
        WHERE id = ? AND status = ?`,
      [
        to,
        to,
        new Date(ctx.now()).toISOString(),
        to,
        new Date(ctx.now()).toISOString(),
        id,
        current.status,
      ],
    );
    if (res.changes !== 1) return false;
    release(ctx.db, current);
    return true;
  });
}

/** Payment captured: CONFIRMED + held seats become sold (idempotent). */
export function confirmBookingPaid(ctx: EngineCtx, id: string): boolean {
  return transitionBooking(ctx, id, 'CONFIRMED', (db, current) => {
    const seats = current.adultCount + current.childCount;
    const segments = ctx.db.all<{ flightId: string; fareClassCode: string }>(
      'SELECT flightId, fareClassCode FROM booking_segments WHERE bookingId = ? ORDER BY seq',
      [id],
    );
    for (const seg of segments) {
      inventoryConvertHoldToSold(db, seg.flightId, seg.fareClassCode, seats);
    }
    db.run(
      `UPDATE seat_holds SET status = 'CONVERTED', convertedAt = ?, activeKey = NULL
        WHERE bookingId = ? AND status = 'ACTIVE'`,
      [new Date(ctx.now()).toISOString(), id],
    );
  });
}

// ── ticketing (port of TicketingService.issue) ──────────────────────────────

export interface TicketRow {
  id: string;
  bookingId: string;
  passengerId: string;
  flightId: string;
  seatLabel: string | null;
  ticketNumber: string;
  status: string;
  baggageKg: number;
  fareMinor: number;
  taxesMinor: number;
  currency: string;
  issuedAt: string | null;
}

export function toTicketDto(row: TicketRow, passengerName: string): TicketDto {
  return {
    id: row.id,
    bookingId: row.bookingId,
    passengerId: row.passengerId,
    passengerName,
    flightId: row.flightId,
    seatLabel: row.seatLabel,
    ticketNumber: row.ticketNumber,
    status: row.status as TicketDto['status'],
    baggageKg: row.baggageKg,
    fareMinor: row.fareMinor,
    taxesMinor: row.taxesMinor,
    currency: row.currency as TicketDto['currency'],
    issuedAt: row.issuedAt,
  };
}

/** 13-char airline document number: `013` + 10 digits (unique index retries). */
export function issueTicketNumber(db: SqlDb): string {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const serial = Math.floor(Math.random() * 1_000_000_000);
    const candidate = `013${String(serial).padStart(10, '0')}`;
    const clash = db.get<{ id: string }>('SELECT id FROM tickets WHERE ticketNumber = ?', [
      candidate,
    ]);
    if (!clash) return candidate;
  }
  throw new AppError('INTERNAL_ERROR', 'Could not allocate a unique ticket number');
}

/**
 * Issue one e-ticket per passenger for a CONFIRMED booking — idempotent:
 * a replay returns the existing rows. Seats come from CONVERTED then
 * still-ACTIVE holds on the primary segment, exactly like the server.
 */
export function issueTickets(
  ctx: EngineCtx,
  bookingId: string,
): { tickets: TicketRow[]; alreadyIssued: boolean } {
  const booking = ctx.db.get<BookingRow>('SELECT * FROM bookings WHERE id = ?', [bookingId]);
  if (!booking) throw new AppError('NOT_FOUND', 'Booking not found');

  const existing = ctx.db.all<TicketRow>('SELECT * FROM tickets WHERE bookingId = ? ORDER BY id', [
    bookingId,
  ]);
  if (existing.length > 0) return { tickets: existing, alreadyIssued: true };
  if (!['CONFIRMED', 'CHECKED_IN'].includes(booking.status)) {
    throw new AppError(
      'INVALID_STATE_TRANSITION',
      `Tickets can only be issued for a confirmed booking — this one is ${booking.status}`,
    );
  }

  const segments = ctx.db.all<{
    seq: number;
    flightId: string;
    fareClassCode: string;
    fareMinor: number;
  }>(
    'SELECT seq, flightId, fareClassCode, fareMinor FROM booking_segments WHERE bookingId = ? ORDER BY seq',
    [bookingId],
  );
  const primary = segments[0];
  if (!primary) throw new AppError('INVALID_STATE_TRANSITION', 'Booking has no segments');

  const passengers = loadPassengers(ctx, bookingId);
  const holds = ctx.db.all<{ flightId: string; seatLabel: string; status: string }>(
    `SELECT flightId, seatLabel, status FROM seat_holds
      WHERE bookingId = ? AND status IN ('ACTIVE', 'CONVERTED') ORDER BY createdAt`,
    [bookingId],
  );
  const orderedSeats = [
    ...holds.filter((h) => h.flightId === primary.flightId && h.status === 'CONVERTED'),
    ...holds.filter((h) => h.flightId === primary.flightId && h.status === 'ACTIVE'),
  ];

  const baseMinor = segments.reduce((sum, s) => sum + s.fareMinor, 0);
  const taxesMinor = Math.max(0, booking.totalMinor - baseMinor);
  const fareClass = ctx.db.get<{ baggageKg: number }>(
    'SELECT baggageKg FROM fare_classes WHERE code = ?',
    [primary.fareClassCode],
  );

  const created = ctx.db.transaction(() => {
    const rows: TicketRow[] = [];
    passengers.forEach((pax, idx) => {
      const seat = orderedSeats[idx]?.seatLabel ?? null;
      const ticketNumber = issueTicketNumber(ctx.db);
      const id = `tkt_${ticketNumber.slice(-10)}_${idx}`;
      ctx.db.run(
        `INSERT INTO tickets (id, bookingId, passengerId, flightId, seatLabel, ticketNumber,
                              status, baggageKg, fareMinor, taxesMinor, currency, issuedAt)
         VALUES (?, ?, ?, ?, ?, ?, 'ISSUED', ?, ?, ?, ?, ?)`,
        [
          id,
          bookingId,
          pax.id,
          primary.flightId,
          seat,
          ticketNumber,
          fareClass?.baggageKg ?? 23,
          baseMinor,
          taxesMinor,
          booking.currency,
          new Date(ctx.now()).toISOString(),
        ],
      );
      rows.push({
        id,
        bookingId,
        passengerId: pax.id,
        flightId: primary.flightId,
        seatLabel: seat,
        ticketNumber,
        status: 'ISSUED',
        baggageKg: fareClass?.baggageKg ?? 23,
        fareMinor: baseMinor,
        taxesMinor,
        currency: booking.currency,
        issuedAt: new Date(ctx.now()).toISOString(),
      });
    });
    return rows;
  });

  return { tickets: created, alreadyIssued: false };
}

export function ticketDtos(ctx: EngineCtx, tickets: TicketRow[]): TicketDto[] {
  return tickets.map((t) => {
    const pax = ctx.db.get<{ firstName: string; lastName: string }>(
      'SELECT firstName, lastName FROM booking_passengers WHERE id = ?',
      [t.passengerId],
    );
    return toTicketDto(t, pax ? `${pax.firstName} ${pax.lastName}` : '');
  });
}

// ── misc ────────────────────────────────────────────────────────────────────

export function uniquePnr(db: SqlDb): string {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = randomPnr();
    const clash = db.get<{ id: string }>('SELECT id FROM bookings WHERE pnr = ?', [candidate]);
    if (!clash) return candidate;
  }
  throw new AppError('INTERNAL_ERROR', 'Could not allocate a unique PNR');
}

export function randomId(prefix: string): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 16; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `${prefix}_${out}`;
}

/** Parse an int query param with bounds, mirroring the DTO validators. */
export function intParam(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}
