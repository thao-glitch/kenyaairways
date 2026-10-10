import { BrandMark } from '@/components/art/brand-mark';
import { getTranslator } from '@/lib/i18n';

export async function SiteFooter() {
  const { t } = await getTranslator();
  return (
    <footer className="mt-12 border-t">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <BrandMark className="h-6 w-6" />
          <p>{t('footer.rights')}</p>
        </div>
        <div className="flex flex-col gap-1 sm:items-end">
          <p className="text-xs">{t('footer.licensed')}</p>
          <p className="text-xs">{t('footer.devNote')}</p>
        </div>
      </div>
    </footer>
  );
}
