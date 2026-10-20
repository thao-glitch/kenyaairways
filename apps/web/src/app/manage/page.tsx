import type { SiteSettingsDto } from '@kenyaairways/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PnrLookup } from '@/components/pnr-lookup';
import { SectionShell, type SectionTab } from '@/components/section-shell';
import { getTranslator } from '@/lib/i18n';
import { getSiteSettings } from '@/lib/site';
import { siteImage } from '@/lib/site-images';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const metadata: Metadata = { title: 'Book & manage' };

const TABS = ['find', 'checkin', 'changes', 'support'] as const;
type Tab = (typeof TABS)[number];

const CHECKIN_STEPS = ['stepSearch', 'stepPassengers', 'stepSeats', 'stepPass'] as const;

const CHANGE_BLOCKS = [
  { id: 'change', titleKey: 'section.changes.change', bodyKey: 'section.changes.changeBody' },
  { id: 'refunds', titleKey: 'section.changes.refunds', bodyKey: 'section.changes.refundsBody' },
  { id: 'delays', titleKey: 'section.changes.delays', bodyKey: 'section.changes.delaysBody' },
] as const;

const FAQS = [
  { qKey: 'section.support.q1', aKey: 'section.support.a1' },
  { qKey: 'section.support.q2', aKey: 'section.support.a2' },
  { qKey: 'section.support.q3', aKey: 'section.support.a3' },
  { qKey: 'section.support.q4', aKey: 'section.support.a4' },
] as const;

export default async function ManagePage({ searchParams }: { searchParams: SearchParams }) {
  const { t } = await getTranslator();
  const sp = await searchParams;
  const raw = typeof sp.tab === 'string' ? sp.tab : '';
  const active: Tab = (TABS as readonly string[]).includes(raw) ? (raw as Tab) : 'find';

  const site: SiteSettingsDto | null = await getSiteSettings();

  const tabs: SectionTab[] = [
    { href: '/manage?tab=find', label: t('section.manage.find'), active: active === 'find' },
    {
      href: '/manage?tab=checkin',
      label: t('section.manage.checkin'),
      active: active === 'checkin',
    },
    {
      href: '/manage?tab=changes',
      label: t('section.manage.changes'),
      active: active === 'changes',
    },
    {
      href: '/manage?tab=support',
      label: t('section.manage.support'),
      active: active === 'support',
    },
  ];

  return (
    <SectionShell
      title={t('section.manage.title')}
      intro={t('section.manage.intro')}
      image={siteImage(site, 'manage')}
      tabs={tabs}
    >
      {active === 'find' && (
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <h2 className="font-display text-xl italic">{t('section.manage.findTitle')}</h2>
            <p className="mb-4 mt-2 text-sm text-muted-foreground">
              {t('section.manage.findBody')}
            </p>
            <PnrLookup />
          </div>
          <aside className="rounded-xl border bg-card p-5 lg:col-span-2">
            <h3 className="font-display text-lg italic">{t('section.manage.tipsTitle')}</h3>
            <ul className="mt-3 space-y-3 text-sm text-muted-foreground">
              <li>{t('section.manage.tip1')}</li>
              <li>{t('section.manage.tip2')}</li>
              <li>{t('section.manage.tip3')}</li>
            </ul>
          </aside>
        </div>
      )}

      {active === 'checkin' && (
        <div className="space-y-6">
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {CHECKIN_STEPS.map((step, index) => (
              <li key={step} className="rounded-xl border bg-card p-4">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  {index + 1}
                </span>
                <p className="mt-2 text-sm font-semibold text-foreground">
                  {t(`section.checkin.${step}`)}
                </p>
                <p className="mt-1 text-xs leading-snug text-muted-foreground">
                  {t(`section.checkin.${step}Body`)}
                </p>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/pnr"
              className="rounded-sm bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              {t('menu.book.checkin')}
            </Link>
            <Link
              href="/status"
              className="rounded-sm border px-5 py-2.5 text-sm font-semibold hover:border-primary hover:text-primary"
            >
              {t('nav.status')}
            </Link>
          </div>
        </div>
      )}

      {active === 'changes' && (
        <div className="space-y-4">
          {CHANGE_BLOCKS.map((block) => (
            <section
              key={block.id}
              id={block.id}
              className="scroll-mt-32 rounded-xl border bg-card p-5"
            >
              <h2 className="font-display text-xl italic text-foreground">{t(block.titleKey)}</h2>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                {t(block.bodyKey)}
              </p>
            </section>
          ))}
          <div className="flex flex-wrap gap-3">
            <Link
              href="/pnr"
              className="rounded-sm bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              {t('menu.book.find')}
            </Link>
            <Link
              href="/manage?tab=support"
              className="rounded-sm border px-5 py-2.5 text-sm font-semibold hover:border-primary hover:text-primary"
            >
              {t('nav.help')}
            </Link>
          </div>
        </div>
      )}

      {active === 'support' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <section className="rounded-xl border bg-card p-5">
              <h2 className="font-display text-xl italic text-foreground">
                {t('section.support.faqTitle')}
              </h2>
              <dl className="mt-3 divide-y divide-border">
                {FAQS.map((faq) => (
                  <div key={faq.qKey} className="py-3 first:pt-0 last:pb-0">
                    <dt className="text-sm font-semibold text-foreground">{t(faq.qKey)}</dt>
                    <dd className="mt-1 text-sm text-muted-foreground">{t(faq.aKey)}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section id="specials" className="scroll-mt-32 rounded-xl border bg-card p-5">
              <h2 className="font-display text-xl italic text-foreground">
                {t('section.support.specialsTitle')}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {t('section.support.specialsBody')}
              </p>
            </section>
          </div>

          <div className="space-y-4">
            <section
              id="payment"
              className="scroll-mt-32 rounded-xl border border-primary/40 bg-accent/40 p-5"
            >
              <h2 className="font-display text-xl italic text-foreground">
                {t('section.support.paymentTitle')}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {t('section.support.paymentBody')}
              </p>
              {site?.mpesaPaybill && (
                <p className="mt-3 rounded-lg bg-background/70 px-4 py-3 text-sm">
                  <span className="text-muted-foreground">{t('pay.manual.paybill')}: </span>
                  <span className="font-bold tracking-widest text-foreground">
                    {site.mpesaPaybill}
                  </span>
                </p>
              )}
            </section>

            <section className="rounded-xl border bg-card p-5">
              <h2 className="font-display text-xl italic text-foreground">
                {t('section.support.channelsTitle')}
              </h2>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                <li>{t('section.support.channel1')}</li>
                <li>{t('section.support.channel2')}</li>
                <li>{t('section.support.channel3')}</li>
              </ul>
              <Link
                href="/pnr"
                className="mt-4 inline-block rounded-sm bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
              >
                {t('menu.book.find')}
              </Link>
            </section>
          </div>
        </div>
      )}
    </SectionShell>
  );
}
