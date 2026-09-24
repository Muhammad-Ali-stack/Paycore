import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export interface AuthUser {
  id: string;
  role: Role;
  sessionId: string;
}

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  role: Role;
}

export type AuthenticatedRequest = { user: AuthUser; id?: unknown; ip?: string };

export const IS_PUBLIC_KEY = 'auth:isPublic';
export const ROLES_KEY = 'auth:roles';

/** Route does not require an access token. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Route requires one of the given roles. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest<AuthenticatedRequest>().user;
});
