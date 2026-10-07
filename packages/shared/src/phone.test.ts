import { describe, expect, it } from 'vitest';
import {
  isValidKenyanPhone,
  maskPhone,
  normalizeE164,
  normalizeKenyanPhone,
  toMpesaMsisdn,
} from '../src/phone';

describe('normalizeKenyanPhone', () => {
  it.each([
    ['0712345678', '+254712345678'],
    ['712345678', '+254712345678'],
    ['+254712345678', '+254712345678'],
    ['254712345678', '+254712345678'],
    ['00254712345678', '+254712345678'],
    ['0112345678', '+254112345678'],
    ['+254 712 345 678', '+254712345678'],
    ['(0712) 345-678', '+254712345678'],
    ['+254712345678 ', '+254712345678'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeKenyanPhone(input)).toBe(expected);
  });

  it.each([
    ['0812345678'],
    ['071234567'],
    ['07123456789'],
    ['+255712345678'],
    ['not-a-number'],
    ['0712abc678'],
    [''],
  ])('rejects %s', (input) => {
    expect(normalizeKenyanPhone(input)).toBeNull();
    expect(isValidKenyanPhone(input)).toBe(false);
  });
});

describe('toMpesaMsisdn', () => {
  it('drops the plus for Daraja', () => {
    expect(toMpesaMsisdn('+254712345678')).toBe('254712345678');
    expect(toMpesaMsisdn('0712345678')).toBe('254712345678');
  });

  it('throws on non-Kenyan input', () => {
    expect(() => toMpesaMsisdn('0812345678')).toThrow();
  });
});

describe('normalizeE164', () => {
  it('handles foreign numbers loosely', () => {
    expect(normalizeE164('+442071838750')).toBe('+442071838750');
    expect(normalizeE164('00442071838750')).toBe('+442071838750');
  });

  it('returns null for nonsense', () => {
    expect(normalizeE164('123')).toBeNull();
  });
});

describe('maskPhone', () => {
  it('masks the middle of the number', () => {
    expect(maskPhone('+254712345678')).toBe('+2547***78');
    expect(maskPhone('')).toBe('');
    expect(maskPhone(null)).toBe('');
  });
});
