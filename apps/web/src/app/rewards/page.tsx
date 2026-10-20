import type { Metadata } from 'next';
import Link from 'next/link';
import { SectionShell, type SectionTab } from '@/components/section-shell';
import { getTranslator } from '@/lib/i18n';
import { getSiteSettings } from '@/lib/site';
import { siteImage } from '@/lib/site-images';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const metadata: Metadata = { title: 'Pride Rewards' };

const TABS = ['about', 'tiers', 'earn', 'redeem'] as const;
type Tab = (typeof TABS)[number];

const TIERS = [
  { id: 'blue', threshold: '0' },
  { id: 'silver', threshold: '20,000' },
  { id: 'gold', threshold: '50,000' },
  { id: 'platinum', threshold: '100,000' },
] as const;

const EARN_CARDS = [
  { id: 'flights', titleKey: 'section.earn.flights', bodyKey: 'section.earn.flightsBody' },
  { id: 'partners', titleKey: 'section.earn.partners', bodyKey: 'section.earn.partnersBody' },
] as const;

const REDEEM_CARDS = [
  { id: 'upgrades', titleKey: 'section.redeem.upgrades', bodyKey: 'section.redeem.upgradesBody' },
  { id: 'awards', titleKey: 'section.redeem.awards', bodyKey: 'section.redeem.awardsBody' },
  { id: 'faq', titleKey: 'section.redeem.faq', bodyKey: 'section.redeem.faqBody' },
] as const;

export default async function RewardsPage({ searchParams }: { searchParams: SearchParams }) {
  const { t } = await getTranslator();
  const sp = await searchParams;
  const raw = typeof sp.tab === 'string' ? sp.tab : '';
  const active: Tab = (TABS as readonly string[]).includes(raw) ? (raw as Tab) : 'about';

  const site = await getSiteSettings();

  const tabs: SectionTab[] = [
    { href: '/rewards', label: t('section.rewards.about'), active: active === 'about' },
    { href: '/rewards?tab=tiers', label: t('section.rewards.tiers'), active: active === 'tiers' },
    { href: '/rewards?tab=earn', label: t('section.rewards.earn'), active: active === 'earn' },
    {
      href: '/rewards?tab=redeem',
      label: t('section.rewards.redeem'),
      active: active === 'redeem',
    },
  ];

  return (
    <SectionShell
      title={t('section.rewards.title')}
      intro={t('section.rewards.intro')}
      image={siteImage(site, 'rewards')}
      tabs={tabs}
    >
      {active === 'about' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
              {t('section.rewards.aboutBody')}
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border bg-card p-4">
                <p className="font-display text-2xl italic text-primary">1×</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('section.rewards.perFlight')}
                </p>
              </div>
              <div className="rounded-xl border bg-card p-4">
                <p className="font-display text-2xl italic text-primary">4</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('section.rewards.fourTiers')}
                </p>
              </div>
              <div className="rounded-xl border bg-card p-4">
                <p className="font-display text-2xl italic text-primary">∞</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('section.rewards.noExpiry')}
                </p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">{t('section.rewards.joinBody')}</p>
          </div>
          <aside className="rounded-xl border border-primary/40 bg-accent/40 p-5">
            <h2 className="font-display text-lg italic text-foreground">{t('menu.rew.join')}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{t('section.rewards.joinAside')}</p>
            <Link
              href="/register"
              className="mt-4 inline-block rounded-sm bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              {t('menu.rew.join')}
            </Link>
          </aside>
        </div>
      )}

      {active === 'tiers' && (
        <div className="space-y-5">
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {t('section.rewards.tiersBody')}
          </p>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {TIERS.map((tier, index) => (
              <li
                key={tier.id}
                id={tier.id}
                className="flex scroll-mt-32 flex-col rounded-xl border bg-card p-5"
                style={index === 3 ? { borderColor: 'hsl(var(--primary))' } : undefined}
              >
                <span
                  className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold ${
                    index === 3
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-secondary-foreground'
                  }`}
                >
                  {index + 1}
                </span>
                <h2 className="mt-3 font-display text-lg italic text-foreground">
                  {t(`section.tier.${tier.id}`)}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('section.tiers.threshold', { miles: tier.threshold })}
                </p>
                <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                  <li>{t(`section.tier.${tier.id}P1`)}</li>
                  <li>{t(`section.tier.${tier.id}P2`)}</li>
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}

      {active === 'earn' && (
        <div className="space-y-5">
          <ul className="grid gap-4 sm:grid-cols-2">
            {EARN_CARDS.map((card) => (
              <li key={card.id} id={card.id} className="scroll-mt-32 rounded-xl border bg-card p-5">
                <h2 className="font-display text-lg italic text-foreground">{t(card.titleKey)}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {t(card.bodyKey)}
                </p>
              </li>
            ))}
          </ul>
          <div className="rounded-xl border bg-card p-5">
            <h2 className="font-display text-lg italic text-foreground">
              {t('section.earn.rateTitle')}
            </h2>
            <ul className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-3">
              <li>{t('section.earn.rateEconomy')}</li>
              <li>{t('section.earn.rateFlex')}</li>
              <li>{t('section.earn.rateBusiness')}</li>
            </ul>
          </div>
          <Link
            href="/register"
            className="inline-block rounded-sm bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            {t('menu.rew.join')}
          </Link>
        </div>
      )}

      {active === 'redeem' && (
        <div className="space-y-5">
          <ul className="grid gap-4 lg:grid-cols-3">
            {REDEEM_CARDS.map((card) => (
              <li key={card.id} id={card.id} className="scroll-mt-32 rounded-xl border bg-card p-5">
                <h2 className="font-display text-lg italic text-foreground">{t(card.titleKey)}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {t(card.bodyKey)}
                </p>
              </li>
            ))}
          </ul>
          <div className="rounded-xl border border-primary/40 bg-accent/40 p-5">
            <h2 className="font-display text-lg italic text-foreground">
              {t('section.redeem.ctaTitle')}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">{t('section.redeem.ctaBody')}</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                href="/flights"
                className="rounded-sm bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
              >
                {t('menu.book.flight')}
              </Link>
              <Link
                href="/legal#rewards"
                className="rounded-sm border px-5 py-2.5 text-sm font-semibold hover:border-primary hover:text-primary"
              >
                {t('menu.rew.terms')}
              </Link>
            </div>
          </div>
        </div>
      )}
    </SectionShell>
  );
}
