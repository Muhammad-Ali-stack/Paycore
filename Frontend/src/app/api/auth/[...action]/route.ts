import type { NextRequest } from 'next/server';
import { authGet, authPost } from '@/lib/bff/auth-handler';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ action: string[] }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  return authPost(req, (await ctx.params).action.join('/'));
}

export async function GET(req: NextRequest, ctx: Ctx) {
  return authGet(req, (await ctx.params).action.join('/'));
}
