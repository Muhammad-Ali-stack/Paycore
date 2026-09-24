/**
 * Token rotation for the BFF.
 *
 * Refresh tokens are SINGLE USE and reuse revokes the whole session on the backend.
 * Several requests from one browser can hit an expired access token at the same
 * moment (a page mounts 5 queries). So:
 *
 *  1. Single-flight: concurrent refreshes for the same refresh token share ONE
 *     backend call (per server instance).
 *  2. Grace cache: for a short window after a rotation, a request that still
 *     carries the OLD refresh token (its cookie was sent before the browser saw
 *     the new Set-Cookie) receives the already-rotated pair instead of replaying
 *     the consumed token.
 *
 * Both maps live on globalThis so every route bundle in the process shares them.
 * On multi-instance serverless deployments the window between instances is not
 * covered; see README "Refresh token races".
 */
import type { NextResponse } from 'next/server';
import { TokenPair } from '@/lib/api/contracts/phase1';
import { apiOrigin, ACCESS_COOKIE, REFRESH_COOKIE, baseCookie } from './config';
import { backendFetch } from './backend';

export type RefreshResult = { ok: true; pair: TokenPair } | { ok: false; reason: 'invalid' | 'unavailable' };

type Store = {
  inflight: Map<string, Promise<RefreshResult>>;
  recent: Map<string, { pair: TokenPair; at: number }>;
};

const g = globalThis as typeof globalThis & { __pcRefreshStore?: Store };
function store(): Store {
  if (!g.__pcRefreshStore) g.__pcRefreshStore = { inflight: new Map(), recent: new Map() };
  return g.__pcRefreshStore;
}

export const REFRESH_GRACE_MS = 20_000;

async function doRefresh(refreshToken: string, correlationId: string): Promise<RefreshResult> {
  let res: Response;
  try {
    res = await backendFetch(
      new Request(`${apiOrigin()}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-correlation-id': correlationId },
        body: JSON.stringify({ refreshToken }),
      }),
    );
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  if (res.status === 401 || res.status === 403 || res.status === 400) return { ok: false, reason: 'invalid' };
  if (!res.ok) return { ok: false, reason: 'unavailable' };
  const parsed = TokenPair.safeParse(await res.json().catch(() => null));
  if (!parsed.success) return { ok: false, reason: 'unavailable' };
  return { ok: true, pair: parsed.data };
}

export async function refreshSession(refreshToken: string, correlationId = 'bff-refresh'): Promise<RefreshResult> {
  const s = store();
  const now = Date.now();
  for (const [k, v] of s.recent) if (now - v.at > REFRESH_GRACE_MS) s.recent.delete(k);

  const cached = s.recent.get(refreshToken);
  if (cached) return { ok: true, pair: cached.pair };

  let p = s.inflight.get(refreshToken);
  if (!p) {
    p = doRefresh(refreshToken, correlationId)
      .then((r) => {
        if (r.ok) s.recent.set(refreshToken, { pair: r.pair, at: Date.now() });
        return r;
      })
      .finally(() => s.inflight.delete(refreshToken));
    s.inflight.set(refreshToken, p);
  }
  return p;
}

/** Test helper. */
export function __resetRefreshStore() {
  g.__pcRefreshStore = { inflight: new Map(), recent: new Map() };
}

export function setSessionCookies(res: NextResponse, pair: TokenPair) {
  const refreshExpires = new Date(pair.refreshTokenExpiresAt);
  // The access cookie outlives the JWT so the route guard can still read the role
  // of an expired token; the proxy refreshes before use.
  res.cookies.set(ACCESS_COOKIE, pair.accessToken, { ...baseCookie, expires: refreshExpires });
  res.cookies.set(REFRESH_COOKIE, pair.refreshToken, { ...baseCookie, expires: refreshExpires });
}

export function clearSessionCookies(res: NextResponse) {
  res.cookies.set(ACCESS_COOKIE, '', { ...baseCookie, maxAge: 0 });
  res.cookies.set(REFRESH_COOKIE, '', { ...baseCookie, maxAge: 0 });
}

export function newCorrelationId(): string {
  return `web-${crypto.randomUUID()}`;
}
