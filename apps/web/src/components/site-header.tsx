import Link from 'next/link';
import { LogoRoundel } from '@/components/art/logo-roundel';
import { getTranslator } from '@/lib/i18n';
import { getSiteSettings } from '@/lib/site';
import { setLocaleAction } from '@/app/actions';
import { SessionNav } from '@/components/session-nav';
import { MegaNav, type PromoImageKey } from '@/components/mega-nav';
import { siteImage } from '@/lib/site-images';

/**
 * Airline-style header, mirroring the reference layout: a brand-red angled
 * block on the left (roundel + live app name + tagline) spanning a thin
 * utility row (Holidays · About · locale · account) above the main nav row
 * (mega menus + Help + search). Below `md` the block becomes a full-width
 * top banner and the rows stack beneath it.
 */
export async function SiteHeader() {
  const { t, locale } = await getTranslator();
  // Live admin renames: brand follows site settings, catalog is the fallback.
  const site = await getSiteSettings();
  const name = site?.appName?.trim() || t('app.name');

  const promoImages: Record<PromoImageKey, string> = {
    holidays: siteImage(site, 'holidays'),
    plan: siteImage(site, 'plan'),
    auth: siteImage(site, 'auth'),
    experience: siteImage(site, 'experience'),
    rewards: siteImage(site, 'rewards'),
  };

  const localeBtn = (value: 'en-KE' | 'sw-KE', label: string, active: boolean) => (
    <form action={setLocaleAction} aria-label={t('nav.language')}>
      <input type="hidden" name="locale" value={value} />
      <button
        type="submit"
        className={`px-1.5 py-1 text-xs font-semibold uppercase tracking-wide transition-colors ${
          active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        {label}
      </button>
    </form>
  );

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/90">
      <div className="relative">
        {/*
          Brand block: crimson gradient + gold bevel along the angled edge,
          pinstripes and a concentric-roundel watermark for depth. Active
          from `md` up (absolute, full header height); below that it is a
          full-width banner. Content must stay clear of the diagonal: the
          72px right padding keeps it inside the 80% cut at every height.
        */}
        <Link
          href="/"
          aria-label={name}
          className="group relative isolate flex items-center overflow-hidden text-primary-foreground md:absolute md:inset-y-0 md:left-0 md:z-10 md:w-[320px] md:[clip-path:polygon(0_0,100%_0,80%_100%,0_100%)] lg:w-[380px]"
        >
          {/* Gold bevel showing along the diagonal (footer-medallion gold). */}
          <span
            aria-hidden
            className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,#f7dd93_0%,#d8a62a_100%)]"
          />
          {/* Crimson fill, 3px short of the right edge so the bevel reads. */}
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 right-[3px] -z-10 bg-[linear-gradient(115deg,#ec2a41_0%,#da1b28_52%,#96091c_100%)]"
          />
          {/* Diagonal pinstripes. */}
          <span
            aria-hidden
            className="absolute inset-0 -z-10 bg-[repeating-linear-gradient(115deg,transparent_0_28px,rgba(255,255,255,0.05)_28px_30px)]"
          />
          {/* Concentric roundel watermark echoing the logo. */}
          <span
            aria-hidden
            className="absolute -right-8 top-1/2 -z-10 h-36 w-36 -translate-y-1/2 rounded-full border-[9px] border-white/10"
          />
          <span
            aria-hidden
            className="absolute -right-8 top-1/2 -z-10 h-20 w-20 -translate-y-1/2 rounded-full border-[5px] border-white/10"
          />

          <span className="relative flex min-w-0 items-center gap-3 px-4 py-3.5 md:px-6 md:py-4 md:pr-[72px]">
            <LogoRoundel className="h-10 w-10 shrink-0 drop-shadow-[0_2px_6px_rgba(0,0,0,0.35)]" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-display text-lg italic leading-tight tracking-tight md:text-xl">
                {name}
              </span>
              <span className="hidden items-center gap-2 lg:flex">
                <span aria-hidden className="h-px w-4 shrink-0 bg-[#f2cf7e]" />
                <span className="truncate text-[8px] font-semibold uppercase tracking-[0.14em] text-white/85">
                  {t('app.tagline')}
                </span>
              </span>
            </span>
          </span>
        </Link>

        <div className="flex flex-col md:pl-[320px] lg:pl-[380px]">
          {/* Utility row — Holidays / About / locale / account (reference bar). */}
          <div className="flex h-9 items-center justify-end gap-1 overflow-x-auto border-b border-border/60 px-3 [scrollbar-width:none] sm:gap-3 md:[scrollbar-width:none]">
            <Link
              href="/plan?tab=holidays"
              className="hidden shrink-0 text-xs font-medium text-muted-foreground transition-colors hover:text-primary lg:inline"
            >
              {t('util.holidays')}
            </Link>
            <Link
              href="/explore?tab=about"
              className="hidden shrink-0 text-xs font-medium text-muted-foreground transition-colors hover:text-primary lg:inline"
            >
              {t('util.about')}
            </Link>
            <span className="flex shrink-0 items-center" aria-label={t('nav.language')}>
              {localeBtn('en-KE', t('nav.english'), locale === 'en-KE')}
              <span className="text-border" aria-hidden="true">
                /
              </span>
              {localeBtn('sw-KE', t('nav.swahili'), locale === 'sw-KE')}
            </span>
            <span className="shrink-0">
              <SessionNav />
            </span>
          </div>

          {/* Main nav row — mega menus; horizontally scrollable on small screens. */}
          <div className="overflow-x-auto">
            <div className="flex min-w-max items-center px-2">
              <MegaNav promoImages={promoImages} />
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
