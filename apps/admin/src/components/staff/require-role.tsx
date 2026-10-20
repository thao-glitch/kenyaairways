'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useContext, type ReactNode } from 'react';
import type { Role, SessionUserDto } from '@kenyaairways/shared';
import { useT } from '@/components/i18n-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/lib/use-session';

/**
 * Session user provided by the enclosing `<RequireRole>`. Consoles read it via
 * `useStaffUser()` instead of a prop, because Next.js server components cannot
 * serialize functions (a render-prop) across the server → client boundary —
 * plain JSX children plus context is the supported shape.
 */
const StaffUserContext = createContext<SessionUserDto | null>(null);

/** The signed-in staff user. Only valid inside `<RequireRole>` (post-gate). */
export function useStaffUser(): SessionUserDto {
  const user = useContext(StaffUserContext);
  if (!user) throw new Error('useStaffUser() must be used inside <RequireRole>');
  return user;
}

/**
 * Role gate for the staff consoles. The API is the real authority (`@Roles` →
 * 403); this wrapper only shapes the UI: it shows a skeleton while the session
 * resolves, a sign-in prompt when signed out, and a friendly denial when the
 * signed-in role isn't allowed — so a passenger who guesses `/ops` never sees
 * a raw error.
 */
export function RequireRole({ allow, children }: { allow: readonly Role[]; children: ReactNode }) {
  const { t } = useT();
  const pathname = usePathname();
  const { user } = useSession();

  if (user === undefined) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-live="polite">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!user) {
    const next = encodeURIComponent(pathname);
    return (
      <Card className="mx-auto max-w-md">
        <CardContent className="flex flex-col items-center gap-3 pt-6 text-center">
          <p className="text-sm text-muted-foreground">{t('staff.needSignIn')}</p>
          <Link href={`/login?next=${next}`}>
            <Button>{t('nav.signIn')}</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (!allow.includes(user.role)) {
    return (
      <Card className="mx-auto max-w-md">
        <CardContent className="flex flex-col items-center gap-3 pt-6 text-center">
          <p className="text-sm font-medium">{t('staff.noAccess')}</p>
          <p className="text-xs text-muted-foreground">
            {t('staff.yourRole', { role: user.role })}
          </p>
          <Link href="/">
            <Button variant="outline">{t('nav.home')}</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return <StaffUserContext.Provider value={user}>{children}</StaffUserContext.Provider>;
}
