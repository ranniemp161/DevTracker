import { NextResponse, type NextRequest } from 'next/server';

/**
 * Forwards the browser's IP to the API (decision record 0008). The API sits behind this site's
 * `/api/v1` rewrite, and Vercel overwrites `X-Forwarded-For` between deployments, so the API
 * would otherwise see this site's IP for every user and share one rate-limit bucket.
 *
 * The IP travels in `x-devtrack-client-ip`, which the API trusts only together with the shared
 * `WEB_PROXY_SECRET`. Copies sent by the browser are always discarded.
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.delete('x-devtrack-client-ip');
  headers.delete('x-devtrack-proxy-secret');

  const secret = process.env.WEB_PROXY_SECRET;
  // On Vercel the first X-Forwarded-For entry is the client, set by Vercel's edge (not spoofable).
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (secret && ip) {
    headers.set('x-devtrack-client-ip', ip);
    headers.set('x-devtrack-proxy-secret', secret);
  }
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: '/api/v1/:path*',
};
