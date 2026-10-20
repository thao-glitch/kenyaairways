import type { ApiErrorBody } from '@kenyaairways/shared';
import { API_URL } from './config';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

interface ApiGetOptions {
  /** Next.js fetch cache lifetime (seconds). */
  revalidate?: number;
  headers?: Record<string, string>;
  cache?: RequestCache;
}

/**
 * Server-side GET helper. Never throws for optional UI — use `apiGetOrNull`.
 */
export async function apiGet<T>(path: string, options: ApiGetOptions = {}): Promise<T> {
  const { revalidate, headers, cache } = options;
  const res = await fetch(`${API_URL}${path}`, {
    headers: { accept: 'application/json', ...headers },
    ...(revalidate ? { next: { revalidate } } : {}),
    ...(cache ? { cache } : {}),
  });

  if (!res.ok) {
    let code = 'HTTP_ERROR';
    let message = `Request failed with status ${res.status}`;
    try {
      const body = (await res.json()) as Partial<ApiErrorBody>;
      if (body.error?.code) code = body.error.code;
      if (body.error?.message) message = body.error.message;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiRequestError(res.status, code, message);
  }

  return (await res.json()) as T;
}

/** Best-effort variant for widgets that must degrade gracefully (status strip). */
export async function apiGetOrNull<T>(
  path: string,
  options: ApiGetOptions = {},
): Promise<T | null> {
  try {
    return await apiGet<T>(path, options);
  } catch {
    return null;
  }
}
