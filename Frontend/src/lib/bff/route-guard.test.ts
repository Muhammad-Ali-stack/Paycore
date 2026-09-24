// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { guard } from './route-guard';
import { decodeJwt, isExpired, roleHome } from './jwt';
import { signJwt } from '@/mocks/util';

const token = (role: string, expOffset = 600) =>
  signJwt({ sub: 'u1', role, sid: 's1', iat: 0, exp: Math.floor(Date.now() / 1000) + expOffset });

describe('jwt helpers', () => {
  it('decodes payloads and detects expiry with skew', () => {
    expect(decodeJwt(token('ADMIN'))?.role).toBe('ADMIN');
    expect(decodeJwt('garbage')).toBeNull();
    expect(isExpired(token('CONSUMER', 600))).toBe(false);
    expect(isExpired(token('CONSUMER', 5))).toBe(true); // within 15s skew
    expect(isExpired(undefined)).toBe(true);
  });
  it('maps roles to home routes', () => {
    expect(roleHome('ADMIN')).toBe('/admin');
    expect(roleHome('MERCHANT')).toBe('/merchant');
    expect(roleHome('CONSUMER')).toBe('/home');
  });
});

describe('route guard', () => {
  it('sends anonymous users to login with next', () => {
    expect(guard('/send', '?to=@ali_k')).toEqual({ type: 'redirect', to: '/login?next=%2Fsend%3Fto%3D%40ali_k' });
    expect(guard('/', '')).toEqual({ type: 'redirect', to: '/login' });
  });
  it('lets anonymous users see auth pages', () => {
    expect(guard('/login', '')).toEqual({ type: 'next' });
    expect(guard('/register', '')).toEqual({ type: 'next' });
  });
  it('bounces signed-in users away from auth pages to their portal', () => {
    expect(guard('/login', '', token('MERCHANT'), 'rt')).toEqual({ type: 'redirect', to: '/merchant' });
  });
  it('refreshes via the BFF when only the refresh cookie survived', () => {
    expect(guard('/cards', '', undefined, 'rt')).toEqual({ type: 'redirect', to: '/api/auth/refresh?next=%2Fcards' });
  });
  it('enforces MERCHANT and ADMIN areas', () => {
    expect(guard('/merchant/qr', '', token('CONSUMER'), 'rt')).toEqual({ type: 'redirect', to: '/forbidden' });
    expect(guard('/admin', '', token('MERCHANT'), 'rt')).toEqual({ type: 'redirect', to: '/forbidden' });
    expect(guard('/admin/kyc', '', token('ADMIN'), 'rt')).toEqual({ type: 'next' });
    expect(guard('/merchant', '', token('MERCHANT'), 'rt')).toEqual({ type: 'next' });
  });
  it('allows any authenticated role on consumer routes and routes / by role', () => {
    expect(guard('/home', '', token('CONSUMER'), 'rt')).toEqual({ type: 'next' });
    expect(guard('/', '', token('ADMIN'), 'rt')).toEqual({ type: 'redirect', to: '/admin' });
  });
  it('still routes an expired access token by role (the proxy refreshes before use)', () => {
    expect(guard('/merchant', '', token('MERCHANT', -3600), 'rt')).toEqual({ type: 'next' });
  });
  it('does not confuse /merchants-like paths with the merchant area', () => {
    expect(guard('/merchantx', '', token('CONSUMER'), 'rt')).toEqual({ type: 'next' });
  });
});
