import type { FareClassDetailDto, SiteSettingsDto } from '@flight13/shared';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { SitePhoto } from '@/components/media/site-photo';
import { SectionShell, type SectionTab } from '@/components/section-shell';
import { apiGetOrNull } from '@/lib/api';
import { getTranslator } from '@/lib/i18n';
import { getSiteSettings } from '@/lib/site';
import { siteImage } from '@/lib/site-images';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const metadata: Metadata = { title: 'Plan your trip' };

const TABS = ['flights', 'holidays', 'checklist', 'groups'] as const;
type Tab = (typeof TABS)[number];

function InfoBlock({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-32 rounded-xl border bg-card p-5">
      <h3 className="font-display text-lg italic text-foreground">{title}</h3>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

const HOLIDAY_CARDS = [
  { dest: 'MYD', img: 'holidays' as const, titleKey: 'section.holidays.beach' },
  { dest: 'MBA', img: 'explore' as const, titleKey: 'section.holidays.safari' },
  { dest: 'NBO', img: 'plan' as const, titleKey: 'section.holidays.city' },
];

export default async function PlanPage({ searchParams }: { searchParams: SearchParams }) {
  const { t } = await getTranslator();
  const sp = await searchParams;
  const raw = typeof sp.tab === 'string' ? sp.tab : '';
  const active: Tab = (TABS as readonly string[]).includes(raw) ? (raw as Tab) : 'flights';

  const [fares, site]: [FareClassDetailDto[] | null, SiteSettingsDto | null] = await Promise.all([
    apiGetOrNull<FareClassDetailDto[]>('/api/v1/fare-classes', { revalidate: 300 }),
    getSiteSettings(),
  ]);

  const tabs: SectionTab[] = [
    { href: '/plan?tab=flights', label: t('section.plan.flights'), active: active === 'flights' },
    {
      href: '/plan?tab=holidays',
      label: t('section.plan.holidays'),
      active: active === 'holidays',
    },
    {
      href: '/plan?tab=checklist',
      label: t('section.plan.checklist'),
      active: active === 'checklist',
    },
    { href: '/plan?tab=groups', label: t('section.plan.groups'), active: active === 'groups' },
  ];

  const allowance = (fares ?? [])[0];

  return (
    <SectionShell
      title={t('section.plan.title')}
      intro={t('section.plan.intro')}
      image={siteImage(site, 'plan')}
      tabs={tabs}
    >
      {active === 'flights' && (
        <div className="space-y-8">
          {/* 24-hour hold — a real booking feature. */}
          <section
            id="hold"
            className="scroll-mt-32 rounded-xl border border-primary/40 bg-accent/40 p-5"
          >
            <h2 className="font-display text-xl italic text-foreground">
              {t('section.plan.holdTitle')}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              {t('section.plan.holdBody')}
            </p>
            <Link
              href="/flights"
              className="mt-4 inline-block rounded-sm bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              {t('menu.book.flight')}
            </Link>
          </section>

          {/* Fare families straight from the fare-classes endpoint. */}
          <div>
            <div className="mb-3 flex items-center gap-3">
              <h2 className="font-display text-xl italic">{t('section.plan.faresTitle')}</h2>
              <span className="h-px flex-1 bg-border" aria-hidden="true" />
            </div>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {(fares ?? []).map((fare) => (
                <li key={fare.code} className="flex flex-col rounded-xl border bg-card p-4">
                  <span className="text-xs font-bold uppercase tracking-wider text-primary">
                    {fare.code === 'BUSINESS'
                      ? t('section.plan.cabinBusiness')
                      : t('section.plan.cabinEconomy')}
                  </span>
                  <span className="mt-1 font-display text-lg italic">{fare.name}</span>
                  <span className="mt-2 text-sm text-muted-foreground">
                    {t('section.plan.baggageKg', { kg: fare.baggageKg })}
                  </span>
                  <span className="mt-1 text-xs text-muted-foreground">
                    {fare.changesAllowed
                      ? t('section.plan.changesYes')
                      : t('section.plan.changesNo')}{' '}
                    · {fare.refundable ? t('section.plan.refundYes') : t('section.plan.refundNo')}
                  </span>
                  <Link
                    href="/experience?tab=cabins"
                    className="mt-3 text-xs font-medium text-primary hover:underline"
                  >
                    {t('menu.exp.action2')}
                  </Link>
                </li>
              ))}
              {(fares ?? []).length === 0 && (
                <li className="col-span-full rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
                  {t('home.status.unreachable')}
                </li>
              )}
            </ul>
          </div>
        </div>
      )}

      {active === 'holidays' && (
        <div className="space-y-6">
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {t('section.holidays.body')}
          </p>
          <ul className="grid gap-4 sm:grid-cols-3">
            {HOLIDAY_CARDS.map((card) => (
              <li key={card.dest}>
                <Link
                  href={`/flights?destination=${card.dest}&trip=oneway`}
                  className="group relative block h-56 overflow-hidden rounded-xl"
                >
                  <SitePhoto src={siteImage(site, card.img)} alt="" className="absolute inset-0" />
                  <span
                    className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent"
                    aria-hidden="true"
                  />
                  <span className="absolute inset-x-4 bottom-4 text-white">
                    <span
                      className="mb-1.5 block h-0.5 w-6 rounded-full bg-primary"
                      aria-hidden="true"
                    />
                    <span className="block font-display text-xl italic">{t(card.titleKey)}</span>
                    <span className="mt-1 block text-xs text-white/85">
                      {t('section.holidays.fromAirport', { code: card.dest })}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="rounded-xl border bg-card p-5">
            <h2 className="font-display text-lg italic">{t('section.holidays.quoteTitle')}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{t('section.holidays.quoteBody')}</p>
            <Link
              href="/manage?tab=support"
              className="mt-3 inline-block rounded-sm border px-5 py-2.5 text-sm font-semibold hover:border-primary hover:text-primary"
            >
              {t('menu.rew.contact')}
            </Link>
          </div>
        </div>
      )}

      {active === 'checklist' && (
        <div className="grid gap-4 md:grid-cols-2">
          <InfoBlock id="documents" title={t('section.check.documents')}>
            <p>{t('section.check.documentsBody')}</p>
          </InfoBlock>
          <InfoBlock id="eta" title={t('section.check.eta')}>
            <p>{t('section.check.etaBody')}</p>
          </InfoBlock>
          <InfoBlock id="health" title={t('section.check.health')}>
            <p>{t('section.check.healthBody')}</p>
          </InfoBlock>
          <InfoBlock id="money" title={t('section.check.money')}>
            <p>{t('section.check.moneyBody')}</p>
          </InfoBlock>
          <InfoBlock id="baggage" title={t('section.check.baggage')}>
            <p>
              {t('section.check.baggageBody', {
                kg: allowance?.baggageKg ?? 23,
                carry: allowance?.carryOnKg ?? 7,
              })}
            </p>
          </InfoBlock>
          <InfoBlock id="pets" title={t('section.check.pets')}>
            <p>{t('section.check.petsBody')}</p>
          </InfoBlock>
          <InfoBlock id="restricted" title={t('section.check.restricted')}>
            <p>{t('section.check.restrictedBody')}</p>
          </InfoBlock>
          <InfoBlock id="support" title={t('section.check.helpTitle')}>
            <p>{t('section.check.helpBody')}</p>
            <Link
              href="/manage?tab=support"
              className="inline-block text-sm font-medium text-primary hover:underline"
            >
              {t('nav.help')} →
            </Link>
          </InfoBlock>
        </div>
      )}

      {active === 'groups' && (
        <div className="space-y-5">
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {t('section.groups.body')}
          </p>
          <ul className="grid gap-4 sm:grid-cols-3">
            {[
              { titleKey: 'section.groups.tenPlus', bodyKey: 'section.groups.tenPlusBody' },
              { titleKey: 'section.groups.corporate', bodyKey: 'section.groups.corporateBody' },
              { titleKey: 'section.groups.students', bodyKey: 'section.groups.studentsBody' },
            ].map((card) => (
              <li key={card.titleKey} className="rounded-xl border bg-card p-5">
                <h3 className="font-display text-lg italic text-foreground">{t(card.titleKey)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {t(card.bodyKey)}
                </p>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/manage?tab=support"
              className="rounded-sm bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              {t('menu.rew.contact')}
            </Link>
            <Link
              href="/flights?trip=multicity"
              className="rounded-sm border px-5 py-2.5 text-sm font-semibold hover:border-primary hover:text-primary"
            >
              {t('menu.book.multicity')}
            </Link>
          </div>
        </div>
      )}
    </SectionShell>
  );
}
