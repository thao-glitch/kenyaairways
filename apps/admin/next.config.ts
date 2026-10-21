import type { NextConfig } from 'next';

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
  // Self-contained server bundle for the Docker runtime image
  output: 'standalone',
  async rewrites() {
    // Browser clients stay same-origin (src/lib/config.ts returns '' in the
    // browser), so a device on the LAN only needs to reach this console —
    // API calls plus the root /readyz and /healthz probes are forwarded to
    // the API. Array form = checked after the filesystem, so any real route
    // here always wins over these patterns.
    return [
      { source: '/api/:path*', destination: `${apiTarget}/api/:path*` },
      { source: '/readyz', destination: `${apiTarget}/readyz` },
      { source: '/healthz', destination: `${apiTarget}/healthz` },
    ];
  },
};

export default nextConfig;
