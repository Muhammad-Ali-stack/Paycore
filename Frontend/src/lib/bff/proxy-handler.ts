/**
 * Catch-all API proxy: /api/proxy/<path> -> ${API_URL}/<path>
 *
 * - Attaches `Authorization: Bearer` from the httpOnly access cookie (server-side only).
 * - Forwards Idempotency-Key and x-correlation-id (creates one if absent).
 * - Silent refresh: proactive when the access token is expired, reactive on a
 *   401 UNAUTHORIZED; rotates at most once and retries the request at most once.
 *   Money POSTs are safe to retry: an auth failure means the backend never ran
 *   them, and the same Idempotency-Key is sent again anyway.
 * - Never forwards browser cookies to the backend; never exposes tokens.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { apiOrigin, ACCESS_COOKIE, REFRESH_COOKIE } from './config';
import { backendFetch } from './backend';
import { isExpired } from './jwt';
import {
  clearSessionCookies,
  newCorrelationId,
  refreshSession,
  setSessionCookies,
  type RefreshResult,
} from './session';
import type { TokenPair } from '@/lib/api/contracts/phase1';

const FORWARD_REQUEST_HEADERS = ['content-type', 'accept', 'accept-language', 'idempotency-key', 'user-agent'];
const FORWARD_RESPONSE_HEADERS = [
  'content-type',
  'content-disposition',
  'x-correlation-id',
  'idempotent-replayed',
  'retry-after',
  'x-ratelimit-remaining',
];
const ALLOWED_PREFIXES = ['v1/', 'health'];

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true; // same-origin GETs and non-browser clients omit Origin
  try {
    return new URL(origin).host === req.headers.get('host');
  } catch {
    return false;
  }
}

function errorJson(status: number, code: string, message: string, extraHeaders: Record<string, string> = {}) {
  return NextResponse.json(
    { error: { code, message, correlationId: 'bff' } },
    { status, headers: { 'cache-control': 'no-store', ...extraHeaders } },
  );
}

async function isAuthFailure(res: Response): Promise<boolean> {
  if (res.status !== 401) return false;
  try {
    const body = (await res.clone().json()) as { error?: { code?: string } };
    const code = body?.error?.code;
    // PIN_INVALID and friends are business errors, not session errors.
    return !code || code === 'UNAUTHORIZED' || code === 'TOKEN_EXPIRED';
  } catch {
    return true;
  }
}

export async function proxyRequest(req: NextRequest, segments: string[]): Promise<NextResponse> {
  const path = segments.map(encodeURIComponent).join('/');
  if (!ALLOWED_PREFIXES.some((p) => path === p || path.startsWith(p))) {
    return errorJson(404, 'NOT_FOUND', 'Unknown API path');
  }
  const method = req.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD' && !sameOrigin(req)) {
    return errorJson(403, 'FORBIDDEN', 'Cross-origin request blocked');
  }

  const correlationId = req.headers.get('x-correlation-id') || newCorrelationId();
  const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value;
  let accessToken = req.cookies.get(ACCESS_COOKIE)?.value;
  let rotated: TokenPair | null = null;

  const expired = () => {
    const res = errorJson(401, 'UNAUTHORIZED', 'Session expired', { 'x-auth-state': 'expired' });
    clearSessionCookies(res);
    return res;
  };

  const rotate = async (): Promise<RefreshResult | null> => {
    if (!refreshToken || rotated) return null;
    const r = await refreshSession(refreshToken, correlationId);
    if (r.ok) {
      rotated = r.pair;
      accessToken = r.pair.accessToken;
    }
    return r;
  };

  // Proactive refresh.
  if (refreshToken && isExpired(accessToken)) {
    const r = await rotate();
    if (r && !r.ok && r.reason === 'invalid') return expired();
  }

  const body = method === 'GET' || method === 'HEAD' ? undefined : await req.arrayBuffer();
  const target = `${apiOrigin()}/${path}${req.nextUrl.search}`;

  const send = () => {
    const headers = new Headers();
    for (const h of FORWARD_REQUEST_HEADERS) {
      const v = req.headers.get(h);
      if (v) headers.set(h, v);
    }
    headers.set('x-correlation-id', correlationId);
    const fwd = req.headers.get('x-forwarded-for');
    if (fwd) headers.set('x-forwarded-for', fwd);
    if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);
    return backendFetch(new Request(target, { method, headers, body: body && body.byteLength ? body : undefined }));
  };

  let upstream: Response;
  try {
    upstream = await send();
    if (await isAuthFailure(upstream)) {
      const r = await rotate();
      if (r?.ok) upstream = await send();
      else if (r && r.reason === 'invalid') return expired();
      else if (!refreshToken) {
        const res = errorJson(401, 'UNAUTHORIZED', 'Not signed in', { 'x-auth-state': 'expired' });
        clearSessionCookies(res);
        return res;
      }
    }
  } catch {
    return errorJson(502, 'NETWORK_ERROR', 'Backend unreachable', { 'x-correlation-id': correlationId });
  }

  const headers = new Headers({ 'cache-control': 'no-store' });
  for (const h of FORWARD_RESPONSE_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (!headers.has('x-correlation-id')) headers.set('x-correlation-id', correlationId);
  if (upstream.status === 401 && (await isAuthFailure(upstream))) headers.set('x-auth-state', 'expired');

  const payload = upstream.status === 204 || method === 'HEAD' ? null : await upstream.arrayBuffer();
  const res = new NextResponse(payload, { status: upstream.status, headers });
  if (rotated) setSessionCookies(res, rotated);
  return res;
}
