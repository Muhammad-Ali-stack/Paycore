/**
 * /api/auth/* : the only place tokens are issued to or cleared from the browser,
 * always as httpOnly, Secure, SameSite=Lax cookies. Tokens never appear in a
 * response body.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { TokenPair } from '@/lib/api/contracts/phase1';
import { apiOrigin, ACCESS_COOKIE, REFRESH_COOKIE } from './config';
import { backendFetch } from './backend';
import { decodeJwt, isExpired, roleHome } from './jwt';
import { clearSessionCookies, newCorrelationId, refreshSession, setSessionCookies } from './session';

const PASS_THROUGH: Record<string, string> = {
  register: '/v1/auth/register',
  'verify-phone': '/v1/auth/verify-phone',
  'otp/resend': '/v1/auth/otp/resend',
  'password/forgot': '/v1/auth/password/forgot',
  'password/reset': '/v1/auth/password/reset',
};

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.get('host');
  } catch {
    return false;
  }
}

async function callBackend(path: string, body: unknown, correlationId: string, token?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-correlation-id': correlationId };
  if (token) headers.authorization = `Bearer ${token}`;
  return backendFetch(
    new Request(`${apiOrigin()}${path}`, {
      method: 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

async function relay(upstream: Response) {
  const text = await upstream.text();
  return new NextResponse(text || null, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'x-correlation-id': upstream.headers.get('x-correlation-id') ?? '',
      'cache-control': 'no-store',
    },
  });
}

/** Resolve the role for routing: JWT claim first, /users/me as a fallback. */
async function sessionInfo(pair: Pick<TokenPair, 'accessToken' | 'sessionId'>, correlationId: string) {
  const claims = decodeJwt(pair.accessToken);
  let role = claims?.role ?? null;
  let userId = claims?.sub ?? null;
  if (!role) {
    const me = await backendFetch(
      new Request(`${apiOrigin()}/v1/users/me`, {
        headers: { authorization: `Bearer ${pair.accessToken}`, 'x-correlation-id': correlationId },
      }),
    );
    if (me.ok) {
      const u = (await me.json()) as { role?: typeof role; id?: string };
      role = u.role ?? null;
      userId = u.id ?? userId;
    }
  }
  return { authenticated: true, role, userId, sessionId: pair.sessionId ?? claims?.sid ?? null };
}

const anonymous = { authenticated: false, role: null, userId: null, sessionId: null };

export async function authPost(req: NextRequest, action: string): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Cross-origin request blocked', correlationId: 'bff' } },
      { status: 403 },
    );
  }
  const correlationId = newCorrelationId();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (action === 'login') {
    const upstream = await callBackend('/v1/auth/login', body, correlationId);
    if (!upstream.ok) return relay(upstream);
    const pair = TokenPair.safeParse(await upstream.json());
    if (!pair.success) {
      return NextResponse.json(
        { error: { code: 'CONTRACT_MISMATCH', message: 'Unexpected login response', correlationId } },
        { status: 502 },
      );
    }
    const res = NextResponse.json(await sessionInfo(pair.data, correlationId), {
      headers: { 'cache-control': 'no-store' },
    });
    setSessionCookies(res, pair.data);
    return res;
  }

  if (action === 'logout') {
    const token = req.cookies.get(ACCESS_COOKIE)?.value;
    if (token) await callBackend('/v1/auth/logout', undefined, correlationId, token).catch(() => null);
    const res = NextResponse.json(anonymous, { headers: { 'cache-control': 'no-store' } });
    clearSessionCookies(res);
    return res;
  }

  const path = PASS_THROUGH[action];
  if (!path)
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Unknown auth action', correlationId } },
      { status: 404 },
    );
  return relay(await callBackend(path, body, correlationId));
}

export async function authGet(req: NextRequest, action: string): Promise<NextResponse> {
  const correlationId = newCorrelationId();
  const access = req.cookies.get(ACCESS_COOKIE)?.value;
  const refresh = req.cookies.get(REFRESH_COOKIE)?.value;

  if (action === 'session') {
    if (access && !isExpired(access)) {
      return NextResponse.json(
        await sessionInfo({ accessToken: access, sessionId: decodeJwt(access)?.sid ?? '' }, correlationId),
        {
          headers: { 'cache-control': 'no-store' },
        },
      );
    }
    if (refresh) {
      const r = await refreshSession(refresh, correlationId);
      if (r.ok) {
        const res = NextResponse.json(await sessionInfo(r.pair, correlationId), {
          headers: { 'cache-control': 'no-store' },
        });
        setSessionCookies(res, r.pair);
        return res;
      }
      if (r.reason === 'unavailable') {
        return NextResponse.json(
          { error: { code: 'NETWORK_ERROR', message: 'Backend unreachable', correlationId } },
          { status: 502 },
        );
      }
    }
    const res = NextResponse.json(anonymous, { headers: { 'cache-control': 'no-store' } });
    clearSessionCookies(res);
    return res;
  }

  if (action === 'refresh') {
    // Used by the route guard when only the refresh cookie survived: rotate and bounce back.
    const nextParam = req.nextUrl.searchParams.get('next') ?? '/';
    const next = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/';
    if (refresh) {
      const r = await refreshSession(refresh, correlationId);
      if (r.ok) {
        const role = decodeJwt(r.pair.accessToken)?.role;
        const res = NextResponse.redirect(new URL(next === '/' ? roleHome(role) : next, req.url));
        setSessionCookies(res, r.pair);
        return res;
      }
    }
    const res = NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(next)}`, req.url));
    clearSessionCookies(res);
    return res;
  }

  return NextResponse.json(
    { error: { code: 'NOT_FOUND', message: 'Unknown auth action', correlationId } },
    { status: 404 },
  );
}
