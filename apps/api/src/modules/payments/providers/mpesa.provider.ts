import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import type { PaymentProviderType } from '@prisma/client';
import { AppError, describeMpesaResult, toMpesaMsisdn } from '@kenyaairways/shared';
import { getEnv, type Env } from '../../../config/env';
import { createLogger, type Logger } from '../../../common/logger';
import type { RedisService } from '../../../redis/redis.module';
import type {
  PaymentProvider,
  ProviderInitiateInput,
  ProviderInitiateResult,
  ProviderOutcome,
  ProviderQueryResult,
  ProviderRefundInput,
  ProviderRefundResult,
} from './payment-provider';

const OAUTH_CACHE_KEY_PREFIX = 'mpesa:oauth:';

/**
 * Daraja credentials resolved from the effective config (DB override or env).
 * Built per config version by PaymentProviderRegistry — a provider instance
 * therefore speaks with exactly the credentials it was created from.
 */
export interface MpesaRuntimeConfig {
  mpesaEnv: 'sandbox' | 'production';
  consumerKey: string;
  consumerSecret: string;
  shortcode: string;
  passkey: string;
  initiatorName: string;
  securityCredential: string;
}

/**
 * `YYYYMMDDHHmmss` in Africa/Nairobi (EAT, UTC+3) — the timestamp Daraja
 * requires inside the STK password. Pure function so tests pin the clock.
 */
export function mpesaTimestamp(now: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  });
  // Locale part order is day-first for en-GB — build YYYYMMDDHHmmss explicitly.
  const parts = fmt.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}${part('month')}${part('day')}${part('hour')}${part('minute')}${part('second')}`;
}

/** Daraja STK password: base64(Shortcode + Passkey + Timestamp) — no separators. */
export function buildStkPassword(shortcode: string, passkey: string, timestamp: string): string {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`, 'utf8').toString('base64');
}

/** Whole-shilling amount per MPESA_AMOUNT_ROUNDING; null = reject (rounding=reject). */
export function roundKesFromMinor(
  amountMinor: number,
  policy: Env['MPESA_AMOUNT_ROUNDING'],
): number | null {
  if (policy === 'reject') return amountMinor % 100 === 0 ? amountMinor / 100 : null;
  const major = amountMinor / 100;
  if (policy === 'round_nearest') return Math.round(major);
  return Math.ceil(major); // round_up (default): never under-collect
}

export interface StkPayloadInput {
  shortcode: string;
  passkey: string;
  timestamp: string;
  amountMajor: number;
  msisdn: string; // 2547XXXXXXXX
  /** PNR — Daraja AccountReference, max 12 chars. */
  accountReference: string;
  callbackUrl: string;
}

/**
 * STK push request body. Invariants the spec pins down:
 *  - AccountReference is the PNR, truncated to 12 chars
 *  - TransactionDesc is the literal "Kenya Airways"
 *  - CallbackURL is the neutral path (no provider names in it)
 */
export function buildStkPayload(input: StkPayloadInput): Record<string, unknown> {
  return {
    BusinessShortCode: input.shortcode,
    Password: buildStkPassword(input.shortcode, input.passkey, input.timestamp),
    Timestamp: input.timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: input.amountMajor, // whole KES
    PartyA: input.msisdn,
    PartyB: input.shortcode,
    PhoneNumber: input.msisdn,
    CallBackURL: input.callbackUrl,
    AccountReference: input.accountReference.slice(0, 12),
    TransactionDesc: 'Kenya Airways',
  };
}

function darajaHost(mpesaEnv: 'sandbox' | 'production'): string {
  return mpesaEnv === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';
}

function outcomeForCode(code: number): ProviderOutcome {
  const info = describeMpesaResult(code);
  switch (info.category) {
    case 'success':
      return 'SUCCESS';
    case 'cancelled':
      return 'CANCELLED';
    case 'timeout':
      return 'TIMEOUT';
    case 'in_process':
      return 'PENDING';
    default:
      return 'FAILED';
  }
}

/**
 * Live Safaricom Daraja integration (STK push + query + B2C refund).
 * OAuth tokens are cached in Redis for their lifetime minus 60s of slack.
 * All money movement is recorded by PaymentsService — this class only speaks
 * to Daraja and normalizes its responses.
 */
export class MpesaProvider implements PaymentProvider {
  readonly name: PaymentProviderType = 'MPESA_STK';
  private readonly log: Logger = createLogger('mpesa-provider');

  constructor(
    private readonly redis: RedisService,
    private readonly cfg: MpesaRuntimeConfig,
  ) {}

  /** OAuth tokens are cached per consumer key — a rotation gets a fresh token. */
  private oauthCacheKey(): string {
    return `${OAUTH_CACHE_KEY_PREFIX}${createHash('sha256').update(this.cfg.consumerKey).digest('hex').slice(0, 12)}`;
  }

