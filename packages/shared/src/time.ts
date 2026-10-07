/**
 * Time helpers.
 * Storage: UTC (`DateTime`). Display: airport-local via IANA timezone,
 * default Africa/Nairobi for Kenya-localised surfaces.
 */

export type DateInput = string | number | Date;

function toDate(input: DateInput): Date {
  return input instanceof Date ? input : new Date(input);
}

export function minutesToClockLabel(minutes: number): string {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function clockLabelToMinutes(label: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(label.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/** "07:30" in the airport's timezone. */
export function formatClock(input: DateInput, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(toDate(input));
}

/** "Tue, 7 Oct · 07:30" in the airport's timezone. */
export function formatAirportDateTime(
  input: DateInput,
  timeZone: string,
  locale = 'en-KE',
): string {
  const date = toDate(input);
  const day = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone,
  }).format(date);
  return `${day} · ${formatClock(date, timeZone)}`;
}

/** "7 Oct 2026" in the given timezone. */
export function formatDate(input: DateInput, timeZone: string, locale = 'en-KE'): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone,
  }).format(toDate(input));
}

export function addMinutes(input: DateInput, minutes: number): Date {
  return new Date(toDate(input).getTime() + minutes * 60_000);
}

export function addSeconds(input: DateInput, seconds: number): Date {
  return new Date(toDate(input).getTime() + seconds * 1000);
}

export function hoursBetween(from: DateInput, to: DateInput): number {
  return (toDate(to).getTime() - toDate(from).getTime()) / 3_600_000;
}

export function isWithinWindow(now: DateInput, from: DateInput, to: DateInput): boolean {
  const t = toDate(now).getTime();
  return t >= toDate(from).getTime() && t <= toDate(to).getTime();
}

/** Daraja timestamps: "YYYYMMDDHHmmss" (East Africa accounts are UTC+3). */
export function toDarajaTimestamp(input: DateInput, timeZone = 'Africa/Nairobi'): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(toDate(input));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '00';
  // hour12:false can yield "24" for midnight in some ICU versions
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}${get('month')}${get('day')}${hour}${get('minute')}${get('second')}`;
}

/**
 * Local ISO-8601 with offset: "2026-10-08T07:30:00+03:00".
 * Used whenever the API returns times to display (storage stays UTC).
 */
export function toLocalIso(input: DateInput, timeZone: string): string {
  const date = toDate(input);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '00';
  const hour = get('hour') === '24' ? '00' : get('hour');
  const offset = offsetLabel(date, timeZone);
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}:${get('second')}${offset}`;
}

/** "+03:00" / "-05:30" / "Z" for an instant in a timezone. */
export function offsetLabel(input: DateInput, timeZone: string): string {
  const date = toDate(input);
  const label = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  })
    .formatToParts(date)
    .find((p) => p.type === 'timeZoneName')?.value;
  if (!label || label === 'GMT') return 'Z';
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(label);
  if (!match) return 'Z';
  return `${match[1]}${match[2]}:${match[3]}`;
}
