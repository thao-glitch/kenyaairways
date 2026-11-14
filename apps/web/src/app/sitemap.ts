import type { MetadataRoute } from 'next';
import { absoluteUrl } from '@/lib/site-url';

// Rendered per request, not prerendered — see the note in robots.ts: a
// build-time render would freeze localhost URLs into every entry.
export const dynamic = 'force-dynamic';

/**
 * `/sitemap.xml` — the index Google uses to discover the public site.
 *
 * Only genuinely public, evergreen pages are listed: search, destination
 * browsing, trip planning, manage-booking, PNR lookup, live status, rewards
 * and the legal pages. Staff consoles and owner-scoped detail pages
 * (`/bookings/[id]`, `/boarding-passes/[id]`) are deliberately absent — they
 * are `noindex` in `robots.txt` too, so listing them would only make the
 * crawler fetch pages it is told not to index.
 *
 * `priority`/`changeFrequency` are hints, not guarantees; they tell Google
 * where to spend its crawl budget on a site whose flight data moves daily.
 */
const ROUTES: Array<{
  path: string;
  changeFrequency: NonNullable<MetadataRoute.Sitemap[number]['changeFrequency']>;
  priority: number;
}> = [
  { path: '/', changeFrequency: 'daily', priority: 1 },
  { path: '/flights', changeFrequency: 'daily', priority: 0.9 },
  { path: '/book', changeFrequency: 'daily', priority: 0.9 },
  { path: '/status', changeFrequency: 'daily', priority: 0.8 },
  { path: '/explore', changeFrequency: 'daily', priority: 0.8 },
  { path: '/manage', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/pnr', changeFrequency: 'weekly', priority: 0.7 },
  { path: '/plan', changeFrequency: 'weekly', priority: 0.7 },
  { path: '/experience', changeFrequency: 'weekly', priority: 0.7 },
  { path: '/alerts', changeFrequency: 'weekly', priority: 0.6 },
  { path: '/rewards', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/legal', changeFrequency: 'monthly', priority: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return ROUTES.map(({ path, changeFrequency, priority }) => ({
    url: absoluteUrl(path),
    lastModified: now,
    changeFrequency,
    priority,
  }));
}
