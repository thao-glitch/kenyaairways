import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { z } from 'zod';
import {
  AppError,
  C2B_VALIDATION,
  describeMpesaResult,
  maskPhone,
  toMpesaMsisdn,
  type C2BPaymentDto,
  type PaymentDto,
  type RefundDto,
} from '@flight13/shared';
import type { Booking, MpesaTxStatus, Payment, Refund } from '@prisma/client';
import type Stripe from 'stripe';
import { getEnv } from '../../config/env';
import { createLogger, maskDeep, type Logger } from '../../common/logger';
import { randomToken } from '../../common/crypto';
import { PrismaService } from '../../prisma/prisma.module';
import { GLOBAL_PREFIX } from '../../app.setup';
import { BookingsService, STAFF_ROLES, type BookingActor } from '../bookings/bookings.service';
import type { Db } from '../bookings/inventory.service';
import { OtpService } from '../auth/otp.service';
import { PAYMENT_CB_QUEUE, PAYMENT_STATUSES_TO_CLAIM, type PaymentCbJob } from './queues';
import { PAYMENT_PROVIDER, type PaymentProvider } from './providers/payment-provider';
import { roundKesFromMinor } from './providers/mpesa.provider';
import type { CreatePaymentDto, RefundPaymentDto } from './dto/payment.dto';

// ── callback payload contracts (Daraja wire format) ─────────────────────────

const STK_PAYLOAD_SCHEMA = z.object({
  Body: z.object({
    stkCallback: z.object({
      MerchantRequestID: z.string().min(1),
      CheckoutRequestID: z.string().min(1),
      ResultCode: z.coerce.number().int(),
      ResultDesc: z.string().optional(),
      CallbackMetadata: z
        .object({
          Item: z.array(
            z.object({
              Name: z.string(),
              Value: z.union([z.string(), z.number(), z.null()]),
            }),
          ),
        })
        .optional(),
    }),
  }),
});

const C2B_PAYLOAD_SCHEMA = z.object({
  TransID: z.string().min(1).max(40),
  TransAmount: z.union([z.string(), z.number()]),
  BillRefNumber: z.string().max(64),
  MSISDN: z.string().optional(),
  Msisdn: z.string().optional(),
  TransTime: z.string().optional(),
  TransactionType: z.string().optional(),
  BusinessShortCode: z.string().optional(),
  InvoiceNumber: z.string().optional(),
  OrgAccountBalance: z.string().optional(),
  ThirdPartyTransID: z.string().optional(),
});

export interface StkResult {
  merchantRequestId: string;
  checkoutRequestId: string;
  resultCode: number;
  resultDesc?: string;
  receipt?: string;
  /** Whole shillings from CallbackMetadata.Amount (callback always sends KES). */
  amountMajor?: number;
  transactionDate?: Date;
  phone?: string;
}

export type ApplyOutcome =
  'paid' | 'applied' | 'duplicate' | 'skipped' | 'mismatch' | 'unconfirmable';

function extractMeta(
  payload: z.infer<typeof STK_PAYLOAD_SCHEMA>,
  name: string,
): string | number | undefined {
  const items = payload.Body.stkCallback.CallbackMetadata?.Item ?? [];
  const item = items.find((i) => i.Name === name);
  if (!item || item.Value === null || item.Value === undefined) return undefined;
  return item.Value;
}

/** Daraja TransactionDate "YYYYMMDDHHmmss" is Africa/Nairobi wall time. */
function parseDarajaDate(value: string | number | undefined): Date | undefined {
  if (value === undefined) return undefined;
  const s = String(value);
  if (!/^\d{14}$/.test(s)) return undefined;
  const num = (a: number, b: number) => Number(s.slice(a, b));
  const utc = Date.UTC(num(0, 4), num(4, 6) - 1, num(6, 8), num(8, 10), num(10, 12), num(12, 14));
  return new Date(utc - 3 * 3600 * 1000); // EAT = UTC+3, no DST
}

/** Parse a raw STK callback body — throws VALIDATION_ERROR on malformed input. */
export function normalizeStkPayload(raw: unknown): StkResult {
  const parsed = STK_PAYLOAD_SCHEMA.safeParse(raw);
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Malformed STK callback payload');
  }
  const cb = parsed.data.Body.stkCallback;
  const amount = extractMeta(parsed.data, 'Amount');
  const receipt = extractMeta(parsed.data, 'MpesaReceiptNumber');
  const phone = extractMeta(parsed.data, 'PhoneNumber');
  const txDate = extractMeta(parsed.data, 'TransactionDate');
  return {
    merchantRequestId: cb.MerchantRequestID,
    checkoutRequestId: cb.CheckoutRequestID,
    resultCode: cb.ResultCode,
    resultDesc: cb.ResultDesc,
    receipt: receipt === undefined ? undefined : String(receipt),
    amountMajor: amount === undefined ? undefined : Number(amount),
    transactionDate: parseDarajaDate(
      typeof txDate === 'number' || typeof txDate === 'string' ? txDate : undefined,
    ),
    phone: phone === undefined ? undefined : String(phone),
  };
}

export function parseC2BPayload(raw: unknown): z.infer<typeof C2B_PAYLOAD_SCHEMA> {
  const parsed = C2B_PAYLOAD_SCHEMA.safeParse(raw);
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Malformed C2B payload');
  }
  return parsed.data;
}

