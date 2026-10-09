import { randomUUID } from 'node:crypto';
import type { PaymentProviderType } from '@prisma/client';
import type {
  PaymentProvider,
  ProviderInitiateInput,
  ProviderInitiateResult,
  ProviderQueryResult,
  ProviderRefundInput,
  ProviderRefundResult,
} from './payment-provider';

/**
 * Deterministic in-process provider used by tests and local dev
 * (`MPESA_MODE=mock`, `STRIPE_MODE=mock`, `PAYMENT_PROVIDER_DEFAULT=MOCK`).
 *
 * It has no external state: `query()` always answers PENDING (there is nothing
 * to ask), and results arrive through the same callback/simulate pipeline the
 * live provider uses — so idempotency and state-machine tests exercise the
 * real processing code, not a shortcut.
 */
export class MockProvider implements PaymentProvider {
  constructor(readonly name: PaymentProviderType = 'MOCK') {}

  async initiate(input: ProviderInitiateInput): Promise<ProviderInitiateResult> {
    return {
      providerRef: `MOCKCHK_${randomUUID()}`,
      clientSecret: `mock_secret_${input.paymentId}`,
      customerMessage:
        'Mock provider: deliver a result via /payments/:id/simulate or the callback URL.',
      raw: { mock: true, accountReference: input.accountReference, amountMinor: input.amountMinor },
    };
  }

  async query(_providerRef: string): Promise<ProviderQueryResult> {
    return {
      outcome: 'PENDING',
      resultDesc: 'mock provider has no external state',
      raw: { mock: true },
    };
  }

  async refund(input: ProviderRefundInput): Promise<ProviderRefundResult> {
    return {
      providerRef: `MOCKRFND_${randomUUID()}`,
      status: 'COMPLETED',
      raw: { mock: true, providerRef: input.providerRef, amountMinor: input.amountMinor },
    };
  }
}
