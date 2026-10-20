import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

/**
 * Environment contract. Validated once at startup — the process exits with a
 * readable list of problems instead of failing later with cryptic errors.
 * Conditional requirements (live providers, production hardening) are enforced
 * in the `.superRefine` below.
 */

const zBool = (defaultValue: boolean) =>
  z.preprocess((value) => {
    if (value === undefined || value === null || value === '') return defaultValue;
    if (typeof value === 'boolean') return value;
    return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
  }, z.boolean());

const zPort = z.coerce.number().int().min(1).max(65535);
const zSeconds = z.coerce.number().int().positive();
const zStr = (defaultValue = '') => z.string().default(defaultValue);

const zCurrency = z.enum(['KES', 'USD', 'EUR']).default('KES');

function isValidAesKey(value: string): boolean {
  try {
    return Buffer.from(value, 'base64').length === 32;
  } catch {
    return false;
  }
}

const optionalUrl = z.preprocess(
  (value) => (value === '' || value === undefined ? undefined : value),
  z.url().optional(),
);

export const envSchema = z
  .object({
    // ── runtime ────────────────────────────────────────────────────────
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: zPort.default(4000),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    ENABLE_SWAGGER: zBool(true),

    // ── urls & cors ────────────────────────────────────────────────────
    API_PUBLIC_URL: z.url().default('http://localhost:4000'),
    WEB_PUBLIC_URL: z.url().default('http://localhost:3000'),
    NEXT_PUBLIC_API_URL: z.url().default('http://localhost:4000'),
    CORS_ORIGINS: zStr('http://localhost:3000'),

    // ── secrets (never have defaults — must be present) ────────────────
    JWT_ACCESS_SECRET: z
      .string()
      .min(32, 'must be at least 32 characters (generate one: openssl rand -hex 32)'),
    JWT_REFRESH_SECRET: z
      .string()
      .min(32, 'must be at least 32 characters (generate one: openssl rand -hex 32)'),
    SESSION_COOKIE_SECRET: z.string().min(16, 'must be at least 16 characters'),
    ENCRYPTION_KEY: z
      .string()
      .refine(isValidAesKey, 'must be base64 encoding exactly 32 bytes (openssl rand -base64 32)'),
    MPESA_CALLBACK_SECRET: z
      .string()
      .min(16, 'random token embedded in callback URLs, min 16 chars')
      .regex(/^[A-Za-z0-9_-]+$/, 'URL-safe characters only'),

    // ── data stores ────────────────────────────────────────────────────
    DATABASE_URL: z.url({ message: 'must be a postgresql:// URL' }),
    DATABASE_URL_TEST: optionalUrl,
    REDIS_URL: z.url({ message: 'must be a redis:// URL' }),

    // ── auth ───────────────────────────────────────────────────────────
    ACCESS_TOKEN_TTL: zSeconds.default(900),
    REFRESH_TOKEN_TTL: zSeconds.default(604800),
    LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    LOGIN_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
    OTP_TTL_SECONDS: zSeconds.default(300),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
    RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(20),

    // ── airline & locale ───────────────────────────────────────────────
    AIRLINE_NAME: zStr('Kenya Airways'),
    AIRLINE_IATA_CODE: z
      .string()
      .regex(/^[A-Z0-9]{2,3}$/, '2–3 alphanumeric characters, e.g. F13')
      .default('F13'),
    DEFAULT_CURRENCY: zCurrency,
    DEFAULT_TIMEZONE: zStr('Africa/Nairobi'),
    DEFAULT_LOCALE: zStr('en-KE'),
    SUPPORTED_LOCALES: zStr('en-KE,sw-KE'),

    // ── booking ────────────────────────────────────────────────────────
    SEAT_HOLD_TTL_SECONDS: zSeconds.default(600),
    BOOKING_EXPIRE_TTL_SECONDS: zSeconds.default(1800),
    // Check-in window relative to scheduled departure (UTC instants — see
    // shared checkInWindow). Finance/ops may tune per SOP.
    CHECK_IN_OPEN_HOURS: z.coerce.number().int().positive().default(24),
    CHECK_IN_CLOSE_MINUTES: z.coerce.number().int().positive().default(60),
    CHECKIN_WINDOW_OPEN_HOURS: z.coerce.number().int().positive().default(24),
    CHECKIN_WINDOW_CLOSE_HOURS: z.coerce.number().int().positive().default(1),
    MAX_PAX_PER_BOOKING: z.coerce.number().int().min(1).max(9).default(9),

    // ── payments ───────────────────────────────────────────────────────
    PAYMENT_PROVIDER_DEFAULT: z.enum(['MPESA_STK', 'MPESA_C2B', 'STRIPE', 'MOCK']).default('MOCK'),
    MPESA_MODE: z.enum(['mock', 'live']).default('mock'),
    STRIPE_MODE: z.enum(['mock', 'live']).default('mock'),
    MPESA_AMOUNT_ROUNDING: z.enum(['round_up', 'round_nearest', 'reject']).default('round_up'),

    MPESA_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
    MPESA_CONSUMER_KEY: zStr(),
    MPESA_CONSUMER_SECRET: zStr(),
    MPESA_SHORTCODE: zStr(),
    MPESA_PASSKEY: zStr(),
    MPESA_CALLBACK_BASE_URL: zStr(),
    MPESA_ALLOWED_CALLBACK_IPS: zStr(),
    MPESA_INITIATOR_NAME: zStr(),
    MPESA_SECURITY_CREDENTIAL: zStr(),

    STRIPE_SECRET_KEY: zStr(),
    STRIPE_PUBLISHABLE_KEY: zStr(),
    STRIPE_WEBHOOK_SECRET: zStr(),

    // ── notifications ──────────────────────────────────────────────────
    SMS_PROVIDER: z.enum(['mock', 'africastalking', 'twilio']).default('mock'),
    SMS_FROM: zStr('Kenya Airways'),
    AFRICASTALKING_API_KEY: zStr(),
    AFRICASTALKING_USERNAME: zStr(),
    AFRICASTALKING_SENDER_ID: zStr(),
    TWILIO_ACCOUNT_SID: zStr(),
    TWILIO_AUTH_TOKEN: zStr(),
    TWILIO_FROM: zStr(),

    EMAIL_PROVIDER: z.enum(['mock', 'resend', 'sendgrid']).default('mock'),
    EMAIL_FROM: zStr('bookings@kenyaairways.example'),
    RESEND_API_KEY: zStr(),
    SENDGRID_API_KEY: zStr(),

    PUSH_PROVIDER: z.enum(['mock', 'webpush']).default('mock'),
    VAPID_PUBLIC_KEY: zStr(),
    VAPID_PRIVATE_KEY: zStr(),
    VAPID_SUBJECT: zStr('mailto:ops@kenyaairways.example'),

    // ── flight data ────────────────────────────────────────────────────
    FLIGHT_DATA_PROVIDER: z.enum(['internal', 'external', 'mock']).default('internal'),
    EXTERNAL_FEED_BASE_URL: zStr(),
    EXTERNAL_FEED_API_KEY: zStr(),

    // ── jobs ───────────────────────────────────────────────────────────
    FLIGHT_SIMULATOR_ENABLED: zBool(false),
    FLIGHT_SIMULATOR_TICK_MS: z.coerce.number().int().positive().default(30_000),
    RECONCILE_STK_AFTER_SECONDS: z.coerce.number().int().positive().default(75),

    // ── compliance ─────────────────────────────────────────────────────
    PRIVACY_POLICY_VERSION: zStr('2026-01'),
    DATA_RETENTION_BOOKING_DAYS: z.coerce.number().int().positive().default(2555),
    DATA_RETENTION_LOG_DAYS: z.coerce.number().int().positive().default(365),
    REPORTING_MANIFEST_OPERATOR: zStr(),
    // KCAA manifest dispatch: empty URL → no-op dispatcher (default in dev/CI)
    KCAA_MANIFEST_URL: z.url().or(z.literal('')).default(''),
    KCAA_MANIFEST_TOKEN: zStr(''),

    // ── seed (dev only) ────────────────────────────────────────────────
    SEED_USER_PASSWORD: z.string().min(8, 'dev seed login password (set in .env)'),
  })
  .superRefine((env, ctx) => {
    if (env.MPESA_MODE === 'live') {
      const required: [string, string][] = [
        ['MPESA_CONSUMER_KEY', 'required when MPESA_MODE=live'],
        ['MPESA_CONSUMER_SECRET', 'required when MPESA_MODE=live'],
        ['MPESA_SHORTCODE', 'Paybill number, required when MPESA_MODE=live'],
        ['MPESA_PASSKEY', 'Lipa na M-Pesa passkey, required when MPESA_MODE=live'],
        ['MPESA_CALLBACK_BASE_URL', 'public https base URL, required when MPESA_MODE=live'],
      ];
      for (const [key, message] of required) {
        if (!env[key as keyof typeof env]) {
          ctx.addIssue({ code: 'custom', path: [key], message });
        }
      }
      if (env.MPESA_ENV === 'production') {
        const productionOnly: [string, string][] = [
          ['MPESA_INITIATOR_NAME', 'required for reversals/B2C in production'],
          ['MPESA_SECURITY_CREDENTIAL', 'required for reversals/B2C in production'],
          ['MPESA_ALLOWED_CALLBACK_IPS', 'Safaricom IP allowlist strongly required in production'],
        ];
        for (const [key, message] of productionOnly) {
          if (!env[key as keyof typeof env]) {
            ctx.addIssue({ code: 'custom', path: [key], message });
          }
        }
      }
    }

    if (env.STRIPE_MODE === 'live') {
      if (!env.STRIPE_SECRET_KEY)
        ctx.addIssue({
          code: 'custom',
          path: ['STRIPE_SECRET_KEY'],
          message: 'required when STRIPE_MODE=live',
        });
      if (!env.STRIPE_WEBHOOK_SECRET)
        ctx.addIssue({
          code: 'custom',
          path: ['STRIPE_WEBHOOK_SECRET'],
          message: 'required when STRIPE_MODE=live',
        });
    }

    if (env.SMS_PROVIDER === 'africastalking') {
      if (!env.AFRICASTALKING_API_KEY || !env.AFRICASTALKING_USERNAME)
        ctx.addIssue({
          code: 'custom',
          path: ['AFRICASTALKING_API_KEY'],
          message:
            'AFRICASTALKING_API_KEY and AFRICASTALKING_USERNAME are required when SMS_PROVIDER=africastalking',
        });
    }
    if (env.SMS_PROVIDER === 'twilio') {
      if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM)
        ctx.addIssue({
          code: 'custom',
          path: ['TWILIO_ACCOUNT_SID'],
          message:
            'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM are required when SMS_PROVIDER=twilio',
        });
    }
    if (env.EMAIL_PROVIDER === 'resend' && !env.RESEND_API_KEY)
      ctx.addIssue({
        code: 'custom',
        path: ['RESEND_API_KEY'],
        message: 'required when EMAIL_PROVIDER=resend',
      });
    if (env.EMAIL_PROVIDER === 'sendgrid' && !env.SENDGRID_API_KEY)
      ctx.addIssue({
        code: 'custom',
        path: ['SENDGRID_API_KEY'],
        message: 'required when EMAIL_PROVIDER=sendgrid',
      });

    if (env.NODE_ENV === 'production') {
      if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET)
        ctx.addIssue({
          code: 'custom',
          path: ['JWT_REFRESH_SECRET'],
          message: 'must differ from JWT_ACCESS_SECRET in production',
        });
      if (env.MPESA_MODE === 'live' && !env.MPESA_CALLBACK_BASE_URL.startsWith('https://'))
        ctx.addIssue({
          code: 'custom',
          path: ['MPESA_CALLBACK_BASE_URL'],
          message: 'Safaricom requires an https callback base URL',
        });
      if (env.SMS_PROVIDER === 'mock' || env.EMAIL_PROVIDER === 'mock')
        ctx.addIssue({
          code: 'custom',
          path: ['SMS_PROVIDER'],
          message:
            'mock notification providers are not allowed in production — configure live keys',
        });
    }

    if (env.CHECKIN_WINDOW_CLOSE_HOURS >= env.CHECKIN_WINDOW_OPEN_HOURS)
      ctx.addIssue({
        code: 'custom',
        path: ['CHECKIN_WINDOW_CLOSE_HOURS'],
        message: 'must be smaller than CHECKIN_WINDOW_OPEN_HOURS',
      });
  });