function txStatusFor(
  category: ReturnType<typeof describeMpesaResult>['category'],
  success: boolean,
): MpesaTxStatus {
  if (success) return 'SUCCESS';
  if (category === 'cancelled') return 'CANCELLED';
  if (category === 'timeout') return 'TIMEOUT';
  return 'FAILED';
}

export function toPaymentDto(p: Payment): PaymentDto {
  return {
    id: p.id,
    bookingId: p.bookingId,
    provider: p.provider,
    status: p.status,
    amountMinor: p.amountMinor,
    currency: p.currency as PaymentDto['currency'],
    idempotencyKey: p.idempotencyKey,
    providerRef: p.providerRef,
    clientSecret: p.clientSecret,
    failureCode: p.failureCode,
    failureMessage: p.failureMessage,
    paidAt: p.paidAt?.toISOString() ?? null,
    expiresAt: p.expiresAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
  };
}

export function toRefundDto(r: Refund): RefundDto {
  return {
    id: r.id,
    bookingId: r.bookingId,
    paymentId: r.paymentId,
    amountMinor: r.amountMinor,
    currency: r.currency as RefundDto['currency'],
    status: r.status,
    route: r.route,
    reason: r.reason,
    requestedById: r.requestedById,
    approvedById: r.approvedById,
    providerRef: r.providerRef,
    failureReason: r.failureReason,
    completedAt: r.completedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

export function toC2BPaymentDto(row: {
  id: string;
  transId: string;
  billRefNumber: string;
  msisdn: string;
  amountMinor: number;
  currency: string;
  status: string;
  bookingId: string | null;
  paymentId: string | null;
  notes: string | null;
  createdAt: Date;
}): C2BPaymentDto {
  return {
    id: row.id,
    transId: row.transId,
    billRefNumber: row.billRefNumber,
    msisdn: row.msisdn,
    amountMinor: row.amountMinor,
    currency: row.currency as C2BPaymentDto['currency'],
    status: row.status as C2BPaymentDto['status'],
    bookingId: row.bookingId,
    paymentId: row.paymentId,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Payments: creation/idempotency, STK + C2B callback processing (fast ack →
 * BullMQ → idempotent state machine), reconciliation sweep, FINANCE-gated
 * refunds with OTP step-up.
 *
 * Every confirm path funnels through `applyPaidLocked` inside ONE Prisma
 * transaction, guarded by conditional `updateMany` claims — duplicate or lost
 * callback deliveries can never confirm a booking twice or double-convert
 * inventory (see test/payments.e2e.spec.ts).
 */
@Injectable()
export class PaymentsService implements OnModuleInit, OnModuleDestroy {
  private readonly log: Logger = createLogger('payments');
  private queue?: Queue;
  private queueConnection?: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
    private readonly otp: OtpService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queueConnection = new Redis(getEnv().REDIS_URL, { maxRetriesPerRequest: null });
    this.queueConnection.on('error', (err: Error) => {
      this.log.warn('redis (payment queue) connection error', { message: err.message });
    });
    this.queue = new Queue(PAYMENT_CB_QUEUE, { connection: this.queueConnection });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
    this.queueConnection?.quit();
  }

  // ── HTTP: create + initiate ──────────────────────────────────────────────

  async create(actor: BookingActor, dto: CreatePaymentDto): Promise<PaymentDto> {
    const booking = await this.prisma.booking.findUnique({ where: { id: dto.bookingId } });
    if (!booking) throw new AppError('NOT_FOUND', 'Booking not found');
    assertBookingAccess(booking, actor);

    if (!['HELD', 'PENDING_PAYMENT'].includes(booking.status)) {
      if (booking.status === 'CONFIRMED' || booking.status === 'CHECKED_IN') {
        throw new AppError('CONFLICT', 'Booking is already paid');
      }
      throw new AppError(
        'INVALID_STATE_TRANSITION',
        `Booking ${booking.pnr} is ${booking.status} and cannot be paid`,
      );
    }

    const msisdn = this.resolveMsisdn(dto.msisdn, actor, booking);
    const env = getEnv();
    const isPush = this.provider.name !== 'STRIPE';
    if (isPush && this.provider.name === 'MPESA_STK' && env.MPESA_MODE === 'live' && !msisdn) {
      throw new AppError('VALIDATION_ERROR', 'A phone number is required for M-Pesa STK push');
    }

    // Booking: HELD → PENDING_PAYMENT (guarded; a lost race means the sweeper
    // or a concurrent request already moved it).
    if (booking.status === 'HELD') {
      const stepped = await this.prisma.booking.updateMany({
        where: { id: booking.id, status: 'HELD' },
        data: { status: 'PENDING_PAYMENT' },
      });
      if (stepped.count === 0) {
        const fresh = await this.prisma.booking.findUnique({ where: { id: booking.id } });
        throw new AppError(
          fresh && fresh.status === 'PENDING_PAYMENT' ? 'CONFLICT' : 'INVALID_STATE_TRANSITION',
          fresh && fresh.status === 'PENDING_PAYMENT'
            ? 'Payment already in progress'
            : `Booking is ${fresh?.status ?? 'gone'}`,
        );
      }
    }

    const idempotencyKey = dto.idempotencyKey ?? randomToken(16);
    let payment: Payment;
    try {
      payment = await this.prisma.payment.create({
        data: {
          bookingId: booking.id,
          provider: this.provider.name,
          status: 'REQUIRES_ACTION',
          amountMinor: booking.totalMinor,
          currency: booking.currency,
          idempotencyKey,
          expiresAt: booking.expiresAt,
        },
      });
    } catch (err) {
      if (isUniqueViolation(err, 'idempotencyKey')) {
        const existing = await this.prisma.payment.findUnique({
          where: { idempotencyKey },
        });
        if (existing) {
          if (existing.bookingId !== booking.id) {
            throw new AppError('IDEMPOTENCY_CONFLICT', 'Key already used for another booking');
          }
          return toPaymentDto(existing); // replay — never double-initiate
        }
      }
      throw err;
    }

    await this.initiate(payment.id, booking, msisdn, actor);
    const fresh = await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    await this.audit('payment.create', actor, fresh.id, 'SUCCESS', {
      pnr: booking.pnr,
      provider: fresh.provider,
      amountMinor: fresh.amountMinor,
    });
    return toPaymentDto(fresh);
  }

  /** Re-initiate an STK push / intent for an unpaid payment (POST :id/stk). */
  async initiateStk(actor: BookingActor, paymentId: string): Promise<PaymentDto> {
    const payment = await this.loadPayment(paymentId, actor);
    if (payment.status === 'PAID') {
      throw new AppError('CONFLICT', 'Payment already completed');
    }
    if (payment.booking.status !== 'PENDING_PAYMENT') {
      throw new AppError(
        'INVALID_STATE_TRANSITION',
        `Booking is ${payment.booking.status} — a new payment attempt is not possible`,
      );
    }
    const msisdn = this.resolveMsisdn(undefined, actor, payment.booking);
    await this.initiate(payment.id, payment.booking, msisdn, actor, true);
    const fresh = await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    await this.audit('payment.stk.initiate', actor, fresh.id, 'SUCCESS', {
      pnr: payment.booking.pnr,
    });
    return toPaymentDto(fresh);
  }

  private async initiate(
    paymentId: string,
    booking: Booking,
    msisdn: string | undefined,
    actor: BookingActor,
    reinitiate = false,
  ): Promise<void> {
    const env = getEnv();
    let providerRef: string;
    let clientSecret: string | null = null;
    try {
      const result = await this.provider.initiate({
        paymentId,
        accountReference: booking.pnr,
        amountMinor: booking.totalMinor,
        currency: booking.currency,
        msisdn,
        callbackUrl: `${env.API_PUBLIC_URL}/${GLOBAL_PREFIX}/payments/cb/${env.MPESA_CALLBACK_SECRET}/stk`,
        description: 'Flight13',
      });
      providerRef = result.providerRef;
      clientSecret = result.clientSecret ?? null;
    } catch (err) {
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: {
          status: 'FAILED',
          failureCode: 'PROVIDER_ERROR',
          failureMessage: err instanceof AppError ? err.message : 'Payment provider error',
        },
      });
      await this.audit('payment.initiate.failed', actor, paymentId, 'FAILURE', {
        pnr: booking.pnr,
        message: (err as Error).message,
      });
      throw err;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          providerRef,
          clientSecret,
          status: 'REQUIRES_ACTION',
          failureCode: null,
          failureMessage: null,
        },
      });
      if (this.provider.name !== 'STRIPE') {
        // what we ask Daraja to debit (rounding policy) vs what the booking owes
        const debit =
          this.provider.name === 'MPESA_STK' && env.MPESA_MODE === 'live'
            ? Math.round(
                (roundKesFromMinor(booking.totalMinor, env.MPESA_AMOUNT_ROUNDING) ?? 0) * 100,
              )
            : booking.totalMinor;
        await tx.mpesaTransaction.create({
          data: {
            paymentId,
            checkoutRequestId: providerRef,
            accountReference: booking.pnr,
            phone: msisdn ?? '',
            amountMinor: debit,
            amountExpectedMinor: booking.totalMinor,
            currency: booking.currency,
            status: 'PENDING',
          },
        });
      }
    });
    if (reinitiate) this.log.info('payment re-initiated', { paymentId, providerRef });
  }

  async get(actor: BookingActor, paymentId: string): Promise<PaymentDto> {
    return toPaymentDto(await this.loadPayment(paymentId, actor));
  }

  async listForBooking(actor: BookingActor, bookingId: string): Promise<PaymentDto[]> {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new AppError('NOT_FOUND', 'Booking not found');
    assertBookingAccess(booking, actor);
    const rows = await this.prisma.payment.findMany({
      where: { bookingId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toPaymentDto);
  }

  // ── STK callbacks: fast ack + idempotent processing ──────────────────────

  /** HTTP side of the STK callback: validate, persist, enqueue — ack fast. */
  async ingestStkCallback(raw: unknown): Promise<{ accepted: true; reason?: string }> {
    const result = normalizeStkPayload(raw); // throws VALIDATION_ERROR on garbage
    const tx = await this.prisma.mpesaTransaction.findUnique({
      where: { checkoutRequestId: result.checkoutRequestId },
    });
    if (!tx) {
      // Unknown checkout id: still ack (Safaricom would retry forever otherwise)
      // and leave a breadcrumb for ops.
      this.log.warn('stk callback for unknown checkout', {
        checkoutRequestId: result.checkoutRequestId,
      });
      return { accepted: true, reason: 'unknown_checkout' };
    }
    if (tx.status === 'PENDING') {
      await this.prisma.mpesaTransaction.updateMany({
        where: { id: tx.id, status: 'PENDING' },
        // Store the raw Daraja body — processStkCallback re-parses it with the
        // same schema validator, so a stored normalized result would not round-trip.
        data: { rawPayload: raw as object },
      });
    }
    await this.enqueue({ kind: 'stk', mpesaTxId: tx.id }, `stk-${tx.id}`);
    return { accepted: true };
  }

  /** BullMQ side: parse the stored payload and run the state machine. */
  async processStkCallback(mpesaTxId: string): Promise<void> {
    const row = await this.prisma.mpesaTransaction.findUnique({ where: { id: mpesaTxId } });
    if (!row) {
      this.log.warn('stk job for missing transaction', { mpesaTxId });
      return;
    }
    if (row.status !== 'PENDING') return; // fast path; claim below is authoritative
    let result: StkResult;
    try {
      result = normalizeStkPayload(row.rawPayload);
    } catch {
      this.log.error('stored stk payload malformed', { mpesaTxId });
      return;
    }
    const outcome = await this.applyStkResult(mpesaTxId, result, 'callback');
    this.log.info('stk result processed', { mpesaTxId, code: result.resultCode, outcome });
  }

  /**
   * The single STK state machine — used by callbacks, mock simulate and the
   * reconciliation sweep. One transaction: claim the STK attempt, claim the
   * payment, confirm the booking + convert inventory (all conditionally).
   */
  async applyStkResult(
    mpesaTxId: string,
    result: StkResult,
    source: 'callback' | 'reconcile' | 'simulate',
  ): Promise<ApplyOutcome> {
    const info = describeMpesaResult(result.resultCode);
    const success = info.category === 'success';

    const outcome = await this.prisma.$transaction(async (tx) => {
      const row = await tx.mpesaTransaction.findUnique({
        where: { id: mpesaTxId },
        include: { payment: true },
      });
      if (!row) return 'skipped' as const;

      const actualMinor =
        result.amountMajor === undefined ? undefined : Math.round(result.amountMajor * 100);
      const mismatched = success && actualMinor !== undefined && actualMinor !== row.amountMinor;

      const claimed = await tx.mpesaTransaction.updateMany({
        where: { id: row.id, status: 'PENDING' },
        data: {
          status: txStatusFor(info.category, success && !mismatched),
          resultCode: result.resultCode,
          resultDesc: (result.resultDesc ?? info.label).slice(0, 500),
          ...(result.receipt ? { mpesaReceiptNumber: result.receipt } : {}),
          ...(result.transactionDate ? { transactionDate: result.transactionDate } : {}),
          ...(result.phone ? { phone: result.phone } : {}),
          ...(source === 'reconcile' ? { reconciledAt: new Date() } : {}),
        },
      });
      if (claimed.count === 0) return 'duplicate' as const;

      if (success && !mismatched) {
        return this.applyPaidLocked(tx, row.payment, row.checkoutRequestId, source);
      }

      if (mismatched) {
        await tx.payment.updateMany({
          where: { id: row.paymentId, status: { in: PAYMENT_STATUSES_TO_CLAIM } },
          data: {
            status: 'FAILED',
            failureCode: 'AMOUNT_MISMATCH',
            failureMessage: `Received KES ${(actualMinor ?? 0) / 100}, expected KES ${row.amountMinor / 100} — manual resolution required`,
          },
        });
        return 'mismatch' as const;
      }

      await tx.payment.updateMany({
        where: { id: row.paymentId, status: { in: PAYMENT_STATUSES_TO_CLAIM } },
        data: {
          status: 'FAILED',
          failureCode: `MPESA_${result.resultCode}`,
          failureMessage: info.en,
        },
      });
      return 'applied' as const;
    });

    // Audits happen after commit (never inside the money transaction).
    if (outcome === 'paid') {
      await this.audit('payment.paid', null, mpesaTxId, 'SUCCESS', {
        code: result.resultCode,
        receipt: result.receipt,
        source,
        phone: maskPhone(result.phone ? `+${result.phone}` : undefined),
      });
    } else if (outcome === 'mismatch') {
      await this.audit('payment.amount_mismatch', null, mpesaTxId, 'FAILURE', {
        code: result.resultCode,
        source,
      });
    } else if (outcome === 'unconfirmable') {
      await this.audit('payment.orphaned', null, mpesaTxId, 'FAILURE', {
        code: result.resultCode,
        source,
        note: 'funds received, booking not confirmable',
      });
    } else if (outcome === 'applied') {
      await this.audit('payment.failed', null, mpesaTxId, 'FAILURE', {
        code: result.resultCode,
        message: info.en,
        source,
      });
    }
    return outcome;
  }

  /**
   * Claim payment → PAID and confirm the booking + inventory, inside the
   * caller's transaction. Conditional claims make duplicates no-ops.
   */
  private async applyPaidLocked(
    tx: Db,
    payment: Payment,
    providerRef: string,
    source: string,
  ): Promise<'paid' | 'duplicate' | 'unconfirmable'> {
    const claimed = await tx.payment.updateMany({
      where: { id: payment.id, status: { in: PAYMENT_STATUSES_TO_CLAIM } },
      data: {
        status: 'PAID',
        paidAt: new Date(),
        providerRef,
        failureCode: null,
        failureMessage: null,
      },
    });
    if (claimed.count === 0) return 'duplicate';

    // A payment can exist while the booking went the other way (sweeper
    // expired it mid-STK, C2B confirmed it via another payment, …).
    if (payment.bookingId) {
      const ok = await this.bookings.confirmPaid(payment.bookingId, tx);
      if (!ok) {
        this.log.warn('money received but booking not confirmable', {
          paymentId: payment.id,
          bookingId: payment.bookingId,
          source,
        });
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            failureMessage:
              'Funds received but the booking can no longer be confirmed — manual resolution required',
          },
        });
        return 'unconfirmable';
      }
    }
    return 'paid';
  }

  // ── mock simulation (dev/demo/test helper) ───────────────────────────────

  async simulateStk(
    actor: BookingActor,
    paymentId: string,
    resultCode: number,
  ): Promise<PaymentDto> {
    if (getEnv().MPESA_MODE !== 'mock') {
      throw new AppError('NOT_FOUND', 'Payment simulation only exists in mock mode');
    }
    const payment = await this.loadPayment(paymentId, actor);
    if (payment.status === 'PAID') throw new AppError('CONFLICT', 'Payment already completed');
    // No booking-status guard here: a real Daraja callback carries no booking
    // context either. applyPaidLocked decides — an EXPIRED/CANCELLED booking
    // yields PAID + "manual resolution required" (orphaned money), never a
    // silent re-confirm.

    const info = describeMpesaResult(resultCode);
    const success = info.category === 'success';

    if (this.provider.name !== 'STRIPE') {
      const tx = await this.prisma.mpesaTransaction.findFirst({
        where: { paymentId },
        orderBy: { createdAt: 'desc' },
      });
      if (!tx) throw new AppError('CONFLICT', 'No payment attempt to simulate');
      if (tx.status !== 'PENDING') {
        throw new AppError(
          'INVALID_STATE_TRANSITION',
          'Attempt already processed — re-initiate first',
        );
      }
      const amountMajor = Math.round(tx.amountMinor / 100);
      const payload = {
        Body: {
          stkCallback: {
            MerchantRequestID: `MOCKMRQ${randomToken(4)}`,
            CheckoutRequestID: tx.checkoutRequestId,
            ResultCode: resultCode,
            ResultDesc: info.en,
            ...(success
              ? {
                  CallbackMetadata: {
                    Item: [
                      { Name: 'Amount', Value: amountMajor },
                      { Name: 'MpesaReceiptNumber', Value: `MOCKRCT${randomToken(6)}` },
                      { Name: 'TransactionDate', Value: Number(stampDaraja(new Date())) },
                      {
                        Name: 'PhoneNumber',
                        Value: Number(tx.phone.replace(/\D/g, '').slice(-12) || '254700000000'),
                      },
                    ],
                  },
                }
              : {}),
          },
        },
      };
      const result = normalizeStkPayload(payload);
      const outcome = await this.applyStkResult(tx.id, result, 'simulate');
      this.log.info('simulated stk result', { paymentId, code: resultCode, outcome });
      return toPaymentDto(
        await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } }),
      );
    }

    // Stripe-style mock payment: no STK attempt — apply directly.
    if (!success) {
      await this.prisma.payment.updateMany({
        where: { id: payment.id, status: { in: PAYMENT_STATUSES_TO_CLAIM } },
        data: {
          status: 'FAILED',
          failureCode: `STRIPE_${resultCode}`,
          failureMessage: info.en,
        },
      });
    } else {
      const outcome = await this.prisma.$transaction((tx) =>
        this.applyPaidLocked(
          tx,
          payment,
          payment.providerRef ?? `MOCKSI_${randomToken(4)}`,
          'simulate',
        ),
      );
      await this.audit('payment.paid', actor, payment.id, 'SUCCESS', {
        source: 'simulate',
        outcome,
      });
    }
    return toPaymentDto(await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } }));
  }

  // ── C2B (paybill) ────────────────────────────────────────────────────────

  /** C2B validation runs BEFORE money moves — reject unknown/unpayable now. */
  async validateC2B(raw: unknown): Promise<Record<string, string>> {
    const payload = parseC2BPayload(raw);
    const amount = Number(payload.TransAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ...C2B_VALIDATION.INVALID_AMOUNT };
    }
    const pnr = payload.BillRefNumber.trim().toUpperCase();
    const booking = await this.prisma.booking.findUnique({ where: { pnr } });
    if (!booking) return { ...C2B_VALIDATION.INVALID_ACCOUNT };
    if (!['HELD', 'PENDING_PAYMENT'].includes(booking.status)) {
      return { ...C2B_VALIDATION.NOT_PAYABLE };
    }
    return { ...C2B_VALIDATION.ACCEPT };
  }

  /** HTTP side of C2B confirmation: dedupe by TransID, enqueue, ack. */
  async ingestC2BConfirm(raw: unknown): Promise<{ accepted: true; deduped?: true }> {
    const payload = parseC2BPayload(raw);
    const pnr = payload.BillRefNumber.trim().toUpperCase();
    const msisdn = payload.MSISDN ?? payload.Msisdn ?? '';
    const amount = Number(payload.TransAmount);
    let rowId: string;
    try {
      const row = await this.prisma.mpesaC2BPayment.create({
        data: {
          transId: payload.TransID,
          billRefNumber: pnr,
          msisdn,
          amountMinor: Math.round(amount * 100),
          status: 'RECEIVED',
          rawPayload: payload as unknown as object,
        },
      });
      rowId = row.id;
    } catch (err) {
      if (isUniqueViolation(err, 'transId')) {
        this.log.info('duplicate c2b confirmation ignored', { transId: payload.TransID });
        return { accepted: true, deduped: true };
      }
      throw err;
    }
    await this.enqueue({ kind: 'c2b', c2bId: rowId }, `c2b-${rowId}`);
    return { accepted: true };
  }

  /** BullMQ side of C2B: match the paybill reference to a booking. */
  async processC2B(c2bId: string): Promise<void> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const row = await tx.mpesaC2BPayment.findUnique({ where: { id: c2bId } });
      if (!row) return 'skipped' as const;
      const claim = (data: Record<string, unknown>) =>
        tx.mpesaC2BPayment.updateMany({
          where: { id: row.id, status: 'RECEIVED' },
          data: data as never,
        });

      const booking = await tx.booking.findUnique({ where: { pnr: row.billRefNumber } });
      if (!booking) {
        await claim({ status: 'UNKNOWN_ACCOUNT', notes: 'No booking with this bill reference' });
        return 'unknown' as const;
      }

      if (!['HELD', 'PENDING_PAYMENT'].includes(booking.status)) {
        const stale = await tx.payment.findFirst({
          where: { bookingId: booking.id },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });
        await claim({
          status: 'LATE_PAYMENT',
          bookingId: booking.id,
          paymentId: stale?.id ?? null,
          notes: `Booking already ${booking.status} — funds held for finance`,
        });
        return 'late' as const;
      }

      const expected = booking.totalMinor;
      const target =
        row.amountMinor === expected
          ? 'MATCHED'
          : row.amountMinor > expected
            ? 'OVERPAID'
            : 'UNDERPAID';

      if (target === 'UNDERPAID') {
        await claim({
          status: 'UNDERPAID',
          bookingId: booking.id,
          notes: `Received KES ${row.amountMinor / 100}, expected KES ${expected / 100} — not confirmed`,
        });
        return 'underpaid' as const;
      }

      // Matched / overpaid: confirm the booking first (guarded), then record
      // the money. A HELD booking steps through PENDING_PAYMENT like STK does.
      if (booking.status === 'HELD') {
        const stepped = await tx.booking.updateMany({
          where: { id: booking.id, status: 'HELD' },
          data: { status: 'PENDING_PAYMENT' },
        });
        if (stepped.count === 0) return 'late' as const;
      }
      const ok = await this.bookings.confirmPaid(booking.id, tx);
      if (!ok) {
        await claim({
          status: 'LATE_PAYMENT',
          bookingId: booking.id,
          notes: 'Booking not confirmable',
        });
        return 'late' as const;
      }
      const claimed = await claim({
        status: target,
        bookingId: booking.id,
        notes:
          target === 'OVERPAID'
            ? `Overpaid by KES ${(row.amountMinor - expected) / 100} — refund review`
            : null,
      });
      if (claimed.count === 0) return 'duplicate' as const;
      await tx.payment.create({
        data: {
          bookingId: booking.id,
          provider: 'MPESA_C2B',
          status: 'PAID',
          amountMinor: row.amountMinor,
          currency: row.currency,
          idempotencyKey: `c2b:${row.transId}`,
          providerRef: row.transId,
          paidAt: new Date(),
        },
      });
      return target.toLowerCase() as 'matched' | 'overpaid';
    });

    if (outcome !== 'skipped' && outcome !== 'duplicate') {
      await this.audit(`payment.c2b.${outcome}`, null, c2bId, 'SUCCESS', { outcome });
    }
    this.log.info('c2b processed', { c2bId, outcome });
  }

  // ── Stripe webhook (live mode) ───────────────────────────────────────────

  async ingestStripeEvent(event: Stripe.Event): Promise<void> {
    const obj = event.data.object as { id?: string; payment_intent?: string | { id?: string } };
    const pi =
      typeof obj.payment_intent === 'string'
        ? obj.payment_intent
        : (obj.payment_intent?.id ?? obj.id ?? '');
    if (!pi) return;

    if (event.type === 'payment_intent.succeeded') {
      const payment = await this.prisma.payment.findFirst({ where: { providerRef: pi } });
      if (!payment) {
        this.log.warn('stripe event for unknown payment intent', { pi });
        return;
      }
      const res = await this.prisma.$transaction((tx) =>
        this.applyPaidLocked(tx, payment, pi, 'webhook'),
      );
      if (res === 'paid')
        await this.audit('payment.paid', null, payment.id, 'SUCCESS', { source: 'stripe-webhook' });
      return;
    }

    if (event.type === 'payment_intent.payment_failed') {
      const payment = await this.prisma.payment.findFirst({ where: { providerRef: pi } });
      if (!payment) return;
      await this.prisma.payment.updateMany({
        where: { id: payment.id, status: { in: PAYMENT_STATUSES_TO_CLAIM } },
        data: {
          status: 'FAILED',
          failureCode: 'STRIPE_FAILED',
          failureMessage: 'The card payment did not complete',
        },
      });
      await this.audit('payment.failed', null, payment.id, 'FAILURE', { source: 'stripe-webhook' });
    }
  }

  // ── reconciliation ───────────────────────────────────────────────────────

  /** Poll stale PENDING rows at the provider; apply any terminal answer. */
  async reconcileOnce(): Promise<number> {
    const env = getEnv();
    const cutoff = new Date(Date.now() - env.RECONCILE_STK_AFTER_SECONDS * 1000);
    let polled = 0;

    if (this.provider.name === 'STRIPE') {
      const stale = await this.prisma.payment.findMany({
        where: {
          provider: 'STRIPE',
          status: 'REQUIRES_ACTION',
          providerRef: { not: null },
          createdAt: { lt: cutoff },
        },
        take: 25,
      });
      for (const payment of stale) {
        const attempts =
          Number((payment.metadata as { queryAttempts?: number } | null)?.queryAttempts ?? 0) + 1;
        const answer = await this.provider.query(payment.providerRef!);
        polled += 1;
        if (answer.outcome === 'PENDING') {
          if (attempts >= 10) {
            await this.prisma.payment.updateMany({
              where: { id: payment.id, status: 'REQUIRES_ACTION' },
              data: {
                status: 'EXPIRED',
                failureCode: 'RECONCILE_TIMEOUT',
                failureMessage: 'Intent never completed',
              },
            });
            await this.audit('payment.reconcile.expired', null, payment.id, 'SUCCESS', {
              attempts,
            });
          } else {
            await this.prisma.payment.update({
              where: { id: payment.id },
              data: {
                metadata: {
                  ...(payment.metadata as object),
                  queryAttempts: attempts,
                  lastPolledAt: new Date().toISOString(),
                },
              },
            });
          }
          continue;
        }
        if (answer.outcome === 'SUCCESS') {
          const res = await this.prisma.$transaction((tx) =>
            this.applyPaidLocked(tx, payment, payment.providerRef!, 'reconcile'),
          );
          if (res === 'paid') {
            await this.audit('payment.paid', null, payment.id, 'SUCCESS', { source: 'reconcile' });
          }
        } else {
          const code = codeForOutcome(answer);
          const info = describeMpesaResult(code);
          await this.prisma.payment.updateMany({
            where: { id: payment.id, status: { in: PAYMENT_STATUSES_TO_CLAIM } },
            data: { status: 'FAILED', failureCode: `PROVIDER_${code}`, failureMessage: info.en },
          });
          await this.audit('payment.failed', null, payment.id, 'FAILURE', {
            source: 'reconcile',
            code,
          });
        }
      }
      return polled;
    }

    const stale = await this.prisma.mpesaTransaction.findMany({
      where: {
        status: 'PENDING',
        createdAt: { lt: cutoff },
        queryAttempts: { lt: 10 },
      },
      orderBy: { createdAt: 'asc' },
      take: 25,
    });
    for (const tx of stale) {
      const answer = await this.provider.query(tx.checkoutRequestId);
      polled += 1;
      await this.prisma.mpesaTransaction.updateMany({
        where: { id: tx.id, status: 'PENDING' },
        data: { queryAttempts: { increment: 1 }, lastPolledAt: new Date() },
      });
      if (answer.outcome === 'PENDING') continue;
      const code = codeForOutcome(answer);
      const outcome = await this.applyStkResult(
        tx.id,
        {
          merchantRequestId: '',
          checkoutRequestId: tx.checkoutRequestId,
          resultCode: code,
          resultDesc: answer.resultDesc,
        },
        'reconcile',
      );
      this.log.info('reconciled stale stk attempt', { txId: tx.id, code, outcome });
    }
    return polled;
  }

  // ── refunds (FINANCE + OTP step-up) ──────────────────────────────────────

  async refund(actor: BookingActor, paymentId: string, dto: RefundPaymentDto): Promise<RefundDto> {
    if (actor.role !== 'FINANCE') {
      throw new AppError('FORBIDDEN', 'Refunds require the FINANCE role');
    }
    // Validate everything that can fail cheaply BEFORE consuming the step-up
    // OTP — a typo'd amount must not burn the customer's code.
    const payment = await this.loadPayment(paymentId, actor);
    if (!['PAID', 'PARTIALLY_REFUNDED'].includes(payment.status)) {
      throw new AppError(
        'INVALID_STATE_TRANSITION',
        `Payment is ${payment.status} — only captured money can be refunded`,
      );
    }
    const prior = await this.prisma.refund.findMany({
      where: { paymentId, status: { notIn: ['REJECTED', 'FAILED'] } },
      select: { amountMinor: true },
    });
    const reserved = prior.reduce((sum, r) => sum + r.amountMinor, 0);
    const refundable = payment.amountMinor - reserved;
    const amount = dto.amountMinor ?? refundable;
    if (amount <= 0 || amount > refundable) {
      throw new AppError(
        'PAYMENT_AMOUNT_MISMATCH',
        `Refundable amount is ${refundable} minor units — asked for ${amount}`,
      );
    }

    // Step-up: a fresh OTP sent to the FINANCE user's own phone (purpose REFUND).
    if (!actor.phone) {
      throw new AppError('VALIDATION_ERROR', 'Your account has no phone for the step-up code');
    }
    await this.otp.verify(actor.phone, 'REFUND', dto.otp);

    const route =
      payment.provider === 'STRIPE'
        ? 'STRIPE'
        : payment.provider === 'MPESA_STK' || payment.provider === 'MPESA_C2B'
          ? 'MPESA_B2C'
          : 'MANUAL';

    let refund = await this.prisma.refund.create({
      data: {
        bookingId: payment.bookingId,
        paymentId: payment.id,
        amountMinor: amount,
        currency: payment.currency,
        status: 'REQUESTED',
        route,
        reason: dto.reason,
        requestedById: actor.userId!,
        approvedById: actor.userId!, // FINANCE approval = this authenticated action
        approvedAt: new Date(),
      },
    });

    const providerRef = await this.resolveRefundRef(payment);
    try {
      const result = await this.provider.refund({
        providerRef,
        amountMinor: amount,
        currency: payment.currency,
        reason: dto.reason,
      });
      refund = await this.prisma.refund.update({
        where: { id: refund.id },
        data: {
          status: result.status === 'COMPLETED' ? 'COMPLETED' : 'PROCESSING',
          providerRef: result.providerRef,
          completedAt: result.status === 'COMPLETED' ? new Date() : null,
        },
      });
    } catch (err) {
      refund = await this.prisma.refund.update({
        where: { id: refund.id },
        data: { status: 'FAILED', failureReason: (err as Error).message },
      });
      await this.audit('payment.refund.failed', actor, refund.id, 'FAILURE', {
        paymentId,
        message: (err as Error).message,
      });
      throw new AppError('PAYMENT_PROVIDER_ERROR', 'Refund could not be processed', {
        refundId: refund.id,
      });
    }

    // Full refund → payment REFUNDED + booking REFUNDED (inventory back);
    // partial → money back, booking untouched.
    const fullyRefunded = reserved + amount >= payment.amountMinor;
    if (fullyRefunded) {
      await this.prisma.payment.updateMany({
        where: { id: payment.id, status: { in: ['PAID', 'PARTIALLY_REFUNDED'] } },
        data: { status: 'REFUNDED' },
      });
      const ok = await this.bookings.markRefunded(payment.bookingId);
      if (!ok) {
        await this.audit('payment.refund.booking_state_conflict', actor, payment.id, 'FAILURE', {
          note: 'booking was not in a refundable state',
        });
      }
    } else {
      await this.prisma.payment.updateMany({
        where: { id: payment.id, status: { in: ['PAID', 'PARTIALLY_REFUNDED'] } },
        data: { status: 'PARTIALLY_REFUNDED' },
      });
    }

    await this.audit('payment.refund', actor, refund.id, 'SUCCESS', {
      paymentId,
      amountMinor: amount,
      full: fullyRefunded,
      route,
      reason: dto.reason,
    });
    return toRefundDto(refund);
  }

  private async resolveRefundRef(payment: Payment): Promise<string> {
    if (payment.provider === 'MPESA_STK') {
      const tx = await this.prisma.mpesaTransaction.findFirst({
        where: { paymentId: payment.id, mpesaReceiptNumber: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: { mpesaReceiptNumber: true },
      });
      if (tx?.mpesaReceiptNumber) return tx.mpesaReceiptNumber;
    }
    if (payment.provider === 'MPESA_C2B') {
      const c2b = await this.prisma.mpesaC2BPayment.findFirst({
        where: { paymentId: payment.id },
        orderBy: { createdAt: 'desc' },
        select: { transId: true },
      });
      if (c2b) return c2b.transId;
    }
    return payment.providerRef ?? payment.id;
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async loadPayment(
    id: string,
    actor: BookingActor,
  ): Promise<Payment & { booking: Booking }> {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: { booking: true },
    });
    if (!payment) throw new AppError('NOT_FOUND', 'Payment not found');
    assertBookingAccess(payment.booking, actor);
    return payment;
  }

  private resolveMsisdn(
    explicit: string | undefined,
    actor: BookingActor,
    booking: Booking,
  ): string | undefined {
    const raw = explicit ?? actor.phone ?? booking.contactPhone ?? undefined;
    if (!raw) return undefined;
    try {
      return toMpesaMsisdn(raw);
    } catch {
      if (this.provider.name === 'MPESA_STK' && getEnv().MPESA_MODE === 'live') {
        throw new AppError('VALIDATION_ERROR', 'Phone is not a Kenyan mobile number');
      }
      return undefined;
    }
  }

  private async enqueue(job: PaymentCbJob, jobId: string): Promise<void> {
    if (!this.queue) {
      throw new AppError('SERVICE_UNAVAILABLE', 'Payment queue not ready');
    }
    await this.queue.add(job.kind === 'stk' ? 'stk-result' : 'c2b-confirm', job, {
      jobId,
      removeOnComplete: { age: 3600 },
      removeOnFail: { age: 86_400 },
    });
  }

  private async audit(
    action: string,
    actor: BookingActor | null,
    entityId: string | undefined,
    outcome: 'SUCCESS' | 'FAILURE' | 'DENIED',
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action,
          actorId: actor?.userId ?? null,
          actorRole: actor?.role ?? null,
          entityType: 'payment',
          entityId,
          outcome,
          ip: actor?.ip,
          requestId: actor?.requestId,
          metadata: metadata ? (maskDeep(metadata) as object) : undefined,
        },
      });
    } catch {
      // audit must never fail the business action
    }
  }
}

