import type { Metadata } from 'next';
import { AdminConsole } from '@/components/staff/admin-console';
import { RequireRole } from '@/components/staff/require-role';
import { getTranslator } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t('staff.admin.title') };
}

/** Admin console (ADMIN): paginated user directory. */
export default function AdminPage() {
  return (
    <RequireRole allow={['ADMIN']}>
      <AdminConsole />
    </RequireRole>
  );
}
