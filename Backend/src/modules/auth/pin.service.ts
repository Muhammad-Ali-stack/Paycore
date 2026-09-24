import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppConfig } from '../../config/app-config';
import { DomainError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { hashSecret, isWeakPin, verifySecret } from './credentials.policy';

/** Transaction PIN: argon2-hashed, attempt-limited with temporary lockout. */
@Injectable()
export class PinService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    @InjectPinoLogger(PinService.name) private readonly logger: PinoLogger,
  ) {}

  async setPin(userId: string, pin: string): Promise<void> {
    if (isWeakPin(pin)) throw new DomainError('PIN_TOO_WEAK', 'PIN is too easy to guess');
    await this.prisma.user.update({
      where: { id: userId },
      data: { pinHash: await hashSecret(pin), pinFailedAttempts: 0, pinLockedUntil: null },
    });
  }

  /** Throws unless `pin` is correct. Must be called BEFORE opening a money transaction. */
  async verify(userId: string, pin: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { pinHash: true, pinLockedUntil: true, pinFailedAttempts: true },
    });
    if (!user) throw new DomainError('UNAUTHORIZED', 'Unknown user');
    if (!user.pinHash) throw new DomainError('PIN_NOT_SET', 'Set a transaction PIN first');
    if (user.pinLockedUntil && user.pinLockedUntil > new Date()) {
      throw new DomainError('PIN_LOCKED', 'PIN is temporarily locked', {
        lockedUntil: user.pinLockedUntil.toISOString(),
      });
    }

    if (await verifySecret(user.pinHash, pin)) {
      if (user.pinFailedAttempts > 0 || user.pinLockedUntil) {
        await this.prisma.user.update({ where: { id: userId }, data: { pinFailedAttempts: 0, pinLockedUntil: null } });
      }
      return;
    }

    const max = this.config.get('PIN_MAX_FAILED_ATTEMPTS');
    const lockSeconds = this.config.get('PIN_LOCKOUT_SECONDS');
    // Atomic increment-and-maybe-lock, safe under concurrent guesses.
    const [row] = await this.prisma.$queryRaw<Array<{ attempts: number; lockedUntil: Date | null }>>`
      UPDATE users SET
        pin_failed_attempts = CASE WHEN pin_failed_attempts + 1 >= ${max} THEN 0 ELSE pin_failed_attempts + 1 END,
        pin_locked_until    = CASE WHEN pin_failed_attempts + 1 >= ${max}
                                   THEN now() + (${lockSeconds}::int * interval '1 second')
                                   ELSE pin_locked_until END,
        updated_at = now()
      WHERE id = ${userId}::uuid
      RETURNING pin_failed_attempts AS attempts, pin_locked_until AS "lockedUntil"`;

    if (row?.lockedUntil && row.lockedUntil > new Date()) {
      this.logger.warn({ userId }, 'PIN locked after repeated failures');
      throw new DomainError('PIN_LOCKED', 'Too many incorrect PIN attempts; PIN is temporarily locked', {
        lockedUntil: row.lockedUntil.toISOString(),
      });
    }
    throw new DomainError('PIN_INVALID', 'Incorrect PIN', { attemptsRemaining: max - (row?.attempts ?? 0) });
  }
}
