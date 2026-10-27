/**
 * Runtime API base URL.
 *
 * Server-side (SSR/RSC): API_PUBLIC_URL / NEXT_PUBLIC_API_URL / localhost:4100
 * — the API always runs next to this server.
 *
 * Browser-side: empty → same-origin. The traveller site proxies `/api/*`,
 * `/socket.io/*`, `/readyz` and `/healthz` to the API (next.config rewrites),
 * so a phone on the LAN only ever needs to reach :3000. A baked-in
 * localhost:4100 would resolve to the phone itself and every call — payments
 * included — would fail with "Network error".
 */
export const API_URL = (
  typeof window === 'undefined'
    ? process.env.API_PUBLIC_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4100'
    : ''
).replace(/\/+$/, '');

/** Standalone staff console app (separate deployment — see apps/admin). */
export const ADMIN_URL = (process.env.NEXT_PUBLIC_ADMIN_URL || 'http://localhost:3001').replace(
  /\/+$/,
  '',
);
