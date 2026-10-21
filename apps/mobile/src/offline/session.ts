/**
 * Local session tokens.
 *
 * Offline tokens are opaque device-local strings: `loc.<uid>.<exp>.<sig>`
 * (access) / `locr.<uid>.<exp>.<sig>` (refresh). The signature is a tiny
 * FNV-1a checksum — this is device-local state behind the app sandbox, not a
 * server credential, so a lightweight integrity tag is all that's needed.
 *
 * Tokens issued by the real backend also work offline: the engine stores the
 * last successful login (whatever flavour) in `local_session` and treats a
 * matching bearer token as the device identity. That way a traveller signed
 * in while the PC was up stays signed in after the PC goes down.
 */
import type { SessionUserDto } from '@kenyaairways/shared';

export const ACCESS_TTL_SEC = 60 * 60 * 24 * 30; // 30 days, device-local

const SALT = 'f13-local-v1';

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function sign(kind: string, uid: string, exp: number): string {
  return fnv1a(`${kind}.${uid}.${exp}.${SALT}`);
}

export function mintToken(kind: 'loc' | 'locr', userId: string, nowSec: number): string {
  const exp = nowSec + (kind === 'loc' ? ACCESS_TTL_SEC : ACCESS_TTL_SEC * 2);
  return `${kind}.${userId}.${exp}.${sign(kind, userId, exp)}`;
}

export function parseToken(
  raw: string | null | undefined,
  expectedKind: 'loc' | 'locr',
  nowSec: number,
): string | null {
  if (!raw || !raw.startsWith(`${expectedKind}.`)) return null;
  const parts = raw.split('.');
  if (parts.length !== 4) return null;
  const [, uid, expRaw, sig] = parts;
  const exp = Number(expRaw);
  if (!uid || !Number.isFinite(exp) || exp <= nowSec) return null;
  if (sign(expectedKind, uid, exp) !== sig) return null;
  return uid;
}

/** Shape returned by POST /auth/login|register (mobile client). */
export interface LocalIssuedSession {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresInSec: number;
  user: SessionUserDto;
}

export function issueSession(user: SessionUserDto, nowSec: number): LocalIssuedSession {
  return {
    accessToken: mintToken('loc', user.id, nowSec),
    refreshToken: mintToken('locr', user.id, nowSec),
    accessTokenExpiresInSec: ACCESS_TTL_SEC,
    user,
  };
}
