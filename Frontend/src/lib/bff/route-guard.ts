/**
 * Role-based route protection (runs in src/proxy.ts, Next 16's name for middleware.ts).
 * Decodes the JWT payload for routing only; the backend enforces authorization.
 */
import { decodeJwt, roleHome } from './jwt';

export type GuardDecision = { type: 'next' } | { type: 'redirect'; to: string };

const PUBLIC_EXACT = new Set(['/offline', '/forbidden']);
const AUTH_PAGES = ['/login', '/register', '/verify', '/forgot-password'];

export function isAuthPage(pathname: string) {
  return AUTH_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function requiredRole(pathname: string): 'MERCHANT' | 'ADMIN' | 'ANY' {
  if (pathname === '/merchant' || pathname.startsWith('/merchant/')) return 'MERCHANT';
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'ADMIN';
  return 'ANY';
}

export function guard(pathname: string, search: string, accessToken?: string, refreshToken?: string): GuardDecision {
  if (PUBLIC_EXACT.has(pathname)) return { type: 'next' };
  const claims = decodeJwt(accessToken);
  const signedIn = Boolean(claims?.sub || refreshToken);

  if (isAuthPage(pathname)) {
    // PIN setup lives under the authenticated area, so every auth page is for signed-out users.
    if (claims?.role && refreshToken) return { type: 'redirect', to: roleHome(claims.role) };
    return { type: 'next' };
  }

  const next = encodeURIComponent(`${pathname}${search}`);
  if (!claims) {
    if (refreshToken) return { type: 'redirect', to: `/api/auth/refresh?next=${next}` };
    return { type: 'redirect', to: pathname === '/' ? '/login' : `/login?next=${next}` };
  }
  if (!signedIn) return { type: 'redirect', to: `/login?next=${next}` };

  if (pathname === '/') return { type: 'redirect', to: roleHome(claims.role) };

  const need = requiredRole(pathname);
  if (need !== 'ANY' && claims.role !== need) return { type: 'redirect', to: '/forbidden' };
  return { type: 'next' };
}
