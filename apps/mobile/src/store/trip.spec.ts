import { beforeEach, describe, expect, it } from 'vitest';
import { useTripStore, type TripContext } from './trip';

const tripA: TripContext = {
  flightId: 'fl_1',
  bookingId: 'bk_1',
  flightNumber: 'F13-101',
  originCode: 'NBO',
  destinationCode: 'MBA',
  departUtc: '2026-11-01T07:00:00.000Z',
};

const tripB: TripContext = {
  ...tripA,
  flightId: 'fl_2',
  bookingId: 'bk_2',
  flightNumber: 'F13-202',
  destinationCode: 'KIS',
};

describe('trip context store', () => {
  beforeEach(() => {
    useTripStore.setState({ current: null, recent: [] });
  });

  it('starts with no current trip', () => {
    expect(useTripStore.getState().current).toBeNull();
  });

  it('setCurrent sets the active trip and records it as recent', () => {
    useTripStore.getState().setCurrent(tripA);
    const s = useTripStore.getState();
    expect(s.current?.flightId).toBe('fl_1');
    expect(s.recent).toHaveLength(1);
    expect(s.recent[0].flightId).toBe('fl_1');
  });

  it('deduplicates recent trips by flightId (most recent first)', () => {
    useTripStore.getState().setCurrent(tripA);
    useTripStore.getState().setCurrent(tripB);
    useTripStore.getState().setCurrent(tripA); // revisit fl_1
    const s = useTripStore.getState();
    expect(s.recent.map((r) => r.flightId)).toEqual(['fl_1', 'fl_2']);
  });

  it('caps the recent list at 20 entries', () => {
    for (let i = 0; i < 30; i++) {
      useTripStore.getState().pushRecent({ ...tripA, flightId: `fl_${i}` });
    }
    expect(useTripStore.getState().recent).toHaveLength(20);
    expect(useTripStore.getState().recent[0].flightId).toBe('fl_29');
  });
});
