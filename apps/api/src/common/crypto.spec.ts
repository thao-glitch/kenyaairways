import { describe, expect, it } from 'vitest';
import { encryptionKeyConfigured, maskSecret, openSecrets, sealSecrets } from './crypto';

describe('payment-method secret storage (AES-256-GCM envelope)', () => {
  it('seals and opens a secret map round-trip', () => {
    const secrets = { passkey: 'pk-123', consumerKey: 'ck-456' };
    const envelope = sealSecrets(secrets);
    expect(envelope).toMatch(/^v1\./);
    expect(envelope).not.toContain('pk-123');
    expect(openSecrets(envelope)).toEqual(secrets);
  });

  it('returns null for empty maps (nothing to protect)', () => {
    expect(sealSecrets({})).toBeNull();
    expect(sealSecrets({ passkey: '' })).toBeNull();
  });

  it('produces a fresh envelope per write (random IV)', () => {
    const secrets = { passkey: 'same-value' };
    expect(sealSecrets(secrets)).not.toBe(sealSecrets(secrets));
  });

  it('fails soft on corrupt, foreign or wrong-key input', () => {
    expect(openSecrets(null)).toEqual({});
    expect(openSecrets(undefined)).toEqual({});
    expect(openSecrets('garbage')).toEqual({});
    expect(openSecrets('v2.aaaa.bbbb.cccc')).toEqual({});
    // Well-formed envelope from a different key → decrypt fails → {}
    const other = 'v1.AAAA.AAAA.AAAA';
    expect(openSecrets(other)).toEqual({});
  });

  it('never surfaces raw decrypt errors', () => {
    expect(() => openSecrets('v1.a.b.c')).not.toThrow();
  });

  it('reports key availability', () => {
    expect(encryptionKeyConfigured()).toBe(true); // env validation guarantees it
  });
});

describe('maskSecret (admin UI views)', () => {
  it('masks to shape + last 4, never the value', () => {
    expect(maskSecret('sk_live_4242424242424242')).toBe('••••••••4242');
    expect(maskSecret('sk_live_4242424242424242')).not.toContain('sk_live');
  });

  it('handles short and empty values', () => {
    expect(maskSecret('ab')).toBe('••••');
    expect(maskSecret('')).toBeNull();
    expect(maskSecret(null)).toBeNull();
    expect(maskSecret(undefined)).toBeNull();
  });
});
