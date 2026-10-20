import Link from 'next/link';
import type { ReactNode } from 'react';
import { LogoRoundel } from '@/components/art/logo-roundel';
import { getTranslator } from '@/lib/i18n';
import { getSiteSettings } from '@/lib/site';

type FooterLink = { href: string; labelKey: string };
type FooterColumn = { titleKey: string; links: FooterLink[] };

/** Eight link columns mirroring the reference mega-footer, all real routes. */
const COLUMNS: FooterColumn[] = [
  {
    titleKey: 'footer.col.book',
    links: [
      { href: '/flights', labelKey: 'menu.book.flight' },
      { href: '/#deals', labelKey: 'menu.book.deals' },
      { href: '/flights?trip=multicity', labelKey: 'menu.book.multicity' },
      { href: '/plan?tab=holidays', labelKey: 'menu.book.holidays' },
    ],
  },
  {
    titleKey: 'footer.col.manage',
    links: [
      { href: '/pnr', labelKey: 'menu.book.find' },
      { href: '/manage?tab=checkin', labelKey: 'menu.book.checkin' },
      { href: '/manage?tab=changes', labelKey: 'menu.book.change' },
      { href: '/alerts', labelKey: 'nav.alerts' },
    ],
  },
  {
    titleKey: 'footer.col.info',
    links: [
      { href: '/status', labelKey: 'nav.status' },
      { href: '/explore?tab=destinations', labelKey: 'menu.book.where' },
      { href: '/plan?tab=checklist', labelKey: 'menu.plan.action1' },
      { href: '/plan?tab=groups', labelKey: 'menu.plan.groups' },
    ],
  },
  {
    titleKey: 'footer.col.experience',
    links: [
      { href: '/experience?tab=fleet', labelKey: 'menu.exp.action1' },
      { href: '/experience?tab=cabins', labelKey: 'menu.exp.action2' },
      { href: '/experience?tab=service', labelKey: 'menu.exp.service' },
      { href: '/experience?tab=service#lounge', labelKey: 'menu.exp.lounges' },
    ],
  },
  {
    titleKey: 'footer.col.rewards',
    links: [
      { href: '/rewards', labelKey: 'nav.rewards' },
      { href: '/rewards?tab=tiers', labelKey: 'menu.rew.action1' },
      { href: '/rewards?tab=earn', labelKey: 'menu.rew.earning' },
      { href: '/rewards?tab=redeem', labelKey: 'menu.rew.redeem' },
    ],
  },
  {
    titleKey: 'footer.col.company',
    links: [
      { href: '/explore?tab=about', labelKey: 'util.about' },
      { href: '/explore?tab=network', labelKey: 'section.explore.network' },
      { href: '/plan?tab=holidays', labelKey: 'menu.explore.action1' },
      { href: '/manage?tab=support', labelKey: 'menu.rew.contact' },
    ],
  },
  {
    titleKey: 'footer.col.support',
    links: [
      { href: '/manage?tab=support', labelKey: 'nav.help' },
      { href: '/manage?tab=support#specials', labelKey: 'menu.plan.action2' },
      { href: '/manage?tab=support#payment', labelKey: 'menu.book.payment' },
      { href: '/pnr', labelKey: 'menu.book.action2' },
    ],
  },
  {
    titleKey: 'footer.col.legal',
    links: [
      { href: '/legal#privacy', labelKey: 'legal.sec.privacy' },
      { href: '/legal#carriage', labelKey: 'legal.sec.carriage' },
      { href: '/legal#cookies', labelKey: 'legal.sec.cookies' },
      { href: '/legal#refunds', labelKey: 'legal.sec.refunds' },
    ],
  },
];

const SOCIAL: { labelKey: string; path: string; href: string }[] = [
  { labelKey: 'footer.social.x', path: 'M5 5l14 14M19 5L5 19', href: 'https://x.com' },
  {
    labelKey: 'footer.social.facebook',
    path: 'M14 8h3V4h-3c-2.2 0-4 1.8-4 4v2H7v4h3v8h4v-8h3l1-4h-4V8c0-.6.4-1 1-1z',
    href: 'https://www.facebook.com',
  },
  {
    labelKey: 'footer.social.instagram',
    path: 'M5 8a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM17 7.5v.01',
    href: 'https://www.instagram.com',
  },
  {
    labelKey: 'footer.social.youtube',
    path: 'M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5zM10 9.5l5 2.5-5 2.5z',
    href: 'https://www.youtube.com',
  },
  {
    labelKey: 'footer.social.linkedin',
    path: 'M6.5 10.5V19M6.5 5.5v.01M11 19v-5c0-1.7 1.3-3 3-3s3 1.3 3 3v5',
    href: 'https://www.linkedin.com',
  },
];

