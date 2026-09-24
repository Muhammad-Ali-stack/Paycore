/**
 * Decode (NOT verify) a JWT payload. Used only for routing decisions and expiry
 * checks; the backend verifies every token and enforces authorization.
 * Edge/Node/browser safe (no Buffer).
 */
export type AccessClaims = {
  sub?: string;
  role?: 'CONSUMER' | 'MERCHANT' | 'ADMIN';
  sid?: string;
  exp?: number;
  iat?: number;
};

export function decodeJwt(token: string | undefined | null): AccessClaims | null {
  if (!token) return null;
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((part.length + 3) % 4);
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const json = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return json && typeof json === 'object' ? (json as AccessClaims) : null;
  } catch {
    return null;
  }
}

/** True when the token is missing, undecodable or expires within `skewSeconds`. */
export function isExpired(token: string | undefined | null, skewSeconds = 15, now = Date.now()): boolean {
  const claims = decodeJwt(token);
  if (!claims?.exp) return true;
  return claims.exp * 1000 - skewSeconds * 1000 <= now;
}

export function roleHome(role: string | undefined | null): string {
  if (role === 'ADMIN') return '/admin';
  if (role === 'MERCHANT') return '/merchant';
  return '/home';
}
