import { Injectable } from '@nestjs/common';
import type { PaymentProviderType } from '@prisma/client';
import { AppError, type PaymentPlanDto } from '@flight13/shared';
import { getEnv } from '../../../config/env';
import {
  encryptionKeyConfigured,
  maskSecret,
  openSecrets,
  sealSecrets,
} from '../../../common/crypto';
import { maskDeep } from '../../../common/logger';
import { PrismaService } from '../../../prisma/prisma.module';
import type { BookingActor } from '../../bookings/bookings.service';

/** Config rows are keyed by canonical provider — C2B shares the Daraja account. */
export const CANONICAL: Record<string, 'MPESA_STK' | 'STRIPE' | 'MOCK'> = {
  MPESA_STK: 'MPESA_STK',
  MPESA_C2B: 'MPESA_STK',
  STRIPE: 'STRIPE',
  MOCK: 'MOCK',
};

export type MethodSource = 'ENV' | 'DATABASE';

export interface MpesaRuntimeSettings {
  mode: 'mock' | 'live';
  mpesaEnv: 'sandbox' | 'production';
  shortcode: string;
  callbackBaseUrl: string;
  allowedCallbackIps: string;
  initiatorName: string;
}

export interface StripeRuntimeSettings {
  mode: 'mock' | 'live';
}

export interface EffectiveMethod {
  provider: PaymentProviderType;
  enabled: boolean;
  source: MethodSource;
  version: number | null;
  settings: MpesaRuntimeSettings & StripeRuntimeSettings;
  /** Decrypted merged secrets — server-side only, never leaves this module. */
  secrets: {
    consumerKey: string;
    consumerSecret: string;
    passkey: string;
    securityCredential: string;
    secretKey: string;
    webhookSecret: string;
    /** Previous webhook secret, exposed only inside the 24h rotation grace. */
    previousWebhookSecret: string;
  };
  secretsRotatedAt: Date | null;
  updatedById: string | null;
  updatedAt: Date | null;
}

export interface EffectivePlan {
  defaultProvider: PaymentProviderType;
  encryptionKeyConfigured: boolean;
  methods: EffectiveMethod[];
}

export interface UpdateMethodInput {
  enabled?: boolean;
  /** Partial settings; `''` removes a stored override (falls back to env). */
  settings?: Partial<MpesaRuntimeSettings & StripeRuntimeSettings>;
  /** Partial secrets; a value of `''` clears the stored secret; omitted keeps. */
  secrets?: Record<string, string>;
}

const SECRETS_BY_PROVIDER: Record<string, string[]> = {
  MPESA_STK: ['consumerKey', 'consumerSecret', 'passkey', 'securityCredential'],
  STRIPE: ['secretKey', 'webhookSecret'],
  MOCK: [],
};

const SETTINGS_KEYS = [
  'mode',
  'mpesaEnv',
  'shortcode',
  'callbackBaseUrl',
  'allowedCallbackIps',
  'initiatorName',
] as const;

/** Previous-secrets grace for Stripe webhook signatures after a rotation. */
const WEBHOOK_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Runtime payment-method configuration ("payment plans"). Environment
 * variables provide the defaults; an admin-edited `PaymentMethodConfig` row
 * overrides them field-by-field. Reads are cached for a few seconds so
 * console edits propagate to every instance without restarts, while
 * in-flight payments are structurally unaffected (each Payment keeps its
 * own provider; the neutral callback-path secret stays env-only).
 */
@Injectable()
export class MethodConfigService {
  private cache: { at: number; plan: EffectivePlan } | null = null;
  private static readonly TTL_MS = 10_000;

  constructor(private readonly prisma: PrismaService) {}

