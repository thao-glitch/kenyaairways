import type {
  AirportDto,
  Currency,
  FareCalendarDto,
  FlightOptionDto,
  FlightSearchResultDto,
} from '@kenyaairways/shared';
import { formatMoney } from '@kenyaairways/shared';
import Link from 'next/link';
import { RouteArc } from '@/components/art/route-arc';
import { SitePhoto } from '@/components/media/site-photo';
import { FlightResults } from '@/components/flight-results';
import { SearchForm } from '@/components/search-form';
import { TrackFareButton } from '@/components/track-fare-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { apiGetOrNull } from '@/lib/api';
import { getTranslator } from '@/lib/i18n';
import { getSiteSettings } from '@/lib/site';
import { siteImage } from '@/lib/site-images';
import { parseLeg, type TripKind } from '@/lib/trip';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/** `YYYY-MM` for the searched date (or the current month when undated). */
function monthOf(date: string | undefined): string {
  const now = new Date();
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date.slice(0, 7);
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

type LegSpec = { origin: string; destination: string; date: string };

const searchUrl = (s: LegSpec, adults: string): string =>
  `/api/v1/flights/search?origin=${encodeURIComponent(s.origin)}` +
  `&destination=${encodeURIComponent(s.destination)}` +
  `&date=${encodeURIComponent(s.date)}&adults=${encodeURIComponent(adults)}`;

/**
 * Search results for every trip type. One-way lists flights; a return trip
 * asks you to pick the outbound flight first, then the return flight links
 * straight to the booking form; multi-city walks the legs in order and then
 * books them as one multi-segment booking. Selection lives in the `sel` URL
 * param — no client JS beyond the search form itself.
 */
export default async function FlightsPage({ searchParams }: { searchParams: SearchParams }) {
  const { t, locale } = await getTranslator();
  const sp = await searchParams;
  const tripRaw = first(sp.trip);
  const trip: TripKind = tripRaw === 'oneway' || tripRaw === 'multicity' ? tripRaw : 'return';
  const adults = first(sp.adults) ?? '1';
  const origin = first(sp.origin);
  const destination = first(sp.destination);
  const date = first(sp.date);
  const returnDate = first(sp.returnDate);
  const legRaws = (Array.isArray(sp.leg) ? sp.leg : sp.leg ? [sp.leg] : []).map(String);
  const chosen = (first(sp.sel) ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const single = trip !== 'multicity';
  const hasFilters = single
    ? Boolean(origin || destination || date)
    : legRaws.some((raw) => parseLeg(raw) !== null);
  // The pick-outbound-then-return flow only engages with a full round trip:
  // a "Return" search without a return date behaves like a one-way list.
  const returnMode = single && trip === 'return' && Boolean(returnDate && origin && destination);

  // Which legs to fetch: one-way/default = the searched route; a return trip
  // only fetches the return leg once an outbound flight is chosen; multi-city
  // fetches each encoded leg.
  const legSpecs: LegSpec[] = [];
  if (trip === 'multicity') {
    for (const raw of legRaws) {
      const leg = parseLeg(raw);
      if (leg) legSpecs.push(leg);
    }
  } else {
    legSpecs.push({ origin: origin ?? '', destination: destination ?? '', date: date ?? '' });
    if (trip === 'return' && returnDate && origin && destination && chosen.length > 0) {
      legSpecs.push({ origin: destination, destination: origin, date: returnDate });
    }
  }

  const needCalendar = Boolean(origin && destination);
  const [airports, site, calendar, groups] = await Promise.all([
    apiGetOrNull<AirportDto[]>('/api/v1/airports', { revalidate: 300 }),
    getSiteSettings(),
    needCalendar
      ? apiGetOrNull<FareCalendarDto>(
          `/api/v1/flights/calendar?origin=${encodeURIComponent(origin ?? '')}` +
            `&destination=${encodeURIComponent(destination ?? '')}&month=${monthOf(date)}`,
          { revalidate: 300 },
        )
      : Promise.resolve(null),
    Promise.all(
      legSpecs.map((spec) =>
        apiGetOrNull<FlightSearchResultDto>(searchUrl(spec, adults), { revalidate: 30 }),
      ),
    ),
  ]);

  const out = groups[0] ?? null;
  const outResults = out?.results ?? null;

  // Validate selections against what actually came back: a stale or foreign
  // `sel` falls back to the un-chosen state instead of breaking the page.
  let validChosen: string[] = [];
  if (returnMode) {
    if (chosen[0] && outResults?.some((o) => o.flightId === chosen[0])) validChosen = [chosen[0]];
  } else if (trip === 'multicity') {
    for (let i = 0; i < legSpecs.length && i < chosen.length; i += 1) {
      if (groups[i]?.results?.some((o) => o.flightId === chosen[i])) validChosen.push(chosen[i]);
      else break;
    }
  }

  /** Rebuild the results URL, preserving every filter and swapping `sel`. */
  const pageHref = (sel: string[]): string => {
    const p = new URLSearchParams();
    p.set('trip', trip);
    p.set('adults', adults);
    if (single) {
      if (origin) p.set('origin', origin);
      if (destination) p.set('destination', destination);
      if (date) p.set('date', date);
      if (returnDate) p.set('returnDate', returnDate);
    } else {
      for (const raw of legRaws) p.append('leg', raw);
    }
    if (sel.length > 0) p.set('sel', sel.join(','));
    return `/flights?${p.toString()}`;
  };

  const bookHref = (ids: string[]): string =>
    `/book?flights=${ids.join(',')}&trip=${trip}` + (adults !== '1' ? `&adults=${adults}` : '');

  const emptyBlock = (message: string) => (
    <div className="flex flex-col items-center gap-3 rounded-xl border px-4 py-8 text-center">
      <SitePhoto
        src={siteImage(site, 'notFound')}
        alt=""
        className="h-32 w-full max-w-xs rounded-lg"
      />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );

  const unavailable = out === null &&
    (hasFilters || (trip === 'multicity' && legSpecs.length > 0)) && (
      <p
        className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        role="alert"
      >
        {t('search.unavailable')}
      </p>
    );

  const chosenCard = (option: FlightOptionDto, currency: Currency, changeHref: string) => (
    <Card className="border-primary/40">
      <CardContent className="flex flex-wrap items-center gap-4 pt-6">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{t('results.selected')}</Badge>
            <span className="font-semibold">{option.flightNumber}</span>
          </div>
          <div className="flex items-center gap-2 text-sm font-medium">
            <span>{option.origin.code}</span>
            <RouteArc className="h-5 min-w-16 flex-1 text-primary/70" />
            <span>{option.destination.code}</span>
          </div>
          <span className="truncate text-sm text-muted-foreground">
            {option.departLocal.replace('T', ' ').slice(0, 16)} →{' '}
            {option.arriveLocal.replace('T', ' ').slice(0, 16)} · {option.origin.city} →{' '}
            {option.destination.city}
          </span>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-lg font-semibold">
            {formatMoney(
              Math.min(...option.fareOptions.map((f) => f.pricing.totalMinor)),
              currency,
              locale,
            )}
          </span>
          <Link href={changeHref}>
            <Button type="button" variant="outline" size="sm">
              {t('results.change')}
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );

  const groupHeading = (id: string, text: string, hint?: string) => (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 id={id} className="text-lg font-semibold">
        {text}
      </h2>
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
    </div>
  );

  const currencyOf = (i: number): Currency =>
    groups[i]?.meta.currency ?? calendar?.currency ?? 'KES';

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold sm:text-2xl">{t('search.title')}</h1>

      <Card>
        <CardContent className="pt-6">
          <SearchForm
            airports={airports ?? []}
            defaults={{ origin, destination, date, adults, trip, returnDate, legs: legRaws }}
          />
        </CardContent>
      </Card>

      {/* Whole-month fare calendar (Skyscanner style) — links re-run the search. */}
      {calendar && calendar.days.length > 0 && (
        <section aria-labelledby="calendar-heading" className="flex flex-col gap-3">
          {groupHeading(
            'calendar-heading',
            t('calendar.title'),
            t('calendar.subtitle', {
              origin: calendar.origin,
              destination: calendar.destination,
            }),
          )}
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
            {calendar.days.map((day) => {
              const isBest = calendar.bestDate === day.date;
              const searchLink =
                `/flights?trip=${trip}` +
                `&origin=${encodeURIComponent(calendar.origin)}` +
                `&destination=${encodeURIComponent(calendar.destination)}` +
                `&date=${day.date}&adults=${encodeURIComponent(adults)}` +
                (trip === 'return' && returnDate
                  ? `&returnDate=${encodeURIComponent(returnDate)}`
                  : '');
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

      {unavailable}

      {/* Fare tracking only applies to a fixed route pair. */}
      {single && outResults && outResults.length > 0 && origin && destination && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">{t('alerts.body')}</p>
          <TrackFareButton originCode={origin} destinationCode={destination} />
        </div>
      )}

      {/* ---------------- one way / default ---------------- */}
      {single && !returnMode && out && outResults && (
        <>
          {outResults.length === 0 ? (
            emptyBlock(t('search.empty'))
          ) : (
            <FlightResults
              options={outResults}
              currency={currencyOf(0)}
              site={site}
              locale={locale}
              cardHref={(id) => `/flights/${id}`}
            />
          )}
        </>
      )}

      {/* ---------------- return trip ---------------- */}
      {returnMode && out && outResults && validChosen.length === 0 && (
        <>
          {groupHeading('outbound-heading', t('results.chooseOutbound'))}
          {outResults.length === 0 ? (
            emptyBlock(t('search.empty'))
          ) : (
            <FlightResults
              options={outResults}
              currency={currencyOf(0)}
              site={site}
              locale={locale}
              cardHref={(id) => pageHref([id])}
            />
          )}
        </>
      )}

      {returnMode &&
        outResults &&
        validChosen.length === 1 &&
        (() => {
          const selected = outResults.find((o) => o.flightId === validChosen[0]);
          const retGroup = groups[1] ?? null;
          if (!selected) return null;
          const retResults = retGroup?.results ?? null;
          return (
            <>
              {chosenCard(selected, currencyOf(0), pageHref([]))}
              {groupHeading('return-heading', t('results.chooseReturn'))}
              {retGroup === null ? (
                <p
                  className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  role="alert"
                >
                  {t('search.unavailable')}
                </p>
              ) : retResults && retResults.length > 0 ? (
                <FlightResults
                  options={retResults}
                  currency={currencyOf(1)}
                  site={site}
                  locale={locale}
                  cardHref={(id) => bookHref([validChosen[0], id])}
                />
              ) : (
                emptyBlock(t('results.emptyLeg'))
              )}
            </>
          );
        })()}

      {/* ---------------- multi-city ---------------- */}
      {trip === 'multicity' &&
        (legSpecs.length === 0
          ? emptyBlock(t('search.empty'))
          : (() => {
              const allChosen = validChosen.length === legSpecs.length;
              return (
                <div className="flex flex-col gap-6">
                  {legSpecs.map((spec, i) => {
                    const results = groups[i]?.results ?? null;
                    const heading = groupHeading(
                      `leg-${i}`,
                      t('search.leg', { n: i + 1 }),
                      `${spec.origin} → ${spec.destination} · ${spec.date}`,
                    );
                    if (i < validChosen.length) {
                      const selected = results?.find((o) => o.flightId === validChosen[i]);
                      if (!selected) return null;
                      return (
                        <section key={`chosen-${i}`} className="flex flex-col gap-3">
                          {heading}
                          {chosenCard(selected, currencyOf(i), pageHref(validChosen.slice(0, i)))}
                        </section>
                      );
                    }
                    if (i > validChosen.length) {
                      return (
                        <section key={`locked-${i}`} className="flex flex-col gap-3">
                          {heading}
                          {results && results.length > 0 ? (
                            <FlightResults
                              options={results}
                              currency={currencyOf(i)}
                              site={site}
                              locale={locale}
                              cardHref={() => pageHref(validChosen)}
                              dimmed
                            />
                          ) : (
                            <p className="text-sm text-muted-foreground">{t('results.emptyLeg')}</p>
                          )}
                        </section>
                      );
                    }
                    // The active leg: cards add themselves to the selection.
                    return (
                      <section key={`active-${i}`} className="flex flex-col gap-3">
                        {i === 0 && groupHeading('legs-heading', t('results.chooseOutbound'))}
                        {heading}
                        {groups[i] === null ? (
                          <p
                            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                            role="alert"
                          >
                            {t('search.unavailable')}
                          </p>
                        ) : results && results.length > 0 ? (
                          <FlightResults
                            options={results}
                            currency={currencyOf(i)}
                            site={site}
                            locale={locale}
                            cardHref={(id) => pageHref([...validChosen, id])}
                          />
                        ) : (
                          <p className="text-sm text-muted-foreground">{t('results.emptyLeg')}</p>
                        )}
                      </section>
                    );
                  })}
                  {allChosen && (
                    <div className="flex justify-end rounded-xl border bg-primary/5 p-4">
                      <Link href={bookHref(validChosen)}>
                        <Button>{t('results.bookAll', { count: validChosen.length })}</Button>
                      </Link>
                    </div>
                  )}
                </div>
              );
            })())}
    </div>
  );
}
