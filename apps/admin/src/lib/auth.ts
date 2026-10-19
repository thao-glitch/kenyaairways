import type { SessionUserDto } from '@flight13/shared';
import { ApiRequestError, apiCall } from './api-client';

/** Current session from the httpOnly cookies, or null when signed out. */
export async function getSession(): Promise<SessionUserDto | null> {
  try {
    return await apiCall<SessionUserDto>('/api/v1/auth/me');
  } catch (err) {
    // 401 = signed out; any other failure (API offline) degrades to signed-out
    // so the header never breaks the page.
    if (err instanceof ApiRequestError && err.status === 401) return null;
    return null;
  }
}

interface SessionResponse {
  user: SessionUserDto;
}

export async function login(identifier: string, password: string): Promise<SessionUserDto> {
  const res = await apiCall<SessionResponse>('/api/v1/auth/login', {
    method: 'POST',
    body: { identifier, password },
  });
  return res.user;
}

export interface RegisterInput {
  email?: string;
  phone?: string;
  password: string;
  firstName: string;
  lastName: string;
  acceptTerms: boolean;
}

export async function register(input: RegisterInput): Promise<SessionUserDto> {
  const res = await apiCall<SessionResponse>('/api/v1/auth/register', {
    method: 'POST',
    body: input,
  });
  return res.user;
}

export async function logout(): Promise<void> {
  try {
    await apiCall<void>('/api/v1/auth/logout', { method: 'POST' });
  } catch {
    // Best effort: cookies are cleared server-side even if the response is lost.
  }
}
