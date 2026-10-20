/*
 * Minimal offline-aware service worker for installability + resilience.
 * Same-origin only: static assets are cache-first (with background
 * refresh), pages are network-first with a cached fallback; API calls
 * are never intercepted. Bump CACHE to invalidate old entries.
 */
const CACHE = 'kenyaairways-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // API & external: network only

  const isStatic =
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/photos/') ||
    /\.(png|jpe?g|svg|webp|ico|woff2?)$/.test(url.pathname);

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      if (isStatic) {
        const cached = await cache.match(req);
        const network = fetch(req)
          .then((res) => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      }
      try {
        const res = await fetch(req);
        if (res.ok && !url.pathname.startsWith('/api/')) cache.put(req, res.clone());
        return res;
      } catch {
        const cached = await cache.match(req);
        if (cached) return cached;
        return new Response('You appear to be offline.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' },
        });
      }
    }),
  );
});
