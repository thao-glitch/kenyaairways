import type { AirportDto, MetaDto, SiteSettingsDto } from '@flight13/shared';
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
  const [meta, airports, site]: [MetaDto | null, AirportDto[] | null, SiteSettingsDto | null] =
    await Promise.all([
      apiGetOrNull<MetaDto>('/api/v1/meta', { revalidate: 60 }),
      apiGetOrNull<AirportDto[]>('/api/v1/airports', { revalidate: 300 }),
      getSiteSettings(),
    ]);

  return (
    <div className="flex flex-col gap-8">
      {/* Hero — a real photograph of our fleet behind a live search form */}
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

      {/* Manage booking */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('home.manage.title')}</CardTitle>
          <CardDescription>{t('home.manage.body')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/pnr">
            <Button variant="outline" className="w-full sm:w-auto">
              {t('nav.manage')}
            </Button>
          </Link>
        </CardContent>
      </Card>

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
