/**
 * Console bridge — the fetch middleman between the bundled admin console
 * (WebView, file:// origin) and the world.
 *
 * The static-export console talks to `/api/v1/…` with plain relative fetches
 * and cookie auth. In the WebView there are no cookies and no server, so the
 * injected shim forwards every API call here as a JSON message and this
 * module answers it exactly like `lib/api.ts` answers native calls:
 *
 *   - `X-Client: mobile` on every request, so the API returns the token pair
 *     in the body (the WebView cannot read httpOnly cookies) — login,
 *     register and the console's own silent-refresh all work unchanged.
 *   - `Authorization: Bearer <console access token>` from the console's own
 *     SecureStore pair (`f13_console_at/rt` — separate from the traveller
 *     session: the console signs in and rotates independently).
 *   - Reachable PC → straight to the live API (including multipart photo
 *     uploads, rebuilt from the shim's base64 parts as data-URI form parts).
 *   - PC unreachable / network error → `markOffline()` then the identical
 *     request to the on-device engine (`dispatchLocal`), same paths, same
 *     DTOs, same error envelopes.
 *   - Logout is answered by the bridge itself (clears the console pair and
 *     returns 204 even offline — the engine has no logout route and the
 *     console's sign-out must never dead-end).
 *
 * Token capture happens here: any successful auth answer carrying a
 * `session` is stored (and, when it came from the PC, remembered by the
 * engine so identity survives a later outage).
 */
import type { SessionUserDto } from '@kenyaairways/shared';
import { isLocal, markOffline } from '@/offline/connectivity';
import { dispatchLocal, rememberRemoteIdentity, type LocalCall } from '@/offline/dispatch';
import type { LocalResponse } from '@/offline/types';
import { getApiBase } from '@/lib/server';
import {
  clearConsoleTokens,
  getConsoleAccessToken,
  getConsoleRefreshToken,
  isAuthPath,
  isLogoutPath,
  isMePath,
  saveConsoleTokens,
  type AuthAnswer,
} from './console-session';

/** One file part as serialized by the shim (FileReader → data URL). */
export interface FormPart {
  name: string;
  /** Plain string value, or a `data:<mime>;base64,…` URL for file parts. */
  value: string;
}

/** Message the injected shim posts for one API call. */
export interface ConsoleApiRequest {
  id: number;
  method: string;
  /** Path + query, e.g. `/api/v1/admin/users?page=1`. */
  url: string;
  headers: Record<string, string>;
  body: string | null;
  /** Present when the console sent FormData (photo uploads). */
  form: FormPart[] | null;
}

/** Answer injected back into the page as a reconstructed `Response`. */
export interface ConsoleApiResponse {
  id: number;
  status: number;
  contentType: string;
  body: string;
}

/** Injectable dependencies — tests route these to fakes; production wires
 * the real connectivity/dispatch/network modules. */
export interface BridgeDeps {
  isLocal(): boolean;
  markOffline(): void;
  apiBase(): string;
  fetchRemote(input: string, init: RequestInit): Promise<Response>;
  dispatch(call: LocalCall): LocalResponse;
  getAccessToken(): Promise<string | null>;
  getRefreshToken(): Promise<string | null>;
  saveSession(s: { accessToken: string; refreshToken: string }): Promise<void>;
  clearSession(): Promise<void>;
  rememberIdentity(
    user: SessionUserDto,
    session: { accessToken: string; refreshToken: string } | null,
  ): void;
}

/** Strip an accidental absolute origin: the console always means the API. */
export function consolePath(url: string): string {
  const withoutOrigin = url.replace(/^[a-z]+:\/\/[^/]+/i, '');
  return withoutOrigin.startsWith('/') ? withoutOrigin : `/${withoutOrigin}`;
}

/** Where the static-export console lives inside the APK. */
export const CONSOLE_ASSET_BASE = 'file:///android_asset/console';

/**
 * Map a hard navigation inside the bundled console (`window.location.href =
 * '/login'`, the login form's redirect, …) onto the HTML file that ships in
 * the APK. Handles both basePath-prefixed and bare paths, with or without a
 * `.html` suffix; unknown routes land on the export's 404 page. Returns null
 * for anything that is not a file:// URL (the mapper is file-scope only).
 */
