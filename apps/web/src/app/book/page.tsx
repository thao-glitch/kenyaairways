import type { FareOptionDto, FlightOptionDto } from '@flight13/shared';
import { notFound, redirect } from 'next/navigation';
import { BookForm } from '@/components/booking/book-form';
import { apiGetOrNull } from '@/lib/api';
import { getTranslator } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/** Booking form shell: resolves flight + fare server-side, form is a client island. */
export default async function BookPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const flightId = first(sp.flightId);
  const fareCode = first(sp.fare);
  if (!flightId) redirect('/flights');

  const { t } = await getTranslator();
  const flight = await apiGetOrNull<FlightOptionDto>(`/api/v1/flights/${flightId}`);
  if (!flight) notFound();

  const fare: FareOptionDto | undefined =
    flight.fareOptions.find((f) => f.fareClass.code === fareCode) ?? flight.fareOptions[0];
  if (!fare) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">{t('book.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {flight.flightNumber} · {flight.origin.code} → {flight.destination.code} ·{' '}
          {flight.departLocal.replace('T', ' ').slice(0, 16)}
        </p>
      </div>
      <BookForm flight={flight} fare={fare} />
    </div>
  );
}
