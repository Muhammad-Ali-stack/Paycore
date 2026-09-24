/**
 * The single function the BFF uses to reach the backend.
 *
 * Mock mode (NEXT_PUBLIC_API_MOCKING=enabled): the request is resolved in-process
 * by the SAME MSW handlers used in tests and Storybook, via msw's getResponse().
 * Everything above this line (cookies, bearer, refresh, Idempotency-Key and
 * correlation-id forwarding) runs exactly as in production, which keeps the BFF honest.
 */
import { MOCKING } from './config';

type Fetcher = (req: Request) => Promise<Response>;

let mockFetcher: Fetcher | null = null;

async function loadMockFetcher(): Promise<Fetcher> {
  if (mockFetcher) return mockFetcher;
  const [{ getResponse }, { handlers }] = await Promise.all([import('msw'), import('@/mocks/handlers')]);
  mockFetcher = async (req) => {
    const res = await getResponse(handlers, req);
    if (res) return res;
    return Response.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: `No mock for ${req.method} ${new URL(req.url).pathname}`,
          correlationId: 'mock',
        },
      },
      { status: 404 },
    );
  };
  return mockFetcher;
}

let override: Fetcher | null = null;
/** Tests can inject a fetcher (e.g. to simulate backend failures). */
export function setBackendFetcher(f: Fetcher | null) {
  override = f;
}

export async function backendFetch(req: Request): Promise<Response> {
  if (override) return override(req);
  if (MOCKING) return (await loadMockFetcher())(req);
  return fetch(req, { cache: 'no-store' });
}
