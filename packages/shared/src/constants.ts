/**
 * Cross-cutting constants. Everything here is safe to ship to the browser.
 * Kenya-localised defaults are intentional: KES, Africa/Nairobi, en-KE.
 */

export const SUPPORTED_CURRENCIES = ['KES', 'USD', 'EUR'] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];
export const DEFAULT_CURRENCY: Currency = 'KES';

/** Number of decimal digits stored in `amountMinor` for each currency. */
export const CURRENCY_EXPONENTS: Record<Currency, number> = {
  KES: 2,
  USD: 2,
  EUR: 2,
};

export const DEFAULT_TIMEZONE = 'Africa/Nairobi';
export const SUPPORTED_LOCALES = ['en-KE', 'sw-KE'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en-KE';

/** Bumped whenever terms/privacy text changes — stored on every ConsentRecord. */
export const POLICY_VERSION = '2026-01';

export const SUPPORTED_ROLES = ['PASSENGER', 'AGENT', 'OPS', 'FINANCE', 'ADMIN'] as const;
export type Role = (typeof SUPPORTED_ROLES)[number];

/** PNR uses an unambiguous alphabet (no 0/O/1/I) — 32^6 ≈ 1.07e9 combos. */
export const PNR_LENGTH = 6;
export const PNR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Daraja AccountReference is capped at 12 chars — PNR (6) always fits. */
export const MPESA_ACCOUNT_REFERENCE_MAX = 12;
/** Daraja TransactionDesc is capped at 13 chars. */
export const MPESA_TRANSACTION_DESC_MAX = 13;
export const MPESA_TRANSACTION_DESC = 'Flight13';

export const MAX_PAX_PER_BOOKING = 9;
export const INFANT_MAX_YEARS = 1;
export const CHILD_MAX_YEARS = 11;
export const ADULT_MIN_YEARS = 12;

/**
 * Passenger pricing factors (basis points of the base fare).
 * PLACEHOLDER pending commercial confirmation: children pay the adult fare,
 * infants on laps pay 10% of the base fare with taxes/fees waived.
 */
export const PASSENGER_FARE_BPS: Record<'ADULT' | 'CHILD' | 'INFANT', number> = {
  ADULT: 10_000,
  CHILD: 10_000,
  INFANT: 1_000,
};

/** Kenyan VAT headline rate (bps) — a default; TaxFeeRule rows in the DB win. */
export const KENYA_VAT_BPS = 1600;
