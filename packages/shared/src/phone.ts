/**
 * Kenyan phone handling.
 * Canonical storage format: E.164 (+2547XXXXXXXX / +2541XXXXXXXX).
 * M-Pesa/Daraja format:     MSISDN  (2547XXXXXXXX / 2541XXXXXXXX, no "+").
 *
 * Kenyan mobile allocations: 07XXXXXXXX and 01XXXXXXXX.
 */

const KE_MOBILE_BODY = /^([71]\d{8})$/;

/**
 * Accepts "0712345678", "712345678", "+254712345678", "254712345678",
 * "00254712345678", "254712345678 " … and returns E.164, or null if invalid.
 */
export function normalizeKenyanPhone(input: string): string | null {
  if (typeof input !== 'string') return null;
  const digits = input.replace(/[\s()\-.]/g, '');
  if (!/^\+?\d+$/.test(digits)) return null;

  let body: string | null = null;
  if (digits.startsWith('+254') || digits.startsWith('254')) {
    body = digits.replace(/^\+?254/, '');
  } else if (digits.startsWith('00254')) {
    body = digits.slice(5);
  } else if (digits.startsWith('0')) {
    body = digits.slice(1);
  } else {
    body = digits;
  }

  if (!body || !KE_MOBILE_BODY.test(body)) return null;
  return `+254${body}`;
}

export function isValidKenyanPhone(input: string): boolean {
  return normalizeKenyanPhone(input) !== null;
}

/** E.164 → Daraja MSISDN ("+254712345678" → "254712345678"). Throws if not KE mobile. */
export function toMpesaMsisdn(e164: string): string {
  const normalized = normalizeKenyanPhone(e164);
  if (!normalized) throw new Error(`Not a valid Kenyan mobile number: ${e164}`);
  return normalized.slice(1);
}

/** Generic E.164 normalization for non-KE international numbers (loose check). */
export function normalizeE164(input: string): string | null {
  const ke = normalizeKenyanPhone(input);
  if (ke) return ke;
  const digits = input.replace(/[\s()\-.]/g, '');
  if (/^\+\d{8,15}$/.test(digits)) return digits;
  if (/^00\d{8,15}$/.test(digits)) return `+${digits.slice(2)}`;
  return null;
}

/** Log-safe representation: "+254712•••78". Never log full MSISDNs. */
export function maskPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  if (e164.length <= 6) return '***';
  const head = e164.startsWith('+') ? e164.slice(0, 5) : e164.slice(0, 3);
  const tail = e164.slice(-2);
  return `${head}***${tail}`;
}
