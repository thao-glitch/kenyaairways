import { Injectable } from '@nestjs/common';
import type { PaymentProviderType } from '@prisma/client';
import { RedisService } from '../../../redis/redis.module';
import { MethodConfigService, type EffectiveMethod } from './method-config.service';
import type { PaymentProvider } from '../providers/payment-provider';
import { MockProvider } from '../providers/mock.provider';
import { MpesaProvider } from '../providers/mpesa.provider';
import { StripeProvider } from '../providers/stripe.provider';

export interface ActiveProvider {
  type: PaymentProviderType;
  mode: 'mock' | 'live';
  enabled: boolean;
  provider: PaymentProvider;
}

/**
 * Builds payment providers from the *effective* (DB-over-env) configuration
 * and caches them per config version, so an admin edit in the console takes
 * effect within the config TTL — no restart — while instances under load keep
 * reusing a stable provider object.
 *
 * Routing rules that keep in-flight payments safe across config changes:
 *   - `active()` — the method NEW payments are created with (plan default).
 *   - `forType()` — used for query/refund/reconcile/callbacks, keyed by the
 *     Payment row's own provider, so switching the default never strands an
 *     existing payment.
 */
@Injectable()
export class PaymentProviderRegistry {
  private readonly cache = new Map<string, PaymentProvider>();

  constructor(
    private readonly configs: MethodConfigService,
    private readonly redis: RedisService,
  ) {}

  /** The method new payments are created with right now. */
  async active(): Promise<ActiveProvider> {
    const plan = await this.configs.plan();
    return this.resolve(plan.defaultProvider);
  }

  /**
   * Provider + mode + enabled flag for a specific method type — used to route
   * query/refund/reconcile/callbacks by a Payment row's own stored provider.
   */
  async resolve(type: PaymentProviderType): Promise<ActiveProvider> {
    const eff = await this.configs.method(type);
    // Keyed by config version + mode: a save bumps `version`, which swaps the
    // built provider on the next call; unchanged config reuses the instance.
    const stamp = `${eff.provider}:${eff.source}:${eff.version ?? 0}:${eff.settings.mode}`;
    let provider = this.cache.get(stamp);
    if (!provider) {
      provider = this.build(eff);
      if (this.cache.size > 16) this.cache.clear(); // bound growth on hot edits
      this.cache.set(stamp, provider);
    }
    return {
      type: type === 'MPESA_C2B' ? 'MPESA_C2B' : eff.provider,
      mode: eff.settings.mode,
      enabled: eff.enabled,
      provider,
    };
  }

  private build(eff: EffectiveMethod): PaymentProvider {
    switch (eff.provider) {
      case 'MPESA_STK':
        return eff.settings.mode === 'live' &&
          eff.secrets.consumerKey &&
          eff.secrets.consumerSecret &&
          eff.secrets.passkey &&
          eff.settings.shortcode
          ? new MpesaProvider(this.redis, {
              mpesaEnv: eff.settings.mpesaEnv,
              consumerKey: eff.secrets.consumerKey,
              consumerSecret: eff.secrets.consumerSecret,
              shortcode: eff.settings.shortcode,
              passkey: eff.secrets.passkey,
              initiatorName: eff.settings.initiatorName,
              securityCredential: eff.secrets.securityCredential,
            })
          : new MockProvider('MPESA_STK');
      case 'STRIPE':
        return eff.settings.mode === 'live' && eff.secrets.secretKey
          ? new StripeProvider({ secretKey: eff.secrets.secretKey })
          : new MockProvider('STRIPE');
      case 'MOCK':
      default:
        return new MockProvider('MOCK');
    }
  }
}
