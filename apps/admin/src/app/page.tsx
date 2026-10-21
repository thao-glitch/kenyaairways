import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslator } from '@/lib/i18n';
import { getSiteSettings } from '@/lib/site';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  const site = await getSiteSettings();
  const name = site?.appName?.trim() || t('app.name');
  // The root index segment bypasses the layout title template, so the
  // "· app name" suffix is composed here as an absolute title.
  return { title: { absolute: `${t('staff.console.home.title')} · ${name}` } };
}

const CARDS = [
  { href: '/admin', label: 'nav.admin', desc: 'staff.console.card.directory' },
  { href: '/pricing', label: 'staff.pricing.nav', desc: 'staff.console.card.pricing' },
  { href: '/bookings', label: 'staff.bookings.nav', desc: 'staff.console.card.bookings' },
  { href: '/agent', label: 'nav.agent', desc: 'staff.console.card.agent' },
  { href: '/ops', label: 'nav.ops', desc: 'staff.console.card.ops' },
  { href: '/finance', label: 'nav.finance', desc: 'staff.console.card.finance' },
] as const;

/** Console home: every staff tool in one place. */
export default async function ConsoleHome() {
  const { t } = await getTranslator();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('staff.console.home.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('staff.console.home.subtitle')}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="group rounded-lg border bg-card p-5 shadow-sm transition hover:border-primary/50 hover:shadow"
          >
            <div className="font-medium group-hover:text-primary">{t(c.label)}</div>
            <p className="mt-1 text-sm text-muted-foreground">{t(c.desc)}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
