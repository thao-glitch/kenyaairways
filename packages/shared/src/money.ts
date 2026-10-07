import { CURRENCY_EXPONENTS, DEFAULT_CURRENCY, type Currency } from './constants';

export interface Money {
  amountMinor: number;
  currency: Currency;
}

/** Whole major units → minor units (integer). Guards float drift. */
export function toMinor(amount: number, currency: Currency = DEFAULT_CURRENCY): number {
  const exp = CURRENCY_EXPONENTS[currency];
  return Math.round((amount + Number.EPSILON) * 10 ** exp);
}

/** Minor units → major units (float; display only, never use for arithmetic). */
export function fromMinor(amountMinor: number, currency: Currency = DEFAULT_CURRENCY): number {
  return amountMinor / 10 ** CURRENCY_EXPONENTS[currency];
}

/**
 * Canonical money label: "KES 12,500", "USD 120.00".
 * KES shows decimals only when the amount is not a whole shilling.
 */
export function formatMoney(
  amountMinor: number,
  currency: Currency = DEFAULT_CURRENCY,
  locale = 'en-KE',
): string {
  const exp = CURRENCY_EXPONENTS[currency];
  const value = fromMinor(amountMinor, currency);
  const isWhole = amountMinor % 10 ** exp === 0;
  const fractionDigits = currency === 'KES' && isWhole ? 0 : exp;
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
  return `${currency} ${formatted}`;
}

/** Breakdown of a formatted amount, e.g. for editable inputs. */
export function formatMinorInput(
  amountMinor: number,
  currency: Currency = DEFAULT_CURRENCY,
): string {
  const exp = CURRENCY_EXPONENTS[currency];
  return (amountMinor / 10 ** exp).toFixed(exp);
}

export type RoundingPolicy = 'round_up' | 'round_nearest' | 'reject';

export type MpesaAmountResult =
  { ok: true; amountMinor: number; wholeShillings: number } | { ok: false; reason: string };

/**
 * M-Pesa moves whole shillings only. Policy (MPESA_AMOUNT_ROUNDING):
 *  - round_up      → charge ceil(total) — default; the extra shilling is shown
 *                    in the checkout breakdown before the customer confirms.
 *  - round_nearest → nearest shilling.
 *  - reject        → the caller must present a whole-shilling total.
 */
export function toMpesaAmount(
  amountMinor: number,
  policy: RoundingPolicy = 'round_up',
): MpesaAmountResult {
  if (amountMinor <= 0) return { ok: false, reason: 'Amount must be positive' };
  const perShilling = 100;
  switch (policy) {
    case 'round_up': {
      const minor = Math.ceil(amountMinor / perShilling) * perShilling;
      return { ok: true, amountMinor: minor, wholeShillings: minor / perShilling };
    }
    case 'round_nearest': {
      const minor = Math.round(amountMinor / perShilling) * perShilling;
      return { ok: true, amountMinor: minor, wholeShillings: minor / perShilling };
    }
    case 'reject': {
      if (amountMinor % perShilling !== 0) {
        return { ok: false, reason: 'M-Pesa requires a whole-shilling amount' };
      }
      return { ok: true, amountMinor, wholeShillings: amountMinor / perShilling };
    }
  }
}

export function addMinor(...values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0);
}

/** Basis points (1600 = 16.00%). Rounds half-up to the nearest minor unit. */
export function applyPercentBps(amountMinor: number, bps: number): number {
  return Math.round((amountMinor * bps) / 10_000);
}

/** Parses user input ("12,500", "12500.50", " 12 500 ") into minor units. */
export function parseMoneyInput(
  input: string,
  currency: Currency = DEFAULT_CURRENCY,
): number | null {
  const cleaned = input.replace(/[\s,\u00a0\u202f]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const exp = CURRENCY_EXPONENTS[currency];
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round((value + Number.EPSILON) * 10 ** exp);
}
