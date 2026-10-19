'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SessionUserDto } from '@flight13/shared';
import { getSession } from './auth';

/**
 * Client-side session probe. `undefined` = still loading, `null` = signed out.
 * Server components can't read the API-origin httpOnly cookies, so every
 * authenticated surface (staff consoles included) resolves the session here.
 */
export function useSession(): {
  user: SessionUserDto | null | undefined;
  refresh: () => Promise<SessionUserDto | null>;
} {
  const [user, setUser] = useState<SessionUserDto | null | undefined>(undefined);

  const refresh = useCallback(async () => {
    const session = await getSession();
    setUser(session);
    return session;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { user, refresh };
}
