import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace package consumed as source so API/web share one set of types
  transpilePackages: ['@flight13/shared'],
  // Mobile-first, low-bandwidth: keep payloads small
  compress: true,
  poweredByHeader: false,
};

export default nextConfig;
