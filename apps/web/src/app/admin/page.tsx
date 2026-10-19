import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ADMIN_URL } from '@/lib/config';
import { getTranslator } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t('staff.admin.title') };
}

/** The admin console now lives in its own standalone app. */
export default function AdminPage() {
  redirect(`${ADMIN_URL}/admin`);
}
