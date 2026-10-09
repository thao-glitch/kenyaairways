import { describe, expect, it } from 'vitest';
import { checkInWindow } from './check-in';

const DEP = new Date('2026-11-20T09:30:00.000Z');
const CFG = { openHours: 24, closeMinutes: 60 };

const at = (iso: string) => new Date(iso);

describe('checkInWindow', () => {
  it('is closed before the opening lead', () => {
    expect(checkInWindow(DEP, at('2026-11-18T09:29:00.000Z'), CFG)).toEqual({
      open: false,
      reason: 'TOO_EARLY',
    });
  });

  it('opens exactly at dep − openHours', () => {
    expect(checkInWindow(DEP, at('2026-11-19T09:30:00.000Z'), CFG)).toEqual({ open: true });
  });

  it('stays open through the day of departure', () => {
    expect(checkInWindow(DEP, at('2026-11-20T08:00:00.000Z'), CFG)).toEqual({ open: true });
    expect(checkInWindow(DEP, at('2026-11-20T08:30:00.000Z'), CFG)).toEqual({ open: true });
  });

  it('closes at the gate cutoff and stays closed after departure', () => {
    expect(checkInWindow(DEP, at('2026-11-20T08:31:00.000Z'), CFG)).toEqual({
      open: false,
      reason: 'TOO_LATE',
    });
    expect(checkInWindow(DEP, at('2026-11-21T10:00:00.000Z'), CFG)).toEqual({
      open: false,
      reason: 'TOO_LATE',
    });
  });

  it('accepts ISO strings', () => {
    expect(checkInWindow(DEP.toISOString(), at('2026-11-20T08:00:00.000Z'), CFG)).toEqual({
      open: true,
    });
  });

  it('rejects an unparseable departure', () => {
    expect(() => checkInWindow('not-a-date', new Date(), CFG)).toThrow(TypeError);
  });

  it('supports a widened window (ops override / tests)', () => {
    const wide = { openHours: 999_999, closeMinutes: 1 };
    expect(checkInWindow(DEP, at('2026-11-18T09:29:00.000Z'), wide)).toEqual({ open: true });
  });
});
