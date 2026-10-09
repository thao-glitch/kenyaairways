/**
 * IATA BCBP (Bar Coded Boarding Pass) "M1" payload builder (M7).
 *
 * Layout implemented (ASCII, space-padded — character fields left-justified,
 * numeric fields zero-filled right-justified):
 *
 * | pos | len | field                                    |
 * | --- | --- | ---------------------------------------- |
 * | 1   | 2   | format code `M1`                         |
 * | 3   | 20  | passenger name `SURNAME/GIVEN`           |
 * | 23  | 1   | electronic ticket indicator `E`          |
 * | 24  | 6   | PNR locator                              |
 * | 30  | 3   | origin airport                           |
 * | 33  | 3   | destination airport                      |
 * | 36  | 2   | operating carrier                        |
 * | 38  | 4   | flight number (zero-filled)              |
 * | 42  | 3   | Julian departure date (001–366)          |
 * | 45  | 1   | booking class (RBD)                      |
 * | 46  | 5   | seat number                              |
 * | 51  | 4   | check-in sequence (zero-filled)          |
 *
 * This is the passenger-data core of BCBP v6; add-on areas (security,
 * frequent-flyer, boarding group) can be appended later without changing the
 * field order above.
 */

export interface BcbpInput {
  lastName: string;
  firstName: string;
  /** PNR locator (≤ 6 characters in the BCBP core). */
  pnr: string;
  origin: string;
  destination: string;
  /** 2-letter operating carrier code. */
  carrier: string;
  /** Digits only or alphanumeric — letters are stripped, result 4 digits. */
  flightNumber: string;
  departureUtc: Date | string;
  /** RBD, one letter (e.g. `Y`). */
  bookingClass: string;
  /** Seat like `12A`. */
  seat: string;
  /** Check-in sequence number for this flight (1-based). */
  sequence: number;
}

const padEnd = (value: string, len: number): string => value.slice(0, len).padEnd(len, ' ');
const padNum = (value: string, len: number): string => value.slice(-len).padStart(len, '0');

/** Fold to BCBP-safe ASCII: uppercase, strip diacritics, spaces for symbols. */
function bcbpFold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/** Day-of-year (001–366) of the departure date, in UTC. */
export function bcbpJulianDate(depUtc: Date | string): string {
  const dep = depUtc instanceof Date ? depUtc : new Date(depUtc);
  if (Number.isNaN(dep.getTime())) throw new TypeError('bcbpJulianDate: invalid date');
  const start = Date.UTC(dep.getUTCFullYear(), 0, 1);
  const day =
    Math.floor(
      (Date.UTC(dep.getUTCFullYear(), dep.getUTCMonth(), dep.getUTCDate()) - start) / 86_400_000,
    ) + 1;
  return String(day).padStart(3, '0');
}

/** Builds the M1 BCBP string for one passenger. */
export function buildBcbp(input: BcbpInput): string {
  const last = bcbpFold(input.lastName);
  const first = bcbpFold(input.firstName);
  const name = padEnd(`${last}/${first}`, 20);
  const digits = input.flightNumber.replace(/\D/g, '');
  if (!digits) throw new TypeError('buildBcbp: flightNumber needs at least one digit');
  if (input.sequence < 1 || input.sequence > 9999) {
    throw new RangeError('buildBcbp: sequence must be 1..9999');
  }

  return (
    'M1' + //  1-2   format code
    name + //  3-22  passenger name
    'E' + //  23    electronic ticket indicator
    padEnd(input.pnr.toUpperCase(), 6) + //  24-29  PNR
    padEnd(input.origin.toUpperCase(), 3) + //  30-32
    padEnd(input.destination.toUpperCase(), 3) + //  33-35
    padEnd(input.carrier.toUpperCase(), 2) + //  36-37
    padNum(digits, 4) + //  38-41  flight number
    bcbpJulianDate(input.departureUtc) + //  42-44  date
    padEnd(input.bookingClass.toUpperCase(), 1) + //  45     class
    padEnd(input.seat.toUpperCase(), 5) + //  46-50  seat
    padNum(String(input.sequence), 4) //  51-54  sequence
  );
}
