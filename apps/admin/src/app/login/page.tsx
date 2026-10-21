import { Suspense } from 'react';
import type { Metadata } from 'next';
import { LoginForm } from '@/components/auth/login-form';
import { getTranslator } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t('auth.login.title') };
}

/** Staff sign-in (standalone console). */
export default function LoginPage() {
  // Suspense boundary around useSearchParams — required for the static
  // export build (the APK bundle), invisible in the server build.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
