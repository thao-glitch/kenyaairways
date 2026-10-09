import type { Env } from '../../../config/env';
import type { RedisService } from '../../../redis/redis.module';
import { MpesaProvider } from './mpesa.provider';
import { MockProvider } from './mock.provider';
import { StripeProvider } from './stripe.provider';
import type { PaymentProvider } from './payment-provider';

/**
 * One active provider per environment:
 *
 *   PAYMENT_PROVIDER_DEFAULT=MOCK        → MockProvider('MOCK')
 *   PAYMENT_PROVIDER_DEFAULT=MPESA_STK   → MpesaProvider (live) / MockProvider('MPESA_STK')
 *   PAYMENT_PROVIDER_DEFAULT=MPESA_C2B   → same as MPESA_STK (C2B is receive-only;
 *                                          incoming paybill flows always work)
 *   PAYMENT_PROVIDER_DEFAULT=STRIPE      → StripeProvider (live) / MockProvider('STRIPE')
 */
export function createPaymentProvider(env: Env, redis: RedisService): PaymentProvider {
  switch (env.PAYMENT_PROVIDER_DEFAULT) {
    case 'STRIPE':
      return env.STRIPE_MODE === 'live' ? new StripeProvider() : new MockProvider('STRIPE');
    case 'MPESA_STK':
    case 'MPESA_C2B':
      return env.MPESA_MODE === 'live' ? new MpesaProvider(redis) : new MockProvider('MPESA_STK');
    case 'MOCK':
    default:
      return new MockProvider('MOCK');
  }
}
