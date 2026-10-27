/**
 * Admin console endpoints — port of admin-flights.controller /
 * admin-bookings.controller / reports.service / mpesa-verifier.service /
 * site-settings.service against SQLite.
 *
 * Role gates mirror the server (@Roles decorators): flight pricing needs
 * ADMIN/FINANCE/OPS, the assistance desk ADMIN/AGENT/FINANCE, reports
 * FINANCE/ADMIN (load also OPS), site settings ADMIN.
 */
import {
  AppError,
  normalizeBrandName,
  toLocalIso,
  toMpesaMsisdn,
  type AdminBookingSummaryDto,
  type AdminFlightPriceDto,
  type AdminUserDto,
  type BookingStatus,
  type BulkPriceUpdateResultDto,
  type LoadReportDto,
  type LoadFactorRowDto,
  type ManualVerifyStatus,
  type MpesaManualVerificationDto,
  type MpesaVerifyCheckDto,
  type Paginated,
  type PaymentDto,
  type PaymentProviderType,
  type RevenueDayDto,
  type RevenueReportDto,
  type SiteImagesDto,
  type SiteSettingsDto,
  type SiteTheme,
} from '@kenyaairways/shared';
import {
  PAYMENT_STATUSES_TO_CLAIM,
  confirmBookingPaid,
  deriveStatus,
  fail,
  loadBooking,
  randomId,
  type Actor,
  type BookingActorLike,
  type EngineCtx,
  type FlightRow,
  type TicketRow,
} from './engine-support';
import { parseMpesaSms } from './mpesa-sms';

const MAX_LIST = 100;
const BOOKINGS_LIST = 60;
const FLOOR_MINOR = 1_000; // never price below KES 10
const VERIFIER_PAGE_SIZE = 25;
const MAX_MESSAGE_CHARS = 4_000;
const MAX_RANGE_DAYS = 366;
const NAIROBI_OFFSET = '+03:00';

export const SITE_THEMES: SiteTheme[] = [
  'sky',
  'savanna',
  'ocean',
  'forest',
  'midnight',
  'crimson',
];

// ── admin flights (price manager) ───────────────────────────────────────────

interface AdminFlightQuery {
  origin?: string;
  destination?: string;
  dateFrom?: string;
  dateTo?: string;
}

export function adminListFlights(ctx: EngineCtx, q: AdminFlightQuery): AdminFlightPriceDto[] {
  const rows = ctx.db.all<FlightRow & { originTz: string }>(
    `SELECT f.*, (SELECT timezone FROM airports WHERE code = f.originCode) AS originTz
       FROM flights f
      WHERE (? IS NULL OR upper(originCode) = ?)
        AND (? IS NULL OR upper(destinationCode) = ?)
        AND (? IS NULL OR flightDate >= ?)
        AND (? IS NULL OR flightDate <= ?)
      ORDER BY flightDate, depUtc
      LIMIT ?`,
    [
      q.origin?.toUpperCase() ?? null,
      q.origin?.toUpperCase() ?? null,
      q.destination?.toUpperCase() ?? null,
      q.destination?.toUpperCase() ?? null,
      q.dateFrom ?? null,
      q.dateFrom ?? null,
      q.dateTo ?? null,
      q.dateTo ?? null,
      MAX_LIST,
    ],
  );

  return rows.map((f) => {
    const fares = ctx.db.all<{ fareClassCode: string; baseFareMinor: number }>(
      `SELECT fareClassCode, baseFareMinor FROM fares WHERE flightId = ? ORDER BY baseFareMinor`,
      [f.id],
    );
    return {
      flightId: f.id,
      flightNumber: f.flightNumber,
      flightDate: f.flightDate,
      originCode: f.originCode,
      destinationCode: f.destinationCode,
      status: deriveStatus(f, ctx.now()) as AdminFlightPriceDto['status'],
      departureLocal: toLocalIso(f.depUtc, f.originTz ?? 'Africa/Nairobi'),
      fares: fares.map((fa) => ({
        fareClassCode: fa.fareClassCode,
        baseFareMinor: fa.baseFareMinor,
        currency: f.currency as AdminFlightPriceDto['fares'][number]['currency'],
      })),
    };
  });
}

export function adminSetFlightPrices(
  ctx: EngineCtx,
  flightId: string,
  fares: Array<{ fareClassCode?: string; baseFareMinor?: number }>,
): BulkPriceUpdateResultDto {
  const flight = ctx.db.get<{ id: string }>('SELECT id FROM flights WHERE id = ?', [flightId]);
  if (!flight) return { flightsUpdated: 0, faresUpdated: 0 };
  let faresUpdated = 0;
  for (const fare of fares) {
    if (!fare.fareClassCode || typeof fare.baseFareMinor !== 'number') continue;
    const res = ctx.db.run(
      `UPDATE fares SET baseFareMinor = ? WHERE flightId = ? AND upper(fareClassCode) = ?`,
      [fare.baseFareMinor, flightId, fare.fareClassCode.toUpperCase()],
    );
    faresUpdated += res.changes;
  }
  return { flightsUpdated: faresUpdated > 0 ? 1 : 0, faresUpdated };
}

