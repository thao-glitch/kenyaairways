import type { Metadata } from 'next';
import { PnrLookup } from '@/components/pnr-lookup';
import { getTranslator } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t('pnr.title') };
}

/** Manage-booking entry point: PNR lookup → booking hub. */
export default async function PnrPage() {
  const { t } = await getTranslator();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">{t('pnr.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('pnr.subtitle')}</p>
      </div>
      <PnrLookup />
    </div>
  );
}
