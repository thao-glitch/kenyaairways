import Link from 'next/link';
import { getTranslator } from '@/lib/i18n';

export default async function NotFound() {
  const { t } = await getTranslator();
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
      <p className="text-5xl font-bold">404</p>
      <p className="text-muted-foreground">{t('home.status.unreachable')}</p>
      <Link
        href="/"
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        {t('nav.home')}
      </Link>
    </div>
  );
}
