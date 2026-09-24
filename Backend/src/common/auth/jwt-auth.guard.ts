import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { DomainError } from '../errors/domain-error';
import { PrismaService } from '../prisma/prisma.service';
import { AccessTokenPayload, AuthUser, IS_PUBLIC_KEY } from './auth.decorators';

/**
 * Global guard: verifies the access token AND that its device session is still live,
 * so logout / session revocation / suspension take effect immediately.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new DomainError('UNAUTHORIZED', 'Missing bearer token');

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new DomainError('UNAUTHORIZED', 'Invalid or expired access token');
    }

    const session = await this.prisma.session.findUnique({
      where: { id: payload.sid },
      select: { userId: true, revokedAt: true, expiresAt: true, user: { select: { status: true, role: true } } },
    });
    if (!session || session.userId !== payload.sub || session.revokedAt || session.expiresAt <= new Date()) {
      throw new DomainError('UNAUTHORIZED', 'Session is no longer active');
    }
    if (session.user.status === 'SUSPENDED') {
      throw new DomainError('ACCOUNT_SUSPENDED', 'Account is suspended');
    }

    req.user = { id: payload.sub, role: session.user.role, sessionId: payload.sid };
    return true;
  }
}
