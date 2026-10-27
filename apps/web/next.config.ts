import type { NextConfig } from 'next';

// Where the proxied API lives for browser clients. Server-side code reads the
// same variables directly via src/lib/config.ts.
const apiTarget = (
  process.env.API_PUBLIC_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:4100'
).replace(/\/+$/, '');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace package consumed as source so API/web share one set of types
  transpilePackages: ['@kenyaairways/shared'],
  // Mobile-first, low-bandwidth: keep payloads small
  compress: true,
  poweredByHeader: false,
  // Preserve Socket.IO's trailing slash so the API's engine.io endpoint
  // matches; page URLs still resolve without a slash.
  skipTrailingSlashRedirect: true,
  // Self-contained server bundle for the Docker runtime image
  output: 'standalone',
  async rewrites() {
    // Browser clients stay same-origin (src/lib/config.ts returns '' in the
    // browser), so a phone on the LAN only needs to reach this front door —
    // API calls, Socket.IO, paybill confirmation and the health probes are all
    // forwarded to the API. Array form = checked after the filesystem, so any
    // real route always wins over these patterns.
    return [
      { source: '/api/:path*', destination: `${apiTarget}/api/:path*` },
      // Socket.IO's engine.io endpoint lives at `/socket.io/` (trailing
      // slash); forwarding it verbatim keeps polling and upgrades working.
      { source: '/socket.io/', destination: `${apiTarget}/socket.io/` },
      { source: '/socket.io/:path*', destination: `${apiTarget}/socket.io/:path*` },
      { source: '/readyz', destination: `${apiTarget}/readyz` },
      { source: '/healthz', destination: `${apiTarget}/healthz` },
    ];
  },
};

export default nextConfig;
