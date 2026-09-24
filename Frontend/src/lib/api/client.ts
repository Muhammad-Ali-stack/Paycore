/**
 * Browser API client. The browser only ever talks to this Next app:
 *   /api/proxy/v1/...  -> BFF catch-all -> backend (bearer attached server-side)
 *
 * `api` is an openapi-fetch client typed with ApiPaths (generated + contracts).
 * `call()` turns its result into parsed contract data or a thrown ApiError.
 */
import createClient from 'openapi-fetch';
import type { z } from 'zod';
import type { ApiPaths } from './paths';
import { ApiError, errorFromBody, networkError } from './errors';

export const PROXY_BASE = '/api/proxy';

type Listener = () => void;
const sessionExpiredListeners = new Set<Listener>();
/** Fired when the BFF could not refresh the session (refresh token gone or revoked). */
export function onSessionExpired(fn: Listener) {
  sessionExpiredListeners.add(fn);
  return () => {
    sessionExpiredListeners.delete(fn);
  };
}

async function bffFetch(input: Request): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(input);
  } catch (e) {
    throw networkError(e);
  }
  if (res.status === 401 && res.headers.get('x-auth-state') === 'expired') {
    sessionExpiredListeners.forEach((l) => l());
  }
  return res;
}

export function createApiClient(baseUrl = PROXY_BASE, fetchImpl: (r: Request) => Promise<Response> = bffFetch) {
  return createClient<ApiPaths>({ baseUrl, fetch: fetchImpl, credentials: 'same-origin' });
}

export const api = createApiClient();

type FetchResult = { data?: unknown; error?: unknown; response: Response };

const isDev = process.env.NODE_ENV !== 'production';

/** Await an openapi-fetch call, throw ApiError on failure, validate against the contract. */
export async function call<S extends z.ZodType>(schema: S, request: Promise<FetchResult>): Promise<z.infer<S>> {
  let result: FetchResult;
  try {
    result = await request;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw networkError(e);
  }
  const { response } = result;
  if (!response.ok) throw errorFromBody(response.status, result.error, response.headers);
  const parsed = schema.safeParse(result.data);
  if (!parsed.success) {
    // Log only the failing paths, never values (no PII in logs).
    if (isDev) {
      console.warn(
        '[api] contract mismatch',
        response.url.replace(/\?.*$/, ''),
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.code}`),
      );
    }
    throw new ApiError({
      status: response.status,
      code: 'CONTRACT_MISMATCH',
      message: 'The server response did not match the API contract',
      correlationId: response.headers.get('x-correlation-id') ?? undefined,
    });
  }
  return parsed.data;
}

/** For 204 / body-less endpoints. */
export async function callVoid(request: Promise<FetchResult>): Promise<void> {
  let result: FetchResult;
  try {
    result = await request;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw networkError(e);
  }
  if (!result.response.ok) {
    throw errorFromBody(result.response.status, result.error, result.response.headers);
  }
}

/** Raw download through the proxy (CSV / PDF). Returns a Blob. */
export async function download(path: string, query: Record<string, string | undefined>): Promise<Blob> {
  const qs = new URLSearchParams(Object.entries(query).filter((e): e is [string, string] => Boolean(e[1]))).toString();
  const res = await bffFetch(new Request(`${PROXY_BASE}${path}${qs ? `?${qs}` : ''}`));
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* not json */
    }
    throw errorFromBody(res.status, body, res.headers);
  }
  return res.blob();
}

/** Calls to the BFF auth routes (/api/auth/*), which set/clear httpOnly cookies. */
export async function authCall<S extends z.ZodType>(
  schema: S,
  path: string,
  body?: unknown,
  method: 'POST' | 'GET' = 'POST',
): Promise<z.infer<S>> {
  let res: Response;
  try {
    res = await fetch(`/api/auth/${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch (e) {
    throw networkError(e);
  }
  const data: unknown = res.status === 204 ? {} : await res.json().catch(() => null);
  if (!res.ok) throw errorFromBody(res.status, data, res.headers);
  return schema.parse(data);
}
