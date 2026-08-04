import path from 'node:path';
import type { NextConfig } from 'next';

// Note: the Content-Security-Policy is set in middleware.ts, because it needs a
// fresh per-request nonce. Only the static headers live here.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Produces a self-contained server bundle for slim Docker images.
  output: 'standalone',
  // This is an npm workspace, so tracing must start at the repo root to pick up
  // hoisted node_modules; without it the standalone build is missing dependencies.
  outputFileTracingRoot: path.join(import.meta.dirname, '..'),

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
