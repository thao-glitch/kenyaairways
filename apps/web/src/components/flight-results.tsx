import type { Currency, FlightOptionDto, Locale, SiteSettingsDto } from '@flight13/shared';
import { formatMoney } from '@flight13/shared';
import Link from 'next/link';
import { RouteArc } from '@/components/art/route-arc';
import { SitePhoto } from '@/components/media/site-photo';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { getTranslator } from '@/lib/i18n';
import { destinationImage } from '@/lib/site-images';

const cheapest = (option: FlightOptionDto): number =>
  Math.min(...option.fareOptions.map((f) => f.pricing.totalMinor));

/**
 * One group of search results (a single leg). Server-rendered; the card
 * target varies by trip context: detail page (one-way), select-in-results
 * (choose outbound / a multi-city leg), or straight to the booking form.
 */
export async function FlightResults({
  options,
  currency,
  site,
  locale,
  cardHref,
  dimmed = false,
}: {
  options: FlightOptionDto[];
  currency: Currency;
  site: SiteSettingsDto | null;
  locale: Locale;
  /** Where a whole card links — varies by trip context. */
  cardHref: (flightId: string) => string;
  /** Later multi-city legs before earlier ones are chosen: visible, not clickable. */
  dimmed?: boolean;
}) {
  const { t } = await getTranslator();
  if (options.length === 0) return null;
  return (
    <ul className={`flex flex-col gap-3 ${dimmed ? 'opacity-60' : ''}`}>
      {options.map((option) => {
        const inner = (
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
                      variant={option.priceAdvice.verdict === 'BOOK_NOW' ? 'default' : 'outline'}
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
                  {option.destination.city}
                </span>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-lg font-semibold">
                  {formatMoney(cheapest(option), currency, locale)}
                </span>
                <span className="text-xs text-muted-foreground">{t('results.from')}</span>
              </div>
            </CardContent>
          </Card>
        );
        return (
          <li key={option.flightId}>
            {dimmed ? (
              <div aria-disabled="true" className="rounded-xl border">
                {inner}
              </div>
            ) : (
              <Link
                href={cardHref(option.flightId)}
                className="block rounded-xl border transition-colors hover:border-primary/50 hover:bg-accent/40"
              >
                {inner}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
