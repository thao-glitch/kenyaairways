import type { Metadata } from 'next';
import { PassPanel } from '@/components/pass-panel';
import { getTranslator } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  // Owner-scoped boarding pass — private, and would 404 for a crawler.
  return { title: t('pass.title'), robots: { index: false, follow: false } };
}

/** Printable boarding pass (owner-scoped, fetched client-side with cookies). */
export default async function BoardingPassPage({ params }: { params: Params }) {
  const { id } = await params;
  const { t } = await getTranslator();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold sm:text-2xl">{t('pass.title')}</h1>
      <PassPanel passId={id} />
    </div>
  );
}
