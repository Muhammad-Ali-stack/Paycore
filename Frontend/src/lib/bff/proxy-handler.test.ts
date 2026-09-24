// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getResponse } from 'msw';
import { handlers } from '@/mocks/handlers';
import { resetDb } from '@/mocks/db';
import { signJwt } from '@/mocks/util';
import { proxyRequest } from './proxy-handler';
import { authGet, authPost } from './auth-handler';
import { setBackendFetcher } from './backend';
import { __resetRefreshStore, refreshSession } from './session';

const ORIGIN = 'http://localhost:3100';

/** Backend double = the real MSW mock handlers, with a call log. */
const calls: { method: string; path: string; headers: Headers }[] = [];
async function mockBackend(req: Request) {
  calls.push({ method: req.method, path: new URL(req.url).pathname, headers: req.headers });
  return (await getResponse(handlers, req)) ?? new Response('no mock', { status: 404 });
}

function cookieJar(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(';');
    const [k, v] = pair!.split('=');
    out[k!] = v ?? '';
  }
  return out;
}

function req(
  path: string,
  init: { method?: string; cookies?: Record<string, string>; headers?: Record<string, string>; body?: unknown } = {},
) {
  const headers = new Headers({ host: 'localhost:3100', ...init.headers });
  if (init.cookies)
    headers.set(
      'cookie',
      Object.entries(init.cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; '),
    );
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  return new NextRequest(`${ORIGIN}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

async function login(phone = '+923001234567') {
  const res = await authPost(
    req('/api/auth/login', {
      method: 'POST',
      headers: { origin: ORIGIN },
      body: { phone, password: 'Password123!', deviceId: 'vitest' },
    }),
    'login',
  );
  expect(res.status).toBe(200);
  const jar = cookieJar(res);
  return { res, jar, body: (await res.json()) as { role: string; authenticated: boolean } };
}

/** Craft an expired access token for the same session (mock JWT format). */
function expiredAccessFor(accessToken: string) {
  const payload = JSON.parse(Buffer.from(accessToken.split('.')[1]!, 'base64url').toString()) as Parameters<
    typeof signJwt
  >[0];
  return signJwt({ ...payload, exp: Math.floor(Date.now() / 1000) - 60 });
}

beforeEach(() => {
  resetDb();
  __resetRefreshStore();
  calls.length = 0;
  setBackendFetcher(mockBackend);
});
afterEach(() => setBackendFetcher(null));

describe('/api/auth/login', () => {
  it('sets httpOnly, Secure, SameSite=Lax cookies and never returns tokens in the body', async () => {
    const { res, body } = await login();
    const setCookies = res.headers.getSetCookie();
    expect(setCookies).toHaveLength(2);
    for (const c of setCookies) {
      expect(c).toMatch(/HttpOnly/i);
      expect(c).toMatch(/Secure/i);
      expect(c).toMatch(/SameSite=lax/i);
      expect(c).toMatch(/Path=\//);
    }
    expect(body).toMatchObject({ authenticated: true, role: 'CONSUMER' });
    expect(JSON.stringify(body)).not.toMatch(/accessToken|refreshToken/);
  });

  it('relays contract errors unchanged', async () => {
    const res = await authPost(
      req('/api/auth/login', {
        method: 'POST',
        headers: { origin: ORIGIN },
        body: { phone: '+923001234567', password: 'nope', deviceId: 'x' },
      }),
      'login',
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_CREDENTIALS' } });
  });

  it('blocks cross-origin auth posts (CSRF)', async () => {
    const res = await authPost(
      req('/api/auth/login', { method: 'POST', headers: { origin: 'https://evil.example' }, body: {} }),
      'login',
    );
    expect(res.status).toBe(403);
  });
});

describe('/api/proxy', () => {
  it('attaches the bearer server-side and forwards Idempotency-Key + x-correlation-id', async () => {
    const { jar } = await login();
    const wallets = await proxyRequest(req('/api/proxy/v1/wallets', { cookies: jar }), ['v1', 'wallets']);
    expect(wallets.status).toBe(200);
    const [pkr] = (await wallets.json()) as { id: string }[];
    calls.length = 0;
    const res = await proxyRequest(
      req('/api/proxy/v1/funding/topups', {
        method: 'POST',
        cookies: jar,
        headers: { origin: ORIGIN, 'idempotency-key': 'pc_test-key-123', 'x-correlation-id': 'corr-1' },
        body: { walletId: pkr!.id, amount: '100.00', method: 'BANK_TRANSFER' },
      }),
      ['v1', 'funding', 'topups'],
    );
    expect(res.status).toBe(201);
    const upstream = calls.find((c) => c.path === '/v1/funding/topups')!;
    expect(upstream.headers.get('authorization')).toMatch(/^Bearer /);
    expect(upstream.headers.get('idempotency-key')).toBe('pc_test-key-123');
    expect(upstream.headers.get('x-correlation-id')).toBe('corr-1');
    expect(upstream.headers.get('cookie')).toBeNull();
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('generates a correlation id when the browser sends none', async () => {
    const { jar } = await login();
    await proxyRequest(req('/api/proxy/v1/wallets', { cookies: jar }), ['v1', 'wallets']);
    expect(calls.at(-1)!.headers.get('x-correlation-id')).toMatch(/^web-/);
  });

  it('proactively refreshes an expired access token, rotates cookies once, and succeeds', async () => {
    const { jar } = await login();
    const cookies = { ...jar, pc_at: expiredAccessFor(jar.pc_at!) };
    const res = await proxyRequest(req('/api/proxy/v1/wallets', { cookies }), ['v1', 'wallets']);
    expect(res.status).toBe(200);
    expect(calls.filter((c) => c.path === '/v1/auth/refresh')).toHaveLength(1);
    const rotated = cookieJar(res);
    expect(rotated.pc_rt).toBeTruthy();
    expect(rotated.pc_rt).not.toBe(jar.pc_rt);
  });

  it('reactively refreshes on 401 UNAUTHORIZED and retries exactly once', async () => {
    const { jar } = await login();
    // A token that decodes as unexpired but the backend rejects (bad signature).
    const [h, p] = jar.pc_at!.split('.');
    const forged = `${h}.${p}.invalidsig`;
    const res = await proxyRequest(req('/api/proxy/v1/users/me', { cookies: { ...jar, pc_at: forged } }), [
      'v1',
      'users',
      'me',
    ]);
    expect(res.status).toBe(200);
    expect(calls.filter((c) => c.path === '/v1/users/me')).toHaveLength(2);
    expect(calls.filter((c) => c.path === '/v1/auth/refresh')).toHaveLength(1);
  });

  it('concurrent requests with an expired token share ONE refresh (single-use refresh token is not replayed)', async () => {
    const { jar } = await login();
    const cookies = { ...jar, pc_at: expiredAccessFor(jar.pc_at!) };
    const results = await Promise.all(
      Array.from({ length: 5 }, () => proxyRequest(req('/api/proxy/v1/wallets', { cookies }), ['v1', 'wallets'])),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(calls.filter((c) => c.path === '/v1/auth/refresh')).toHaveLength(1);
    // The session is still alive: the new refresh token works.
    const next = cookieJar(results[0]!);
    const again = await refreshSession(next.pc_rt!);
    expect(again.ok).toBe(true);
  });

  it('a late request still carrying the OLD refresh token gets the rotated pair (grace window), not a revocation', async () => {
    const { jar } = await login();
    const cookies = { ...jar, pc_at: expiredAccessFor(jar.pc_at!) };
    const first = await proxyRequest(req('/api/proxy/v1/wallets', { cookies }), ['v1', 'wallets']);
    expect(first.status).toBe(200);
    const late = await proxyRequest(req('/api/proxy/v1/wallets', { cookies }), ['v1', 'wallets']);
    expect(late.status).toBe(200);
    expect(calls.filter((c) => c.path === '/v1/auth/refresh')).toHaveLength(1);
  });

  it('when refresh fails: 401 with x-auth-state=expired and cookies cleared', async () => {
    const { jar } = await login();
    const cookies = { pc_at: expiredAccessFor(jar.pc_at!), pc_rt: 'not-a-valid-refresh-token' };
    const res = await proxyRequest(req('/api/proxy/v1/wallets', { cookies }), ['v1', 'wallets']);
    expect(res.status).toBe(401);
    expect(res.headers.get('x-auth-state')).toBe('expired');
    const cleared = res.headers.getSetCookie().join(';');
    expect(cleared).toMatch(/pc_at=;/);
    expect(cleared).toMatch(/pc_rt=;/);
  });

  it('does not treat business 4xx (PIN_INVALID) as a session problem', async () => {
    const { jar } = await login();
    const res = await proxyRequest(
      req('/api/proxy/v1/auth/pin/verify', {
        method: 'POST',
        cookies: jar,
        headers: { origin: ORIGIN },
        body: { pin: '0000' },
      }),
      ['v1', 'auth', 'pin', 'verify'],
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: { code: 'PIN_INVALID', details: { attemptsRemaining: 4 } } });
    expect(calls.filter((c) => c.path === '/v1/auth/refresh')).toHaveLength(0);
  });

  it('blocks cross-origin mutations and unknown path prefixes', async () => {
    const { jar } = await login();
    const cross = await proxyRequest(
      req('/api/proxy/v1/transfers', {
        method: 'POST',
        cookies: jar,
        headers: { origin: 'https://evil.example' },
        body: {},
      }),
      ['v1', 'transfers'],
    );
    expect(cross.status).toBe(403);
    const unknown = await proxyRequest(req('/api/proxy/internal/admin', { cookies: jar }), ['internal', 'admin']);
    expect(unknown.status).toBe(404);
  });

  it('returns 502 NETWORK_ERROR when the backend is unreachable', async () => {
    const { jar } = await login();
    setBackendFetcher(() => Promise.reject(new TypeError('fetch failed')));
    const res = await proxyRequest(req('/api/proxy/v1/wallets', { cookies: jar }), ['v1', 'wallets']);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: { code: 'NETWORK_ERROR' } });
  });
});

describe('/api/auth/session and refresh redirect', () => {
  it('reports the role for routing, refreshing if needed', async () => {
    const { jar } = await login('+923009876543');
    const res = await authGet(
      req('/api/auth/session', { cookies: { ...jar, pc_at: expiredAccessFor(jar.pc_at!) } }),
      'session',
    );
    expect(await res.json()).toMatchObject({ authenticated: true, role: 'MERCHANT' });
  });
  it('refresh?next= only redirects to same-site paths', async () => {
    const { jar } = await login();
    const res = await authGet(req('/api/auth/refresh?next=//evil.example', { cookies: jar }), 'refresh');
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).origin).toBe(ORIGIN);
  });
  it('logout clears cookies and revokes the backend session', async () => {
    const { jar } = await login();
    const out = await authPost(
      req('/api/auth/logout', { method: 'POST', cookies: jar, headers: { origin: ORIGIN }, body: {} }),
      'logout',
    );
    expect(out.headers.getSetCookie().join(';')).toMatch(/pc_at=;/);
    const after = await proxyRequest(req('/api/proxy/v1/wallets', { cookies: jar }), ['v1', 'wallets']);
    expect(after.status).toBe(401);
  });
});

vi.setConfig({ testTimeout: 20_000 });
