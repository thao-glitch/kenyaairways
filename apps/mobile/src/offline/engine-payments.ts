/**
 * Passenger payment flow against the on-device world — port of
 * payments.controller / payments.service and the passenger side of
 * mpesa-verifier.service.
 *
 * The traveller app now has a real payment step, so a booking is created
 * HELD and settles only after the passenger pays:
 *
 *   HELD ──POST /payments──► PENDING_PAYMENT ──paste paybill SMS──► CONFIRMED
 *
 * Manual paybill is the primary path (the paybill number is shown on screen
 * and the confirmation SMS is verified on the spot). STK stays available as
 * an opt-in secondary path; in mock mode the screen can deliver a simulated
 * result. Receipt numbers remain the uniqueness key.
 */
import {
  AppError,
  toMpesaMsisdn,
  type ManualVerifyStatus,
  type MpesaManualVerificationDto,
  type PaymentDto,
  type PaymentProviderType,
} from '@kenyaairways/shared';
import {
  assertBookingAccess,
  bookingActor,
  issueTickets,
  loadBooking,
  randomId,
  type Actor,
  type EngineCtx,
} from './engine-support';
import { applyManualPaid } from './engine-admin';
import { parseMpesaSms } from './mpesa-sms';

const MAX_MESSAGE_CHARS = 4_000;
const ACTIVE_STATUSES: readonly string[] = ['REQUIRES_ACTION', 'PENDING'];

