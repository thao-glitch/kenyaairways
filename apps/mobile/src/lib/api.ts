/**
 * API client for the Kenya Airways NestJS backend.
 *
 * - Attaches the bearer access token from the session store to every call.
 * - On a 401, performs ONE silent refresh (POST /auth/refresh with the
 *   stored refresh token) and retries the original request. Concurrent 401s
 *   share a single in-flight refresh promise (no thundering herd).
 * - Sends `X-Client: mobile` so the API returns tokens in the body instead
 *   of relying on httpOnly cookies (which React Native cannot persist).
 * - `API_BASE` comes from `src/lib/server.ts`: build-time
 *   `EXPO_PUBLIC_API_BASE`, overridable at runtime (saved on device) so an
 *   installed APK can point at a LAN backend. Read per request via
 *   `getApiBase()` so a server-address change takes effect immediately.
 * - STANDALONE MODE: every call is a single choke point. When the PC backend
 *   is unreachable (connectivity monitor, or the fetch itself throws a
 *   network error) the identical request is answered by the on-device
 *   engine — same paths, same DTOs, same error envelopes. When the PC comes
 *   back the monitor flips the route back automatically.
 */
import { useSessionStore } from '@/store/session';
import { getApiBase } from '@/lib/server';
import { dispatchLocal, rememberRemoteIdentity } from '@/offline/dispatch';
import { isLocal, markOffline } from '@/offline/connectivity';
import type { SessionUserDto } from '@kenyaairways/shared';

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  // Only one refresh at a time; concurrent callers await the same promise.
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const stored = await getStoredRefreshToken();
      try {
        const res = await fetch(`${getApiBase()}/api/v1/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Client': 'mobile' },
          body: JSON.stringify({ refreshToken: stored }),
        });
        if (res.ok) {
          const body = (await res.json()) as {
            session?: { accessToken: string; refreshToken?: string };
          };
          const token = body.session?.accessToken ?? null;
          if (token) {
            await useSessionStore.getState().setAccessToken(token);
            // Rotation: keep the newest refresh token for the next round.
            if (body.session?.refreshToken) await storeRefreshToken(body.session.refreshToken);
          }
          return token;
        }
        return null;
      } catch {
        // Network failure → the PC is likely down; fall through to local.
        markOffline();
        if (!stored) return null;
        try {
          const local = dispatchLocal({
            method: 'POST',
            path: '/api/v1/auth/refresh',
            body: { refreshToken: stored },
            authorization: null,
          });
          const session =
            local.status < 400
              ? (local.body as { session?: { accessToken: string; refreshToken?: string } }).session
              : null;
          const token = session?.accessToken ?? null;
          if (token) {
            await useSessionStore.getState().setAccessToken(token);
            if (session?.refreshToken) await storeRefreshToken(session.refreshToken);
          }
          return token;
        } catch {
          return null;
        }
      } finally {
        // Allow future refreshes once this batch settles.
        setTimeout(() => {
          refreshPromise = null;
        }, 0);
      }
    })();
  }
  return refreshPromise;
}

// Refresh token lives in secure store; the session store exposes it via a
// tiny indirection so the token never lands in a global we might log.
async function getStoredRefreshToken(): Promise<string | null> {
  const mod = await import('expo-secure-store');
  return mod.getItemAsync('f13_refresh');
}

async function storeRefreshToken(token: string): Promise<void> {
  try {
    const mod = await import('expo-secure-store');
    await mod.setItemAsync('f13_refresh', token);
  } catch {
    /* secure store unavailable — the old token stays */
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
}

type QueryValues = Record<string, string>;

function queryStrings(query: RequestOptions['query']): QueryValues {
  const out: QueryValues = {};
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) out[k] = String(v);
    }
  }
  return out;
}

/** Answer a request from the on-device engine with the same error contract. */
function localRequest<T>(method: string, path: string, query: QueryValues, body: unknown): T {
  const { accessToken } = useSessionStore.getState();
  const res = dispatchLocal({
    method,
    path,
    query,
    body,
    authorization: accessToken ? `Bearer ${accessToken}` : null,
  });
  if (res.status >= 400) {
    const err = (res.body as { error?: { code?: string; message?: string } })?.error;
    throw new ApiError(
      err?.code ?? 'INTERNAL_ERROR',
      err?.message ?? 'Local request failed',
      res.status,
    );
  }
  return res.body as T;
}

/** Keep the device identity in sync with successful remote auth answers. */
function syncIdentity(path: string, body: unknown): void {
  if (!path.startsWith('/api/v1/auth/')) return;
  const shaped = body as {
    user?: SessionUserDto;
    session?: { accessToken: string; refreshToken: string; accessTokenExpiresInSec?: number };
  } | null;
  if (!shaped?.user) return;
  rememberRemoteIdentity(shaped.user, shaped.session ?? null);
}

async function request<T>(path: string, opts: RequestOptions = {}, retry = true): Promise<T> {
  const query = queryStrings(opts.query);

  // Offline (or marked-offline) → the device answers, identically.
  if (isLocal()) return localRequest<T>(opts.method ?? 'GET', path, query, opts.body);

  const { accessToken } = useSessionStore.getState();
  const url = new URL(`${getApiBase()}${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Client': 'mobile',
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    // Network error (PC down / wrong network) → fail over to the device.
    markOffline();
    return localRequest<T>(opts.method ?? 'GET', path, query, opts.body);
  }

  // 401 → try one silent refresh, then retry the original call.
  if (res.status === 401 && retry) {
    const fresh = await refreshAccessToken();
    if (fresh) return request<T>(path, opts, false);
    if (isLocal()) {
      // The PC went away mid-session — the device session still works.
      return localRequest<T>(opts.method ?? 'GET', path, query, opts.body);
    }
    // Refresh failed → force sign-out so the UI shows the auth stack.
    await useSessionStore.getState().clearSession();
    throw new ApiError('UNAUTHENTICATED', 'Session expired', 401);
  }

  if (!res.ok) {
    let code = 'UNKNOWN';
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(code, message, res.status);
  }

  if (res.status === 204) return undefined as T;
  const data = (await res.json()) as T;
  syncIdentity(path, data);
  return data;
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query']) =>
    request<T>(path, { method: 'GET', query }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
