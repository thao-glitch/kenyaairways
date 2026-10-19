import type { Metadata } from 'next';
import { LoginForm } from '@/components/auth/login-form';
import { getTranslator } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t('auth.login.title') };
}

/** Staff sign-in (standalone console). */
export default function LoginPage() {
  return <LoginForm />;
}
