import type { Metadata } from 'next';
import { OpsConsole } from '@/components/staff/ops-console';
import { RequireRole } from '@/components/staff/require-role';
import { getTranslator } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t('staff.ops.title') };
}

/** Operations console (OPS/ADMIN): flight board, status control, KCAA manifest. */
export default function OpsPage() {
  return (
    <RequireRole allow={['OPS', 'ADMIN']}>
      <OpsConsole />
    </RequireRole>
  );
}
