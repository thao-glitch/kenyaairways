import { describe, expect, it } from 'vitest';
import {
  addMinor,
  applyPercentBps,
  formatMoney,
  formatMinorInput,
  parseMoneyInput,
  toMinor,
  toMpesaAmount,
} from '../src/money';

describe('formatMoney', () => {
  it('formats whole shillings without decimals', () => {
    expect(formatMoney(1_250_000, 'KES')).toBe('KES 12,500');
  });

  it('formats KES with decimals when not whole', () => {
    expect(formatMoney(1_250_550, 'KES')).toBe('KES 12,505.50');
  });

  it('formats USD with two decimals', () => {
    expect(formatMoney(12_000, 'USD', 'en-US')).toBe('USD 120.00');
  });

  it('formats EUR with two decimals', () => {
    expect(formatMoney(120_50, 'EUR', 'de-DE')).toBe('EUR 120,50');
  });
});

describe('toMinor / fromMinor', () => {
  it('converts without float drift', () => {
    expect(toMinor(12_500)).toBe(1_250_000);
    expect(toMinor(0.1 + 0.2)).toBe(30);
    expect(formatMinorInput(1_250_000)).toBe('12500.00');
  });
});

describe('toMpesaAmount (round-up policy)', () => {
  it('rounds a fractional shilling up by default', () => {
    expect(toMpesaAmount(1_250_550)).toEqual({
      ok: true,
      amountMinor: 1_250_600,
      wholeShillings: 12_506,
    });
  });

  it('keeps whole shillings untouched', () => {
    expect(toMpesaAmount(1_250_000)).toEqual({
      ok: true,
      amountMinor: 1_250_000,
      wholeShillings: 12_500,
    });
  });

  it('rejects non-whole amounts under the reject policy', () => {
    expect(toMpesaAmount(1_250_550, 'reject').ok).toBe(false);
    expect(toMpesaAmount(1_250_500, 'reject').ok).toBe(true);
  });

  it('rounds to nearest shilling when configured', () => {
    expect(toMpesaAmount(1_250_450, 'round_nearest')).toEqual({
      ok: true,
      amountMinor: 1_250_500,
      wholeShillings: 12_505,
    });
    expect(toMpesaAmount(1_250_449, 'round_nearest')).toEqual({
      ok: true,
      amountMinor: 1_250_400,
      wholeShillings: 12_504,
    });
  });

  it('rejects non-positive amounts', () => {
    expect(toMpesaAmount(0).ok).toBe(false);
    expect(toMpesaAmount(-100).ok).toBe(false);
  });
});

describe('arithmetic helpers', () => {
  it('adds minor units', () => {
    expect(addMinor(100, 200, 300)).toBe(600);
  });

  it('applies basis points with half-up rounding', () => {
    expect(applyPercentBps(1_000_00, 1600)).toBe(16_000);
    expect(applyPercentBps(1_999, 5000)).toBe(1000);
  });
});

describe('parseMoneyInput', () => {
  it('parses grouped input', () => {
    expect(parseMoneyInput('12,500')).toBe(1_250_000);
    expect(parseMoneyInput('12500.50')).toBe(1_250_050);
    expect(parseMoneyInput(' 12 500 ')).toBe(1_250_000);
  });

  it('rejects garbage', () => {
    expect(parseMoneyInput('abc')).toBeNull();
    expect(parseMoneyInput('12.3.4')).toBeNull();
    expect(parseMoneyInput('')).toBeNull();
  });
});
