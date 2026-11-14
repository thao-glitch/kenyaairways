import type { Metadata, Viewport } from 'next';
import './globals.css';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { EdgeWidgets } from '@/components/edge-widgets';
import { I18nProvider } from '@/components/i18n-provider';
import { PwaRegister } from '@/components/pwa-register';
import { catalogs, getTranslator } from '@/lib/i18n';
import { getSiteSettings } from '@/lib/site';
import { absoluteUrl, siteUrl } from '@/lib/site-url';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  // Live admin renames flow through site settings (short TTL, see lib/site);
  // the catalog value is only the fallback before settings ever load.
  const site = await getSiteSettings();
  const name = site?.appName?.trim() || t('app.name');
  return {
    // Relative OG/Twitter image URLs resolve against this, so every absolute
    // URL we emit points at the one canonical origin (see lib/site-url).
    metadataBase: new URL(siteUrl()),
    title: {
      default: `${name} — ${t('app.tagline')}`,
      template: `%s · ${name}`,
    },
    description: t('home.hero.subtitle'),
    applicationName: name,
    robots: { index: true, follow: true },
    // Only page-agnostic fields live here. `title`, `description` and `url`
    // are deliberately absent: metadata merges shallowly, so a root-level
    // `openGraph` object is inherited verbatim by every page that does not
    // define its own — setting them here would stamp the homepage title and
    // og:url onto all of them.
    openGraph: {
      type: 'website',
      siteName: name,
      locale: 'en_KE',
      images: [{ url: '/og.jpg', width: 1200, height: 630, alt: name }],
    },
    twitter: {
      card: 'summary_large_image',
      images: ['/og.jpg'],
    },
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
  const name = site?.appName?.trim() || t('app.name');

  // Structured data so Google understands *what* this site is (an airline
  // booking site) instead of guessing from markup alone — the first step
  // toward showing up for "Kenya Airways" style queries rather than only
  // exact URL hits. Rendered as a native <script> in the body: JSON-LD is
  // data, not executable code (next/scripts/json-ld guide).
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Airline',
    name,
    url: siteUrl(),
    logo: absoluteUrl('/brand/kenya-airways-logo.svg'),
    description: t('home.hero.subtitle'),
    slogan: t('app.tagline'),
  };

  return (
    <html lang={locale} data-theme={site?.theme ?? 'sky'}>
      <body className="flex min-h-dvh flex-col">
        <script
          type="application/ld+json"
          // Scrub `<` so an admin-entered name can never break out of the tag.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
        />
        <a href="#main" className="skip-link">
          {t('a11y.skipToContent')}
        </a>
        <I18nProvider locale={locale} messages={catalogs[locale]}>
          <SiteHeader />
          <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
            {children}
          </main>
          {/* Fixed-position furniture — inside the provider for useT(). */}
          <EdgeWidgets />
        </I18nProvider>
        <SiteFooter />
        <PwaRegister />
      </body>
    </html>
  );
}
