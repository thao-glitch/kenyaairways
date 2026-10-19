import { BrandMark } from '@/components/art/brand-mark';
import { getTranslator } from '@/lib/i18n';
import { getSiteSettings } from '@/lib/site';

export async function SiteFooter() {
  const { t } = await getTranslator();
  // Live admin renames flow into the copyright line too (short TTL, lib/site).
  const site = await getSiteSettings();
  const name = site?.appName?.trim() || t('app.name');
  return (
    <footer className="mt-12 border-t">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <BrandMark className="h-6 w-6" />
          <p>{t('footer.rights', { name })}</p>
        </div>
        <div className="flex flex-col gap-1 sm:items-end">
          <p className="text-xs">{t('footer.licensed')}</p>
          <p className="text-xs">{t('footer.devNote')}</p>
        </div>
      </div>
    </footer>
  );
}
