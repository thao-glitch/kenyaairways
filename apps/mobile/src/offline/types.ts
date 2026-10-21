/**
 * Shared types for the on-device offline engine.
 *
 * The engine answers the exact same requests the apps already make against
 * the NestJS API, so screens never learn they are talking to a local copy:
 * same paths, same envelopes, same error codes.
 */
import type { SessionUserDto } from '@kenyaairways/shared';

export interface LocalRequest {
  /** HTTP method, upper-case. */
  method: string;
  /** Path INCLUDING the `/api/v1` prefix (e.g. `/api/v1/flights/search`). */
  path: string;
  /** Decoded query-string parameters. */
  query: Record<string, string>;
  /** Parsed JSON body (undefined for GET/DELETE without body). */
  body: unknown;
  /** Raw `Authorization` header value, if present. */
  authorization: string | null;
}

export interface LocalResponse {
  status: number;
  body?: unknown;
}

/** Who is making the call (resolved from the device's current session). */
export interface EngineActor {
  user: SessionUserDto;
  /** True when the presented token was minted by the local engine. */
  localToken: boolean;
}
