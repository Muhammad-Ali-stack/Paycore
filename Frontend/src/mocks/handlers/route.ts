import { delay, http, type HttpResponseResolver, type PathParams } from 'msw';
import { tickFunding } from '../ledger';
import { MockHttpError, apiError } from '../util';

type Ctx = { request: Request; params: PathParams; url: URL };
type Fn = (ctx: Ctx) => Promise<Response> | Response;

function latency(): number {
  const v = Number(process.env.MOCK_LATENCY_MS ?? process.env.NEXT_PUBLIC_MOCK_LATENCY_MS);
  return Number.isFinite(v) && v >= 0 ? v : 120;
}

/** Wrap a resolver: simulated latency, lazy async work, contract-shaped errors. */
export function route(fn: Fn): HttpResponseResolver {
  return async ({ request, params }) => {
    const ms = latency();
    if (ms > 0) await delay(ms);
    try {
      tickFunding();
      return await fn({ request, params, url: new URL(request.url) });
    } catch (e) {
      if (e instanceof MockHttpError) return e.toResponse();
      console.error('[mock] handler crashed', e instanceof Error ? e.message : e);
      return apiError(500, 'INTERNAL', 'Mock handler error');
    }
  };
}

const P = '*/v1';
export const get = (path: string, fn: Fn) => http.get(`${P}${path}`, route(fn));
export const postR = (path: string, fn: Fn) => http.post(`${P}${path}`, route(fn));
export const putR = (path: string, fn: Fn) => http.put(`${P}${path}`, route(fn));
export const patchR = (path: string, fn: Fn) => http.patch(`${P}${path}`, route(fn));
export const del = (path: string, fn: Fn) => http.delete(`${P}${path}`, route(fn));

export const str = (v: unknown): string => (typeof v === 'string' ? v : '');
