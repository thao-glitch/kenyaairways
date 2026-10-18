import type {
  AirportDto,
  FareCalendarDto,
  FlightSearchResultDto,
  FlightOptionDto,
  SiteSettingsDto,
} from '@flight13/shared';
import { formatMoney } from '@flight13/shared';
import Link from 'next/link';
import { RouteArc } from '@/components/art/route-arc';
import { SitePhoto } from '@/components/media/site-photo';
import { SearchForm } from '@/components/search-form';
import { TrackFareButton } from '@/components/track-fare-button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { formatDurationShort } from '@/lib/format';
import { apiGetOrNull } from '@/lib/api';
import { getTranslator } from '@/lib/i18n';
import { getSiteSettings } from '@/lib/site';
import { destinationImage, siteImage } from '@/lib/site-images';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

function cheapest(option: FlightOptionDto): number {
  return Math.min(...option.fareOptions.map((f) => f.pricing.totalMinor));
}

/** `YYYY-MM` for the searched date (or the current month when undated). */
function monthOf(date: string | undefined): string {
  const now = new Date();
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date.slice(0, 7);
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Search results — server-rendered (public data, zero client JS beyond the form). */
export default async function FlightsPage({ searchParams }: { searchParams: SearchParams }) {
  const { t, locale } = await getTranslator();
  const sp = await searchParams;
  const origin = first(sp.origin);
  const destination = first(sp.destination);
  const date = first(sp.date);
  const adults = first(sp.adults);
  // No filters → the page lists every bookable flight; filters narrow it down.
  const hasFilters = Boolean(origin || destination || date);

  const [airports, results, calendar, site]: [
    AirportDto[] | null,
    FlightSearchResultDto | null,
    FareCalendarDto | null,
    SiteSettingsDto | null,
  ] = await Promise.all([
    apiGetOrNull<AirportDto[]>('/api/v1/airports', { revalidate: 300 }),
    apiGetOrNull<FlightSearchResultDto>(
      `/api/v1/flights/search?origin=${encodeURIComponent(origin ?? '')}` +
        `&destination=${encodeURIComponent(destination ?? '')}` +
        `&date=${encodeURIComponent(date ?? '')}&adults=${encodeURIComponent(adults ?? '1')}`,
      { revalidate: 30 },
    ),
    origin && destination
      ? apiGetOrNull<FareCalendarDto>(
          `/api/v1/flights/calendar?origin=${encodeURIComponent(origin)}` +
            `&destination=${encodeURIComponent(destination)}` +
            `&month=${monthOf(date)}`,
          { revalidate: 300 },
        )
      : Promise.resolve(null),
    getSiteSettings(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold sm:text-2xl">{t('search.title')}</h1>

      <Card>
        <CardContent className="pt-6">
          <SearchForm airports={airports ?? []} defaults={{ origin, destination, date, adults }} />
        </CardContent>
      </Card>

      {/* Whole-month fare calendar (Skyscanner style) — links re-run the search. */}
      {calendar && calendar.days.length > 0 && (
        <section aria-labelledby="calendar-heading" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="calendar-heading" className="text-lg font-semibold">
              {t('calendar.title')}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t('calendar.subtitle', {
                origin: calendar.origin,
                destination: calendar.destination,
              })}
            </p>
          </div>
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
            {calendar.days.map((day) => {
              const isBest = calendar.bestDate === day.date;
              const searchLink =
                `/flights?origin=${encodeURIComponent(calendar.origin)}` +
                `&destination=${encodeURIComponent(calendar.destination)}` +
                `&date=${day.date}&adults=${encodeURIComponent(adults ?? '1')}`;
              return (
                <Link
                  key={day.date}
                  href={searchLink}
                  className={`flex flex-col items-center rounded-lg border px-1.5 py-2 text-center transition-colors hover:border-primary/60 hover:bg-accent/50 ${
                    isBest ? 'border-primary/70 bg-primary/5' : 'bg-background'
                  } ${day.lowestTotalMinor === null ? 'pointer-events-none opacity-50' : ''}`}
                >
                  <span className="text-[11px] text-muted-foreground">{day.date.slice(8)}</span>
                  <span className="text-xs font-semibold">
                    {day.lowestTotalMinor === null
                      ? t('calendar.noFlights')
                      : formatMoney(day.lowestTotalMinor, calendar.currency, locale)}
                  </span>
                  {isBest && (
                    <span className="text-[10px] font-medium text-primary">
                      {t('calendar.best')}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {hasFilters && results === null && (
        <p
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {t('search.unavailable')}
        </p>
      )}

      {results && results.results.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-xl border px-4 py-8 text-center">
          <SitePhoto
            src={siteImage(site, 'notFound')}
            alt=""
            className="h-32 w-full max-w-xs rounded-lg"
          />
          <p className="text-sm text-muted-foreground">{t('search.empty')}</p>
        </div>
      )}

      {results && results.results.length > 0 && origin && destination && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">{t('alerts.body')}</p>
          <TrackFareButton originCode={origin} destinationCode={destination} />
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
                    <SitePhoto
                      src={destinationImage(site, option.destination.code)}
                      alt=""
                      className="hidden h-20 w-28 shrink-0 rounded-md border sm:block"
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{option.flightNumber}</span>
                        <Badge variant="outline">{t(`flight.status.${option.status}`)}</Badge>
                        {option.co2KgPerPax !== undefined && (
                          <Badge variant="secondary">
                            {t('results.co2', { kg: option.co2KgPerPax })}
                          </Badge>
                        )}
                        {option.priceAdvice && (
                          <Badge
                            variant={
                              option.priceAdvice.verdict === 'BOOK_NOW' ? 'default' : 'outline'
                            }
                          >
                            {t(`results.advice.${option.priceAdvice.verdict}`)}
                          </Badge>
                        )}
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
