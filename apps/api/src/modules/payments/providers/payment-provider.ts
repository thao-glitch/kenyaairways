import type { PaymentProviderType } from '@prisma/client';

export interface ProviderInitiateInput {
  paymentId: string;
  /** Daraja AccountReference: the PNR (≤12 chars, we send 6). */
  accountReference: string;
  /** Amount in integer minor units (KES cents — shillings × 100). */
  amountMinor: number;
  currency: string;
  /** 2547XXXXXXXX MSISDN for STK push (unused by Stripe). */
  msisdn?: string;
  /** Full neutral callback URL — secret path embedded server-side only. */
  callbackUrl?: string;
  /** Fixed Daraja TransactionDesc ("Kenya Airways") / Stripe description. */
  description: string;
}

export interface ProviderInitiateResult {
  /** CheckoutRequestID (M-Pesa) or PaymentIntent id (Stripe). */
  providerRef: string;
  clientSecret?: string | null;
  customerMessage?: string;
  raw?: unknown;
}

export type ProviderOutcome = 'SUCCESS' | 'FAILED' | 'PENDING' | 'CANCELLED' | 'TIMEOUT';

export interface ProviderQueryResult {
  outcome: ProviderOutcome;
  resultCode?: number;
  resultDesc?: string;
  raw?: unknown;
}

export interface ProviderRefundInput {
  /** What refunds key on: MpesaReceiptNumber (STK) or PaymentIntent id (Stripe). */
  providerRef: string;
  amountMinor: number;
  currency: string;
  reason?: string;
}

export interface ProviderRefundResult {
  providerRef: string;
  /** Mock completes immediately; Daraja B2C refunds are async (PROCESSING). */
  status: 'COMPLETED' | 'PROCESSING' | 'FAILED';
  raw?: unknown;
}

/**
 * Typed seam between the booking money flow and external processors
 * (Safaricom Daraja, Stripe). Instances are built on demand by
 * `PaymentProviderRegistry` from the effective configuration — environment
 * defaults overridden field-by-field by the admin "payment plans" tab — and
 * mock implementations are deterministic and never touch a network, which is
 * what the test suite runs against.
 */
export interface PaymentProvider {
  readonly name: PaymentProviderType;
  /** Start an STK push (M-Pesa) or PaymentIntent (Stripe). */
  initiate(input: ProviderInitiateInput): Promise<ProviderInitiateResult>;
  /** Poll external state — used by the reconciliation sweep for stale rows. */
  query(providerRef: string): Promise<ProviderQueryResult>;
  /** Return money to the passenger (callers enforce FINANCE approval). */
  refund(input: ProviderRefundInput): Promise<ProviderRefundResult>;
}
