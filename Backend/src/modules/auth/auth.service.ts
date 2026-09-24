import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppConfig } from '../../config/app-config';
import { DomainError } from '../../common/errors/domain-error';
import { isUniqueViolation } from '../../common/errors/error-response';
import { PrismaService } from '../../common/prisma/prisma.service';
import { hashSecret, verifySecret } from './credentials.policy';
import { OtpService } from './otp/otp.service';
import { PinService } from './pin.service';
import { DeviceInfo, TokenPair, TokenService } from './token.service';

/** Verified against when the phone is unknown, so response timing doesn't reveal accounts. */
const DUMMY_HASH_PROMISE = hashSecret('paycore-timing-equaliser-not-a-password');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
    private readonly pins: PinService,
    @InjectPinoLogger(AuthService.name) private readonly logger: PinoLogger,
  ) {}

  async register(input: { phone: string; password: string; fullName: string; role?: 'CONSUMER' | 'MERCHANT' }) {
    let userId: string;
    try {
      const user = await this.prisma.user.create({
        data: {
          phone: input.phone,
          fullName: input.fullName,
          passwordHash: await hashSecret(input.password),
          role: (input.role ?? 'CONSUMER') as Role,
        },
        select: { id: true },
      });
      userId = user.id;
    } catch (err) {
      if (isUniqueViolation(err, 'phone')) throw new DomainError('CONFLICT', 'Phone number is already registered');
      throw err;
    }
    const issued = await this.otp.issue(input.phone, 'REGISTRATION');
    this.logger.info({ userId }, 'User registered; phone verification pending');
    return { userId, otpExpiresAt: issued.expiresAt.toISOString(), devOtp: issued.devCode };
  }

  async verifyPhone(phone: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user || user.status !== 'PENDING_VERIFICATION') throw new DomainError('OTP_INVALID', 'Invalid or expired code');
    await this.otp.verify(phone, 'REGISTRATION', code);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { status: 'ACTIVE', phoneVerifiedAt: new Date() },
    });
    return { verified: true };
  }

  async resendRegistrationOtp(phone: string) {
    const user = await this.prisma.user.findUnique({ where: { phone }, select: { status: true } });
    // Uniform response for unknown / already verified numbers (no enumeration).
    if (!user || user.status !== 'PENDING_VERIFICATION') return { sent: true };
    const issued = await this.otp.issue(phone, 'REGISTRATION');
    return { sent: true, otpExpiresAt: issued.expiresAt.toISOString(), devOtp: issued.devCode };
  }

  async login(input: { phone: string; password: string } & DeviceInfo): Promise<TokenPair> {
    const user = await this.prisma.user.findUnique({ where: { phone: input.phone } });
    if (!user) {
      await verifySecret(await DUMMY_HASH_PROMISE, input.password);
      throw new DomainError('INVALID_CREDENTIALS', 'Invalid phone or password');
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new DomainError('ACCOUNT_LOCKED', 'Account temporarily locked after failed logins', {
        lockedUntil: user.lockedUntil.toISOString(),
      });
    }

    if (!(await verifySecret(user.passwordHash, input.password))) {
      await this.recordFailedLogin(user.id);
      throw new DomainError('INVALID_CREDENTIALS', 'Invalid phone or password');
    }

    if (user.status === 'PENDING_VERIFICATION') throw new DomainError('PHONE_NOT_VERIFIED', 'Verify your phone first');
    if (user.status === 'SUSPENDED') throw new DomainError('ACCOUNT_SUSPENDED', 'Account is suspended');

    if (user.failedLoginAttempts > 0 || user.lockedUntil) {
      await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: null } });
    }
    const pair = await this.tokens.startSession(user, input);
    this.logger.info({ userId: user.id, sessionId: pair.sessionId }, 'Login succeeded');
    return pair;
  }

  private async recordFailedLogin(userId: string): Promise<void> {
    const max = this.config.get('LOGIN_MAX_FAILED_ATTEMPTS');
    const lockSeconds = this.config.get('LOGIN_LOCKOUT_SECONDS');
    const [row] = await this.prisma.$queryRaw<Array<{ lockedUntil: Date | null }>>`
      UPDATE users SET
        failed_login_attempts = CASE WHEN failed_login_attempts + 1 >= ${max} THEN 0 ELSE failed_login_attempts + 1 END,
        locked_until          = CASE WHEN failed_login_attempts + 1 >= ${max}
                                     THEN now() + (${lockSeconds}::int * interval '1 second')
                                     ELSE locked_until END,
        updated_at = now()
      WHERE id = ${userId}::uuid
      RETURNING locked_until AS "lockedUntil"`;
    if (row?.lockedUntil && row.lockedUntil > new Date()) {
      this.logger.warn({ userId }, 'Account locked after repeated failed logins');
    }
  }

  refresh(refreshToken: string): Promise<TokenPair> {
    return this.tokens.rotate(refreshToken);
  }

  async logout(sessionId: string): Promise<void> {
    await this.tokens.revokeSession(sessionId, 'LOGOUT');
  }

  async listSessions(userId: string, currentSessionId: string) {
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
    });
    return sessions.map((s) => ({
      id: s.id,
      deviceId: s.deviceId,
      deviceName: s.deviceName,
      userAgent: s.userAgent,
      ipAddress: s.ipAddress,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      current: s.id === currentSessionId,
    }));
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId }, select: { userId: true } });
    if (!session || session.userId !== userId) throw new DomainError('NOT_FOUND', 'Session not found');
    await this.tokens.revokeSession(sessionId, 'REVOKED_BY_USER');
  }

  async forgotPassword(phone: string) {
    const user = await this.prisma.user.findUnique({ where: { phone }, select: { status: true } });
    if (!user || user.status !== 'ACTIVE') return { sent: true };
    const issued = await this.otp.issue(phone, 'PASSWORD_RESET');
    return { sent: true, otpExpiresAt: issued.expiresAt.toISOString(), devOtp: issued.devCode };
  }

  async resetPassword(phone: string, code: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { phone }, select: { id: true } });
    if (!user) throw new DomainError('OTP_INVALID', 'Invalid or expired code');
    await this.otp.verify(phone, 'PASSWORD_RESET', code);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashSecret(newPassword), failedLoginAttempts: 0, lockedUntil: null },
    });
    await this.tokens.revokeAllSessions(user.id, 'PASSWORD_RESET');
    return { reset: true };
  }

  async setPin(userId: string, password: string, pin: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    if (!user || !(await verifySecret(user.passwordHash, password))) {
      throw new DomainError('INVALID_CREDENTIALS', 'Password is incorrect');
    }
    await this.pins.setPin(userId, pin);
    return { pinSet: true };
  }

  async changePin(userId: string, currentPin: string, newPin: string) {
    await this.pins.verify(userId, currentPin);
    await this.pins.setPin(userId, newPin);
    return { pinSet: true };
  }
}
