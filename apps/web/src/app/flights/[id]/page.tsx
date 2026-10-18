import type { FlightOptionDto } from '@flight13/shared';
import { formatMoney } from '@flight13/shared';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { RouteArc } from '@/components/art/route-arc';
import { SitePhoto } from '@/components/media/site-photo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDurationShort } from '@/lib/format';
import { apiGetOrNull } from '@/lib/api';
import { getTranslator } from '@/lib/i18n';
import { getSiteSettings } from '@/lib/site';
import { destinationImage } from '@/lib/site-images';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;

/** Public flight detail: schedule + fare families, each leading into `/book`. */
export default async function FlightDetailPage({ params }: { params: Params }) {
  const { id } = await params;
  const { t, locale } = await getTranslator();
  const [flight, site] = await Promise.all([
    apiGetOrNull<FlightOptionDto>(`/api/v1/flights/${id}`),
    getSiteSettings(),
  ]);
  if (!flight) notFound();

  return (
    <div className="flex flex-col gap-6">
      {/* Route banner — a real photograph of the destination behind the flight identity */}
      <div className="overflow-hidden rounded-xl border">
        <div className="relative">
          <SitePhoto
            src={destinationImage(site, flight.destination.code)}
            alt=""
            eager
            className="h-36 w-full"
          />
          <div className="absolute inset-0 flex flex-col justify-end gap-1 bg-gradient-to-t from-background/95 via-background/45 to-transparent p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold sm:text-2xl">{flight.flightNumber}</h1>
              <Badge variant="outline">{t(`flight.status.${flight.status}`)}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {flight.origin.name} → {flight.destination.name}
            </p>
          </div>
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-2xl font-semibold">
              {flight.departLocal.replace('T', ' ').slice(0, 16)}
            </p>
            <p className="text-sm text-muted-foreground">
              {flight.origin.code} · {flight.origin.timezone}
            </p>
          </div>
          <div className="flex flex-col items-center gap-1">
            <RouteArc className="h-8 w-36 text-primary/70" />
            <div className="text-sm text-muted-foreground">
              {formatDurationShort(flight.durationMinutes)}
            </div>
          </div>
          <div className="sm:text-right">
            <p className="text-2xl font-semibold">
              {flight.arriveLocal.replace('T', ' ').slice(0, 16)}
            </p>
            <p className="text-sm text-muted-foreground">
              {flight.destination.code} · {flight.destination.timezone}
            </p>
          </div>
        </CardContent>
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t('flights.fares.title')}</h2>
        <ul className="flex flex-col gap-3">
          {flight.fareOptions.map((fare) => (
            <li key={fare.fareClass.code}>
              <Card>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                    <span>{fare.fareClass.name}</span>
                    <span className="font-semibold">
                      {formatMoney(fare.pricing.totalMinor, fare.pricing.currency, locale)}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 text-sm">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">{fare.fareClass.cabin}</Badge>
                    <Badge variant="outline">
                      {t('flights.baggage', { kg: fare.fareClass.baggageKg })}
                    </Badge>
                    <Badge variant="outline">
                      {t('flights.carryOn', { kg: fare.fareClass.carryOnKg })}
                    </Badge>
                    <Badge variant={fare.fareClass.refundable ? 'success' : 'outline'}>
                      {fare.fareClass.refundable
                        ? t('flights.refundable')
                        : t('flights.nonRefundable')}
                    </Badge>
                    {!fare.fareClass.changesAllowed && (
                      <Badge variant="outline">{t('flights.noChanges')}</Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-muted-foreground">
                      {t('flights.seatsLeft', { count: fare.seatsAvailable })}
                    </span>
                    <Link href={`/book?flightId=${flight.flightId}&fare=${fare.fareClass.code}`}>
                      <Button size="sm" disabled={fare.seatsAvailable <= 0}>
                        {fare.seatsAvailable > 0 ? t('flights.select') : t('flights.soldOut')}
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
