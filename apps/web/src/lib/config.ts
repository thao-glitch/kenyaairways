/** Runtime API base URL — server-side only; browser calls go through NEXT_PUBLIC_API_URL. */
export const API_URL = (
  process.env.API_PUBLIC_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:4100'
).replace(/\/+$/, '');

/** Standalone staff console app (separate deployment — see apps/admin). */
export const ADMIN_URL = (process.env.NEXT_PUBLIC_ADMIN_URL || 'http://localhost:3001').replace(
  /\/+$/,
  '',
);
