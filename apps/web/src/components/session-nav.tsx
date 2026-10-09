'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { Role, SessionUserDto } from '@flight13/shared';
import { useT } from '@/components/i18n-provider';
import { getSession, logout } from '@/lib/auth';

/** Which staff consoles a role may open (mirrors the API's `@Roles` guards). */
const CONSOLES: { href: string; labelKey: string; allow: readonly Role[] }[] = [
  { href: '/ops', labelKey: 'nav.ops', allow: ['OPS', 'ADMIN'] },
  { href: '/finance', labelKey: 'nav.finance', allow: ['FINANCE', 'ADMIN'] },
  { href: '/agent', labelKey: 'nav.agent', allow: ['AGENT', 'ADMIN'] },
  { href: '/admin', labelKey: 'nav.admin', allow: ['ADMIN'] },
];

/**
 * Live account state in the header: skeleton while probing `/auth/me`, then
 * either sign-in links or the account menu (client island — the session
 * cookies are httpOnly, so only fetch can see them). Re-probes on every
 * navigation: register/login sign in via `router.push`, which never remounts
 * the header, so a mount-only probe would leave it stale.
 */
export function SessionNav() {
  const { t } = useT();
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<SessionUserDto | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    void getSession().then((session) => {
      // Keep the previous value while revalidating — no skeleton flash on nav.
      if (alive) setUser(session);
    });
    return () => {
      alive = false;
    };
  }, [pathname]);

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
      {CONSOLES.filter((c) => c.allow.includes(user.role)).map((c) => (
        <Link
          key={c.href}
          href={c.href}
          className="rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {t(c.labelKey)}
        </Link>
      ))}
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
