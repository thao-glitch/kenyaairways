import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth/auth-form';
import { getTranslator } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t('auth.login.title') };
}

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  return <AuthForm mode="login" next={first(sp.next)} />;
}
