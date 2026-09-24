/**
 * Helpers for the mock backend: ids, fake JWTs, contract-shaped errors,
 * pagination, money arithmetic on bigint minor units.
 */
import { HttpResponse } from 'msw';
import type { Currency, Money } from '@/lib/api/contracts/common';
import { minorToDecimalString } from '@/lib/money';

export const API_PREFIX = '*/v1';

let counter = 0;
export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
}

export function correlationId() {
  return `mock-${uuid().slice(0, 8)}`;
}

export const nowIso = () => new Date().toISOString();
export const isoIn = (ms: number) => new Date(Date.now() + ms).toISOString();
export const isoAgo = (ms: number) => new Date(Date.now() - ms).toISOString();
export const DAY = 24 * 60 * 60 * 1000;

export function money(minor: bigint | string | number, currency: Currency): Money {
  const m = typeof minor === 'bigint' ? minor : BigInt(minor);
  return { currency, amountMinor: m.toString(), amount: minorToDecimalString(m, currency) };
}

/** Parse a request decimal string ("1250.50") to minor units; null when invalid. */
export function parseDecimal(amount: unknown, maxDecimals = 2): bigint | null {
  if (typeof amount !== 'string' || !/^\d+(\.\d+)?$/.test(amount)) return null;
  const [i = '0', f = ''] = amount.split('.');
  if (f.length > maxDecimals) return null;
  return BigInt(i + f.padEnd(maxDecimals, '0'));
}

/** Apply basis points with bankers-free half-up rounding on minor units. */
export function bps(minor: bigint, basisPoints: number): bigint {
  return (minor * BigInt(basisPoints) + 5000n) / 10000n;
}

export const RATE_SCALE = 100_000_000n; // rates have 8 decimals
export function rateToString(rate8: bigint): string {
  const i = rate8 / RATE_SCALE;
  const f = (rate8 % RATE_SCALE).toString().padStart(8, '0');
  return `${i}.${f}`;
}

/* ------------------------------- Responses ------------------------------ */

export function json<T>(body: T, status = 200, headers: Record<string, string> = {}) {
  return HttpResponse.json(body as never, {
    status,
    headers: { 'x-correlation-id': correlationId(), ...headers },
  });
}

export function noContent() {
  return new HttpResponse(null, { status: 204, headers: { 'x-correlation-id': correlationId() } });
}

export function apiError(status: number, code: string, message: string, details?: unknown) {
  const cid = correlationId();
  return HttpResponse.json(
    { error: { code, message, ...(details === undefined ? {} : { details }), correlationId: cid } },
    { status, headers: { 'x-correlation-id': cid } },
  );
}

export class MockHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
  toResponse() {
    return apiError(this.status, this.code, this.message, this.details);
  }
}

export const fail = (status: number, code: string, message: string, details?: unknown): never => {
  throw new MockHttpError(status, code, message, details);
};

/* ------------------------------ Pagination ------------------------------ */

export function paginate<T>(all: T[], url: URL, defaultLimit = 20) {
  const limitRaw = Number(url.searchParams.get('limit') ?? defaultLimit);
  const limit = Math.min(100, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : defaultLimit));
  const cursor = url.searchParams.get('cursor');
  const start = cursor ? Number(atobUrl(cursor)) || 0 : 0;
  const items = all.slice(start, start + limit);
  const next = start + limit < all.length ? btoaUrl(String(start + limit)) : null;
  return { items, nextCursor: next };
}

/* -------------------------------- Base64 -------------------------------- */

export function btoaUrl(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function atobUrl(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** FNV-1a 32-bit, hex. Mock-only "signature" (the real backend uses HMAC-SHA256). */
export function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/* ---------------------------------- JWT --------------------------------- */

export type MockJwtPayload = { sub: string; role: string; sid: string; exp: number; iat: number };

export function signJwt(payload: MockJwtPayload): string {
  const header = btoaUrl(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoaUrl(JSON.stringify(payload));
  return `${header}.${body}.${btoaUrl(fnv(`${header}.${body}.paycore-mock`))}`;
}

export function verifyJwt(token: string): MockJwtPayload | null {
  const [h, b, s] = token.split('.');
  if (!h || !b || !s) return null;
  if (btoaUrl(fnv(`${h}.${b}.paycore-mock`)) !== s) return null;
  try {
    return JSON.parse(atobUrl(b)) as MockJwtPayload;
  } catch {
    return null;
  }
}

export function randomToken(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function maskPhone(phone: string): string {
  if (phone.length < 8) return phone;
  return `${phone.slice(0, 6)}****${phone.slice(-3)}`;
}

export function displayNameOf(fullName: string): string {
  const [first, ...rest] = fullName.trim().split(/\s+/);
  const last = rest.at(-1);
  return last ? `${first} ${last[0]}.` : (first ?? fullName);
}

export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
}
