import { Suspense } from 'react';
import type { FlightOptionDto } from '@flight13/shared';
import { notFound, redirect } from 'next/navigation';
import { BookForm } from '@/components/booking/book-form';
import { apiGetOrNull } from '@/lib/api';
import { getTranslator } from '@/lib/i18n';

// Reading searchParams opts the route into dynamic rendering. The page itself
// stays synchronous and streams its data region inside a <Suspense> boundary:
// the shell (heading + pulse skeleton) flushes immediately while the flight
// lookups resolve, so slow API responses never block first paint.

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/**
 * Booking form shell: resolves every flight of the trip server-side (one-way,
 * round trip or up to 4 multi-city legs), form is a client island.
 * Legacy `?flightId=…&fare=…` links keep working as a single segment.
 */
export default function BookPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<BookSkeleton />}>
      <BookContent searchParams={searchParams} />
    </Suspense>
  );
}

/** Locale-neutral placeholder (mirrors the app's pulse skeleton style). */
function BookSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <div className="animate-pulse flex flex-col gap-2">
        <div className="h-8 w-56 rounded bg-muted" />
        <div className="h-4 w-80 rounded bg-muted" />
        <div className="h-4 w-64 rounded bg-muted" />
      </div>
      <div className="animate-pulse h-64 rounded-lg bg-muted" />
    </div>
  );
}

async function BookContent({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const flightsParam = first(sp.flights);
  const flightId = first(sp.flightId);
  const ids = (
    flightsParam
      ? flightsParam
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : flightId
        ? [flightId]
        : []
  ).slice(0, 4);
  if (ids.length === 0) redirect('/flights');

  const fareCode = first(sp.fare);
  const trip = first(sp.trip);
  const adults = first(sp.adults);

  const { t } = await getTranslator();
  const fetched = await Promise.all(
    ids.map((id) => apiGetOrNull<FlightOptionDto>(`/api/v1/flights/${id}`)),
  );
  const flights = fetched.filter((f): f is FlightOptionDto => f !== null);
  if (flights.length !== ids.length) notFound();

  // Round-trip / login bounce must return to the same multi-segment form.
  const nextParams = new URLSearchParams();
  nextParams.set('flights', ids.join(','));
  if (fareCode) nextParams.set('fare', fareCode);
  if (trip) nextParams.set('trip', trip);
  if (adults) nextParams.set('adults', adults);
  const nextHref = `/book?${nextParams.toString()}`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">{t('book.title')}</h1>
        <ul className="mt-1 flex flex-col gap-0.5 text-sm text-muted-foreground">
          {flights.map((flight) => (
            <li key={flight.flightId}>
              {flight.flightNumber} · {flight.origin.code} → {flight.destination.code} ·{' '}
              {flight.departLocal.replace('T', ' ').slice(0, 16)}
            </li>
          ))}
        </ul>
      </div>
      <BookForm
        flights={flights}
        defaultFareCode={fareCode}
        trip={trip}
        defaultPax={adults ? Number(adults) : undefined}
        nextHref={nextHref}
      />
    </div>
  );
}