export function consoleFileForPath(url: string): string | null {
  if (!url.startsWith('file://')) return null;
  let path = url.slice('file://'.length);
  const hashAt = path.indexOf('#');
  if (hashAt >= 0) path = path.slice(0, hashAt);
  let query = '';
  const queryAt = path.indexOf('?');
  if (queryAt >= 0) {
    query = path.slice(queryAt);
    path = path.slice(0, queryAt);
  }
  if (path.startsWith('/android_asset/console')) path = path.slice('/android_asset/console'.length);
  path = path.replace(/\.html$/, '');
  const page =
    path === '' || path === '/'
      ? 'index'
      : ['index', 'login', 'admin', 'pricing', 'bookings', 'agent', 'ops', 'finance'].includes(
            path.split('/').pop() ?? '',
          )
        ? (path.split('/').pop() as string)
        : '404';
  return `${CONSOLE_ASSET_BASE}/${page}.html${query}`;
}

/**
 * Main-frame navigation policy for the WebView hosting the bundled console.
 *
 * Returns the URL the navigation must be replaced with, or `null` when the
 * WebView should simply load what it was given. In the `file://` export every
 * hard navigation resolves to a filesystem path, while the console speaks
 * routes — and `usePathname()` (and therefore the login form's `?next=`)
 * reports `/index.html`-style paths once basePath is stripped. Extensions and
 * the asset base are folded away by `consoleFileForPath`, so a navigation that
 * already equals its mapped file (the real `.html` pages, subresource loads)
 * passes through untouched.
 */
export function consoleNavigationTarget(url: string): string | null {
  const mapped = consoleFileForPath(url);
  return mapped && mapped !== url ? mapped : null;
}

/** Only API-ish paths are bridged; everything else never reaches this module. */
export function isBridgeablePath(path: string): boolean {
  const clean = path.split('?')[0];
  return clean.startsWith('/api/') || clean === '/healthz' || clean === '/readyz';
}

function errorResponse(
  id: number,
  status: number,
  code: string,
  message: string,
): ConsoleApiResponse {
  return {
    id,
    status,
    contentType: 'application/json',
    body: JSON.stringify({ error: { code, message } }),
  };
}

function passthrough(
  id: number,
  status: number,
  contentType: string,
  body: string,
): ConsoleApiResponse {
  return { id, status, contentType, body };
}

/** Capture tokens/profile from a successful auth answer (both transports). */
function captureAuth(deps: BridgeDeps, path: string, bodyText: string, fromRemote: boolean): void {
  if (!bodyText) return;
  let parsed: AuthAnswer | null = null;
  try {
    parsed = JSON.parse(bodyText) as AuthAnswer;
  } catch {
    return;
  }
  const session = parsed.session;
  if (isAuthPath(path) && session?.accessToken && session?.refreshToken) {
    void deps.saveSession({ accessToken: session.accessToken, refreshToken: session.refreshToken });
    // Remote logins must be rememberable by the engine so a later PC outage
    // still resolves this bearer; local logins already live in the engine.
    if (fromRemote) deps.rememberIdentity(parsed.user ?? ({} as SessionUserDto), session);
  } else if (isMePath(path) && parsed.user) {
    if (fromRemote) deps.rememberIdentity(parsed.user, null);
  }
}

/** The console's silent-refresh posts an EMPTY body (cookies did the work).
 *  Translate it to the body-token refresh the API and engine both accept. */
function withRefreshBody(req: ConsoleApiRequest, stored: string | null): string | null {
  const clean = req.url.split('?')[0];
  const isRefresh = clean.endsWith('/auth/refresh');
  if (!isRefresh) return req.body;
  if (req.body && req.body.trim() && req.body.trim() !== '{}') return req.body;
  return JSON.stringify({ refreshToken: stored });
}

/** Answer from the on-device engine — identical DTOs and error envelopes. */
function fromLocal(
  deps: BridgeDeps,
  req: ConsoleApiRequest,
  authorization: string | null,
  bodyText: string | null,
): ConsoleApiResponse {
  const [path, qs] = req.url.split('?');
  const query: Record<string, string> = {};
  if (qs) {
    for (const pair of qs.split('&')) {
      const [k, v] = pair.split('=');
      if (k) query[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
    }
  }
  let body: unknown = undefined;
  if (bodyText) {
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = bodyText;
    }
  }
  const res = deps.dispatch({
    method: req.method.toUpperCase(),
    path,
    query,
    body,
    authorization,
  });
  return passthrough(req.id, res.status, 'application/json', JSON.stringify(res.body ?? null));
}

/** Rebuild the shim's base64 parts as RN FormData (data-URI file parts). */
function rebuildForm(form: FormPart[]): FormData {
  const fd = new FormData();
  for (const part of form) {
    if (part.value.startsWith('data:')) {
      const semi = part.value.indexOf(';');
      const mime = semi > 5 ? part.value.slice(5, semi) : 'application/octet-stream';
      fd.append(part.name, { uri: part.value, name: part.name, type: mime } as unknown as Blob);
    } else {
      fd.append(part.name, part.value);
    }
  }
  return fd;
}

