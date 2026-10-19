'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { apiCall } from '@/lib/api-client';
import { useSession } from '@/lib/use-session';
import { useT } from '@/components/i18n-provider';
import { Button } from '@/components/ui/button';

/** Sign-in / sign-out island for the console header. */
export function AdminSession() {
  const { t } = useT();
  const { user, refresh } = useSession();
  const pathname = usePathname();

  if (user === undefined) {
    return <span className="text-xs text-muted-foreground">{t('auth.working')}</span>;
  }
  if (!user) {
    return (
      <Link
        href={`/login?next=${encodeURIComponent(pathname)}`}
        className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        {t('nav.signIn')}
      </Link>
    );
  }
  const signOut = async (): Promise<void> => {
    await apiCall<void>('/api/v1/auth/logout', { method: 'POST' });
    await refresh();
    window.location.href = '/login';
  };
  return (
    <div className="flex items-center gap-3">
      <span className="hidden text-sm text-muted-foreground sm:inline">
        {user.firstName} {user.lastName} · {user.role}
      </span>
      <Button variant="outline" size="sm" onClick={() => void signOut()}>
        {t('nav.signOut')}
      </Button>
    </div>
  );
}
