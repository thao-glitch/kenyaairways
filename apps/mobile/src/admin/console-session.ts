/**
 * Console session tokens — the staff identity used by the bundled admin
 * console's fetch bridge.
 *
 * Kept SEPARATE from the traveller `useSessionStore` (`f13_access`): the
 * WebView console signs in and refreshes independently of any native
 * screen, so its token pair gets its own SecureStore keys. The bridge
 * attaches these as `Authorization: Bearer …` on every proxied call and
 * rotates them when the console's own silent-refresh answers.
 *
 * On successful remote auth the identity is also handed to the offline
 * engine (`rememberRemoteIdentity`) so a PC outage mid-session keeps
 * working against the on-device world.
 */
import type { SessionUserDto } from '@kenyaairways/shared';

const AT_KEY = 'f13_console_at';
const RT_KEY = 'f13_console_rt';

let memAt: string | null = null;
let memRt: string | null = null;

export interface ConsoleTokens {
  accessToken: string;
  refreshToken: string;
}

export async function saveConsoleTokens(t: ConsoleTokens): Promise<void> {
  memAt = t.accessToken;
  memRt = t.refreshToken;
  try {
    const mod = await import('expo-secure-store');
    await Promise.all([
      mod.setItemAsync(AT_KEY, t.accessToken),
      mod.setItemAsync(RT_KEY, t.refreshToken),
    ]);
  } catch {
    /* secure store unavailable — memory copy still serves this run */
  }
}

export async function clearConsoleTokens(): Promise<void> {
  memAt = null;
  memRt = null;
  try {
    const mod = await import('expo-secure-store');
    await Promise.all([mod.deleteItemAsync(AT_KEY), mod.deleteItemAsync(RT_KEY)]);
  } catch {
    /* nothing to clear */
  }
}

/** Current access token (memory first, then secure store). */
export async function getConsoleAccessToken(): Promise<string | null> {
  if (memAt) return memAt;
  try {
    const mod = await import('expo-secure-store');
    memAt = await mod.getItemAsync(AT_KEY);
  } catch {
    memAt = null;
  }
  return memAt;
}

/** Current refresh token — only ever posted to `/auth/refresh`. */
export async function getConsoleRefreshToken(): Promise<string | null> {
  if (memRt) return memRt;
  try {
    const mod = await import('expo-secure-store');
    memRt = await mod.getItemAsync(RT_KEY);
  } catch {
    memRt = null;
  }
  return memRt;
}

/**
 * Shape of an auth answer the bridge watches for: `X-Client: mobile` makes
 * the API (and the offline engine) return the token pair in the body.
 */
export interface AuthAnswer {
  user?: SessionUserDto;
  session?: { accessToken: string; refreshToken: string };
}

/** True for the auth paths whose successful answers carry a session. */
export function isAuthPath(path: string): boolean {
  const clean = path.split('?')[0];
  return (
    clean.endsWith('/auth/login') ||
    clean.endsWith('/auth/register') ||
    clean.endsWith('/auth/refresh')
  );
}

/** `/auth/me` refreshes the profile (no tokens) — remembered, not stored. */
export function isMePath(path: string): boolean {
  return path.split('?')[0].endsWith('/auth/me');
}

export function isLogoutPath(path: string): boolean {
  return path.split('?')[0].endsWith('/auth/logout');
}
