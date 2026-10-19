import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace package consumed as source so API/web share one set of types
  transpilePackages: ['@flight13/shared'],
  // Mobile-first, low-bandwidth: keep payloads small
  compress: true,
  poweredByHeader: false,
  // Self-contained server bundle for the Docker runtime image
  output: 'standalone',
};

export default nextConfig;
