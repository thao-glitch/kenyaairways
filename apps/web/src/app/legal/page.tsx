import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SectionShell } from '@/components/section-shell';
import { getTranslator } from '@/lib/i18n';
import { getSiteSettings } from '@/lib/site';
import { siteImage } from '@/lib/site-images';

export const metadata: Metadata = { title: 'Legal & policies' };

const SECTIONS = ['privacy', 'carriage', 'cookies', 'refunds', 'rewards', 'access'] as const;

function LegalBlock({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section
      id={id}
      className="scroll-mt-32 border-b border-border py-6 first:pt-0 last:border-b-0"
    >
      <h2 className="font-display text-2xl italic text-foreground">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

/**
 * Legal hub: one page with anchored sections (footer + rewards menu deep-link
 * straight to them). Copy is original and describes THIS product's real
 * behaviour — session cookies, fare-rule refunds, DSAR endpoints.
 */
export default async function LegalPage() {
  const { t, locale } = await getTranslator();
  const site = await getSiteSettings();
  const name = site?.appName?.trim() || t('app.name');
  const img = siteImage(site, 'manage');

  return (
    <SectionShell
      title={t('legal.title')}
      intro={t('legal.intro')}
      image={img}
      tabs={SECTIONS.map((id) => ({
        href: `/legal#${id}`,
        label: t(`legal.sec.${id}`),
      }))}
    >
      <LegalBlock id="privacy" title={t('legal.sec.privacy')}>
        <p>{t('legal.privacy.p1', { name })}</p>
        <p>{t('legal.privacy.p2')}</p>
        <p>{t('legal.privacy.p3')}</p>
      </LegalBlock>

      <LegalBlock id="carriage" title={t('legal.sec.carriage')}>
        <p>{t('legal.carriage.p1', { name })}</p>
        <p>{t('legal.carriage.p2')}</p>
      </LegalBlock>

      <LegalBlock id="cookies" title={t('legal.sec.cookies')}>
        <p>{t('legal.cookies.p1')}</p>
        <p>{t('legal.cookies.p2')}</p>
      </LegalBlock>

      <LegalBlock id="refunds" title={t('legal.sec.refunds')}>
        <p>{t('legal.refunds.p1')}</p>
        <p>{t('legal.refunds.p2')}</p>
      </LegalBlock>

      <LegalBlock id="rewards" title={t('legal.sec.rewards')}>
        <p>{t('legal.rewards.p1')}</p>
        <p>{t('legal.rewards.p2')}</p>
      </LegalBlock>

      <LegalBlock id="access" title={t('legal.sec.access')}>
        <p>{t('legal.access.p1')}</p>
        <p>{t('legal.access.p2')}</p>
      </LegalBlock>

      <p className="mt-6 text-xs text-muted-foreground">
        {t('legal.updated', { locale: locale === 'sw-KE' ? 'Kiswahili' : 'English' })}
      </p>
    </SectionShell>
  );
}