async function fromRemote(
  deps: BridgeDeps,
  req: ConsoleApiRequest,
  accessToken: string | null,
  bodyText: string | null,
): Promise<ConsoleApiResponse> {
  const headers: Record<string, string> = { ...req.headers, 'X-Client': 'mobile' };
  // Cookie/origin headers from the page are meaningless here; the bridge
  // owns auth. Content-type is only set for JSON — multipart sets itself.
  delete headers['content-type'];
  delete headers['Content-Type'];
  delete headers['cookie'];
  delete headers['Cookie'];
  delete headers['authorization'];
  delete headers['Authorization'];
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const body = req.form ? rebuildForm(req.form) : (bodyText ?? undefined);
  if (typeof body === 'string') headers['Content-Type'] = 'application/json';

  const init: RequestInit = { method: req.method.toUpperCase(), headers };
  if (body !== undefined && req.method.toUpperCase() !== 'GET') init.body = body;

  const res = await deps.fetchRemote(`${deps.apiBase()}${req.url}`, init);
  const contentType = res.headers.get('content-type') ?? 'application/json';
  const text = res.status === 204 ? '' : await res.text();
  if (res.ok) captureAuth(deps, req.url, text, true);
  return passthrough(req.id, res.status, contentType, text);
}

/** Build the request handler. Production wiring lives in `consoleHandle`. */
export function createConsoleHandler(deps: BridgeDeps) {
  return async function handle(req: ConsoleApiRequest): Promise<ConsoleApiResponse> {
    const path = consolePath(req.url);

    // Sign-out is bridge-owned: best-effort server call, always clear the
    // local pair, always 204 — the console must never wedge on logout.
    if (isLogoutPath(path)) {
      const at = await deps.getAccessToken();
      if (!deps.isLocal() && at) {
        try {
          await deps.fetchRemote(`${deps.apiBase()}${req.url}`, {
            method: 'POST',
            headers: {
              'X-Client': 'mobile',
              Authorization: `Bearer ${at}`,
              accept: 'application/json',
            },
          });
        } catch {
          /* the token dies locally regardless */
        }
      }
      await deps.clearSession();
      return passthrough(req.id, 204, 'application/json', '');
    }

    const at = await deps.getAccessToken();
    const rt = await deps.getRefreshToken();
    const authorization = at ? `Bearer ${at}` : null;
    // One translation point: the console's cookie-style silent-refresh (empty
    // body) becomes the body-token refresh both the API and engine accept.
    const bodyText = withRefreshBody(req, rt);

    // Photo uploads: online-only (the engine has no media store). The error
    // envelope is the API's shape, so the console shows it inline.
    if (req.form) {
      if (deps.isLocal()) {
        return errorResponse(
          req.id,
          503,
          'SERVICE_UNAVAILABLE',
          'Photograph uploads need a connection to the PC backend',
        );
      }
      try {
        return await fromRemote(deps, req, at, bodyText);
      } catch {
        deps.markOffline();
        return errorResponse(
          req.id,
          503,
          'SERVICE_UNAVAILABLE',
          'Photograph uploads need a connection to the PC backend',
        );
      }
    }

    // Offline first — the device answers identically.
    if (deps.isLocal()) {
      const res = fromLocal(deps, req, authorization, bodyText);
      if (res.status < 400) captureAuth(deps, req.url, res.body, false);
      return res;
    }

    try {
      // The console's own 401 → silentRefresh → retry logic runs on top of
      // this (its refresh call also lands here, translated above), so no
      // bridge-level retry loop is needed — one refresh path, console-owned.
      return await fromRemote(deps, req, at, bodyText);
    } catch {
      // Network error (PC down / wrong network) → fail over to the device.
      deps.markOffline();
      const res = fromLocal(deps, req, authorization, bodyText);
      if (res.status < 400) captureAuth(deps, req.url, res.body, false);
      return res;
    }
  };
}

/** Production handler: real connectivity, dispatch, network and tokens. */
export const consoleHandle = createConsoleHandler({
  isLocal,
  markOffline,
  apiBase: getApiBase,
  fetchRemote: (input, init) => fetch(input, init),
  dispatch: dispatchLocal,
  getAccessToken: getConsoleAccessToken,
  getRefreshToken: getConsoleRefreshToken,
  saveSession: saveConsoleTokens,
  clearSession: clearConsoleTokens,
  rememberIdentity: rememberRemoteIdentity,
});

/** The `injectJavaScript` snippet that delivers one answer to the page. */
export function respondScript(res: ConsoleApiResponse): string {
  return (
    `window.__f13bridge && window.__f13bridge.respond(` +
    `${res.id}, ${res.status}, ${JSON.stringify(res.contentType)}, ${JSON.stringify(res.body)});`
  );
}