interface PaymentRow {
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

interface VerificationRow {
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

function toPaymentDto(row: PaymentRow): PaymentDto {
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

function toVerificationDto(ctx: EngineCtx, row: VerificationRow): MpesaManualVerificationDto {
  const booking = row.bookingId
    ? ctx.db.get<{ pnr: string }>('SELECT pnr FROM bookings WHERE id = ?', [row.bookingId])
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
    pnr: booking?.pnr ?? null,
    submittedById: row.submittedById,
    resolvedById: row.resolvedById,
    resolvedAt: row.resolvedAt,
    rejectReason: row.rejectReason,
    notes: row.notes,
    createdAt: row.createdAt,
  };
}

function loadPayment(ctx: EngineCtx, actor: Actor, paymentId: string): PaymentRow {
  const row = ctx.db.get<PaymentRow>('SELECT * FROM payments WHERE id = ?', [paymentId]);
  if (!row) throw new AppError('NOT_FOUND', 'Payment not found');
  const booking = loadBooking(ctx, row.bookingId);
  assertBookingAccess(booking, bookingActor(actor));
  return row;
}

function formatKes(minor: number): string {
  return `KES ${(minor / 100).toFixed(2)}`;
}

function normalizeMsisdn(raw: string | null): string | null {
  if (!raw) return null;
  try {
    return toMpesaMsisdn(raw);
  } catch {
    return raw;
  }
}

/** The active provider mirrors the server's payment plan (MOCK in the demo). */
function defaultProvider(ctx: EngineCtx): PaymentProviderType {
  const plan = ctx.world.paymentPlan as { defaultProvider?: string } | undefined;
  const provider = plan?.defaultProvider;
  if (
    provider === 'MPESA_STK' ||
    provider === 'MPESA_C2B' ||
    provider === 'STRIPE' ||
    provider === 'MOCK' ||
    provider === 'CASH'
  ) {
    return provider;
  }
  return 'MOCK';
}

interface CreatePaymentInput {
  bookingId?: string;
  msisdn?: string;
  manual?: boolean;
  idempotencyKey?: string;
}

export function createPayment(ctx: EngineCtx, actor: Actor, dto: CreatePaymentInput): PaymentDto {
  const booking = loadBooking(ctx, dto.bookingId ?? '');
  assertBookingAccess(booking, bookingActor(actor));
  if (!['HELD', 'PENDING_PAYMENT'].includes(booking.status)) {
    if (booking.status === 'CONFIRMED' || booking.status === 'CHECKED_IN') {
      throw new AppError('CONFLICT', 'Booking is already paid');
    }
    throw new AppError(
      'INVALID_STATE_TRANSITION',
      `Booking ${booking.pnr} is ${booking.status} and cannot be paid`,
    );
  }

  const provider = defaultProvider(ctx);
  const manual = dto.manual === true;
  if (manual && !['MPESA_STK', 'MPESA_C2B', 'MOCK'].includes(provider)) {
    throw new AppError(
      'VALIDATION_ERROR',
      `Manual paybill payment is only available for M-Pesa (current method: ${provider})`,
    );
  }
  if (!manual && provider === 'MPESA_STK' && !dto.msisdn?.trim()) {
    throw new AppError('VALIDATION_ERROR', 'A phone number is required for M-Pesa STK push');
  }

  if (booking.status === 'HELD') {
    const stepped = ctx.db.run(
      `UPDATE bookings SET status = 'PENDING_PAYMENT' WHERE id = ? AND status = 'HELD'`,
      [booking.id],
    );
    if (stepped.changes === 0) throw new AppError('CONFLICT', 'Payment already in progress');
  }

  const id = randomId('pay');
  const nowIso = new Date(ctx.now()).toISOString();
  const idempotencyKey = dto.idempotencyKey?.trim() || randomId('idem');
  ctx.db.run(
    `INSERT INTO payments (id, bookingId, provider, status, amountMinor, currency,
                           idempotencyKey, manual, expiresAt, createdAt)
     VALUES (?, ?, ?, 'REQUIRES_ACTION', ?, ?, ?, ?, ?, ?)`,
    [
      id,
      booking.id,
      provider,
      booking.totalMinor,
      booking.currency,
      idempotencyKey,
      manual ? 1 : 0,
      booking.expiresAt,
      nowIso,
    ],
  );
  return toPaymentDto(ctx.db.get<PaymentRow>('SELECT * FROM payments WHERE id = ?', [id])!);
}

export function listPaymentsForBooking(
  ctx: EngineCtx,
  actor: Actor,
  bookingId: string,
): PaymentDto[] {
  const booking = loadBooking(ctx, bookingId);
  assertBookingAccess(booking, bookingActor(actor));
  return ctx.db
    .all<PaymentRow>('SELECT * FROM payments WHERE bookingId = ? ORDER BY createdAt DESC', [
      bookingId,
    ])
    .map(toPaymentDto);
}

export function getPayment(ctx: EngineCtx, actor: Actor, paymentId: string): PaymentDto {
  return toPaymentDto(loadPayment(ctx, actor, paymentId));
}

/** Re-initiate the provider attempt (STK resend). */
export function resendStk(ctx: EngineCtx, actor: Actor, paymentId: string): PaymentDto {
  const payment = loadPayment(ctx, actor, paymentId);
  if (payment.status === 'PAID') throw new AppError('CONFLICT', 'Payment already completed');
  ctx.db.run(
    `UPDATE payments SET status = 'REQUIRES_ACTION', failureCode = NULL,
                     failureMessage = NULL WHERE id = ?`,
    [paymentId],
  );
  return getPayment(ctx, actor, paymentId);
}

/** Deliver an STK result in mock mode (0 = success, anything else = failed). */
export function simulateStk(
  ctx: EngineCtx,
  actor: Actor,
  paymentId: string,
  resultCode: number,
): PaymentDto {
  const payment = loadPayment(ctx, actor, paymentId);
  if (payment.status === 'PAID') throw new AppError('CONFLICT', 'Payment already completed');
  if (resultCode !== 0) {
    ctx.db.run(
      `UPDATE payments SET status = 'FAILED', failureCode = ?, failureMessage = ?
        WHERE id = ?`,
      [
        String(resultCode),
        resultCode === 1032 ? 'Cancelled by the passenger' : 'Payment failed',
        paymentId,
      ],
    );
    return getPayment(ctx, actor, paymentId);
  }
  const paid = applyManualPaid(ctx, actor, paymentId, `MOCK-${payment.id.slice(-8).toUpperCase()}`);
  issueTickets(ctx, payment.bookingId);
  return paid;
}

/**
 * Passenger pastes the M-Pesa paybill confirmation SMS. The receipt + amount
 * are parsed, checked against what the booking owes, recorded (receipt numbers
 * are unique) and the payment settles immediately.
 */
export function submitMpesaManual(
  ctx: EngineCtx,
  actor: Actor,
  paymentId: string,
  message: string,
): { record: MpesaManualVerificationDto; payment: PaymentDto } {
  const text = (message ?? '').trim();
  const parsed = parseMpesaSms(text);
  if (!parsed.valid) {
    throw new AppError(
      'VALIDATION_ERROR',
      'Could not read an M-Pesa receipt number and amount from the message',
    );
  }
  const payment = loadPayment(ctx, actor, paymentId);
  if (payment.status === 'PAID') throw new AppError('CONFLICT', 'Payment already completed');
  if (parsed.amountMinor !== null && parsed.amountMinor !== payment.amountMinor) {
    throw new AppError(
      'PAYMENT_AMOUNT_MISMATCH',
      `Amount mismatch: the message shows ${formatKes(parsed.amountMinor)} but the booking owes ` +
        `${formatKes(payment.amountMinor)}`,
    );
  }

  const used = ctx.db.get<{ id: string }>('SELECT id FROM mpesa_records WHERE receiptNumber = ?', [
    parsed.receiptNumber!,
  ]);
  if (used) throw new AppError('CONFLICT', 'This receipt has already been submitted');

  const id = randomId('mvr');
  const nowIso = new Date(ctx.now()).toISOString();
  ctx.db.run(
    `INSERT INTO mpesa_records (id, receiptNumber, amountMinor, currency, msisdn, paybill,
                                accountReference, transactionAt, messageRaw, status, paymentId,
                                bookingId, submittedById, resolvedById, resolvedAt, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', ?, ?, ?, ?, ?, ?)`,
    [
      id,
      parsed.receiptNumber!,
      parsed.amountMinor!,
      payment.currency,
      normalizeMsisdn(parsed.msisdn),
      parsed.paybill,
      parsed.accountReference,
      parsed.transactionAt,
      text.slice(0, MAX_MESSAGE_CHARS),
      payment.id,
      payment.bookingId,
      actor.user.id,
      actor.user.id,
      nowIso,
      nowIso,
    ],
  );

  const paid = applyManualPaid(ctx, actor, payment.id, parsed.receiptNumber!);
  // Mirror the ticket desk: a settled booking gets its e-tickets issued.
  issueTickets(ctx, payment.bookingId);
  const row = ctx.db.get<VerificationRow>('SELECT * FROM mpesa_records WHERE id = ?', [id])!;
  return { record: toVerificationDto(ctx, row), payment: paid };
}

/** Latest paste for one payment (owner or staff) — drives the status banner. */
export function manualStatus(
  ctx: EngineCtx,
  actor: Actor,
  paymentId: string,
): MpesaManualVerificationDto | null {
  loadPayment(ctx, actor, paymentId);
  const row = ctx.db.get<VerificationRow>(
    'SELECT * FROM mpesa_records WHERE paymentId = ? ORDER BY createdAt DESC LIMIT 1',
    [paymentId],
  );
  return row ? toVerificationDto(ctx, row) : null;
}

export function isActivePayment(status: string): boolean {
  return ACTIVE_STATUSES.includes(status);
}
