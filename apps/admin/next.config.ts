import type { NextConfig } from 'next';

/**
 * TWO build modes, one codebase:
 *
 *   default            — standalone server for :3001 (Docker/LAN runtime).
 *   ADMIN_STATIC_EXPORT=1 — pure static export into `out/`, bundled into the
 *     admin APK's assets and loaded by the WebView from
 *     `file:///android_asset/console/…`. `basePath`/`assetPrefix` point every
 *     route, chunk and stylesheet at the assets folder so the exported HTML
 *     is self-contained on the phone; the injected fetch bridge answers
 *     `/api/v1/*` calls (live PC API when reachable, on-device engine when
 *     not). Rewrites don't exist in a static export — the bridge replaces
 *     them entirely.
 */
const isStaticExport = process.env.ADMIN_STATIC_EXPORT === '1';

// Where the proxied API lives for browser clients (rewrites below). Server-side
// code reads the same variables directly via src/lib/config.ts.
const apiTarget = (process.env.API_PUBLIC_URL || 'http://localhost:4100').replace(/\/+$/, '');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace package consumed as source so API/web share one set of types
  transpilePackages: ['@kenyaairways/shared'],
  // Mobile-first, low-bandwidth: keep payloads small
  compress: true,
  poweredByHeader: false,
  ...(isStaticExport
    ? {
        // Static export for the APK bundle. basePath doubles as assetPrefix
        // (Next defaults it), so `<Link href="/admin">` renders
        // `/android_asset/console/admin` and `/_next/…` resolves inside the
        // Android assets folder under file://.
        output: 'export' as const,
        basePath: '/android_asset/console',
        trailingSlash: false,
      }
    : {
        // Self-contained server bundle for the Docker runtime image
        output: 'standalone' as const,
        async rewrites() {
          // Browser clients stay same-origin (src/lib/config.ts returns '' in
          // the browser), so a device on the LAN only needs to reach this
          // console — API calls plus the root /readyz and /healthz probes are
          // forwarded to the API. Array form = checked after the filesystem,
          // so any real route here always wins over these patterns.
          return [
            { source: '/api/:path*', destination: `${apiTarget}/api/:path*` },
            { source: '/readyz', destination: `${apiTarget}/readyz` },
            { source: '/healthz', destination: `${apiTarget}/healthz` },
          ];
        },
      }),
};

export default nextConfig;
