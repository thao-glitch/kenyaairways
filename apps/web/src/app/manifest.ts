import type { MetadataRoute } from 'next';
import { getSiteSettings } from '@/lib/site';

/**
 * Installable-app manifest — lets the site be added to a home screen on
 * Android, iPhone/iPad, Windows, macOS and Linux exactly like a store app.
 * The name follows live site settings (same source as the header wordmark).
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const site = await getSiteSettings();
  const name = site?.appName?.trim() || 'Kenya Airways';
  return {
    name: `${name} — Book flights around the world`,
    short_name: name,
    description:
      'Search, book and manage flights across a worldwide network — every day, everywhere.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#141416',
    theme_color: '#da1b28',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
  };
}
