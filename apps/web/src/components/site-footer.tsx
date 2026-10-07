import { getTranslator } from '@/lib/i18n';

export async function SiteFooter() {
  const { t } = await getTranslator();
  return (
    <footer className="mt-12 border-t">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>{t('footer.rights')}</p>
        <p className="text-xs">{t('footer.devNote')}</p>
      </div>
    </footer>
  );
}