export type Env = z.infer<typeof envSchema>;

export type LoadEnvResult = { ok: true; env: Env } | { ok: false; errors: string[] };

/** Pure loader — unit-testable, never throws, never exits. */
export function loadEnv(raw: Record<string, string | undefined>): LoadEnvResult {
  const result = envSchema.safeParse(raw);
  if (result.success) return { ok: true, env: result.data };
  return {
    ok: false,
    errors: result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    ),
  };
}

export function formatEnvErrors(errors: string[]): string {
  return [
    '✗ Kenya Airways configuration is invalid — fix these .env values and restart:',
    ...errors.map((e) => `  • ${e}`),
    '',
    '  Generate missing secrets with:  pnpm bootstrap',
    '  Template:                      .env.example',
  ].join('\n');
}

let cached: Env | null = null;
let dotenvLoaded = false;

/**
 * Loads the nearest `.env` (repo root when running from an app dir, or the
 * cwd). Existing process.env values always win, so CI/compose overrides apply.
 */
function loadDotEnvOnce(): void {
  if (dotenvLoaded) return;
  dotenvLoaded = true;
  let dir = process.cwd();
  for (let i = 0; i < 5; i += 1) {
    const candidate = `${dir}/.env`;
    try {
      if (existsSync(candidate)) {
        process.loadEnvFile(candidate);
        return;
      }
    } catch {
      /* unreadable or malformed .env — ignore, validation will explain */
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

/** Loads (once) and validates process.env; exits the process with help on failure. */
export function getEnv(): Env {
  if (cached) return cached;
  loadDotEnvOnce();
  const result = loadEnv(process.env);
  if (!result.ok) {
    console.error(formatEnvErrors(result.errors));
    process.exit(1);
  }
  cached = result.env;
  return cached;
}

/** Test hook: inject a validated environment. */
export function __setEnvForTests(env: Env | null): void {
  cached = env;
}
