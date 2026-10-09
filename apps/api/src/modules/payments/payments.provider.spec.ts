import { describe, expect, it } from 'vitest';
import {
  buildStkPassword,
  buildStkPayload,
  mpesaTimestamp,
  roundKesFromMinor,
} from './providers/mpesa.provider';

describe('Daraja STK helpers (pure)', () => {
  it('formats the timestamp as YYYYMMDDHHmmss in Africa/Nairobi', () => {
    expect(mpesaTimestamp(new Date('2026-01-02T03:04:05Z'))).toBe('20260102060405');
    // EAT is UTC+3 with no DST — midnight wall time must read 00, never 24
    expect(mpesaTimestamp(new Date('2026-01-02T21:30:00Z'))).toBe('20260103003000');
    expect(mpesaTimestamp(new Date('2026-12-31T20:59:59Z'))).toBe('20261231235959');
    expect(mpesaTimestamp(new Date('2026-12-31T21:00:00Z'))).toBe('20270101000000');
  });

  it('password is base64(shortcode + passkey + timestamp), no separators', () => {
    const ts = '20260102060405';
    expect(buildStkPassword('174379', 'bfb279f9aa9bdbcf', ts)).toBe(
      Buffer.from(`174379bfb279f9aa9bdbcf${ts}`, 'utf8').toString('base64'),
    );
  });

  it('pins the wire contract: PNR reference ≤12, TransactionDesc "Flight13"', () => {
    const payload = buildStkPayload({
      shortcode: '174379',
      passkey: 'pass',
      timestamp: '20260102060405',
      amountMajor: 10885,
      msisdn: '254712345678',
      accountReference: 'QMXCJ2',
      callbackUrl: 'https://api.example.com/api/v1/payments/cb/tok/stk',
    });
    expect(payload.AccountReference).toBe('QMXCJ2');
    expect(String(payload.AccountReference).length).toBeLessThanOrEqual(12);
    expect(payload.TransactionDesc).toBe('Flight13');
    expect(payload.Amount).toBe(10885);
    expect(payload.PhoneNumber).toBe('254712345678');
    expect(payload.PartyA).toBe('254712345678');
    expect(payload.CallBackURL).toBe('https://api.example.com/api/v1/payments/cb/tok/stk');
    expect(payload.TransactionType).toBe('CustomerPayBillOnline');
    expect(payload.Timestamp).toBe('20260102060405');

    // even an over-long reference is truncated to Daraja's 12 chars
    const long = buildStkPayload({
      shortcode: '174379',
      passkey: 'pass',
      timestamp: '20260102060405',
      amountMajor: 1,
      msisdn: '254712345678',
      accountReference: 'ABCDEFGHIJKLMNOP',
      callbackUrl: 'https://x/y',
    });
    expect(long.AccountReference).toBe('ABCDEFGHIJKL');
  });

  it('applies MPESA_AMOUNT_ROUNDING to whole-shilling amounts', () => {
    expect(roundKesFromMinor(1_088_500, 'round_up')).toBe(10885);
    expect(roundKesFromMinor(1_088_501, 'round_up')).toBe(10886);
    expect(roundKesFromMinor(1_088_501, 'round_nearest')).toBe(10885);
    expect(roundKesFromMinor(1_088_550, 'round_nearest')).toBe(10886);
    expect(roundKesFromMinor(1_088_501, 'reject')).toBeNull();
    expect(roundKesFromMinor(1_088_500, 'reject')).toBe(10885);
  });
});
