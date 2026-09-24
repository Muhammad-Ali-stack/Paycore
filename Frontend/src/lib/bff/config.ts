/** Server-only BFF configuration. */
export const MOCKING = process.env.NEXT_PUBLIC_API_MOCKING === 'enabled';

/** Backend origin (no trailing slash, no /v1). NEXT_PUBLIC_API_URL per the spec; API_URL wins if set. */
export function apiOrigin(): string {
  const raw = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
  return raw.replace(/\/+$/, '').replace(/\/v1$/, '');
}

export const ACCESS_COOKIE = 'pc_at';
export const REFRESH_COOKIE = 'pc_rt';

/** Secure cookies everywhere; set COOKIE_SECURE=false only for plain-http LAN testing. */
export const COOKIE_SECURE = process.env.COOKIE_SECURE !== 'false';

export const baseCookie = {
  httpOnly: true,
  secure: COOKIE_SECURE,
  sameSite: 'lax' as const,
  path: '/',
};
