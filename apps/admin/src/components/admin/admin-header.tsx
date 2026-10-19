import Link from 'next/link';
import { getTranslator } from '@/lib/i18n';
import { getSiteSettings } from '@/lib/site';
import { AdminSession } from './admin-session';

/**
 * Console header: live app name (from site settings, so a rename in the
 * appearance console shows up here on the next navigation) + section nav.
 */
export async function AdminHeader() {
  const { t } = await getTranslator();
  const site = await getSiteSettings();
  const name = site?.appName?.trim() || t('app.name');
  const links = [
    { href: '/admin', label: t('nav.admin') },
    { href: '/pricing', label: t('staff.pricing.nav') },
    { href: '/bookings', label: t('staff.bookings.nav') },
    { href: '/agent', label: t('nav.agent') },
    { href: '/ops', label: t('nav.ops') },
    { href: '/finance', label: t('nav.finance') },
  ];
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
        <Link href="/" className="shrink-0 font-semibold tracking-tight">
          {name}
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            / {t('staff.console.label')}
          </span>
        </Link>
        <nav className="hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto">
          <AdminSession />
        </div>
      </div>
    </header>
  );
}