export function adminBulkPrices(
  ctx: EngineCtx,
  dto: {
    originCode?: string;
    destinationCode?: string;
    dateFrom?: string;
    dateTo?: string;
    operation?: string;
    value?: number;
  },
): BulkPriceUpdateResultDto {
  if (dto.operation !== 'ADJUST_PERCENT') {
    fail('VALIDATION_ERROR', `Unsupported operation "${dto.operation ?? ''}"`);
  }
  const value = Number(dto.value);
  if (!Number.isFinite(value) || value < -90 || value > 900) {
    fail('VALIDATION_ERROR', 'value must be a percent between -90 and 900');
  }

  const flights = ctx.db.all<{ id: string }>(
    `SELECT id FROM flights
      WHERE (? IS NULL OR originCode = ?)
        AND (? IS NULL OR destinationCode = ?)
        AND (? IS NULL OR flightDate >= ?)
        AND (? IS NULL OR flightDate <= ?)`,
    [
      dto.originCode?.toUpperCase() ?? null,
      dto.originCode?.toUpperCase() ?? null,
      dto.destinationCode?.toUpperCase() ?? null,
      dto.destinationCode?.toUpperCase() ?? null,
      dto.dateFrom ?? null,
      dto.dateFrom ?? null,
      dto.dateTo ?? null,
      dto.dateTo ?? null,
    ],
  );
  if (flights.length === 0) return { flightsUpdated: 0, faresUpdated: 0 };

  let changed = 0;
  ctx.db.transaction(() => {
    for (const flight of flights) {
      const fares = ctx.db.all<{ fareClassCode: string; baseFareMinor: number }>(
        'SELECT fareClassCode, baseFareMinor FROM fares WHERE flightId = ?',
        [flight.id],
      );
      for (const fare of fares) {
        const next = Math.max(FLOOR_MINOR, Math.round(fare.baseFareMinor * (1 + value / 100)));
        if (next === fare.baseFareMinor) continue;
        ctx.db.run('UPDATE fares SET baseFareMinor = ? WHERE flightId = ? AND fareClassCode = ?', [
          next,
          flight.id,
          fare.fareClassCode,
        ]);
        changed += 1;
      }
    }
  });
  return { flightsUpdated: flights.length, faresUpdated: changed };
}

// ── admin bookings (assistance desk) ────────────────────────────────────────

