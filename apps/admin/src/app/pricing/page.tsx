import type { Metadata } from 'next';
import { PricingConsole } from '@/components/admin/pricing-console';
import { RequireRole } from '@/components/staff/require-role';
import { getTranslator } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t('staff.pricing.title') };
}

/** Price manager (ADMIN/FINANCE): every fare, changed live. */
export default function PricingPage() {
  return (
    <RequireRole allow={['ADMIN', 'FINANCE']}>
      <PricingConsole />
    </RequireRole>
  );
}
