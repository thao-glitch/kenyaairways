'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { SessionUserDto } from '@flight13/shared';
import { useT } from '@/components/i18n-provider';
import { getSession, logout } from '@/lib/auth';

/**
 * Live account state in the header: skeleton while probing `/auth/me`, then
 * either sign-in links or the account menu (client island — the session
 * cookies are httpOnly, so only fetch can see them).
 */
export function SessionNav() {
  const { t } = useT();
  const router = useRouter();
  const [user, setUser] = useState<SessionUserDto | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    void getSession().then((session) => {
      if (alive) setUser(session);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function onLogout(): Promise<void> {
    await logout();
    setUser(null);
    router.refresh();
  }

  if (user === undefined) {
    return <span className="h-7 w-24 animate-pulse rounded bg-secondary" aria-hidden="true" />;
  }

  if (!user) {
    return (
      <div className="flex items-center gap-1">
        <Link
          href="/login"
          className="rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {t('nav.signIn')}
        </Link>
        <Link
          href="/register"
          className="rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          {t('nav.register')}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Link
        href="/pnr"
        className="max-w-24 truncate rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        title={t('nav.manage')}
      >
        {user.firstName}
      </Link>
      <button
        type="button"
        onClick={() => void onLogout()}
        className="rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        {t('nav.signOut')}
      </button>
    </div>
  );
}
