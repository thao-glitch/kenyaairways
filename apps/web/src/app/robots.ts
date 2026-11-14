import type { MetadataRoute } from 'next';
import { absoluteUrl, siteHost } from '@/lib/site-url';

// Rendered per request, not prerendered. A static build-time render bakes in
// whatever SITE_URL happened to be set when the image was built — in Docker
// that is almost always localhost — which would hand Google a sitemap and
// Host directive pointing at a server nobody else can reach.
export const dynamic = 'force-dynamic';

/**
 * `/robots.txt` — the front-door instruction manual for crawlers.
 *
 * Everything passenger-facing is open to Google; everything staff-facing or
 * owner-scoped is closed, because those pages are behind a login and would
 * otherwise surface as dead ends in search results (or, worse, advertise
 * where the admin console lives). `host` tells Google that every indexed
 * URL belongs to this one origin, which consolidates ranking signals onto
 * the public domain rather than split across http/https or bare IPs.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          // Staff consoles — login-gated, never for search results.
          '/admin',
          '/finance',
          '/ops',
          '/agent',
          // Account surfaces with nothing to index for a stranger.
          '/login',
          '/register',
          // Owner-scoped records: bookings, passes, API payloads.
          '/bookings',
          '/boarding-passes',
          '/api/',
        ],
      },
    ],
    sitemap: absoluteUrl('/sitemap.xml'),
    host: siteHost(),
  };
}
