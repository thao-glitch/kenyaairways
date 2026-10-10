import type { AirportDto, FlightSearchResultDto, FlightOptionDto } from '@flight13/shared';
import { formatMoney } from '@flight13/shared';
import Link from 'next/link';
import { DestinationArt } from '@/components/art/destination-art';
import { EmptyStateArt } from '@/components/art/empty-state-art';
import { RouteArc } from '@/components/art/route-arc';
import { SearchForm } from '@/components/search-form';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { formatDurationShort } from '@/lib/format';
import { apiGetOrNull } from '@/lib/api';
import { getTranslator } from '@/lib/i18n';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

function cheapest(option: FlightOptionDto): number {
  return Math.min(...option.fareOptions.map((f) => f.pricing.totalMinor));
}

/** Search results — server-rendered (public data, zero client JS beyond the form). */
export default async function FlightsPage({ searchParams }: { searchParams: SearchParams }) {
  const { t, locale } = await getTranslator();
  const sp = await searchParams;
  const origin = first(sp.origin);
  const destination = first(sp.destination);
  const date = first(sp.date);
  const adults = first(sp.adults);
  const hasQuery = Boolean(origin && destination && date);

  const [airports, results] = await Promise.all([
    apiGetOrNull<AirportDto[]>('/api/v1/airports', { revalidate: 300 }),
    hasQuery
      ? apiGetOrNull<FlightSearchResultDto>(
          `/api/v1/flights/search?origin=${encodeURIComponent(origin ?? '')}` +
            `&destination=${encodeURIComponent(destination ?? '')}` +
            `&date=${encodeURIComponent(date ?? '')}&adults=${encodeURIComponent(adults ?? '1')}`,
          { revalidate: 30 },
        )
      : Promise.resolve(null),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold sm:text-2xl">{t('search.title')}</h1>

      <Card>
        <CardContent className="pt-6">
          <SearchForm airports={airports ?? []} defaults={{ origin, destination, date, adults }} />
        </CardContent>
      </Card>

      {!hasQuery && <p className="text-sm text-muted-foreground">{t('search.prompt')}</p>}

      {hasQuery && results === null && (
        <p
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {t('search.unavailable')}
        </p>
      )}

      {results && results.results.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-xl border px-4 py-8 text-center">
          <EmptyStateArt variant="search" className="h-32 w-full max-w-xs" />
          <p className="text-sm text-muted-foreground">{t('search.empty')}</p>
        </div>
      )}

      {results && results.results.length > 0 && (
        <ul className="flex flex-col gap-3">
          {results.results.map((option) => (
            <li key={option.flightId}>
              <Link
                href={`/flights/${option.flightId}`}
                className="block rounded-xl border transition-colors hover:border-primary/50 hover:bg-accent/40"
              >
                <Card className="border-0 shadow-none">
                  <CardContent className="flex items-center gap-4 pt-6">
                    <DestinationArt
                      code={option.destination.code}
                      className="hidden h-20 w-28 shrink-0 rounded-md border sm:block"
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{option.flightNumber}</span>
                        <Badge variant="outline">{t(`flight.status.${option.status}`)}</Badge>
                      </div>
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <span>{option.origin.code}</span>
                        <RouteArc className="h-5 min-w-16 flex-1 text-primary/70" />
                        <span>{option.destination.code}</span>
                      </div>
                      <span className="truncate text-sm text-muted-foreground">
                        {option.departLocal.replace('T', ' ').slice(0, 16)} →{' '}
                        {option.arriveLocal.replace('T', ' ').slice(0, 16)} · {option.origin.city} →{' '}
                        {option.destination.city} · {formatDurationShort(option.durationMinutes)}
                      </span>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-lg font-semibold">
                        {formatMoney(cheapest(option), results.meta.currency, locale)}
                      </span>
                      <span className="text-xs text-muted-foreground">{t('results.from')}</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
