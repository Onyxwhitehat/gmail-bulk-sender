import { NextResponse, type NextRequest } from 'next/server';

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const isDev = process.env.NODE_ENV === 'development';

// Only force HTTPS upgrades once the API is actually served over HTTPS. Emitting
// this unconditionally in production would rewrite http://<api> to https://<api>
// and break any deployment that has not put TLS in front of it yet.
const upgradeInsecure = API_URL.startsWith('https://');

/**
 * Emits a per-request CSP nonce.
 *
 * Next.js injects inline bootstrap scripts, and the dashboard has its own inline
 * theme script, so a nonce is the only way to keep `script-src` strict without
 * falling back to `unsafe-inline`. The nonce is passed to the app through the
 * `x-nonce` request header, which the root layout reads.
 *
 * `unsafe-eval` is required by React Fast Refresh, so it is dev-only.
 */
export function middleware(request: NextRequest) {
  const nonce = crypto.randomUUID().replace(/-/g, '');

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    // Tailwind and Next inject style tags at runtime; styles cannot execute.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${API_URL}`,
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    ...(upgradeInsecure ? ['upgrade-insecure-requests'] : []),
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets, which do not need a nonce.
    {
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
