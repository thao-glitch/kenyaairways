import type { ApiErrorBody } from '@kenyaairways/shared';
import { ApiRequestError } from './api';
import { API_URL } from './config';

export { ApiRequestError };

export interface ApiCallOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Internal: set after a silent token refresh (prevents retry loops). */
  retried?: boolean;
}

/**
 * One shared refresh promise: when the short-lived access cookie (15 min)
 * expires, rotate the session via `POST /auth/refresh` (the httpOnly
 * `f13_rt` cookie travels along) and retry. Concurrent 401s in this tab all
 * wait on the same rotation, so the refresh token is never replayed.
 */
let refreshPromise: Promise<boolean> | null = null;

function silentRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          headers: { accept: 'application/json' },
        });
        return res.ok;
      } catch {
        return false;
      } finally {
        setTimeout(() => {
          refreshPromise = null;
        }, 0);
      }
    })();
  }
  return refreshPromise;
}

/**
 * Browser-side fetch helper. Always `credentials: 'include'` so the API's
 * httpOnly session cookies (same-site, API origin) travel with every call —
 * the browser talks straight to the API, no proxy layer in between.
 */
export async function apiCall<T>(path: string, options: ApiCallOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = options;
  const res = await fetch(`${API_URL}${path}`, {
    method,
    credentials: 'include',
    headers: {
      accept: 'application/json',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  if (res.status === 204) return undefined as T;

  if (res.status === 401 && !options.retried && path !== '/api/v1/auth/refresh') {
    // Guard rejections happen before the handler runs, so a retry after a
    // successful rotation is always safe (no side effects to duplicate).
    if (await silentRefresh()) {
      return apiCall<T>(path, { ...options, retried: true });
    }
  }

  if (!res.ok) {
    let code = 'HTTP_ERROR';
    let message = `Request failed with status ${res.status}`;
    try {
      const parsed = (await res.json()) as Partial<ApiErrorBody>;
      if (parsed.error?.code) code = parsed.error.code;
      if (parsed.error?.message) message = parsed.error.message;
    } catch {
      /* non-JSON error body (proxy/network page) */
    }
    throw new ApiRequestError(res.status, code, message);
  }

  return (await res.json()) as T;
}
