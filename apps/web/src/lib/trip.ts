import type { TripType } from '@flight13/shared';

export type TripKind = 'return' | 'oneway' | 'multicity';

export type SearchDefaults = {
  origin?: string;
  destination?: string;
  date?: string;
  adults?: string;
  trip?: string;
  returnDate?: string;
  /** Pre-encoded legs (`NBO:MBA:2026-11-01`) from the URL. */
  legs?: string[];
};

/** Parse `NBO:MBA:2026-11-01` back into a leg (null when malformed). */
export function parseLeg(
  raw: string,
): { origin: string; destination: string; date: string } | null {
  const m = /^([A-Za-z]{3}):([A-Za-z]{3}):(\d{4}-\d{2}-\d{2})$/.exec(raw.trim());
  return m ? { origin: m[1].toUpperCase(), destination: m[2].toUpperCase(), date: m[3] } : null;
}

/** Booking-API trip type for a URL trip + segment count. */
export function tripTypeFrom(trip: string | undefined, segmentCount: number): TripType {
  if (trip === 'multicity' || segmentCount > 2) return 'MULTI_CITY';
  if (trip === 'oneway' && segmentCount <= 1) return 'ONE_WAY';
  if (segmentCount >= 2) return 'ROUND_TRIP';
  return 'ONE_WAY';
}
