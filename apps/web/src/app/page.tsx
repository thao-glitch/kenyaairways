import type { AirportDto, HealthDto, MetaDto } from '@flight13/shared';
import Link from 'next/link';
import { apiGetOrNull } from '@/lib/api';
import { getTranslator } from '@/lib/i18n';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Landing page — server components only (zero client JS) for slow mobile
 * networks. Data is fetched server-side with short revalidation windows.
 */
export default async function HomePage() {
  const { t } = await getTranslator();
  const [meta, airports, health] = await Promise.all([
    apiGetOrNull<MetaDto>('/api/v1/meta', { revalidate: 60 }),
    apiGetOrNull<AirportDto[]>('/api/v1/airports', { revalidate: 300 }),
    apiGetOrNull<HealthDto>('/healthz', { revalidate: 30 }),
  ]);

  const operational = health?.status === 'ok';

  return (
    <div className="flex flex-col gap-8">
      {/* Hero */}
      <section className="rounded-xl border bg-gradient-to-b from-accent/60 to-background p-6 text-center sm:p-10">
        <h1 className="text-2xl font-bold tracking-tight sm:text-4xl">{t('home.hero.title')}</h1>
        <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground sm:text-base">
          {t('home.hero.subtitle')}
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <Badge variant="secondary">{meta?.currency ?? 'KES'}</Badge>
          <Badge variant="secondary">{meta?.timezone ?? 'Africa/Nairobi'}</Badge>
          {meta && <Badge variant="outline">{meta.airline.iataCode}</Badge>}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
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

        {/* Search teaser → live search */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('home.search.title')}</CardTitle>
            <CardDescription>{t('home.search.coming')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/flights">
              <Button variant="outline" className="w-full">
                {t('home.search.cta')}
              </Button>
            </Link>
          </CardContent>
        </Card>

        {/* Developers */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('home.docs.title')}</CardTitle>
            <CardDescription>{t('home.docs.body')}</CardDescription>
          </CardHeader>
          <CardContent>
            <a
              href={`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/docs`}
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              rel="noreferrer"
            >
              {t('nav.docs')} →
            </a>
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
              <li key={airport.code} className="rounded-lg border p-3">
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
