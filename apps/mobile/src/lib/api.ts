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
 */
import { useSessionStore } from '@/store/session';
import { getApiBase } from '@/lib/server';

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
      try {
        const res = await fetch(`${getApiBase()}/api/v1/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Client': 'mobile' },
          body: JSON.stringify({
            refreshToken: await getStoredRefreshToken(),
          }),
        });
        if (!res.ok) return null;
        const body = (await res.json()) as { session?: { accessToken: string } };
        const token = body.session?.accessToken ?? null;
        if (token) await useSessionStore.getState().setAccessToken(token);
        return token;
      } catch {
        return null;
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

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
}

async function request<T>(path: string, opts: RequestOptions = {}, retry = true): Promise<T> {
  const { accessToken } = useSessionStore.getState();
  const url = new URL(`${getApiBase()}${path}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Client': 'mobile',
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(url.toString(), {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  // 401 → try one silent refresh, then retry the original call.
  if (res.status === 401 && retry) {
    const fresh = await refreshAccessToken();
    if (fresh) return request<T>(path, opts, false);
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
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query']) =>
    request<T>(path, { method: 'GET', query }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
