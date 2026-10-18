import { Injectable } from '@nestjs/common';
import {
  AppError,
  toMpesaMsisdn,
  type ManualVerifyStatus,
  type MpesaManualVerificationDto,
  type MpesaVerifyCheckDto,
  type Paginated,
  type PaymentDto,
} from '@flight13/shared';
import type { MpesaManualVerification, Payment } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.module';
import { STAFF_ROLES, type BookingActor } from '../../bookings/bookings.service';
import { PAYMENT_STATUSES_TO_CLAIM } from '../queues';
import { PaymentsService } from '../payments.service';
import { parseMpesaSms } from './mpesa-sms.parser';

const MAX_MESSAGE_CHARS = 4_000;
const PAGE_SIZE = 25;

export interface ManualVerifyInput {
  /** Raw pasted M-Pesa confirmation SMS. */
  message: string;
  /** Explicit target — otherwise the SMS account reference is tried as a PNR. */
  paymentId?: string;
  pnr?: string;
  notes?: string;
}

type VerificationRow = MpesaManualVerification & { booking?: { pnr: string } | null };

function toDto(row: VerificationRow): MpesaManualVerificationDto {
  return {
    id: row.id,
    receiptNumber: row.receiptNumber,
    amountMinor: row.amountMinor,
    currency: row.currency as MpesaManualVerificationDto['currency'],
    msisdn: row.msisdn,
    paybill: row.paybill,
    accountReference: row.accountReference,
    transactionAt: row.transactionAt?.toISOString() ?? null,
    status: row.status,
    paymentId: row.paymentId,
    bookingId: row.bookingId,
    pnr: row.booking?.pnr ?? null,
    submittedById: row.submittedById,
    resolvedById: row.resolvedById,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    rejectReason: row.rejectReason,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Manual M-Pesa paybill verification. Passengers pay the payment number
 * configured in the payment plan straight from their phones — no Daraja STK,
 * no callback — and paste the confirmation message while booking; the payment
 * settles on the spot through the same idempotent confirm funnel. The receipt
 * number is the uniqueness key: one SMS can never confirm two payments. Staff
 * keep the verifier console as an audit view (and for correcting edge cases).
 */
@Injectable()
export class MpesaVerifierService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
  ) {}

  // ── parsing / dry-run check ──────────────────────────────────────────────

  /** Parse a message and report whether it could confirm a payment (no writes). */
  async check(actor: BookingActor, input: ManualVerifyInput): Promise<MpesaVerifyCheckDto> {
    const parsed = parseMpesaSms(input.message);
    const issues: string[] = [];
    if (input.message.trim().length === 0) issues.push('Paste the M-Pesa confirmation message');
    if (input.message.length > MAX_MESSAGE_CHARS) issues.push('Message is too long');
    if (!parsed.receiptNumber) issues.push('No M-Pesa receipt number found in the message');
    if (parsed.amountMinor === null) issues.push('No amount found in the message');

    const target = await this.resolveTarget(actor, input, parsed.accountReference);
    if (!target) issues.push('No payment found — check the PNR or payment id');

    const receiptAvailable =
      parsed.receiptNumber === null ? true : !(await this.receiptUsed(parsed.receiptNumber));
    if (parsed.receiptNumber && !receiptAvailable) {
      issues.push(`Receipt ${parsed.receiptNumber} was already used for another payment`);
    }

    if (
      target &&
      parsed.amountMinor !== null &&
      parsed.amountMinor !== target.payment.amountMinor
    ) {
      issues.push(
        `Amount mismatch: the message shows ${formatKes(parsed.amountMinor)} but the booking owes ` +
          `${formatKes(target.payment.amountMinor)}`,
      );
    }

    return {
      parsed,
      issues,
      paymentId: target?.payment.id ?? null,
      bookingId: target?.payment.bookingId ?? null,
      pnr: target?.booking.pnr ?? null,
      amountExpectedMinor: target?.payment.amountMinor ?? null,
      receiptAvailable,
    };
  }

  // ── staff: verify a pasted message straight onto a payment ───────────────

  async verify(
    actor: BookingActor,
    input: ManualVerifyInput,
  ): Promise<{ record: MpesaManualVerificationDto; payment: PaymentDto }> {
    const parsed = parseMpesaSms(input.message);
    if (!parsed.valid) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Could not read an M-Pesa receipt number and amount from the message',
      );
    }
    const target = await this.resolveTarget(actor, input, parsed.accountReference);
    if (!target) throw new AppError('NOT_FOUND', 'No payment found for this booking');
    assertAmount(target.payment, parsed.amountMinor);

    let record: VerificationRow;
    try {
      record = await this.prisma.mpesaManualVerification.create({
        data: {
          receiptNumber: parsed.receiptNumber!,
          amountMinor: parsed.amountMinor!,
          currency: target.payment.currency,
          msisdn: normalizeMsisdn(parsed.msisdn),
          paybill: parsed.paybill,
          accountReference: parsed.accountReference,
          transactionAt: parsed.transactionAt ? new Date(parsed.transactionAt) : null,
          messageRaw: input.message.trim().slice(0, MAX_MESSAGE_CHARS),
          status: 'CONFIRMED',
          paymentId: target.payment.id,
          bookingId: target.payment.bookingId,
          resolvedById: actor.userId,
          resolvedAt: new Date(),
          notes: input.notes?.trim() || null,
        },
        include: { booking: { select: { pnr: true } } },
      });
    } catch (err) {
      if (isReceiptTaken(err)) {
        throw new AppError('CONFLICT', `Receipt ${parsed.receiptNumber} was already used`);
      }
      throw err;
    }

    const payment = await this.payments.applyManualPaid(
      actor,
      target.payment.id,
      parsed.receiptNumber!,
    );
    return { record: toDto(record), payment };
  }

  // ── staff: pending queue (passenger-submitted messages) ──────────────────

  async list(query: {
    status?: string;
    page?: number;
  }): Promise<Paginated<MpesaManualVerificationDto>> {
    const page = Math.max(1, query.page ?? 1);
    const status =
      query.status && ['PENDING', 'CONFIRMED', 'REJECTED'].includes(query.status)
        ? (query.status as ManualVerifyStatus)
        : undefined;
    const where = status ? { status } : {};
    const [total, rows] = await Promise.all([
      this.prisma.mpesaManualVerification.count({ where }),
      this.prisma.mpesaManualVerification.findMany({
        where,
        include: { booking: { select: { pnr: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
    ]);
    return {
      items: rows.map(toDto),
      total,
      page,
      pageSize: PAGE_SIZE,
      hasMore: page * PAGE_SIZE < total,
    };
  }

  /** Confirm a passenger-submitted message (payment goes PAID here). */
  async confirm(
    actor: BookingActor,
    id: string,
    notes?: string,
  ): Promise<{ record: MpesaManualVerificationDto; payment: PaymentDto }> {
    const record = await this.prisma.mpesaManualVerification.findUnique({ where: { id } });
    if (!record) throw new AppError('NOT_FOUND', 'Verification record not found');
    if (record.status !== 'PENDING') {
      throw new AppError('CONFLICT', `Verification is already ${record.status}`);
    }
    if (!record.paymentId) throw new AppError('NOT_FOUND', 'Record is not linked to a payment');
    const payment = await this.prisma.payment.findUnique({ where: { id: record.paymentId } });
    if (!payment) throw new AppError('NOT_FOUND', 'Payment not found');
    assertAmount(payment, record.amountMinor);

    const paid = await this.payments.applyManualPaid(actor, payment.id, record.receiptNumber);
    const updated = await this.prisma.mpesaManualVerification.update({
      where: { id },
      data: {
        status: 'CONFIRMED',
        resolvedById: actor.userId,
        resolvedAt: new Date(),
        rejectReason: null,
        ...(notes?.trim() ? { notes: notes.trim() } : {}),
      },
      include: { booking: { select: { pnr: true } } },
    });
    return { record: toDto(updated), payment: paid };
  }

  async reject(
    actor: BookingActor,
    id: string,
    reason: string,
  ): Promise<MpesaManualVerificationDto> {
    const record = await this.prisma.mpesaManualVerification.findUnique({ where: { id } });
    if (!record) throw new AppError('NOT_FOUND', 'Verification record not found');
    if (record.status !== 'PENDING') {
      throw new AppError('CONFLICT', `Verification is already ${record.status}`);
    }
    const updated = await this.prisma.mpesaManualVerification.update({
      where: { id },
      data: {
        status: 'REJECTED',
        resolvedById: actor.userId,
        resolvedAt: new Date(),
        rejectReason: reason.trim().slice(0, 500) || 'Rejected by staff',
      },
      include: { booking: { select: { pnr: true } } },
    });
    return toDto(updated);
  }

  // ── passenger: paste the message, payment settles on the spot ────────────

  /**
   * Passenger pastes their own confirmation SMS against their own payment:
   * the message is parsed, checked against the amount owed, and the payment
   * is confirmed immediately — same idempotent funnel as every other confirm
   * path, no staff step in between. The receipt number stays the uniqueness
   * key, so one SMS can never confirm two payments.
   */
  async submit(
    actor: BookingActor,
    paymentId: string,
    message: string,
  ): Promise<{ record: MpesaManualVerificationDto; payment: PaymentDto }> {
    const parsed = parseMpesaSms(message);
    if (!parsed.valid) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Could not read an M-Pesa receipt number and amount from the message',
      );
    }
    const payment = await this.loadPaymentForActor(paymentId, actor);
    if (payment.status === 'PAID') throw new AppError('CONFLICT', 'Payment already completed');
    assertAmount(payment, parsed.amountMinor);

    let record: VerificationRow;
    try {
      record = await this.prisma.mpesaManualVerification.create({
        data: {
          receiptNumber: parsed.receiptNumber!,
          amountMinor: parsed.amountMinor!,
          currency: payment.currency,
          msisdn: normalizeMsisdn(parsed.msisdn),
          paybill: parsed.paybill,
          accountReference: parsed.accountReference,
          transactionAt: parsed.transactionAt ? new Date(parsed.transactionAt) : null,
          messageRaw: message.trim().slice(0, MAX_MESSAGE_CHARS),
          status: 'CONFIRMED',
          paymentId: payment.id,
          bookingId: payment.bookingId,
          submittedById: actor.userId,
          resolvedById: actor.userId,
          resolvedAt: new Date(),
        },
        include: { booking: { select: { pnr: true } } },
      });
    } catch (err) {
      if (isReceiptTaken(err)) {
        throw new AppError('CONFLICT', 'This receipt has already been submitted');
      }
      throw err;
    }

    const paid = await this.payments.applyManualPaid(actor, payment.id, parsed.receiptNumber!);
    return { record: toDto(record), payment: paid };
  }

  /** The passenger's latest manual verification for one payment, if any. */
  async forPayment(
    actor: BookingActor,
    paymentId: string,
  ): Promise<MpesaManualVerificationDto | null> {
    await this.loadPaymentForActor(paymentId, actor);
    const row = await this.prisma.mpesaManualVerification.findFirst({
      where: { paymentId },
      include: { booking: { select: { pnr: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return row ? toDto(row) : null;
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async loadPaymentForActor(paymentId: string, actor: BookingActor): Promise<Payment> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { booking: { select: { userId: true } } },
    });
    if (!payment) throw new AppError('NOT_FOUND', 'Payment not found');
    if (!STAFF_ROLES.includes(actor.role) && payment.booking.userId !== actor.userId) {
      throw new AppError('FORBIDDEN', 'You do not have access to this booking');
    }
    return payment;
  }

  /**
   * Resolve the payment a message should confirm: explicit payment id, then
   * explicit PNR, then the account reference the payer typed (usually the
   * PNR). Prefers a payment that can still be claimed, falls back to the
   * latest attempt so staff get a clear "already paid" instead of nothing.
   */
  private async resolveTarget(
    actor: BookingActor,
    input: ManualVerifyInput,
    accountReference: string | null,
  ): Promise<{ payment: Payment; booking: { pnr: string } } | null> {
    if (input.paymentId) {
      const payment = await this.loadPaymentForActor(input.paymentId, actor);
      const booking = await this.prisma.booking.findUnique({
        where: { id: payment.bookingId },
        select: { pnr: true },
      });
      return { payment, booking: booking ?? { pnr: '' } };
    }

    const pnr = (input.pnr ?? accountReference ?? '').trim().toUpperCase();
    if (!pnr) return null;
    const booking = await this.prisma.booking.findUnique({
      where: { pnr },
      select: { id: true, pnr: true, userId: true },
    });
    if (!booking) return null;
    if (!STAFF_ROLES.includes(actor.role) && booking.userId !== actor.userId) {
      throw new AppError('FORBIDDEN', 'You do not have access to this booking');
    }
    const payments = await this.prisma.payment.findMany({
      where: { bookingId: booking.id },
      orderBy: { createdAt: 'desc' },
    });
    const payment =
      payments.find((p) => PAYMENT_STATUSES_TO_CLAIM.includes(p.status)) ?? payments[0] ?? null;
    return payment ? { payment, booking } : null;
  }

  private async receiptUsed(receipt: string): Promise<boolean> {
    const row = await this.prisma.mpesaManualVerification.findUnique({
      where: { receiptNumber: receipt },
      select: { id: true },
    });
    if (row) return true;
    const tx = await this.prisma.mpesaTransaction.findUnique({
      where: { mpesaReceiptNumber: receipt },
      select: { id: true },
    });
    return tx !== null;
  }
}

function assertAmount(payment: Payment, amountMinor: number | null): void {
  if (amountMinor === null) return;
  if (amountMinor !== payment.amountMinor) {
    throw new AppError(
      'PAYMENT_AMOUNT_MISMATCH',
      `Amount mismatch: the message shows ${formatKes(amountMinor)} but the booking owes ` +
        `${formatKes(payment.amountMinor)}`,
    );
  }
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

function isReceiptTaken(err: unknown): boolean {
  const e = err as { code?: string; meta?: { target?: unknown[] } } | null;
  return (
    !!e &&
    e.code === 'P2002' &&
    Array.isArray(e.meta?.target) &&
    e.meta.target.includes('receiptNumber')
  );
}
