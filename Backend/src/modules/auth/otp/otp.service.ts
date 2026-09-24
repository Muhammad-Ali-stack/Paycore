import { randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { OtpPurpose } from '@prisma/client';
import { AppConfig } from '../../../config/app-config';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { hmacSha256, safeEqualHex } from '../../../common/util/crypto';
import { addSeconds } from '../../../common/util/time';
import { OTP_PROVIDER, OtpProvider } from './otp.provider';

export interface IssuedOtp {
  expiresAt: Date;
  /** Only populated when OTP_DEV_ECHO=true (forbidden in production). */
  devCode?: string;
}

@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: AppConfig,
    @Inject(OTP_PROVIDER) private readonly provider: OtpProvider,
  ) {}

  /** Codes are stored as HMAC(secret, phone|purpose|code): a DB leak alone doesn't reveal them. */
  private digest(phone: string, purpose: OtpPurpose, code: string): string {
    return hmacSha256(this.config.get('JWT_ACCESS_SECRET'), `otp|${phone}|${purpose}|${code}`);
  }

  async issue(phone: string, purpose: OtpPurpose): Promise<IssuedOtp> {
    const cooldown = this.config.get('OTP_RESEND_COOLDOWN_SECONDS');
    if (cooldown > 0) {
      const ok = await this.redis.set(`otp:cooldown:${purpose}:${phone}`, '1', 'EX', cooldown, 'NX');
      if (ok !== 'OK') throw new DomainError('OTP_COOLDOWN', `Please wait ${cooldown}s before requesting another code`);
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const expiresAt = addSeconds(new Date(), this.config.get('OTP_TTL_SECONDS'));
    await this.prisma.$transaction([
      // Only the newest challenge is valid.
      this.prisma.otpChallenge.updateMany({
        where: { phone, purpose, consumedAt: null },
        data: { consumedAt: new Date() },
      }),
      this.prisma.otpChallenge.create({
        data: { phone, purpose, codeHash: this.digest(phone, purpose, code), expiresAt },
      }),
    ]);
    const minutes = Math.ceil(this.config.get('OTP_TTL_SECONDS') / 60);
    await this.provider.send(phone, `Your PayCore verification code is ${code}. It expires in ${minutes} min.`);
    return { expiresAt, ...(this.config.get('OTP_DEV_ECHO') ? { devCode: code } : {}) };
  }

  /** Verify and consume (single use). Attempts are counted atomically. */
  async verify(phone: string, purpose: OtpPurpose, code: string): Promise<void> {
    const challenge = await this.prisma.otpChallenge.findFirst({
      where: { phone, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge) throw new DomainError('OTP_INVALID', 'Invalid or expired code');
    if (challenge.expiresAt <= new Date()) throw new DomainError('OTP_EXPIRED', 'Code has expired');

    const bumped = await this.prisma.otpChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null, attempts: { lt: this.config.get('OTP_MAX_ATTEMPTS') } },
      data: { attempts: { increment: 1 } },
    });
    if (bumped.count !== 1) throw new DomainError('OTP_ATTEMPTS_EXCEEDED', 'Too many attempts; request a new code');

    if (!safeEqualHex(challenge.codeHash, this.digest(phone, purpose, code))) {
      throw new DomainError('OTP_INVALID', 'Invalid or expired code');
    }
    const consumed = await this.prisma.otpChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) throw new DomainError('OTP_INVALID', 'Invalid or expired code');
  }
}
