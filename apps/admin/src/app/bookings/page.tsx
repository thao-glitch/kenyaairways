import type { Metadata } from 'next';
import { BookingsConsole } from '@/components/admin/bookings-console';
import { RequireRole } from '@/components/staff/require-role';
import { getTranslator } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t('staff.bookings.title') };
}

/** Booking directory (ADMIN/AGENT/FINANCE): search, pay directly, issue. */
export default function BookingsPage() {
  return (
    <RequireRole allow={['ADMIN', 'AGENT', 'FINANCE']}>
      <BookingsConsole />
    </RequireRole>
  );
}
