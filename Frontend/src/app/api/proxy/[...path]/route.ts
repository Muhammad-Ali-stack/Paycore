import type { NextRequest } from 'next/server';
import { proxyRequest } from '@/lib/bff/proxy-handler';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ path: string[] }> };

async function handle(req: NextRequest, ctx: Ctx) {
  return proxyRequest(req, (await ctx.params).path);
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
