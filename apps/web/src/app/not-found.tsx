import Link from 'next/link';
import { SitePhoto } from '@/components/media/site-photo';
import { getTranslator } from '@/lib/i18n';
import { getSiteSettings } from '@/lib/site';
import { siteImage } from '@/lib/site-images';

export default async function NotFound() {
  const { t } = await getTranslator();
  const site = await getSiteSettings();
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
      <p className="text-5xl font-bold">404</p>
      <SitePhoto
        src={siteImage(site, 'notFound')}
        alt=""
        className="h-36 w-full max-w-xs rounded-xl"
      />
      <div className="flex flex-col gap-1">
        <p className="font-medium">{t('error.notFound.title')}</p>
        <p className="text-sm text-muted-foreground">{t('error.notFound.body')}</p>
      </div>
      <Link
        href="/"
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        {t('nav.home')}
      </Link>
    </div>
  );
}