/** App-store badges (presentational — real store listings don't exist yet). */
function StoreBadge({ icon, small, big }: { icon: ReactNode; small: string; big: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-md border border-white/25 px-3 py-1.5 text-white">
      <span aria-hidden="true" className="h-5 w-5 shrink-0">
        {icon}
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-[9px] uppercase tracking-wide text-white/60">{small}</span>
        <span className="text-xs font-semibold">{big}</span>
      </span>
    </span>
  );
}

/**
 * Black mega-footer: eight link columns, brand + social row, store badges,
 * gold medallions, legal row and the live-name copyright line.
 */
export async function SiteFooter() {
  const { t } = await getTranslator();
  // Live admin renames flow into the copyright line too (short TTL, lib/site).
  const site = await getSiteSettings();
  const name = site?.appName?.trim() || t('app.name');

  return (
    <footer className="mt-12 bg-[#0D0D10] text-white/70">
      <div className="mx-auto w-full max-w-6xl px-4 py-12">
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
          {COLUMNS.map((col) => (
            <div key={col.titleKey}>
              <h3 className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-white">
                {t(col.titleKey)}
              </h3>
              <ul className="space-y-2 text-sm">
                {col.links.map((link, index) => (
                  <li key={`${link.href}-${index}`}>
                    <Link href={link.href} className="transition-colors hover:text-primary">
                      {t(link.labelKey)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Brand, socials, store badges, medallions. */}
        <div className="mt-10 flex flex-col gap-6 border-t border-white/10 pt-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <LogoRoundel className="h-11 w-11" />
            <div>
              <p className="font-display text-lg italic text-white">{name}</p>
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/50">
                {t('app.tagline')}
              </p>
            </div>
            <div className="ml-2 flex items-center gap-1" aria-label={t('footer.social.aria')}>
              {SOCIAL.map((icon) => (
                <a
                  key={icon.labelKey}
                  href={icon.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t(icon.labelKey)}
                  title={t(icon.labelKey)}
                  className="rounded-full p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-primary"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="h-4 w-4"
                  >
                    <path d={icon.path} />
                  </svg>
                </a>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <StoreBadge
              icon={
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-5 w-5">
                  <path d="M16.4 12.6c0-2 1.6-3 1.7-3.1-.9-1.4-2.4-1.5-2.9-1.6-1.2-.1-2.4.7-3 .7-.6 0-1.6-.7-2.6-.7-1.3 0-2.6.8-3.3 2-1.4 2.4-.4 6 1 8 .7 1 1.5 2 2.6 2 1 0 1.4-.7 2.6-.7 1.2 0 1.5.7 2.6.6 1.1 0 1.8-1 2.4-1.9.8-1.1 1.1-2.2 1.1-2.2-.1 0-2.2-.9-2.2-3.1zM14.6 6.7c.5-.7.9-1.6.8-2.6-.8.1-1.8.6-2.4 1.3-.5.6-1 1.6-.8 2.5.9.1 1.8-.4 2.4-1.2z" />
                </svg>
              }
              small={t('footer.badge.download')}
              big="App Store"
            />
            <StoreBadge
              icon={
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-5 w-5">
                  <path d="M5 3.5v17l11-8.5-11-8.5zM16.8 11.4l2.7 1.6-2.7 1.6-1.7-1.6 1.7-1.6z" />
                </svg>
              }
              small={t('footer.badge.get')}
              big="Google Play"
            />
          </div>

          <div className="flex items-center gap-3">
            <span className="flex h-14 w-14 flex-col items-center justify-center rounded-full border-2 border-amber-400/70 bg-gradient-to-b from-amber-200/25 to-amber-500/25 text-amber-100">
              <span className="font-display text-sm italic">F13</span>
            </span>
            <span className="flex h-14 w-14 flex-col items-center justify-center rounded-full border-2 border-amber-400/70 bg-gradient-to-b from-amber-200/25 to-amber-500/25 text-center text-amber-100">
              <span className="text-[8px] font-bold uppercase leading-tight tracking-wider">
                {t('footer.award')}
              </span>
            </span>
          </div>
        </div>

        {/* Legal row. */}
        <div className="mt-8 flex flex-col gap-4 border-t border-white/10 pt-6 text-xs lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/legal#privacy" className="transition-colors hover:text-primary">
              {t('legal.sec.privacy')}
            </Link>
            <Link href="/legal#carriage" className="transition-colors hover:text-primary">
              {t('legal.sec.carriage')}
            </Link>
            <Link href="/legal#cookies" className="transition-colors hover:text-primary">
              {t('legal.sec.cookies')}
            </Link>
            <Link href="/legal#refunds" className="transition-colors hover:text-primary">
              {t('legal.sec.refunds')}
            </Link>
            <Link href="/legal" className="transition-colors hover:text-primary">
              {t('footer.legalHub')}
            </Link>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-white/50">
            <span>{t('footer.licensed')}</span>
          </div>
        </div>

        <p className="mt-4 text-xs text-white/50">{t('footer.rights', { name })}</p>
      </div>
    </footer>
  );
}