  /** Full effective plan (default provider + every method), cached briefly. */
  async plan(): Promise<EffectivePlan> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < MethodConfigService.TTL_MS) {
      return this.cache.plan;
    }
    const env = getEnv();
    const [singleton, rows] = await Promise.all([
      this.prisma.paymentPlanSettings.findUnique({ where: { id: true } }),
      this.prisma.paymentMethodConfig.findMany(),
    ]);
    const byKey = new Map(rows.map((r) => [r.provider, r]));
    const methods: EffectiveMethod[] = (['MPESA_STK', 'STRIPE', 'MOCK'] as const).map((key) =>
      this.merge(key, byKey.get(key) ?? null),
    );
    const plan: EffectivePlan = {
      defaultProvider:
        singleton?.defaultProvider ?? (env.PAYMENT_PROVIDER_DEFAULT as PaymentProviderType),
      encryptionKeyConfigured: encryptionKeyConfigured(),
      methods,
    };
    this.cache = { at: now, plan };
    return plan;
  }

  /** Effective config for one provider (MPESA_C2B resolves the MPESA_STK row). */
  async method(type: PaymentProviderType | string): Promise<EffectiveMethod> {
    const canonical = CANONICAL[String(type)] ?? 'MOCK';
    const plan = await this.plan();
    const found = plan.methods.find((m) => m.provider === canonical);
    if (!found) throw new AppError('NOT_FOUND', `Unknown payment method ${String(type)}`);
    return found;
  }

  /** Callback IP allowlist for Daraja delivery (env- or admin-configured). */
  async callbackAllowlist(): Promise<string[]> {
    const eff = await this.method('MPESA_STK');
    return eff.settings.allowedCallbackIps
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /** Stripe webhook verification secrets: current + grace-window previous. */
  async stripeVerification(): Promise<{
    mode: 'mock' | 'live';
    secretKey: string;
    secrets: string[];
  }> {
    const eff = await this.method('STRIPE');
    const secrets = [eff.secrets.webhookSecret].filter(Boolean);
    const withinGrace =
      eff.secrets.previousWebhookSecret &&
      eff.secretsRotatedAt &&
      Date.now() - eff.secretsRotatedAt.getTime() < WEBHOOK_GRACE_MS;
    if (withinGrace) secrets.push(eff.secrets.previousWebhookSecret);
    return { mode: eff.settings.mode, secretKey: eff.secrets.secretKey, secrets };
  }

  /**
   * Admin write: merge a partial update into the stored overrides, validate
   * the resulting effective state, re-seal secrets and audit the change.
   * A secret value of `''` clears the override (env takes over again).
   */
  async updateMethod(
    type: PaymentProviderType | string,
    input: UpdateMethodInput,
    actor: BookingActor,
  ): Promise<EffectiveMethod> {
    const canonical = CANONICAL[String(type)];
    if (!canonical || canonical === 'MOCK') {
      throw new AppError('NOT_FOUND', 'Only M-Pesa and Stripe methods are configurable');
    }
    const existing = await this.prisma.paymentMethodConfig.findUnique({
      where: { provider: canonical },
    });

    // Settings: stored overrides only — fields left unset keep following env.
    const priorSettings = (existing?.settings ?? {}) as Record<string, string>;
    const nextSettings: Record<string, string> = { ...priorSettings };
    const enumFields: Record<string, string[]> = {
      mode: ['mock', 'live'],
      mpesaEnv: ['sandbox', 'production'],
    };
    for (const [k, v] of Object.entries(input.settings ?? {})) {
      if (!SETTINGS_KEYS.includes(k as (typeof SETTINGS_KEYS)[number])) continue;
      if (v === '' || v === undefined) {
        delete nextSettings[k];
        continue;
      }
      if (typeof v !== 'string' || v.length > 1024) {
        throw new AppError('VALIDATION_ERROR', `Invalid value for setting ${k}`);
      }
      if (enumFields[k] && !enumFields[k].includes(v)) {
        throw new AppError('VALIDATION_ERROR', `${k} must be one of: ${enumFields[k].join(', ')}`);
      }
      nextSettings[k] = v;
    }

    // Secrets: merge stored + provided; '' clears; require the KEK to write.
    const allowedSecrets = SECRETS_BY_PROVIDER[canonical] ?? [];
    const provided = Object.fromEntries(
      Object.entries(input.secrets ?? {}).filter(
        ([k, v]) => allowedSecrets.includes(k) && typeof v === 'string' && v.length <= 2048,
      ),
    );
    const stored = openSecrets(existing?.secretsEnc);
    const nextSecrets: Record<string, string> = { ...stored };
    let secretsChanged = false;
    for (const [k, v] of Object.entries(provided)) {
      if (v === '') {
        if (k in nextSecrets) secretsChanged = true;
        delete nextSecrets[k];
      } else if (v !== stored[k]) {
        nextSecrets[k] = v;
        secretsChanged = true;
      }
    }
    if (secretsChanged && Object.keys(nextSecrets).length > 0 && !encryptionKeyConfigured()) {
      throw new AppError(
        'VALIDATION_ERROR',
        'ENCRYPTION_KEY is unusable — secret fields cannot be saved (settings only)',
      );
    }

    const enabled = input.enabled ?? existing?.enabled ?? true;

    // Effective-state validation: a save must not produce a live method with
    // missing credentials (mirrors the env superRefine rules).
    this.validateEffective(canonical, nextSettings, nextSecrets);

    const row = await this.prisma.paymentMethodConfig.upsert({
      where: { provider: canonical },
      create: {
        provider: canonical,
        enabled,
        settings: Object.keys(nextSettings).length > 0 ? nextSettings : undefined,
        secretsEnc: sealSecrets(nextSecrets),
        updatedById: actor.userId,
      },
      update: {
        enabled,
        settings: Object.keys(nextSettings).length > 0 ? nextSettings : undefined,
        secretsEnc: sealSecrets(nextSecrets),
        ...(secretsChanged
          ? { previousSecretsEnc: existing?.secretsEnc ?? null, secretsRotatedAt: new Date() }
          : {}),
        version: { increment: 1 },
        updatedById: actor.userId,
      },
    });

    this.cache = null;
    await this.audit(
      'payment_config.update',
      row.id,
      {
        provider: canonical,
        enabled,
        settings: nextSettings,
        secretsStored: Object.keys(nextSecrets),
        secretsChanged,
      },
      actor,
    );
    return this.method(canonical);
  }

  /** Drop the overrides for a method — it falls back to environment defaults. */
  async revertMethod(
    type: PaymentProviderType | string,
    actor: BookingActor,
  ): Promise<EffectiveMethod> {
    const canonical = CANONICAL[String(type)];
    if (!canonical || canonical === 'MOCK') {
      throw new AppError('NOT_FOUND', 'Only M-Pesa and Stripe methods are configurable');
    }
    const existing = await this.prisma.paymentMethodConfig.findUnique({
      where: { provider: canonical },
    });
    if (existing) {
      await this.prisma.paymentMethodConfig.delete({ where: { provider: canonical } });
      this.cache = null;
      await this.audit('payment_config.revert', existing.id, { provider: canonical }, actor);
    }
    return this.method(canonical);
  }

  /** Choose which method NEW payments are created with (in-flight unaffected). */
  async setDefault(type: PaymentProviderType, actor: BookingActor): Promise<EffectivePlan> {
    if (!['MPESA_STK', 'MPESA_C2B', 'STRIPE', 'MOCK'].includes(type)) {
      throw new AppError('VALIDATION_ERROR', `Unknown payment method ${String(type)}`);
    }
    await this.prisma.paymentPlanSettings.upsert({
      where: { id: true },
      create: { id: true, defaultProvider: type, updatedById: actor.userId },
      update: { defaultProvider: type, updatedById: actor.userId },
    });
    this.cache = null;
    await this.audit(
      'payment_config.default_provider',
      'singleton',
      { defaultProvider: type },
      actor,
    );
    return this.plan();
  }

  /** Admin-facing DTO: same shape as effective, but secrets only as status. */
  toMasked(plan: EffectivePlan): PaymentPlanDto {
    return {
      defaultProvider: plan.defaultProvider,
      encryptionKeyConfigured: plan.encryptionKeyConfigured,
      methods: plan.methods.map((m) => ({
        provider: m.provider,
        enabled: m.enabled,
        source: m.source,
        version: m.version,
        settings: {
          mode: m.settings.mode,
          mpesaEnv: m.provider === 'MPESA_STK' ? m.settings.mpesaEnv : undefined,
          shortcode: m.provider === 'MPESA_STK' ? m.settings.shortcode : undefined,
          callbackBaseUrl: m.provider === 'MPESA_STK' ? m.settings.callbackBaseUrl : undefined,
          allowedCallbackIps:
            m.provider === 'MPESA_STK' ? m.settings.allowedCallbackIps : undefined,
          initiatorName: m.provider === 'MPESA_STK' ? m.settings.initiatorName : undefined,
        },
        secrets: Object.fromEntries(
          (SECRETS_BY_PROVIDER[m.provider] ?? []).map((key) => {
            const value = m.secrets[key as keyof typeof m.secrets];
            return [key, { configured: Boolean(value), masked: maskSecret(value) }];
          }),
        ),
        updatedById: m.updatedById,
        updatedAt: m.updatedAt?.toISOString() ?? null,
      })),
    };
  }

  // ── validation & audit ───────────────────────────────────────────────────

  /**
   * Mirrors the env superRefine rules on the *effective* result of a save:
   * flipping a method to live without usable credentials must fail loudly
   * here, not at the first payment attempt.
   */
  private validateEffective(
    provider: 'MPESA_STK' | 'STRIPE' | 'MOCK',
    settings: Record<string, unknown>,
    secrets: Record<string, string>,
  ): void {
    const env = getEnv();
    const mode =
      provider === 'MPESA_STK'
        ? (settings.mode as string) || env.MPESA_MODE
        : (settings.mode as string) || env.STRIPE_MODE;
    if (mode !== 'live') return;

    const required: Array<[field: string, value: string]> =
      provider === 'MPESA_STK'
        ? [
            ['consumerKey', secrets.consumerKey || env.MPESA_CONSUMER_KEY],
            ['consumerSecret', secrets.consumerSecret || env.MPESA_CONSUMER_SECRET],
            ['shortcode', (settings.shortcode as string) || env.MPESA_SHORTCODE],
            ['passkey', secrets.passkey || env.MPESA_PASSKEY],
            [
              'callbackBaseUrl',
              (settings.callbackBaseUrl as string) || env.MPESA_CALLBACK_BASE_URL,
            ],
          ]
        : [['secretKey', secrets.secretKey || env.STRIPE_SECRET_KEY]];

    const missing = required.filter(([, value]) => !value).map(([field]) => field);
    if (missing.length > 0) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Cannot enable live mode — missing: ${missing.join(', ')}`,
      );
    }
    if (provider === 'MPESA_STK') {
      const base = (settings.callbackBaseUrl as string) || env.MPESA_CALLBACK_BASE_URL;
      if (!base.startsWith('https://')) {
        throw new AppError(
          'VALIDATION_ERROR',
          'callbackBaseUrl must be a public https:// URL in live mode',
        );
      }
    }
  }

  /** Config audit follows the payments convention: it never fails the action. */
  private async audit(
    action: string,
    entityId: string,
    metadata: Record<string, unknown>,
    actor: BookingActor,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action,
          actorId: actor.userId,
          actorRole: actor.role,
          entityType: 'payment_config',
          entityId,
          outcome: 'SUCCESS',
          ip: actor.ip,
          requestId: actor.requestId,
          metadata: maskDeep(metadata) as object,
        },
      });
    } catch {
      // audit must never fail the business action
    }
  }

  // ── merge ────────────────────────────────────────────────────────────────

  private merge(
    provider: 'MPESA_STK' | 'STRIPE' | 'MOCK',
    row: {
      enabled: boolean;
      settings: unknown;
      secretsEnc: string | null;
      previousSecretsEnc: string | null;
      secretsRotatedAt: Date | null;
      version: number;
      updatedById: string | null;
      updatedAt: Date;
    } | null,
  ): EffectiveMethod {
    const env = getEnv();
    const s = (row?.settings ?? {}) as Record<string, string>;
    const stored = openSecrets(row?.secretsEnc);
    const previous = openSecrets(row?.previousSecretsEnc);

    const isMpesa = provider === 'MPESA_STK';
    const isStripe = provider === 'STRIPE';

    return {
      provider,
      enabled: row?.enabled ?? true,
      source: row ? 'DATABASE' : 'ENV',
      version: row?.version ?? null,
      settings: {
        mode: (isMpesa
          ? (s.mode ?? env.MPESA_MODE)
          : isStripe
            ? (s.mode ?? env.STRIPE_MODE)
            : 'mock') as 'mock' | 'live',
        mpesaEnv: (s.mpesaEnv ?? env.MPESA_ENV) as 'sandbox' | 'production',
        shortcode: s.shortcode ?? env.MPESA_SHORTCODE,
        callbackBaseUrl: s.callbackBaseUrl ?? env.MPESA_CALLBACK_BASE_URL,
        allowedCallbackIps: s.allowedCallbackIps ?? env.MPESA_ALLOWED_CALLBACK_IPS,
        initiatorName: s.initiatorName ?? env.MPESA_INITIATOR_NAME,
      },
      secrets: {
        consumerKey: stored.consumerKey ?? env.MPESA_CONSUMER_KEY,
        consumerSecret: stored.consumerSecret ?? env.MPESA_CONSUMER_SECRET,
        passkey: stored.passkey ?? env.MPESA_PASSKEY,
        securityCredential: stored.securityCredential ?? env.MPESA_SECURITY_CREDENTIAL,
        secretKey: stored.secretKey ?? env.STRIPE_SECRET_KEY,
        webhookSecret: stored.webhookSecret ?? env.STRIPE_WEBHOOK_SECRET,
        previousWebhookSecret: previous.webhookSecret ?? '',
      },
      secretsRotatedAt: row?.secretsRotatedAt ?? null,
      updatedById: row?.updatedById ?? null,
      updatedAt: row?.updatedAt ?? null,
    };
  }
}
