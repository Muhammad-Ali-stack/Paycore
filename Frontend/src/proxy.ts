/**
 * Next.js 16 "proxy" (formerly middleware.ts): role-based route protection + security headers.
 * See src/lib/bff/route-guard.ts for the rules.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/bff/config';
import { guard } from '@/lib/bff/route-guard';

function contentSecurityPolicy(nonce: string) {
  const isDev = process.env.NODE_ENV === 'development';
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? ` 'unsafe-eval'` : ''}`,
    // Inline style attributes are used by Framer Motion and Recharts.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data:`,
    `font-src 'self' data:`,
    `connect-src 'self'`,
    `media-src 'self' blob:`,
    `worker-src 'self' blob:`,
    `manifest-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    ...(process.env.VERCEL ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const decision = guard(
    pathname,
    search,
    request.cookies.get(ACCESS_COOKIE)?.value,
    request.cookies.get(REFRESH_COOKIE)?.value,
  );
  if (decision.type === 'redirect') {
    return NextResponse.redirect(new URL(decision.to, request.url));
  }

  const nonce = btoa(crypto.randomUUID());
  const csp = contentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('content-security-policy', csp);
  response.headers.set('x-content-type-options', 'nosniff');
  response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  response.headers.set('x-frame-options', 'DENY');
  response.headers.set('permissions-policy', 'camera=(self), microphone=(), geolocation=(), payment=()');
  if (process.env.VERCEL) {
    response.headers.set('strict-transport-security', 'max-age=63072000; includeSubDomains; preload');
  }
  return response;
}

export const config = {
  // Pages only: skip API routes, Next internals and static assets.
  matcher: [
    {
      source: '/((?!api|_next/static|_next/image|favicon.ico|icons|logo.svg|manifest.webmanifest|sw.js|robots.txt).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
