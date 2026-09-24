import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role, Session } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppConfig } from '../../config/app-config';
import { AccessTokenPayload } from '../../common/auth/auth.decorators';
import { DomainError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { randomToken, sha256 } from '../../common/util/crypto';
import { addSeconds } from '../../common/util/time';

export interface TokenPair {
  tokenType: 'Bearer';
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  sessionId: string;
}

export interface DeviceInfo {
  deviceId: string;
  deviceName?: string;
  userAgent?: string;
  ipAddress?: string;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    @InjectPinoLogger(TokenService.name) private readonly logger: PinoLogger,
  ) {}

  /** One live session per (user, device): logging in again on a device replaces its session. */
  async startSession(user: { id: string; role: Role }, device: DeviceInfo): Promise<TokenPair> {
    const now = new Date();
    const refreshTtl = this.config.get('REFRESH_TOKEN_TTL_SECONDS');
    const refreshToken = randomToken();

    const session = await this.prisma.$transaction(async (tx) => {
      await tx.session.updateMany({
        where: { userId: user.id, deviceId: device.deviceId, revokedAt: null },
        data: { revokedAt: now, revokeReason: 'REPLACED_BY_NEW_LOGIN' },
      });
      const created = await tx.session.create({
        data: {
          userId: user.id,
          deviceId: device.deviceId,
          deviceName: device.deviceName,
          userAgent: device.userAgent?.slice(0, 512),
          ipAddress: device.ipAddress,
          expiresAt: addSeconds(now, refreshTtl),
        },
      });
      await tx.refreshToken.create({
        data: { sessionId: created.id, tokenHash: sha256(refreshToken), expiresAt: created.expiresAt },
      });
      return created;
    });

    return this.buildPair(user, session, refreshToken);
  }

  /**
   * Rotate a refresh token. Each token is single-use: a second presentation of an already
   * rotated token indicates theft, so the whole session (all descendants) is revoked.
   */
  async rotate(presented: string): Promise<TokenPair> {
    const now = new Date();
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(presented) },
      include: { session: { include: { user: { select: { id: true, role: true, status: true } } } } },
    });
    if (!record) throw new DomainError('UNAUTHORIZED', 'Invalid refresh token');
    const { session } = record;

    if (session.revokedAt || session.expiresAt <= now || record.expiresAt <= now) {
      throw new DomainError('UNAUTHORIZED', 'Session is no longer active');
    }
    if (session.user.status !== 'ACTIVE') throw new DomainError('ACCOUNT_SUSPENDED', 'Account is not active');

    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) {
      await this.revokeSession(session.id, 'REFRESH_TOKEN_REUSE');
      this.logger.warn({ sessionId: session.id, userId: session.userId }, 'Refresh token reuse detected; session revoked');
      throw new DomainError('UNAUTHORIZED', 'Refresh token reuse detected; session revoked');
    }

    const next = randomToken();
    await this.prisma.$transaction([
      this.prisma.refreshToken.create({
        data: { sessionId: session.id, tokenHash: sha256(next), expiresAt: session.expiresAt },
      }),
      this.prisma.session.update({ where: { id: session.id }, data: { lastUsedAt: now } }),
    ]);
    return this.buildPair(session.user, session, next);
  }

  async revokeSession(sessionId: string, reason: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
  }

  async revokeAllSessions(userId: string, reason: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
  }

  private async buildPair(user: { id: string; role: Role }, session: Session, refreshToken: string): Promise<TokenPair> {
    const ttl = this.config.get('JWT_ACCESS_TTL_SECONDS');
    const payload: AccessTokenPayload = { sub: user.id, sid: session.id, role: user.role };
    return {
      tokenType: 'Bearer',
      accessToken: await this.jwt.signAsync(payload, { expiresIn: ttl }),
      accessTokenExpiresIn: ttl,
      refreshToken,
      refreshTokenExpiresAt: session.expiresAt.toISOString(),
      sessionId: session.id,
    };
  }
}
