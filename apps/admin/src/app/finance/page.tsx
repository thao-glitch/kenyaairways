import type { Metadata } from 'next';
import { FinanceConsole } from '@/components/staff/finance-console';
import { RequireRole } from '@/components/staff/require-role';
import { getTranslator } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t('staff.finance.title') };
}

/** Finance console (FINANCE/ADMIN): revenue, load factor and OTP-gated refunds. */
export default function FinancePage() {
  return (
    <RequireRole allow={['FINANCE', 'ADMIN']}>
      <FinanceConsole />
    </RequireRole>
  );
}
