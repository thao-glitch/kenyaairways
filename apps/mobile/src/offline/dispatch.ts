/**
 * Expo glue between `api.ts` and the local engine.
 *
 * Owns the singleton World (opened once per app run, lazily on first local
 * request or eagerly at boot via `bootstrapOffline()`), converts a plain
 * method/path/query/body call into a LocalRequest, and hands the response
 * back as `{status, body}` — the exact contract `api.ts` needs to treat a
 * local answer like a network answer.
 */
import type { SessionUserDto } from '@kenyaairways/shared';
import { openExpoDb } from './expo-db';
import { handle } from './engine';
import { syncLocalIdentity, type EngineCtx } from './engine-support';
import type { LocalRequest, LocalResponse } from './types';
import { World } from './world';

let cachedCtx: EngineCtx | null = null;

/** Open the device DB and seed/generate the offline world (idempotent). */
export function getEngineCtx(): EngineCtx {
  if (!cachedCtx) {
    const db = openExpoDb();
    const world = World.load(db);
    cachedCtx = { db, world, now: () => Date.now() };
  }
  return cachedCtx;
}

/** Warm-up call from App.tsx so the first local request is instant. */
export function bootstrapOffline(): void {
  try {
    getEngineCtx();
  } catch (err) {
    console.warn('[offline] world init failed', err);
  }
}

export interface LocalCall {
  method: string;
  /** Path INCLUDING `/api/v1` (or `/healthz`). */
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  authorization?: string | null;
}

/** Synchronous local dispatch — the engine never touches the network. */
export function dispatchLocal(call: LocalCall): LocalResponse {
  const ctx = getEngineCtx();
  const req: LocalRequest = {
    method: call.method,
    path: call.path,
    query: call.query ?? {},
    body: call.body,
    authorization: call.authorization ?? null,
  };
  return handle(ctx, req);
}

/**
 * Remember a successful REMOTE login so the device keeps its identity when
 * the PC goes down (called by api.ts after login/register/me/refresh).
 * Without tokens (the /auth/me path) only the user profile is refreshed.
 */
export function rememberRemoteIdentity(
  user: SessionUserDto,
  session: { accessToken: string; refreshToken: string; accessTokenExpiresInSec?: number } | null,
): void {
  try {
    const ctx = getEngineCtx();
    if (session?.accessToken) {
      syncLocalIdentity(ctx, user, session);
    } else {
      ctx.db.run('UPDATE local_session SET user_json = ? WHERE id = 1 AND user_id = ?', [
        JSON.stringify(user),
        user.id,
      ]);
    }
  } catch (err) {
    console.warn('[offline] identity sync failed', err);
  }
}
