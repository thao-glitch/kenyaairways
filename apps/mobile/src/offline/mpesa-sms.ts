/**
 * Best-effort extraction of the fields staff need from a pasted M-Pesa
 * confirmation SMS.
 *
 * VERBATIM PORT of apps/api/src/modules/payments/mpesa-verifier/mpesa-sms.parser.ts
 * (React Native cannot import from apps/api). Safaricom wording varies by
 * product (paybill, buy goods, P2P), language (English / Kiswahili) and era,
 * so every pattern is generous and only two things are required for `valid`:
 * a receipt number and an amount.
 */
import type { MpesaParsedMessageDto } from '@kenyaairways/shared';

/** Receipt immediately followed by the confirmation word (EN + SW). */
const RECEIPT_RE = /\b([A-Z0-9]{9,10})\b\s+(?:confirmed|imepokelewa|imeathibitishwa)\b/;

/** First "Ksh1,234.50" amount in the message. */
const AMOUNT_RE = /ksh\.?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i;

/** Paybill / till number, whichever way the SMS phrases it. */
const PAYBILL_RES = [
  /(?:pay\s*bill|paybill|till|buy\s*goods)(?:\s*(?:number|no\.?|#))?\s*(?:of|is|:)?\s*(\d{4,12})/i,
  /\b(?:sent|paid|imetumwa|imelipwa)\s+(?:to|kwa)\s+(?:account\s+|akaunti\s+)?(\d{4,12})\b/i,
  /\bto\s+(?:account\s+|akaunti\s+)?(\d{4,12})\b/i,
];

/** Account reference: the booking PNR / invoice number the sender typed. */
const ACCOUNT_RES = [
  /(?:account|akaunti)\s*(?:number|no\.?|#)?\s*(?:is|:)?\s*([A-Z0-9]{4,12})/i,
  /\bfor\s+(?:account\s+|akaunti\s+)?([A-Z0-9]{4,12})\b/,
];

/** Sender phone number, however it is written. */
const MSISDN_RE = /(?:from| kutoka\s+)?(\+?254\d{9}|0\d{9})\b/;

/** "18/10/26 at 3:45 PM" / "18-Oct-26 15:45" style timestamps (Nairobi). */
const TIME_RES = [
  /on\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i,
  /on\s+(\d{1,2})[- ]([A-Za-z]{3,9})[- ](\d{2,4})\s+(?:at\s+)?(\d{1,2}):(\d{2})\s*(AM|PM)?/i,
];

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function toIso(
  day: string,
  month: string,
  year: string,
  hour: string,
  minute: string,
  ampm?: string,
): string | null {
  const d = Number(day);
  const m = /^\d+$/.test(month) ? Number(month) : MONTHS[month.toLowerCase()];
  let y = Number(year);
  if (!d || !m) return null;
  if (y < 100) y += 2000;
  let h = Number(hour);
  const mi = Number(minute);
  const suffix = ampm?.toUpperCase();
  if (suffix === 'PM' && h < 12) h += 12;
  if (suffix === 'AM' && h === 12) h = 0;
  const iso = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:00+03:00`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

export function parseMpesaSms(message: string): MpesaParsedMessageDto {
  const text = message ?? '';

  const receipt = RECEIPT_RE.exec(text)?.[1]?.toUpperCase() ?? null;

  const amountMatch = AMOUNT_RE.exec(text);
  let amountMinor: number | null = null;
  if (amountMatch) {
    const cleaned = amountMatch[1].replace(/,/g, '');
    const value = Number(cleaned);
    if (Number.isFinite(value)) amountMinor = Math.round(value * 100);
  }

  let paybill: string | null = null;
  for (const re of PAYBILL_RES) {
    const m = re.exec(text);
    if (m) {
      paybill = m[1];
      break;
    }
  }

  let accountReference: string | null = null;
  for (const re of ACCOUNT_RES) {
    const m = re.exec(text);
    if (m) {
      accountReference = m[1].toUpperCase();
      break;
    }
  }

  const msisdnRaw = MSISDN_RE.exec(text)?.[1] ?? null;
  const msisdn = msisdnRaw
    ? msisdnRaw.startsWith('+')
      ? msisdnRaw
      : `+254${msisdnRaw.slice(1)}`
    : null;

  let transactionAt: string | null = null;
  for (const re of TIME_RES) {
    const m = re.exec(text);
    if (m) {
      transactionAt = toIso(m[1], m[2], m[3], m[4], m[5], m[6]);
      break;
    }
  }

  return {
    receiptNumber: receipt,
    amountMinor,
    paybill,
    accountReference,
    msisdn,
    transactionAt,
    valid: Boolean(receipt && amountMinor !== null),
  };
}
