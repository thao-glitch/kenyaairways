/**
 * Session store (Zustand) — the single source of truth for "who am I".
 *
 * Tokens live in expo-secure-store (Keychain / Android Keystore), never in
 * AsyncStorage or memory alone, so a signed-in user survives app restarts
 * and device-level encryption backs them. The API client pulls the current
 * access token from here on every request.
 */
import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import type { MobileSessionDto, SessionUserDto } from '@flight13/shared';

const ACCESS_KEY = 'f13_access';
const REFRESH_KEY = 'f13_refresh';

interface SessionState {
  user: SessionUserDto | null;
  accessToken: string | null;
  status: 'unknown' | 'authenticated' | 'anonymous';

  /** Restore from secure store on app launch. */
  hydrate: () => Promise<void>;
  /** Persist a new session (from login/register/refresh). */
  setSession: (session: MobileSessionDto) => Promise<void>;
  /** Update the in-memory access token after a silent refresh. */
  setAccessToken: (token: string) => Promise<void>;
  /** Sign out: clear secure store + memory. */
  clearSession: () => Promise<void>;
}

export const useSessionStore = create<SessionState>((set) => ({
  user: null,
  accessToken: null,
  status: 'unknown',

  hydrate: async () => {
    try {
      const [access, refresh] = await Promise.all([
        SecureStore.getItemAsync(ACCESS_KEY),
        SecureStore.getItemAsync(REFRESH_KEY),
      ]);
      if (access || refresh) {
        // We have a token pair — treat as authenticated; the first API call
        // will refresh silently if the access token has expired.
        set({ accessToken: access, status: 'authenticated' });
      } else {
        set({ status: 'anonymous' });
      }
    } catch {
      set({ status: 'anonymous' });
    }
  },

  setSession: async (session) => {
    await Promise.all([
      SecureStore.setItemAsync(ACCESS_KEY, session.accessToken),
      SecureStore.setItemAsync(REFRESH_KEY, session.refreshToken),
    ]);
    set({ user: session.user, accessToken: session.accessToken, status: 'authenticated' });
  },

  setAccessToken: async (token) => {
    await SecureStore.setItemAsync(ACCESS_KEY, token);
    set({ accessToken: token });
  },

  clearSession: async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_KEY),
      SecureStore.deleteItemAsync(REFRESH_KEY),
    ]);
    set({ user: null, accessToken: null, status: 'anonymous' });
  },
}));