function assertBookingAccess(booking: { userId: string | null }, actor: BookingActor): void {
  if (STAFF_ROLES.includes(actor.role)) return;
  if (actor.userId && booking.userId === actor.userId) return;
  throw new AppError('FORBIDDEN', 'You do not have access to this booking');
}

function isUniqueViolation(err: unknown, field: string): boolean {
  const e = err as { code?: string; meta?: { target?: unknown } } | null;
  return (
    !!e &&
    e.code === 'P2002' &&
    Array.isArray(e.meta?.target) &&
    (e.meta?.target as string[]).includes(field)
  );
}

function codeForOutcome(answer: { outcome: string; resultCode?: number }): number {
  if (answer.resultCode !== undefined && Number.isFinite(answer.resultCode))
    return answer.resultCode;
  switch (answer.outcome) {
    case 'SUCCESS':
      return 0;
    case 'CANCELLED':
      return 1032;
    case 'TIMEOUT':
      return 1037;
    default:
      return 1;
  }
}

function stampDaraja(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  // Africa/Nairobi wall time
  const eat = new Date(now.getTime() + 3 * 3600 * 1000);
  return (
    `${eat.getUTCFullYear()}${p(eat.getUTCMonth() + 1)}${p(eat.getUTCDate())}` +
    `${p(eat.getUTCHours())}${p(eat.getUTCMinutes())}${p(eat.getUTCSeconds())}`
  );
}
