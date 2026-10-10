import Link from 'next/link';
import { BrandMark } from '@/components/art/brand-mark';
import { getTranslator } from '@/lib/i18n';
import { setLocaleAction } from '@/app/actions';
import { SessionNav } from '@/components/session-nav';

/**
 * Mobile-first header: brand, flight search + manage-booking nav, live
 * session island (sign-in/out), locale switcher.
 */
export async function SiteHeader() {
  const { t, locale } = await getTranslator();

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold" aria-label={t('app.name')}>
          <BrandMark className="h-8 w-8" />
          <span className="text-base">{t('app.name')}</span>
        </Link>

        <div className="flex items-center gap-2">
          <nav className="flex items-center gap-1" aria-label={t('nav.home')}>
            <Link
              href="/flights"
              className="rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              {t('nav.flights')}
            </Link>
            <Link
              href="/pnr"
              className="hidden rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground sm:block"
            >
              {t('nav.manage')}
            </Link>
          </nav>
          <SessionNav />
          <form
            action={setLocaleAction}
            className="flex items-center gap-1"
            aria-label={t('nav.language')}
          >
            <input type="hidden" name="locale" value="en-KE" />
            <button
              type="submit"
              aria-label="English"
              className={`rounded px-2 py-1 text-xs font-medium ${
                locale === 'en-KE'
                  ? 'bg-secondary text-secondary-foreground'
                  : 'text-muted-foreground'
              }`}
            >
              {t('nav.english')}
            </button>
          </form>
          <form
            action={setLocaleAction}
            className="flex items-center gap-1"
            aria-label={t('nav.language')}
          >
            <input type="hidden" name="locale" value="sw-KE" />
            <button
              type="submit"
              aria-label="Kiswahili"
              className={`rounded px-2 py-1 text-xs font-medium ${
                locale === 'sw-KE'
                  ? 'bg-secondary text-secondary-foreground'
                  : 'text-muted-foreground'
              }`}
            >
              {t('nav.swahili')}
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
