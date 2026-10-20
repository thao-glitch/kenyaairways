import Stripe from 'stripe';
import type { PaymentProviderType } from '@prisma/client';
import { AppError } from '@kenyaairways/shared';
import { createLogger, type Logger } from '../../../common/logger';
import type {
  PaymentProvider,
  ProviderInitiateInput,
  ProviderInitiateResult,
  ProviderOutcome,
  ProviderQueryResult,
  ProviderRefundInput,
  ProviderRefundResult,
} from './payment-provider';

function outcomeForIntent(pi: Stripe.PaymentIntent): ProviderOutcome {
  if (pi.status === 'succeeded') return 'SUCCESS';
  if (pi.status === 'canceled') return 'CANCELLED';
  if (pi.last_payment_error) return 'FAILED';
  // requires_payment_method / processing / requires_action / requires_confirmation
  return 'PENDING';
}

/**
 * Live Stripe behind the same typed seam as Daraja (`STRIPE_MODE=live`).
 * Creates PaymentIntents (client confirms in the browser with Stripe.js) and
 * polls them from the reconciliation sweep — no Stripe webhook needed for M5
 * (webhook endpoint exists for later use, signature-verified).
 *
 * NOTE for finance: confirm KES is an acceptable Stripe currency before
 * flipping STRIPE_MODE — flagged in README.
 */
export class StripeProvider implements PaymentProvider {
  readonly name: PaymentProviderType = 'STRIPE';
  private readonly stripe: Stripe;
  private readonly log: Logger = createLogger('stripe-provider');

  /** `secretKey` comes from the effective config (DB override or env). */
  constructor(cfg: { secretKey: string }) {
    this.stripe = new Stripe(cfg.secretKey);
  }

  async initiate(input: ProviderInitiateInput): Promise<ProviderInitiateResult> {
    try {
      const intent = await this.stripe.paymentIntents.create({
        amount: input.amountMinor, // Stripe uses minor units natively
        currency: input.currency.toLowerCase(),
        description: input.description,
        metadata: {
          paymentId: input.paymentId,
          accountReference: input.accountReference,
        },
        automatic_payment_methods: { enabled: true },
      });
      return {
        providerRef: intent.id,
        clientSecret: intent.client_secret,
        raw: { status: intent.status },
      };
    } catch (err) {
      this.log.error('payment intent create failed', { message: (err as Error).message });
      throw new AppError('PAYMENT_PROVIDER_ERROR', 'Stripe could not start the payment');
    }
  }

  async query(providerRef: string): Promise<ProviderQueryResult> {
    try {
      const intent = await this.stripe.paymentIntents.retrieve(providerRef);
      return {
        outcome: outcomeForIntent(intent),
        resultDesc: intent.status,
        raw: { status: intent.status },
      };
    } catch (err) {
      this.log.warn('payment intent query failed', {
        providerRef,
        message: (err as Error).message,
      });
      return { outcome: 'PENDING', resultDesc: 'query unavailable — will retry' };
    }
  }

  async refund(input: ProviderRefundInput): Promise<ProviderRefundResult> {
    try {
      const refund = await this.stripe.refunds.create({
        payment_intent: input.providerRef,
        amount: input.amountMinor,
        reason: 'requested_by_customer',
      });
      return {
        providerRef: refund.id,
        status: refund.status === 'succeeded' ? 'COMPLETED' : 'PROCESSING',
        raw: { status: refund.status },
      };
    } catch (err) {
      this.log.error('refund failed', { message: (err as Error).message });
      throw new AppError('PAYMENT_PROVIDER_ERROR', 'Stripe could not process the refund');
    }
  }
}
