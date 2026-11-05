import type { NextConfig } from 'next';

/**
 * The browser only ever talks to the website origin. `/api/v1/*` is proxied to the NestJS
 * API, so session cookies are first-party and SameSite=Lax works even when the website and
 * API run on different hosts (e.g. separate *.vercel.app domains, which are cross-site).
 * See Docs/decisions/0001-authentication-and-sessions.md.
 */
const apiInternalUrl = (process.env.API_INTERNAL_URL ?? 'http://localhost:4000').replace(/\/$/, '');

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${apiInternalUrl}/api/v1/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
      {
        // Pages that receive one-time tokens never leak a Referer.
        source: '/(verify-email|reset-password)',
        headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }],
      },
    ];
  },
};

export default nextConfig;
