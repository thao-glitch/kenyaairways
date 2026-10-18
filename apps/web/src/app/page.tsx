import type { AirportDto, HealthDto, MetaDto, SiteSettingsDto } from '@flight13/shared';
import Link from 'next/link';
import { SitePhoto } from '@/components/media/site-photo';
import { SearchForm } from '@/components/search-form';
import { apiGetOrNull } from '@/lib/api';
import { getTranslator } from '@/lib/i18n';
import { getSiteSettings } from '@/lib/site';
import { destinationImage, siteImage } from '@/lib/site-images';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Landing page — server components only (zero client JS) for slow mobile
 * networks. Data is fetched server-side with short revalidation windows.
 */
export default async function HomePage() {
  const { t } = await getTranslator();
  const [meta, airports, health, site]: [
    MetaDto | null,
    AirportDto[] | null,
    HealthDto | null,
    SiteSettingsDto | null,
  ] = await Promise.all([
    apiGetOrNull<MetaDto>('/api/v1/meta', { revalidate: 60 }),
    apiGetOrNull<AirportDto[]>('/api/v1/airports', { revalidate: 300 }),
    apiGetOrNull<HealthDto>('/healthz', { revalidate: 30 }),
    getSiteSettings(),
  ]);

  const operational = health?.status === 'ok';

  return (
    <div className="flex flex-col gap-8">
      {/* Hero — a real photograph of Kenya behind a live search form */}
      <section className="relative overflow-hidden rounded-xl border">
        <SitePhoto
          src={siteImage(site, 'hero')}
          alt=""
          eager
          className="absolute inset-0 h-full w-full"
        />
        <div className="relative bg-background/60 p-6 backdrop-blur-[2px] sm:p-10">
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight sm:text-4xl">
              {t('home.hero.title')}
            </h1>
            <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground sm:text-base">
              {t('home.hero.subtitle')}
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <Badge variant="secondary">{meta?.currency ?? 'KES'}</Badge>
              <Badge variant="secondary">{meta?.timezone ?? 'Africa/Nairobi'}</Badge>
              {meta && <Badge variant="outline">{meta.airline.iataCode}</Badge>}
            </div>
          </div>
          {airports && airports.length > 0 && (
            <div className="mx-auto mt-6 max-w-3xl rounded-xl border bg-background/90 p-4 shadow-sm">
              <SearchForm airports={airports} />
            </div>
          )}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Service status */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <span
                aria-hidden="true"
                className={`inline-block h-2.5 w-2.5 rounded-full ${
                  operational ? 'bg-success' : 'bg-destructive'
                }`}
              />
              {t('home.status.title')}
            </CardTitle>
            <CardDescription>
              {operational
                ? `${t('home.status.operational')} · ${t('home.status.version', { version: health?.version ?? '—' })}`
                : t('home.status.unreachable')}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <dl className="space-y-1">
              <div className="flex justify-between gap-2">
                <dt>{t('home.status.api')}</dt>
                <dd className={operational ? 'text-success' : 'text-destructive'}>
                  {operational ? t('home.status.operational') : t('home.status.unreachable')}
                </dd>
              </div>
              {meta && (
                <>
                  <div className="flex justify-between gap-2">
                    <dt>M-Pesa</dt>
                    <dd>{meta.features.mpesa.mode}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>SMS</dt>
                    <dd>{meta.features.smsProvider}</dd>
                  </div>
                </>
              )}
            </dl>
          </CardContent>
        </Card>

        {/* Manage booking (flight search now lives in the hero) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('home.manage.title')}</CardTitle>
            <CardDescription>{t('home.manage.body')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/pnr">
              <Button variant="outline" className="w-full">
                {t('nav.manage')}
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Network */}
      <section aria-labelledby="network-heading">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 id="network-heading" className="text-lg font-semibold">
            {t('home.network.title')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t('home.network.subtitle', { count: airports?.length ?? 0 })}
          </p>
        </div>
        {airports && airports.length > 0 ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {airports.map((airport) => (
              <li key={airport.code} className="overflow-hidden rounded-lg border bg-background">
                <SitePhoto
                  src={destinationImage(site, airport.code)}
                  alt=""
                  className="h-16 w-full"
                />
                <div className="p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-base font-semibold">{airport.code}</span>
                    <Badge
                      variant={airport.domestic ? 'secondary' : 'outline'}
                      className="text-[10px]"
                    >
                      {airport.domestic
                        ? t('home.network.domestic')
                        : t('home.network.international')}
                    </Badge>
                  </div>
                  <p className="mt-1 truncate text-sm text-muted-foreground" title={airport.name}>
                    {airport.city}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            {t('home.status.unreachable')}
          </p>
        )}
      </section>
    </div>
  );
}
