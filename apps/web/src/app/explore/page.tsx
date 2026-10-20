import type { AirportDto, FleetDto } from '@flight13/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { SectionShell, type SectionTab } from '@/components/section-shell';
import { apiGetOrNull } from '@/lib/api';
import { getTranslator } from '@/lib/i18n';
import { getSiteSettings } from '@/lib/site';
import { siteImage } from '@/lib/site-images';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const metadata: Metadata = { title: 'Explore' };

const TABS = ['destinations', 'network', 'about'] as const;
type Tab = (typeof TABS)[number];

const REGIONS = [
  'africa',
  'europe',
  'asia',
  'north-america',
  'south-america',
  'oceania',
  'antarctica',
] as const;
type Region = (typeof REGIONS)[number];

/** Continent grouping comes from the API; unknown values group under Africa. */
const regionOf = (airport: AirportDto): Region =>
  (REGIONS as readonly string[]).includes(airport.continent)
    ? (airport.continent as Region)
    : 'africa';

function regionCard(airport: AirportDto, flightLabel: string) {
  return (
    <li key={airport.code}>
      <Link
        href={`/flights?destination=${airport.code}&trip=oneway`}
        className="group flex items-center justify-between gap-3 rounded-lg border bg-card p-3 transition-colors hover:border-primary/60"
      >
        <span className="min-w-0">
          <span className="text-sm font-bold text-foreground">{airport.code}</span>
          <span className="ml-2 truncate text-sm text-muted-foreground">{airport.city}</span>
          <span className="block truncate text-xs text-muted-foreground/80" title={airport.name}>
            {airport.country}
          </span>
        </span>
        <span className="shrink-0 text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
          {flightLabel}
        </span>
      </Link>
    </li>
  );
}

export default async function ExplorePage({ searchParams }: { searchParams: SearchParams }) {
  const { t } = await getTranslator();
  const sp = await searchParams;
  const raw = typeof sp.tab === 'string' ? sp.tab : '';
  const active: Tab = (TABS as readonly string[]).includes(raw) ? (raw as Tab) : 'destinations';

  const [airports, fleet, site] = await Promise.all([
    apiGetOrNull<AirportDto[]>('/api/v1/airports', { revalidate: 300 }),
    apiGetOrNull<FleetDto>('/api/v1/fleet', { revalidate: 300 }),
    getSiteSettings(),
  ]);
  const name = site?.appName?.trim() || t('app.name');
  const list = airports ?? [];

  const tabs: SectionTab[] = [
    {
      href: '/explore?tab=destinations',
      label: t('section.explore.destinations'),
      active: active === 'destinations',
    },
    {
      href: '/explore?tab=network',
      label: t('section.explore.network'),
      active: active === 'network',
    },
    { href: '/explore?tab=about', label: t('section.explore.about'), active: active === 'about' },
  ];

  return (
    <SectionShell
      title={t('section.explore.title')}
      intro={t('section.explore.intro')}
      image={siteImage(site, 'explore')}
      tabs={tabs}
    >
      {active === 'destinations' && (
        <div className="space-y-10">
          {REGIONS.map((region) => {
            const inRegion = list.filter((airport) => regionOf(airport) === region);
            return (
              <section key={region} id={region} className="scroll-mt-32">
                <div className="mb-3 flex items-center gap-3">
                  <h2 className="font-display text-xl italic">{t(`section.region.${region}`)}</h2>
                  <span className="h-px flex-1 bg-border" aria-hidden="true" />
                  <span className="text-xs text-muted-foreground">
                    {t('section.explore.count', { count: inRegion.length })}
                  </span>
                </div>
                {inRegion.length > 0 ? (
                  <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {inRegion.map((airport) => regionCard(airport, t('menu.book.flight')))}
                  </ul>
                ) : (
                  <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                    {t('section.explore.empty')}
                  </p>
                )}
              </section>
            );
          })}
        </div>
      )}

      {active === 'network' && (
        <div className="space-y-6">
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {t('section.explore.networkBody', { name, count: list.length })}
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border bg-card p-5">
              <p className="font-display text-3xl italic text-primary">{list.length}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('section.explore.statAirports')}
              </p>
            </div>
            <div className="rounded-xl border bg-card p-5">
              <p className="font-display text-3xl italic text-primary">
                {new Set(list.map((a) => a.country)).size}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('section.explore.statCountries')}
              </p>
            </div>
            <div className="rounded-xl border bg-card p-5">
              <p className="font-display text-3xl italic text-primary">
                {fleet?.totalAircraft ?? '—'}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{t('section.explore.statFleet')}</p>
            </div>
          </div>
          <ul className="flex flex-wrap gap-2">
            {list.map((airport) => (
              <li key={airport.code}>
                <Link
                  href={`/flights?origin=${airport.code}&trip=oneway`}
                  className="inline-flex rounded-full border px-3 py-1.5 text-xs font-medium transition-colors hover:border-primary hover:text-primary"
                  title={airport.name}
                >
                  {airport.code}{' '}
                  <span className="ml-1.5 text-muted-foreground">{airport.city}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {active === 'about' && (
        <div className="max-w-3xl space-y-5 text-sm leading-relaxed text-muted-foreground">
          <h2 className="font-display text-2xl italic text-foreground">
            {t('section.explore.aboutHeading', { name })}
          </h2>
          <p>{t('section.explore.aboutP1', { name })}</p>
          <p>{t('section.explore.aboutP2', { count: list.length })}</p>
          <p>{t('section.explore.aboutP3', { fleet: fleet?.totalAircraft ?? 0 })}</p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Link
              href="/flights"
              className="rounded-sm bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              {t('menu.book.flight')}
            </Link>
            <Link
              href="/experience?tab=fleet"
              className="rounded-sm border px-5 py-2.5 text-sm font-semibold hover:border-primary hover:text-primary"
            >
              {t('menu.exp.action1')}
            </Link>
          </div>
        </div>
      )}
    </SectionShell>
  );
}
