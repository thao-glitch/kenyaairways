/**
 * Trip context store (Zustand) — the "current flight" the map screen and
 * the seat-preview screen are looking at. Kept separate from the session so
 * switching trips never touches auth state.
 */
import { create } from 'zustand';

export interface TripContext {
  flightId: string;
  bookingId: string;
  flightNumber: string;
  originCode: string;
  destinationCode: string;
  departUtc: string;
}

interface TripState {
  current: TripContext | null;
  recent: TripContext[];
  setCurrent: (trip: TripContext) => void;
  pushRecent: (trip: TripContext) => void;
}

export const useTripStore = create<TripState>((set) => ({
  current: null,
  recent: [],

  setCurrent: (trip) =>
    set((s) => ({
      current: trip,
      recent: [trip, ...s.recent.filter((r) => r.flightId !== trip.flightId)].slice(0, 20),
    })),

  pushRecent: (trip) =>
    set((s) => ({
      recent: [trip, ...s.recent.filter((r) => r.flightId !== trip.flightId)].slice(0, 20),
    })),
}));