export function adminListBookings(ctx: EngineCtx, q?: string): AdminBookingSummaryDto[] {
  const term = q?.trim();
  const words = term
    ? term
        .split(/[\s,]+/)
        .filter(Boolean)
        .slice(0, 6)
    : [];
  const upperTerm = term?.toUpperCase();

  const rows = ctx.db.all<{
    id: string;
    pnr: string;
    status: string;
    totalMinor: number;
    currency: string;
    contactEmail: string | null;
    contactPhone: string | null;
    createdAt: string;
  }>('SELECT * FROM bookings ORDER BY createdAt DESC LIMIT ?', [BOOKINGS_LIST]);

  const filtered = term
    ? rows.filter((b) => {
        if (upperTerm && b.pnr.includes(upperTerm)) return true;
        if (term && b.contactEmail?.toLowerCase().includes(term.toLowerCase())) return true;
        // Name search: every word must land somewhere in first+last name, so
        // "walkin customer" and "customer, walkin" both find Walkin Customer.
        if (words.length === 0) return false;
        const pax = ctx.db.all<{ firstName: string; lastName: string }>(
          'SELECT firstName, lastName FROM booking_passengers WHERE bookingId = ?',
          [b.id],
        );
        return pax.some((p) =>
          words.every((word) => {
            const w = word.toLowerCase();
            return p.firstName.toLowerCase().includes(w) || p.lastName.toLowerCase().includes(w);
          }),
        );
      })
    : rows;

  return filtered.map((b) => {
    const segments = ctx.db.all<{
      seq: number;
      flightId: string;
      originCode: string;
      destinationCode: string;
    }>(
      'SELECT seq, flightId, originCode, destinationCode FROM booking_segments WHERE bookingId = ? ORDER BY seq',
      [b.id],
    );
    const pax = ctx.db.all<{ firstName: string; lastName: string }>(
      'SELECT firstName, lastName FROM booking_passengers WHERE bookingId = ? ORDER BY seq',
      [b.id],
    );
    const paid =
      (ctx.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM payments WHERE bookingId = ? AND status = 'PAID'`,
        [b.id],
      )?.n ?? 0) > 0;
    const flightNumbers = segments.map((s) => {
      const f = ctx.db.get<{ flightNumber: string }>(
        'SELECT flightNumber FROM flights WHERE id = ?',
        [s.flightId],
      );
      return f?.flightNumber ?? '';
    });
    const route = segments.length
      ? `${segments[0].originCode} → ${segments[segments.length - 1].destinationCode}`
      : '—';
    return {
      id: b.id,
      pnr: b.pnr,
      status: b.status as BookingStatus,
      totalMinor: b.totalMinor,
      currency: b.currency as AdminBookingSummaryDto['currency'],
      contactEmail: b.contactEmail,
      contactPhone: b.contactPhone,
      passengerNames: pax.map((p) => `${p.firstName} ${p.lastName}`.trim()),
      route,
      flightNumbers,
      paid,
      createdAt: b.createdAt,
    };
  });
}

// ── admin users (directory) ─────────────────────────────────────────────────

const MAX_USERS_PAGE_SIZE = 100;

/**
 * User directory for the `/admin` landing page — same pagination contract as
 * `users.module.ts` on the API. The device schema has no `lastLoginAt`
 * column, so it is always null offline (the console renders a dash).
 */
export function adminListUsers(
  ctx: EngineCtx,
  page?: string,
  pageSize?: string,
): Paginated<AdminUserDto> {
  const pageNo = Math.max(1, Number.parseInt(page ?? '1', 10) || 1);
  const size = Math.min(
    MAX_USERS_PAGE_SIZE,
    Math.max(1, Number.parseInt(pageSize ?? '20', 10) || 20),
  );
  const total = ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')?.n ?? 0;
  const rows = ctx.db.all<{
    id: string;
    email: string | null;
    phone: string | null;
    firstName: string;
    lastName: string;
    role: string;
    status: string;
    locale: string;
    createdAt: string;
  }>('SELECT * FROM users ORDER BY createdAt DESC LIMIT ? OFFSET ?', [size, (pageNo - 1) * size]);
  return {
    items: rows.map((u) => ({
      id: u.id,
      email: u.email,
      phone: u.phone,
      firstName: u.firstName,
      lastName: u.lastName,
      role: u.role as AdminUserDto['role'],
      status: u.status as AdminUserDto['status'],
      locale: u.locale,
      createdAt: u.createdAt,
      lastLoginAt: null,
    })),
    page: pageNo,
    pageSize: size,
    total,
    hasMore: pageNo * size < total,
  };
}

// ── payments DTO + recordDirect ─────────────────────────────────────────────

interface PaymentRowLite {
  id: string;
  bookingId: string;
  provider: string;
  status: string;
  amountMinor: number;
  currency: string;
  idempotencyKey: string;
  providerRef: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  manual: number;
  paidAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

function toPaymentDto(row: PaymentRowLite): PaymentDto {
  return {
    id: row.id,
    bookingId: row.bookingId,
    provider: row.provider as PaymentDto['provider'],
    status: row.status as PaymentDto['status'],
    amountMinor: row.amountMinor,
    currency: row.currency as PaymentDto['currency'],
    idempotencyKey: row.idempotencyKey,
    providerRef: row.providerRef,
    clientSecret: null,
    failureCode: row.failureCode,
    failureMessage: row.failureMessage,
    paidAt: row.paidAt,
    expiresAt: row.expiresAt,
    manual: row.manual === 1,
    createdAt: row.createdAt,
  };
}

const KNOWN_PROVIDERS: PaymentProviderType[] = ['MPESA_STK', 'MPESA_C2B', 'STRIPE', 'MOCK', 'CASH'];

/** Claim a payment → PAID, confirm the booking (port of applyPaidLocked). */
function applyPaidLocked(
  ctx: EngineCtx,
  paymentId: string,
  providerRef: string,
): 'paid' | 'duplicate' | 'unconfirmable' {
  const nowIso = new Date(ctx.now()).toISOString();
  const claimed = ctx.db.run(
    `UPDATE payments SET status = 'PAID', paidAt = ?, providerRef = ?, failureCode = NULL, failureMessage = NULL
      WHERE id = ? AND status IN (${PAYMENT_STATUSES_TO_CLAIM.map(() => '?').join(',')})`,
    [nowIso, providerRef, paymentId, ...PAYMENT_STATUSES_TO_CLAIM],
  );
  if (claimed.changes === 0) return 'duplicate';

  const payment = ctx.db.get<{ bookingId: string }>('SELECT bookingId FROM payments WHERE id = ?', [
    paymentId,
  ]);
  if (payment?.bookingId) {
    const ok = confirmBookingPaid(ctx, payment.bookingId);
    if (!ok) {
      ctx.db.run(
        `UPDATE payments SET failureMessage = 'Funds received but the booking can no longer be confirmed — manual resolution required'
          WHERE id = ?`,
        [paymentId],
      );
      return 'unconfirmable';
    }
  }
  return 'paid';
}

export function applyManualPaid(
  ctx: EngineCtx,
  actor: Actor,
  paymentId: string,
  receipt: string,
): PaymentDto {
  const payment = ctx.db.get<PaymentRowLite>('SELECT * FROM payments WHERE id = ?', [paymentId]);
  if (!payment) fail('NOT_FOUND', 'Payment not found');
  if (payment.status === 'PAID') fail('CONFLICT', 'Payment already completed');

  const outcome = ctx.db.transaction(() => applyPaidLocked(ctx, paymentId, receipt));
  if (outcome === 'unconfirmable') {
    throw new AppError(
      'INVALID_STATE_TRANSITION',
      'Funds were received but the booking can no longer be confirmed — manual resolution required',
    );
  }
  void actor;
  const fresh = ctx.db.get<PaymentRowLite>('SELECT * FROM payments WHERE id = ?', [paymentId])!;
  return toPaymentDto(fresh);
}

export function recordDirect(
  ctx: EngineCtx,
  actor: Actor,
  bookingId: string,
  dto: { provider?: string; amountMinor?: number; reference?: string },
): PaymentDto {
  if (!dto.provider || !KNOWN_PROVIDERS.includes(dto.provider as PaymentProviderType)) {
    fail('VALIDATION_ERROR', `Unknown payment provider "${dto.provider ?? ''}"`);
  }
  const booking = loadBooking(ctx, bookingId);
  if (!['HELD', 'PENDING_PAYMENT'].includes(booking.status)) {
    if (booking.status === 'CONFIRMED' || booking.status === 'CHECKED_IN') {
      fail('CONFLICT', 'Booking is already paid');
    }
    throw new AppError(
      'INVALID_STATE_TRANSITION',
      `Booking ${booking.pnr} is ${booking.status} and cannot be paid`,
    );
  }
  const amount = dto.amountMinor ?? booking.totalMinor;
  if (!Number.isInteger(amount) || amount <= 0) {
    fail('VALIDATION_ERROR', 'amountMinor must be a positive integer');
  }

  if (booking.status === 'HELD') {
    const stepped = ctx.db.run(
      `UPDATE bookings SET status = 'PENDING_PAYMENT' WHERE id = ? AND status = 'HELD'`,
      [bookingId],
    );
    if (stepped.changes === 0) fail('CONFLICT', 'Payment already in progress');
  }

  const id = randomId('pay');
  const nowIso = new Date(ctx.now()).toISOString();
  ctx.db.run(
    `INSERT INTO payments (id, bookingId, provider, status, amountMinor, currency,
                           idempotencyKey, manual, createdAt)
     VALUES (?, ?, ?, 'PENDING', ?, ?, ?, 1, ?)`,
    [id, bookingId, dto.provider, amount, booking.currency, `direct_${randomId('idem')}`, nowIso],
  );
  const receipt = dto.reference?.trim() || `${dto.provider}-${id.slice(-8).toUpperCase()}`;
  applyManualPaid(ctx, actor, id, receipt);
  const fresh = ctx.db.get<PaymentRowLite>('SELECT * FROM payments WHERE id = ?', [id])!;
  return toPaymentDto(fresh);
}

// ── reports ─────────────────────────────────────────────────────────────────

const isValidDay = (day: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(new Date(`${day}T00:00:00Z`).getTime());

const addDaysStr = (day: string, count: number): string => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + count);
  return d.toISOString().slice(0, 10);
};

const todayNairobi = (nowMs: number): string =>
  new Date(nowMs + 3 * 3_600_000).toISOString().slice(0, 10);

function resolveRange(
  nowMs: number,
  query: { from?: string; to?: string },
  defaultSpan: '30d' | '7d',
): { from: string; to: string } {
  const today = todayNairobi(nowMs);
  const from = query.from ?? (defaultSpan === '30d' ? addDaysStr(today, -30) : today);
  const to = query.to ?? (defaultSpan === '30d' ? today : addDaysStr(today, 7));
  if (!isValidDay(from) || !isValidDay(to)) {
    fail('VALIDATION_ERROR', 'Dates must be valid YYYY-MM-DD days');
  }
  if (from > to) fail('VALIDATION_ERROR', '`from` must not be after `to`');
  const span =
    (Date.parse(`${to}T00:00:00${NAIROBI_OFFSET}`) -
      Date.parse(`${from}T00:00:00${NAIROBI_OFFSET}`)) /
    86_400_000;
  if (span > MAX_RANGE_DAYS) fail('VALIDATION_ERROR', `Range is capped at ${MAX_RANGE_DAYS} days`);
  return { from, to };
}

/** paidAt (ISO UTC) → Africa/Nairobi calendar day. */
function nairobiDay(iso: string): string {
  return new Date(Date.parse(iso) + 3 * 3_600_000).toISOString().slice(0, 10);
}

export function revenueReport(
  ctx: EngineCtx,
  query: { from?: string; to?: string; currency?: string },
): RevenueReportDto {
  const { from, to } = resolveRange(ctx.now(), query, '30d');
  const currency = (query.currency ?? 'KES').toUpperCase();

  const payments = ctx.db.all<{ amountMinor: number; paidAt: string }>(
    `SELECT amountMinor, paidAt FROM payments
      WHERE status = 'PAID' AND currency = ? AND paidAt IS NOT NULL`,
    [currency],
  );

  // Offline world has no refunds; refund columns stay zero-filled.
  const byDay = new Map<string, { payments: number; grossMinor: number }>();
  for (const p of payments) {
    const day = nairobiDay(p.paidAt);
    const bucket = byDay.get(day) ?? { payments: 0, grossMinor: 0 };
    bucket.payments += 1;
    bucket.grossMinor += p.amountMinor;
    byDay.set(day, bucket);
  }

  const days: RevenueDayDto[] = [];
  let cursor = from;
  let guard = 0;
  while (cursor <= to && guard <= MAX_RANGE_DAYS) {
    const g = byDay.get(cursor);
    days.push({
      day: cursor,
      payments: g?.payments ?? 0,
      grossMinor: g?.grossMinor ?? 0,
      refunds: 0,
      refundMinor: 0,
      netMinor: g?.grossMinor ?? 0,
    });
    cursor = addDaysStr(cursor, 1);
    guard += 1;
  }

  const totals = days.reduce(
    (acc, day) => ({
      payments: acc.payments + day.payments,
      grossMinor: acc.grossMinor + day.grossMinor,
      refunds: acc.refunds + day.refunds,
      refundMinor: acc.refundMinor + day.refundMinor,
      netMinor: acc.netMinor + day.netMinor,
    }),
    { payments: 0, grossMinor: 0, refunds: 0, refundMinor: 0, netMinor: 0 },
  );

  return { from, to, currency, days, totals };
}

function pct(sold: number, sellable: number): number | null {
  if (sellable <= 0) return null;
  return Math.round((100 * sold) / sellable);
}

export function loadReport(
  ctx: EngineCtx,
  query: { from?: string; to?: string; origin?: string },
): LoadReportDto {
  const { from, to } = resolveRange(ctx.now(), query, '7d');
  const origin = query.origin?.trim().toUpperCase() || null;

  const flights = ctx.db.all<FlightRow>(
    `SELECT * FROM flights WHERE flightDate >= ? AND flightDate <= ? AND (? IS NULL OR originCode = ?)
      ORDER BY flightDate, flightNumber`,
    [from, to, origin, origin],
  );

  const detail: LoadFactorRowDto[] = flights.map((f) => {
    const inv = ctx.db.all<{
      seatsTotal: number;
      seatsSold: number;
      seatsHeld: number;
      seatsBlocked: number;
    }>('SELECT seatsTotal, seatsSold, seatsHeld, seatsBlocked FROM inventory WHERE flightId = ?', [
      f.id,
    ]);
    const capacity = inv.reduce((s, i) => s + i.seatsTotal, 0);
    const seatsSold = inv.reduce((s, i) => s + i.seatsSold, 0);
    const seatsHeld = inv.reduce((s, i) => s + i.seatsHeld, 0);
    const seatsBlocked = inv.reduce((s, i) => s + i.seatsBlocked, 0);
    return {
      flightId: f.id,
      flightNumber: f.flightNumber,
      originCode: f.originCode,
      destinationCode: f.destinationCode,
      flightDate: f.flightDate,
      status: deriveStatus(f, ctx.now()) as LoadFactorRowDto['status'],
      capacity,
      seatsSold,
      seatsHeld,
      seatsBlocked,
      loadFactorPct: pct(seatsSold, capacity - seatsBlocked),
    };
  });

  const totals = detail.reduce(
    (acc, row) => ({
      flights: acc.flights + 1,
      capacity: acc.capacity + row.capacity,
      seatsSold: acc.seatsSold + row.seatsSold,
      seatsBlocked: acc.seatsBlocked + row.seatsBlocked,
    }),
    { flights: 0, capacity: 0, seatsSold: 0, seatsBlocked: 0 },
  );

  return {
    from,
    to,
    rows: detail,
    totals: {
      flights: totals.flights,
      capacity: totals.capacity,
      seatsSold: totals.seatsSold,
      loadFactorPct: pct(totals.seatsSold, totals.capacity - totals.seatsBlocked),
    },
  };
}

// ── M-Pesa verifier ─────────────────────────────────────────────────────────

interface VerifyInput {
  message?: string;
  paymentId?: string;
  pnr?: string;
  notes?: string;
  reason?: string;
}

interface MpesaRecordRow {
  id: string;
  receiptNumber: string;
  amountMinor: number;
  currency: string;
  msisdn: string | null;
  paybill: string | null;
  accountReference: string | null;
  transactionAt: string | null;
  messageRaw: string;
  status: string;
  paymentId: string | null;
  bookingId: string | null;
  submittedById: string | null;
  resolvedById: string | null;
  resolvedAt: string | null;
  rejectReason: string | null;
  notes: string | null;
  createdAt: string;
}

function toVerifyDto(ctx: EngineCtx, row: MpesaRecordRow): MpesaManualVerificationDto {
  const pnr = row.bookingId
    ? (ctx.db.get<{ pnr: string }>('SELECT pnr FROM bookings WHERE id = ?', [row.bookingId])?.pnr ??
      null)
    : null;
  return {
    id: row.id,
    receiptNumber: row.receiptNumber,
    amountMinor: row.amountMinor,
    currency: row.currency as MpesaManualVerificationDto['currency'],
    msisdn: row.msisdn,
    paybill: row.paybill,
    accountReference: row.accountReference,
    transactionAt: row.transactionAt,
    status: row.status as ManualVerifyStatus,
    paymentId: row.paymentId,
    bookingId: row.bookingId,
    pnr,
    submittedById: row.submittedById,
    resolvedById: row.resolvedById,
    resolvedAt: row.resolvedAt,
    rejectReason: row.rejectReason,
    notes: row.notes,
    createdAt: row.createdAt,
  };
}

function bookingActorId(actor: Actor): string | null {
  return actor.user.id;
}

/** Resolve which payment a message should confirm (paymentId → PNR → ref). */
function resolveTarget(
  ctx: EngineCtx,
  input: VerifyInput,
  accountReference: string | null,
): { payment: PaymentRowLite; pnr: string; userId: string | null } | null {
  if (input.paymentId) {
    const payment = ctx.db.get<PaymentRowLite>('SELECT * FROM payments WHERE id = ?', [
      input.paymentId,
    ]);
    if (!payment) return null;
    const booking = ctx.db.get<{ pnr: string; userId: string | null }>(
      'SELECT pnr, userId FROM bookings WHERE id = ?',
      [payment.bookingId],
    );
    return { payment, pnr: booking?.pnr ?? '', userId: booking?.userId ?? null };
  }
  const pnr = (input.pnr ?? accountReference ?? '').trim().toUpperCase();
  if (!pnr) return null;
  const booking = ctx.db.get<{ id: string; pnr: string; userId: string | null }>(
    'SELECT id, pnr, userId FROM bookings WHERE pnr = ?',
    [pnr],
  );
  if (!booking) return null;
  const payments = ctx.db.all<PaymentRowLite>(
    'SELECT * FROM payments WHERE bookingId = ? ORDER BY createdAt DESC',
    [booking.id],
  );
  const payment =
    payments.find((p) => (PAYMENT_STATUSES_TO_CLAIM as string[]).includes(p.status)) ??
    payments[0] ??
    null;
  return payment ? { payment, pnr: booking.pnr, userId: booking.userId } : null;
}

function receiptUsed(ctx: EngineCtx, receipt: string): boolean {
  const row = ctx.db.get<{ id: string }>('SELECT id FROM mpesa_records WHERE receiptNumber = ?', [
    receipt,
  ]);
  return row !== undefined;
}

function formatKes(minor: number): string {
  return `KES ${(minor / 100).toFixed(2)}`;
}

function assertAmount(payment: PaymentRowLite, amountMinor: number | null): void {
  if (amountMinor === null) return;
  if (amountMinor !== payment.amountMinor) {
    throw new AppError(
      'PAYMENT_AMOUNT_MISMATCH',
      `Amount mismatch: the message shows ${formatKes(amountMinor)} but the booking owes ` +
        `${formatKes(payment.amountMinor)}`,
    );
  }
}

function normalizeMsisdn(raw: string | null): string | null {
  if (!raw) return null;
  try {
    return toMpesaMsisdn(raw);
  } catch {
    return raw;
  }
}

export function verifierCheck(
  ctx: EngineCtx,
  actor: Actor,
  input: VerifyInput,
): MpesaVerifyCheckDto {
  const message = input.message ?? '';
  const parsed = parseMpesaSms(message);
  const issues: string[] = [];
  if (message.trim().length === 0) issues.push('Paste the M-Pesa confirmation message');
  if (message.length > MAX_MESSAGE_CHARS) issues.push('Message is too long');
  if (!parsed.receiptNumber) issues.push('No M-Pesa receipt number found in the message');
  if (parsed.amountMinor === null) issues.push('No amount found in the message');

  const target = resolveTarget(ctx, input, parsed.accountReference);
  if (!target) issues.push('No payment found — check the PNR or payment id');

  const receiptAvailable =
    parsed.receiptNumber === null ? true : !receiptUsed(ctx, parsed.receiptNumber);
  if (parsed.receiptNumber && !receiptAvailable) {
    issues.push(`Receipt ${parsed.receiptNumber} was already used for another payment`);
  }

  if (target && parsed.amountMinor !== null && parsed.amountMinor !== target.payment.amountMinor) {
    issues.push(
      `Amount mismatch: the message shows ${formatKes(parsed.amountMinor)} but the booking owes ` +
        `${formatKes(target.payment.amountMinor)}`,
    );
  }
  void actor;

  return {
    parsed,
    issues,
    paymentId: target?.payment.id ?? null,
    bookingId: target?.payment.bookingId ?? null,
    pnr: target?.pnr ?? null,
    amountExpectedMinor: target?.payment.amountMinor ?? null,
    receiptAvailable,
  };
}

export function verifierVerify(
  ctx: EngineCtx,
  actor: Actor,
  input: VerifyInput,
): { record: MpesaManualVerificationDto; payment: PaymentDto } {
  const message = input.message ?? '';
  const parsed = parseMpesaSms(message);
  if (!parsed.valid) {
    fail('VALIDATION_ERROR', 'Could not read an M-Pesa receipt number and amount from the message');
  }
  const target = resolveTarget(ctx, input, parsed.accountReference);
  if (!target) fail('NOT_FOUND', 'No payment found for this booking');
  assertAmount(target.payment, parsed.amountMinor);

  const nowIso = new Date(ctx.now()).toISOString();
  const id = randomId('mvr');
  try {
    ctx.db.run(
      `INSERT INTO mpesa_records (id, receiptNumber, amountMinor, currency, msisdn, paybill,
                                  accountReference, transactionAt, messageRaw, status, paymentId,
                                  bookingId, resolvedById, resolvedAt, notes, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', ?, ?, ?, ?, ?, ?)`,
      [
        id,
        parsed.receiptNumber!,
        parsed.amountMinor!,
        target.payment.currency,
        normalizeMsisdn(parsed.msisdn),
        parsed.paybill,
        parsed.accountReference,
        parsed.transactionAt,
        message.trim().slice(0, MAX_MESSAGE_CHARS),
        target.payment.id,
        target.payment.bookingId,
        bookingActorId(actor),
        nowIso,
        input.notes?.trim() || null,
        nowIso,
      ],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE'))
      fail('CONFLICT', `Receipt ${parsed.receiptNumber} was already used`);
    throw err;
  }

  const payment = applyManualPaid(ctx, actor, target.payment.id, parsed.receiptNumber!);
  const record = ctx.db.get<MpesaRecordRow>('SELECT * FROM mpesa_records WHERE id = ?', [id])!;
  return { record: toVerifyDto(ctx, record), payment };
}

export function verifierList(
  ctx: EngineCtx,
  query: { status?: string; page?: string },
): Paginated<MpesaManualVerificationDto> {
  const page = Math.max(1, Number(query.page) || 1);
  const status =
    query.status && ['PENDING', 'CONFIRMED', 'REJECTED'].includes(query.status)
      ? query.status
      : null;
  const total =
    (status
      ? ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM mpesa_records WHERE status = ?', [
          status,
        ])
      : ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM mpesa_records')
    )?.n ?? 0;
  const rows = status
    ? ctx.db.all<MpesaRecordRow>(
        'SELECT * FROM mpesa_records WHERE status = ? ORDER BY createdAt DESC LIMIT ? OFFSET ?',
        [status, VERIFIER_PAGE_SIZE, (page - 1) * VERIFIER_PAGE_SIZE],
      )
    : ctx.db.all<MpesaRecordRow>(
        'SELECT * FROM mpesa_records ORDER BY createdAt DESC LIMIT ? OFFSET ?',
        [VERIFIER_PAGE_SIZE, (page - 1) * VERIFIER_PAGE_SIZE],
      );
  return {
    items: rows.map((r) => toVerifyDto(ctx, r)),
    total,
    page,
    pageSize: VERIFIER_PAGE_SIZE,
    hasMore: page * VERIFIER_PAGE_SIZE < total,
  };
}

export function verifierConfirm(
  ctx: EngineCtx,
  actor: Actor,
  id: string,
  notes?: string,
): { record: MpesaManualVerificationDto; payment: PaymentDto } {
  const record = ctx.db.get<MpesaRecordRow>('SELECT * FROM mpesa_records WHERE id = ?', [id]);
  if (!record) fail('NOT_FOUND', 'Verification record not found');
  if (record.status !== 'PENDING') fail('CONFLICT', `Verification is already ${record.status}`);
  if (!record.paymentId) fail('NOT_FOUND', 'Record is not linked to a payment');
  const payment = ctx.db.get<PaymentRowLite>('SELECT * FROM payments WHERE id = ?', [
    record.paymentId,
  ]);
  if (!payment) fail('NOT_FOUND', 'Payment not found');
  assertAmount(payment, record.amountMinor);

  const paid = applyManualPaid(ctx, actor, payment.id, record.receiptNumber);
  const nowIso = new Date(ctx.now()).toISOString();
  ctx.db.run(
    `UPDATE mpesa_records SET status = 'CONFIRMED', resolvedById = ?, resolvedAt = ?, rejectReason = NULL,
                              notes = COALESCE(?, notes)
      WHERE id = ?`,
    [bookingActorId(actor), nowIso, notes?.trim() || null, id],
  );
  const fresh = ctx.db.get<MpesaRecordRow>('SELECT * FROM mpesa_records WHERE id = ?', [id])!;
  return { record: toVerifyDto(ctx, fresh), payment: paid };
}

export function verifierReject(
  ctx: EngineCtx,
  actor: Actor,
  id: string,
  reason: string,
): MpesaManualVerificationDto {
  const record = ctx.db.get<MpesaRecordRow>('SELECT * FROM mpesa_records WHERE id = ?', [id]);
  if (!record) fail('NOT_FOUND', 'Verification record not found');
  if (record.status !== 'PENDING') fail('CONFLICT', `Verification is already ${record.status}`);
  const nowIso = new Date(ctx.now()).toISOString();
  ctx.db.run(
    `UPDATE mpesa_records SET status = 'REJECTED', resolvedById = ?, resolvedAt = ?, rejectReason = ?
      WHERE id = ?`,
    [bookingActorId(actor), nowIso, reason.trim().slice(0, 500) || 'Rejected by staff', id],
  );
  const fresh = ctx.db.get<MpesaRecordRow>('SELECT * FROM mpesa_records WHERE id = ?', [id])!;
  return toVerifyDto(ctx, fresh);
}

// ── site settings ───────────────────────────────────────────────────────────

interface SiteRow {
  id: number;
  app_name: string;
  theme: string;
  images_json: string;
  mpesa_paybill: string | null;
  updated_at: string;
}

const IMAGE_KEY_RE = /^[a-z][a-zA-Z0-9:-]{0,63}$/;
const DESTINATION_CODE_RE = /^[A-Z0-9]{3}$/;
const MAX_URL_CHARS = 512;
const URL_RE = /^https:\/\/[^\s]+$/;
const MAX_NAME_CHARS = 40;

export function getSiteSettings(ctx: EngineCtx): SiteSettingsDto {
  const row = ctx.db.get<SiteRow>('SELECT * FROM site_settings WHERE id = 1');
  const theme =
    row && SITE_THEMES.includes(row.theme as SiteTheme) ? (row.theme as SiteTheme) : 'sky';
  const appName = normalizeBrandName(row?.app_name);
  const images = sanitizeImages(safeParse(row?.images_json));
  return { appName, theme, images, mpesaPaybill: row?.mpesa_paybill ?? null };
}

export function updateSiteSettings(
  ctx: EngineCtx,
  actor: Actor,
  input: { appName?: unknown; theme?: unknown; images?: unknown },
): SiteSettingsDto {
  if (input.theme !== undefined && !SITE_THEMES.includes(input.theme as SiteTheme)) {
    fail('VALIDATION_ERROR', `Unknown theme "${String(input.theme)}"`);
  }
  const images = input.images === undefined ? undefined : validateImages(input.images);
  const appName = input.appName === undefined ? undefined : validateAppName(input.appName);

  const current = getSiteSettings(ctx);
  const theme = (input.theme as SiteTheme) ?? current.theme;
  const merged = images === undefined ? current.images : images;
  const name = appName ?? current.appName;
  const nowIso = new Date(ctx.now()).toISOString();

  ctx.db.run(
    `INSERT INTO site_settings (id, app_name, theme, images_json, mpesa_paybill, updated_at)
     VALUES (1, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       app_name = excluded.app_name,
       theme = excluded.theme,
       images_json = excluded.images_json,
       updated_at = excluded.updated_at`,
    [name, theme, JSON.stringify(merged), current.mpesaPaybill, nowIso],
  );
  void actor;
  return getSiteSettings(ctx);
}

function validateAppName(value: unknown): string {
  if (typeof value !== 'string') fail('VALIDATION_ERROR', 'appName must be a string');
  const trimmed = value.trim();
  const hasControl = [...trimmed].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127);
  if (!trimmed || trimmed.length > MAX_NAME_CHARS || hasControl) {
    fail(
      'VALIDATION_ERROR',
      `appName must be 1-${MAX_NAME_CHARS} characters without control codes`,
    );
  }
  return trimmed;
}

