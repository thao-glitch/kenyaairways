/**
 * Canonical public origin of the traveller site.
 *
 * Google can only index one canonical origin, and every absolute URL we emit
 * (robots.txt, sitemap.xml, Open Graph tags, JSON-LD) has to agree on it —
 * otherwise the same page looks like four different pages to the crawler.
 *
 * Set `SITE_URL` in the production environment (the Caddy front door knows
 * the real domain). `NEXT_PUBLIC_SITE_URL` is accepted as an alias so a
 * client-side consumer can read the same value. Local dev falls back to
 * `http://localhost:3000`.
 */
const LOCAL_FALLBACK = 'http://localhost:3000';

/** Strip a trailing slash and make sure the value carries a scheme. */
function normalise(raw: string | undefined): string {
  if (!raw?.trim()) return LOCAL_FALLBACK;
  const value = raw.trim();
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return withScheme.replace(/\/+$/, '');
}

/** Origin only, no trailing slash — `https://example.com`. */
export function siteUrl(): string {
  const fromEnv =
    process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL;
  // VERCEL_URL arrives bare (`my-app.vercel.app`), hence the https fallback.
  return normalise(fromEnv);
}

/** Absolute URL for a path — `absoluteUrl('/pnr')` → `https://example.com/pnr`. */
export function absoluteUrl(path = '/'): string {
  const base = siteUrl();
  if (!path || path === '/') return `${base}/`;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Bare hostname (`example.com`, or `localhost:3000` locally) — what Google's
 * `Host:` directive in robots.txt wants. It takes a host, not a URL: sending
 * it a scheme-prefixed value makes the crawler discard the directive, which
 * is exactly the www/non-www consolidation it exists to provide.
 */
export function siteHost(): string {
  try {
    return new URL(siteUrl()).host;
  } catch {
    return 'localhost:3000';
  }
}
