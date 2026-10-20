import { describe, expect, it } from 'vitest';
import { formatEnvErrors, loadEnv } from '../src/config/env';

const validEnv = (overrides: Record<string, string | undefined> = {}) => ({
  JWT_ACCESS_SECRET: 'a'.repeat(48),
  JWT_REFRESH_SECRET: 'b'.repeat(48),
  SESSION_COOKIE_SECRET: 'c'.repeat(32),
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  MPESA_CALLBACK_SECRET: 'tok_abcdef1234567890',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/kenyaairways',
  REDIS_URL: 'redis://localhost:6379',
  SEED_USER_PASSWORD: 'Password123!',
  ...overrides,
});

describe('env validation', () => {
  it('accepts a minimal valid environment and applies defaults', () => {
    const result = loadEnv(validEnv());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.env.PORT).toBe(4000);
    expect(result.env.MPESA_MODE).toBe('mock');
    expect(result.env.STRIPE_MODE).toBe('mock');
    expect(result.env.SMS_PROVIDER).toBe('mock');
    expect(result.env.DEFAULT_CURRENCY).toBe('KES');
    expect(result.env.DEFAULT_TIMEZONE).toBe('Africa/Nairobi');
    expect(result.env.SEAT_HOLD_TTL_SECONDS).toBe(600);
  });

  it('reports every missing secret with its path', () => {
    const result = loadEnv({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const text = result.errors.join('\n');
    expect(text).toContain('JWT_ACCESS_SECRET');
    expect(text).toContain('JWT_REFRESH_SECRET');
    expect(text).toContain('ENCRYPTION_KEY');
    expect(text).toContain('MPESA_CALLBACK_SECRET');
    expect(text).toContain('DATABASE_URL');
    expect(result.errors.length).toBeGreaterThanOrEqual(6);
  });

  it('rejects a short JWT secret with actionable guidance', () => {
    const result = loadEnv(validEnv({ JWT_ACCESS_SECRET: 'short' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join('\n')).toMatch(/JWT_ACCESS_SECRET.*at least 32/);
  });

  it('rejects an encryption key that is not 32 bytes', () => {
    const result = loadEnv(validEnv({ ENCRYPTION_KEY: Buffer.alloc(16, 1).toString('base64') }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join('\n')).toContain('ENCRYPTION_KEY');
  });

  it('requires full Daraja credentials when MPESA_MODE=live', () => {
    const result = loadEnv(validEnv({ MPESA_MODE: 'live' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const text = result.errors.join('\n');
    expect(text).toContain('MPESA_CONSUMER_KEY');
    expect(text).toContain('MPESA_SHORTCODE');
    expect(text).toContain('MPESA_PASSKEY');
    expect(text).toContain('MPESA_CALLBACK_BASE_URL');
  });

  it('requires initiator + IP allowlist for Daraja production', () => {
    const result = loadEnv(
      validEnv({
        MPESA_MODE: 'live',
        MPESA_ENV: 'production',
        MPESA_CONSUMER_KEY: 'k',
        MPESA_CONSUMER_SECRET: 's',
        MPESA_SHORTCODE: '123456',
        MPESA_PASSKEY: 'p',
        MPESA_CALLBACK_BASE_URL: 'https://api.kenyaairways.example',
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const text = result.errors.join('\n');
    expect(text).toContain('MPESA_INITIATOR_NAME');
    expect(text).toContain('MPESA_SECURITY_CREDENTIAL');
    expect(text).toContain('MPESA_ALLOWED_CALLBACK_IPS');
  });

  it('accepts a fully configured live sandbox setup', () => {
    const result = loadEnv(
      validEnv({
        MPESA_MODE: 'live',
        MPESA_ENV: 'sandbox',
        MPESA_CONSUMER_KEY: 'k',
        MPESA_CONSUMER_SECRET: 's',
        MPESA_SHORTCODE: '174379',
        MPESA_PASSKEY: 'p',
        MPESA_CALLBACK_BASE_URL: 'https://api.kenyaairways.example',
      }),
    );
    expect(result.ok).toBe(true);
  });

  it('requires Stripe keys when STRIPE_MODE=live', () => {
    const result = loadEnv(validEnv({ STRIPE_MODE: 'live' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const text = result.errors.join('\n');
    expect(text).toContain('STRIPE_SECRET_KEY');
    expect(text).toContain('STRIPE_WEBHOOK_SECRET');
  });

  it('requires SMS credentials for the selected provider', () => {
    const result = loadEnv(validEnv({ SMS_PROVIDER: 'africastalking' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join('\n')).toContain('AFRICASTALKING');

    const twilio = loadEnv(validEnv({ SMS_PROVIDER: 'twilio' }));
    expect(twilio.ok).toBe(false);
    if (twilio.ok) return;
    expect(twilio.errors.join('\n')).toContain('TWILIO_ACCOUNT_SID');
  });

  it('bans mock notification providers in production', () => {
    const result = loadEnv(validEnv({ NODE_ENV: 'production' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join('\n')).toMatch(/mock notification providers are not allowed/);
  });

  it('distinguishes string "false" from true for booleans', () => {
    const result = loadEnv(validEnv({ FLIGHT_SIMULATOR_ENABLED: 'false' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.env.FLIGHT_SIMULATOR_ENABLED).toBe(false);

    const enabled = loadEnv(validEnv({ FLIGHT_SIMULATOR_ENABLED: 'true' }));
    expect(enabled.ok && enabled.env.FLIGHT_SIMULATOR_ENABLED).toBe(true);
  });

  it('validates check-in window ordering', () => {
    const result = loadEnv(
      validEnv({ CHECKIN_WINDOW_OPEN_HOURS: '1', CHECKIN_WINDOW_CLOSE_HOURS: '24' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join('\n')).toContain('CHECKIN_WINDOW_CLOSE_HOURS');
  });

  it('formats errors as a readable startup report', () => {
    const report = formatEnvErrors(['DATABASE_URL: required']);
    expect(report).toContain('✗ Kenya Airways configuration is invalid');
    expect(report).toContain('DATABASE_URL: required');
    expect(report).toContain('pnpm bootstrap');
  });
});
