import type { MpesaParsedMessageDto } from '@kenyaairways/shared';

/**
 * Best-effort extraction of the fields staff need from a pasted M-Pesa
 * confirmation SMS. Safaricom wording varies by product (paybill, buy goods,
 * P2P), language (English / Kiswahili) and era, so every pattern is generous
 * and only two things are required for `valid`: a receipt number and an
 * amount. Everything else is reported when found and ignored when not.
 */

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

/** Account reference the payer typed (usually the booking PNR). */
const ACCOUNT_RES = [
  /for\s+account\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9-]{1,19})\b/i,
  /account\s*(?:number|no\.?)?\s*[:#]\s*([A-Za-z0-9][A-Za-z0-9-]{1,19})\b/i,
  /(?:kwa\s+ajili\s+ya\s+akaunti|akaunti)\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9-]{1,19})\b/i,
];

const PHONE_RES = [/\b(254\d{9})\b/, /\b(0[17]\d{8})\b/];

/** "on 18/10/26 at 3:45 PM" / "tarehe 18/10/26 saa 3:45 ME". */
const WHEN_RE =
  /(?:on|tarehe)\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s*(?:at|saa)?\s*(\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm|me|nt)?)/i;
const DATE_ONLY_RE = /\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/;

const MINOR = 100;

function parseReceipt(text: string): string | null {
  const match = text.match(RECEIPT_RE);
  if (!match) return null;
  const token = match[1].toUpperCase();
  // Real receipts always mix letters and digits — filters stray uppercase words.
  if (!/[0-9]/.test(token) || !/[A-Z]/.test(token)) return null;
  return token;
}

function parseAmountMinor(text: string): number | null {
  const match = text.match(AMOUNT_RE);
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * MINOR);
}

function parsePaybill(text: string): string | null {
  for (const re of PAYBILL_RES) {
    const match = text.match(re);
    if (match) return match[1];
  }
  return null;
}

function parseAccountReference(text: string, paybill: string | null): string | null {
  for (const re of ACCOUNT_RES) {
    const global = new RegExp(re.source, `${re.flags}g`);
    for (const match of text.matchAll(global)) {
      const value = match[1].toUpperCase();
      if (paybill && value === paybill) continue; // the paybill is not the reference
      if (/^\d{9,}$/.test(value)) continue; // phone-like, not a reference
      return value;
    }
  }
  return null;
}

function parseMsisdn(text: string): string | null {
  for (const re of PHONE_RES) {
    const match = text.match(re);
    if (match) return match[1];
  }
  return null;
}

/** dd/mm/yy(yy) + hh:mm, Africa/Nairobi (UTC+3, no DST) → ISO instant. */
function parseWhen(text: string): string | null {
  const match = text.match(WHEN_RE) ?? text.match(DATE_ONLY_RE);
  if (!match) return null;
  const [day, month, year] = match[1].split('/').map(Number);
  if (!day || !month || !year) return null;
  const fullYear = year < 100 ? 2000 + year : year;
  let hours = 0;
  let minutes = 0;
  const time = match[2]?.match(/(\d{1,2}):(\d{2})/);
  if (time) {
    hours = Number(time[1]);
    minutes = Number(time[2]);
    const period = match[2].toLowerCase();
    if (/\b(pm|me)\b/.test(period) && hours < 12) hours += 12; // ME = mchana
    if (/\b(am|nt)\b/.test(period) && hours === 12) hours = 0; // NT = usiku
  }
  const utc = Date.UTC(fullYear, month - 1, day, hours - 3, minutes); // EAT = UTC+3
  const date = new Date(utc);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Parse a pasted M-Pesa confirmation SMS into verifier-ready fields. */
export function parseMpesaSms(raw: string): MpesaParsedMessageDto {
  const text = raw.trim();
  const receiptNumber = parseReceipt(text);
  const amountMinor = parseAmountMinor(text);
  const paybill = parsePaybill(text);
  return {
    receiptNumber,
    amountMinor,
    paybill,
    accountReference: parseAccountReference(text, paybill),
    msisdn: parseMsisdn(text),
    transactionAt: parseWhen(text),
    valid: receiptNumber !== null && amountMinor !== null,
  };
}
