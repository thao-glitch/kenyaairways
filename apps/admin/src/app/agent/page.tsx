import type { Metadata } from 'next';
import { AgentConsole } from '@/components/staff/agent-console';
import { RequireRole } from '@/components/staff/require-role';
import { getTranslator } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t('staff.agent.title') };
}

/** Agent desk (AGENT/ADMIN): book on the customer's behalf, look up any PNR. */
export default function AgentPage() {
  return (
    <RequireRole allow={['AGENT', 'ADMIN']}>
      <AgentConsole />
    </RequireRole>
  );
}
