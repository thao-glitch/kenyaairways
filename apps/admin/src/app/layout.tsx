import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AdminHeader } from '@/components/admin/admin-header';
import { I18nProvider } from '@/components/i18n-provider';
import { catalogs, getTranslator } from '@/lib/i18n';
import { getSiteSettings } from '@/lib/site';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  const site = await getSiteSettings();
  const name = site?.appName?.trim() || t('app.name');
  return {
    title: {
      default: `${name} — ${t('staff.console.label')}`,
      template: `%s · ${name}`,
    },
    applicationName: name,
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1220' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { t, locale } = await getTranslator();
  const site = await getSiteSettings();
  return (
    <html lang={locale} data-theme={site?.theme ?? 'sky'}>
      <body className="flex min-h-dvh flex-col">
        <a href="#main" className="skip-link">
          {t('a11y.skipToContent')}
        </a>
        <I18nProvider locale={locale} messages={catalogs[locale]}>
          <AdminHeader />
          <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
            {children}
          </main>
        </I18nProvider>
      </body>
    </html>
  );
}