function validateImages(input: unknown): SiteImagesDto {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    fail('VALIDATION_ERROR', 'images must be an object');
  }
  const cleaned: SiteImagesDto = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (key === 'destinations') {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        fail('VALIDATION_ERROR', 'images.destinations must be an object');
      }
      const destinations: Record<string, string> = {};
      for (const [code, url] of Object.entries(value as Record<string, unknown>)) {
        if (!DESTINATION_CODE_RE.test(code))
          fail('VALIDATION_ERROR', `Invalid airport code "${code}"`);
        const normalized = validateUrl(url, `images.destinations.${code}`);
        if (normalized) destinations[code] = normalized;
      }
      if (Object.keys(destinations).length > 0) cleaned.destinations = destinations;
      continue;
    }
    if (!IMAGE_KEY_RE.test(key)) fail('VALIDATION_ERROR', `Invalid image key "${key}"`);
    const normalized = validateUrl(value, `images.${key}`);
    if (normalized) (cleaned as Record<string, string>)[key] = normalized;
  }
  return cleaned;
}

function validateUrl(value: unknown, field: string): string | null {
  if (value === '' || value === null) return null; // clear the override
  if (typeof value !== 'string' || value.length > MAX_URL_CHARS || !URL_RE.test(value)) {
    fail('VALIDATION_ERROR', `${field} must be an https:// URL (max ${MAX_URL_CHARS} chars)`);
  }
  return value;
}

function sanitizeImages(raw: unknown): SiteImagesDto {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const images: SiteImagesDto = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === 'destinations') continue;
    if (IMAGE_KEY_RE.test(key) && typeof value === 'string' && URL_RE.test(value)) {
      images[key] = value;
    }
  }
  const destinations = source.destinations;
  if (destinations && typeof destinations === 'object' && !Array.isArray(destinations)) {
    const map: Record<string, string> = {};
    for (const [code, url] of Object.entries(destinations as Record<string, unknown>)) {
      if (DESTINATION_CODE_RE.test(code) && typeof url === 'string' && URL_RE.test(url)) {
        map[code] = url;
      }
    }
    if (Object.keys(map).length > 0) images.destinations = map;
  }
  return images;
}

function safeParse(raw: string | null | undefined): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export type { BookingActorLike, TicketRow };
