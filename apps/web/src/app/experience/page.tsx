import type { FareClassDetailDto, FleetDto, SiteSettingsDto } from '@flight13/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { SectionShell, type SectionTab } from '@/components/section-shell';
import { apiGetOrNull } from '@/lib/api';
import { getTranslator } from '@/lib/i18n';
import { getSiteSettings } from '@/lib/site';
import { siteImage } from '@/lib/site-images';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const metadata: Metadata = { title: 'On board & fleet' };

const TABS = ['fleet', 'cabins', 'service'] as const;
type Tab = (typeof TABS)[number];

const SERVICE_BLOCKS = [
  { id: 'meals', titleKey: 'section.service.meals', bodyKey: 'section.service.mealsBody' },
  { id: 'bags', titleKey: 'section.service.bags', bodyKey: 'section.service.bagsBody' },
  { id: 'seats', titleKey: 'section.service.seats', bodyKey: 'section.service.seatsBody' },
  { id: 'lounge', titleKey: 'section.service.lounge', bodyKey: 'section.service.loungeBody' },
  { id: 'priority', titleKey: 'section.service.priority', bodyKey: 'section.service.priorityBody' },
  { id: 'planet', titleKey: 'section.service.planet', bodyKey: 'section.service.planetBody' },
] as const;

const CABIN_LABEL: Record<string, string> = {
  ECONOMY: 'section.plan.cabinEconomy',
  BUSINESS: 'section.plan.cabinBusiness',
  PREMIUM: 'section.plan.cabinPremium',
};

export default async function ExperiencePage({ searchParams }: { searchParams: SearchParams }) {
  const { t, locale } = await getTranslator();
  const sp = await searchParams;
  const raw = typeof sp.tab === 'string' ? sp.tab : '';
  const active: Tab = (TABS as readonly string[]).includes(raw) ? (raw as Tab) : 'fleet';

  const [fleet, fares, site]: [
    FleetDto | null,
    FareClassDetailDto[] | null,
    SiteSettingsDto | null,
  ] = await Promise.all([
    apiGetOrNull<FleetDto>('/api/v1/fleet', { revalidate: 300 }),
    apiGetOrNull<FareClassDetailDto[]>('/api/v1/fare-classes', { revalidate: 300 }),
    getSiteSettings(),
  ]);

  const tabs: SectionTab[] = [
    {
      href: '/experience?tab=fleet',
      label: t('section.experience.fleet'),
      active: active === 'fleet',
    },
    {
      href: '/experience?tab=cabins',
      label: t('section.experience.cabins'),
      active: active === 'cabins',
    },
    {
      href: '/experience?tab=service',
      label: t('section.experience.service'),
      active: active === 'service',
    },
  ];

  const km = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });

  return (
    <SectionShell
      title={t('section.experience.title')}
      intro={t('section.experience.intro')}
      image={siteImage(site, 'experience')}
      tabs={tabs}
    >
      {active === 'fleet' && (
        <div className="space-y-5">
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {t('section.experience.fleetBody', { count: fleet?.totalAircraft ?? 0 })}
          </p>
          <ul className="grid gap-5 lg:grid-cols-2">
            {(fleet?.types ?? []).map((type) => (
              <li
                key={type.code}
                id={type.code}
                className="scroll-mt-32 rounded-xl border bg-card p-5"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="font-display text-xl italic text-foreground">{type.name}</h2>
                  <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-bold text-accent-foreground">
                    {type.code}
                  </span>
                </div>
                <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
                  {type.manufacturer}
                </p>

                <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      {t('section.experience.range')}
                    </dt>
                    <dd className="text-sm font-semibold">
                      {type.rangeKm ? `${km.format(type.rangeKm)} km` : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      {t('section.experience.cruise')}
                    </dt>
                    <dd className="text-sm font-semibold">
                      {type.cruiseKts ? `${type.cruiseKts} kts` : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      {t('section.experience.seats')}
                    </dt>
                    <dd className="text-sm font-semibold">{type.seats}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('section.experience.co2')}</dt>
                    <dd className="text-sm font-semibold">
                      {type.co2GramsPerPaxKm ? `${type.co2GramsPerPaxKm} g` : '—'}
                    </dd>
                  </div>
                </dl>

                <div className="mt-3 flex flex-wrap gap-2">
                  {type.cabins.map((cabin) => (
                    <span
                      key={cabin.cabin}
                      className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground"
                    >
                      {t(CABIN_LABEL[cabin.cabin] ?? 'section.plan.cabinEconomy')} · {cabin.count}
                    </span>
                  ))}
                </div>

                <div className="mt-4 border-t pt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('section.experience.registrations')}
                  </p>
                  <ul className="mt-1.5 flex flex-wrap gap-2">
                    {type.aircraft.map((ac) => (
                      <li
                        key={ac.registration}
                        title={`${t('section.experience.status')}: ${ac.status}`}
                        className="rounded border bg-background px-2 py-1 font-mono text-xs"
                      >
                        {ac.registration}
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
            {!fleet || fleet.types.length === 0 ? (
              <li className="col-span-full rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
                {t('home.status.unreachable')}
              </li>
            ) : null}
          </ul>
        </div>
      )}

      {active === 'cabins' && (
        <div className="space-y-5">
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {t('section.experience.cabinsBody')}
          </p>
          <ul className="grid gap-4 lg:grid-cols-2">
            {(fares ?? []).map((fare) => {
              const ruleText = (rule: { textEn: string; textSw: string | null }): string =>
                locale === 'sw-KE' && rule.textSw ? rule.textSw : rule.textEn;
              return (
                <li
                  key={fare.code}
                  id={fare.code.toLowerCase()}
                  className="scroll-mt-32 rounded-xl border bg-card p-5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="font-display text-xl italic text-foreground">{fare.name}</h2>
                    <span className="text-xs font-bold uppercase tracking-wider text-primary">
                      {t(CABIN_LABEL[fare.cabin] ?? 'section.plan.cabinEconomy')}
                    </span>
                  </div>
                  <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                    <li>{t('section.plan.baggageKg', { kg: fare.baggageKg })}</li>
                    <li>{t('section.experience.carryOnKg', { kg: fare.carryOnKg })}</li>
                    <li>
                      {fare.changesAllowed
                        ? t('section.plan.changesYes')
                        : t('section.plan.changesNo')}{' '}
                      · {fare.refundable ? t('section.plan.refundYes') : t('section.plan.refundNo')}
                    </li>
                  </ul>
                  {fare.rules.length > 0 && (
                    <ul className="mt-3 space-y-2 border-t pt-3 text-sm text-muted-foreground">
                      {fare.rules.map((rule) => (
                        <li key={rule.routeType} className="flex gap-2">
                          <span
                            className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                            aria-hidden="true"
                          />
                          {ruleText(rule)}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
            {(fares ?? []).length === 0 && (
              <li className="col-span-full rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
                {t('home.status.unreachable')}
              </li>
            )}
          </ul>
          <Link
            href="/flights"
            className="inline-block rounded-sm bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            {t('menu.book.flight')}
          </Link>
        </div>
      )}

      {active === 'service' && (
        <div className="grid gap-4 md:grid-cols-2">
          {SERVICE_BLOCKS.map((block) => (
            <section
              key={block.id}
              id={block.id}
              className="scroll-mt-32 rounded-xl border bg-card p-5"
            >
              <h2 className="font-display text-lg italic text-foreground">{t(block.titleKey)}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {t(block.bodyKey)}
              </p>
            </section>
          ))}
        </div>
      )}
    </SectionShell>
  );
}
