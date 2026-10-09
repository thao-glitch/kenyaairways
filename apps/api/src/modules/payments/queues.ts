import type { PaymentStatus, RefundStatus } from '@prisma/client';

/** BullMQ queue: fast-callback → heavy processing (STK results, C2B confirms). */
export const PAYMENT_CB_QUEUE = 'payment-cb';
/** BullMQ queue: repeat sweep polling stale PENDING payments at Daraja/Stripe. */
export const PAYMENT_RECONCILE_QUEUE = 'payment-reconcile';

/**
 * Jobs on PAYMENT_CB_QUEUE. HTTP callbacks only validate + enqueue (ack fast,
 * see ARCHITECTURE §6); all state transitions happen idempotently here.
 */
export type PaymentCbJob = { kind: 'stk'; mpesaTxId: string } | { kind: 'c2b'; c2bId: string };

export const PAYMENT_STATUSES_TO_CLAIM: PaymentStatus[] = ['REQUIRES_ACTION', 'PENDING', 'FAILED'];
export const REFUND_TERMINAL: RefundStatus[] = ['REJECTED', 'FAILED'];
