/**
 * React Query hooks wrapping the Flight13 API. Each hook handles its own
 * loading/error state so screens never juggle booleans by hand. Where data
 * can be cached offline (bookings, boarding passes) the hook also mirrors
 * into the SQLite vault so the Trips screen renders with zero network.
 */
import { useQuery } from '@tanstack/react-query';
import type {
  AirportDto,
  BaggageDto,
  BoardingPassDto,
  BookingDto,
  FlightOptionDto,
  FlightPositionDto,
  FlightSearchResultDto,
  FlightStatusDto,
  SeatMapDto,
  SessionUserDto,
} from '@flight13/shared';
import { api } from '@/lib/api';
import { saveBooking, savePass } from '@/lib/vault';

/** Airports directory (public, cacheable). */
export function useAirports(enabled = true) {
  return useQuery({
    queryKey: ['airports'],
    queryFn: () => api.get<AirportDto[]>('/api/v1/airports'),
    enabled,
    staleTime: 24 * 60 * 60 * 1000,
  });
}

/** Flight search. */
export function useFlightSearch(
  query: { origin: string; destination: string; date: string; adults: number },
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['search', query],
    queryFn: () => api.get<FlightSearchResultDto>('/api/v1/flights/search', query as never),
    enabled,
  });
}

/** Flight detail. */
export function useFlight(flightId: string) {
  return useQuery({
    queryKey: ['flight', flightId],
    queryFn: () => api.get<FlightOptionDto>(`/api/v1/flights/${flightId}`),
    enabled: !!flightId,
  });
}

/** Live flight status. */
export function useFlightStatus(flightId: string) {
  return useQuery({
    queryKey: ['flight-status', flightId],
    queryFn: () => api.get<FlightStatusDto>(`/api/v1/flights/${flightId}/status`),
    enabled: !!flightId,
    refetchInterval: 30_000,
  });
}

/** Live aircraft position for the map screen — poll every 20 s while visible. */
export function useFlightPosition(flightId: string, enabled = true) {
  return useQuery({
    queryKey: ['flight-position', flightId],
    queryFn: () => api.get<FlightPositionDto>(`/api/v1/flights/${flightId}/position`),
    enabled: enabled && !!flightId,
    refetchInterval: 20_000,
  });
}

/** Seat map for the interactive cabin preview. */
export function useSeatMap(flightId: string) {
  return useQuery({
    queryKey: ['seat-map', flightId],
    queryFn: () => api.get<SeatMapDto>(`/api/v1/flights/${flightId}/seats`),
    enabled: !!flightId,
  });
}

/** The signed-in user's bookings (My Trips). Mirrors into the offline vault. */
export function useBookings() {
  return useQuery({
    queryKey: ['bookings'],
    queryFn: async () => {
      const bookings = await api.get<BookingDto[]>('/api/v1/bookings');
      // Best-effort mirror into SQLite — offline Trips screen.
      await Promise.allSettled(bookings.map(saveBooking));
      return bookings;
    },
  });
}

/** One booking. */
export function useBooking(bookingId: string) {
  return useQuery({
    queryKey: ['booking', bookingId],
    queryFn: async () => {
      const booking = await api.get<BookingDto>(`/api/v1/bookings/${bookingId}`);
      await saveBooking(booking).catch(() => undefined);
      return booking;
    },
    enabled: !!bookingId,
  });
}

/** Boarding passes for a booking — persisted for offline QR access. */
export function useBoardingPasses(bookingId: string, enabled = true) {
  return useQuery({
    queryKey: ['boarding-passes', bookingId],
    queryFn: async () => {
      const result = await api.get<{ checkIns: { boardingPassId: string | null }[] }>(
        '/api/v1/check-in',
        { bookingId },
      );
      const ids = result.checkIns.map((c) => c.boardingPassId).filter((id): id is string => !!id);
      const passes = await Promise.all(
        ids.map((id) => api.get<BoardingPassDto>(`/api/v1/boarding-passes/${id}`)),
      );
      await Promise.allSettled(passes.map(savePass));
      return passes;
    },
    enabled: enabled && !!bookingId,
  });
}

/** Baggage tracking timeline. */
export function useBaggage(bookingId: string) {
  return useQuery({
    queryKey: ['baggage', bookingId],
    queryFn: () => api.get<BaggageDto>(`/api/v1/check-in/bookings/${bookingId}/baggage`),
    enabled: !!bookingId,
    refetchInterval: 60_000,
  });
}

/** Current session user. */
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<SessionUserDto>('/api/v1/auth/me'),
  });
}
