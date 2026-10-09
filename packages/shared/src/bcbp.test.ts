import { describe, expect, it } from 'vitest';
import { bcbpJulianDate, buildBcbp } from './bcbp';

const base = {
  lastName: 'Otieno',
  firstName: 'Amina',
  pnr: 'K7QX2M',
  origin: 'NBO',
  destination: 'MBA',
  carrier: 'K1',
  flightNumber: '234',
  departureUtc: new Date('2026-07-15T06:30:00.000Z'),
  bookingClass: 'Y',
  seat: '12A',
  sequence: 7,
};

describe('bcbpJulianDate', () => {
  it('is 001 on Jan 1', () => {
    expect(bcbpJulianDate('2026-01-01T00:00:00.000Z')).toBe('001');
  });
  it('is 365 on Dec 31 of a common year', () => {
    expect(bcbpJulianDate('2026-12-31T23:59:00.000Z')).toBe('365');
  });
  it('is 366 on Dec 31 of a leap year', () => {
    expect(bcbpJulianDate('2028-12-31T23:59:00.000Z')).toBe('366');
  });
  it('counts in UTC (evening local = same UTC day)', () => {
    // 2026-07-15 23:30 EAT = 20:30 UTC → day 196
    expect(bcbpJulianDate('2026-07-15T20:30:00.000Z')).toBe('196');
  });
});

describe('buildBcbp', () => {
  it('produces the exact M1 layout (54 chars)', () => {
    const bcbp = buildBcbp(base);
    expect(bcbp).toHaveLength(54);
    expect(bcbp).toBe('M1OTIENO/AMINA        EK7QX2MNBOMBAK10234196Y12A  0007');
    //  M1 └────── name 20 ─────┘ E └PNR─┘ └NBO┘ └MBA┘ K1 ─flight─ ─date class └─seat── ─seq─
  });

  it('fits a 3-char airline code into the 2-char carrier field (F13 → F1)', () => {
    // AIRLINE_IATA_CODE accepts 2–3 chars (default F13); check-in strips the
    // full designator first, so flight 101 of F13101 arrives here as '101'.
    const bcbp = buildBcbp({ ...base, carrier: 'F13', flightNumber: '101' });
    expect(bcbp).toHaveLength(54);
    expect(bcbp.slice(35, 37)).toBe('F1'); // truncated to the spec's 2 chars
    expect(bcbp.slice(37, 41)).toBe('0101'); // flight 101, zero-filled to 4
  });

  it('zero-fills flight and sequence, left-pads seat', () => {
    const bcbp = buildBcbp({ ...base, flightNumber: 'K1307', sequence: 42 });
    expect(bcbp.slice(37, 41)).toBe('1307'); // letters stripped
    expect(bcbp.slice(50, 54)).toBe('0042');
    expect(bcbp.slice(45, 50)).toBe('12A  ');
  });

  it('folds names: uppercase, diacritics stripped, symbols → space', () => {
    const bcbp = buildBcbp({ ...base, lastName: 'Müller-García', firstName: "O'Connor" });
    expect(bcbp.slice(2, 22)).toBe('MULLER GARCIA/O CONNOR'.slice(0, 20).padEnd(20, ' '));
  });

  it('truncates overlong names to 20 characters', () => {
    const bcbp = buildBcbp({ ...base, lastName: 'Verylongfamilyname', firstName: 'Xyz' });
    expect(bcbp.slice(2, 22)).toHaveLength(20);
    expect(bcbp.slice(2, 22)).toBe('VERYLONGFAMILYNAME/X'.slice(0, 20).padEnd(20, ' '));
  });

  it('rejects a flight number without digits and bad sequence', () => {
    expect(() => buildBcbp({ ...base, flightNumber: 'ABC' })).toThrow(TypeError);
    expect(() => buildBcbp({ ...base, sequence: 0 })).toThrow(RangeError);
    expect(() => buildBcbp({ ...base, sequence: 10_000 })).toThrow(RangeError);
  });
});