  private async accessToken(): Promise<string> {
    const cacheKey = this.oauthCacheKey();
    const cached = await this.redis.raw.get(cacheKey);
    if (cached) return cached;

    const basic = Buffer.from(
      `${this.cfg.consumerKey}:${this.cfg.consumerSecret}`,
      'utf8',
    ).toString('base64');
    const res = await fetch(
      `${darajaHost(this.cfg.mpesaEnv)}/oauth/v1/generate?grant_type=client_credentials`,
      {
        headers: { Authorization: `Basic ${basic}` },
      },
    );
    if (!res.ok) {
      throw new AppError('PAYMENT_PROVIDER_ERROR', `Daraja OAuth failed (${res.status})`);
    }
    const body = (await res.json()) as { access_token: string; expires_in: string | number };
    const ttl = Math.max(Number(body.expires_in) - 60, 60);
    await this.redis.raw.set(cacheKey, body.access_token, 'EX', ttl);
    return body.access_token;
  }

  private async post(path: string, payload: unknown): Promise<Record<string, unknown>> {
    const token = await this.accessToken();
    const res = await fetch(`${darajaHost(this.cfg.mpesaEnv)}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || body.errorCode) {
      const message =
        typeof body.errorMessage === 'string'
          ? body.errorMessage
          : `Daraja ${path} → ${res.status}`;
      this.log.error('daraja request failed', { path, errorCode: body.errorCode });
      throw new AppError('PAYMENT_PROVIDER_ERROR', message);
    }
    return body;
  }

  async initiate(input: ProviderInitiateInput): Promise<ProviderInitiateResult> {
    if (!input.msisdn) {
      throw new AppError('VALIDATION_ERROR', 'An M-Pesa phone number is required for STK push');
    }
    // Rounding policy is a finance decision — env-only, not admin-editable.
    const amountMajor = roundKesFromMinor(input.amountMinor, getEnv().MPESA_AMOUNT_ROUNDING);
    if (amountMajor === null) {
      throw new AppError(
        'PAYMENT_AMOUNT_MISMATCH',
        'Amount is not a whole-shilling value and MPESA_AMOUNT_ROUNDING=reject',
      );
    }
    const timestamp = mpesaTimestamp();
    const payload = buildStkPayload({
      shortcode: this.cfg.shortcode,
      passkey: this.cfg.passkey,
      timestamp,
      amountMajor,
      msisdn: toMpesaMsisdn(input.msisdn),
      accountReference: input.accountReference,
      callbackUrl: input.callbackUrl ?? '',
    });
    const data = await this.post('/mpesa/stkpush/v1/processrequest', payload);
    const providerRef = String(data.CheckoutRequestID ?? '');
    if (!providerRef) {
      throw new AppError('PAYMENT_PROVIDER_ERROR', 'Daraja did not return a CheckoutRequestID');
    }
    return {
      providerRef,
      customerMessage: typeof data.CustomerMessage === 'string' ? data.CustomerMessage : undefined,
      raw: data,
    };
  }

  async query(providerRef: string): Promise<ProviderQueryResult> {
    const timestamp = mpesaTimestamp();
    const payload = {
      BusinessShortCode: this.cfg.shortcode,
      Password: buildStkPassword(this.cfg.shortcode, this.cfg.passkey, timestamp),
      Timestamp: timestamp,
      CheckoutRequestID: providerRef,
    };
    try {
      const data = await this.post('/mpesa/stkpushquery/v1/query', payload);
      // ResultCode 0 = success; Daraja uses error codes for still-processing too.
      const code = Number(data.ResultCode ?? -1);
      return {
        outcome: outcomeForCode(code),
        resultCode: Number.isFinite(code) ? code : undefined,
        resultDesc: typeof data.ResultDesc === 'string' ? data.ResultDesc : undefined,
        raw: data,
      };
    } catch (err) {
      // "500.001.1001 — still processing" and transient errors mean: keep waiting.
      this.log.warn('stk query failed', { providerRef, message: (err as Error).message });
      return { outcome: 'PENDING', resultDesc: 'query unavailable — will retry', raw: undefined };
    }
  }

  async refund(input: ProviderRefundInput): Promise<ProviderRefundResult> {
    const amountMajor = roundKesFromMinor(input.amountMinor, getEnv().MPESA_AMOUNT_ROUNDING);
    if (amountMajor === null) {
      throw new AppError('PAYMENT_AMOUNT_MISMATCH', 'Refund amount is not whole shillings');
    }
    const payload = {
      Initiator: this.cfg.initiatorName,
      SecurityCredential: this.cfg.securityCredential,
      CommandID: 'Refund',
      TransactionID: input.providerRef, // MpesaReceiptNumber
      Amount: amountMajor,
      Occasion: 'Booking refund',
      Remarks: (input.reason ?? 'Kenya Airways booking refund').slice(0, 100),
    };
    const data = await this.post('/mpesa/refund/v1/process', payload);
    const accepted = String(data.ResponseCode ?? '') === '0';
    return {
      // Daraja refunds settle asynchronously via the result URL — see README
      // (known gap: live refund completion is closed manually / by reports).
      providerRef: String(data.ConversationID ?? data.MerchantRequestID ?? input.providerRef),
      status: accepted ? 'PROCESSING' : 'FAILED',
      raw: data,
    };
  }
}
