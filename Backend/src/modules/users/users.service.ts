import { Injectable } from '@nestjs/common';
import { Currency, User } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { DomainError } from '../../common/errors/domain-error';
import { isUniqueViolation } from '../../common/errors/error-response';
import { PrismaService } from '../../common/prisma/prisma.service';
import { maskPhone, shortDisplayName } from '../payments/parties';
import { USERNAME_INPUT_PATTERN, UserDto, UserLookupDto } from './users.dto';

export function userView(u: User): UserDto {
  return {
    id: u.id,
    phone: u.phone,
    fullName: u.fullName,
    username: u.username,
    role: u.role,
    status: u.status,
    kycTier: u.kycTier,
    phoneVerified: u.phoneVerifiedAt !== null,
    pinSet: u.pinHash !== null,
    createdAt: u.createdAt.toISOString(),
  };
}

export type RecipientRef = { phone?: string; username?: string };

/** "@Ali_K" / "ali_k" -> "ali_k"; null if it isn't a valid handle. */
export function normaliseUsername(input: string): string | null {
  const raw = input.trim().replace(/^@/, '');
  return USERNAME_INPUT_PATTERN.test(raw) ? raw.toLowerCase() : null;
}

/** "+923001234567", or " 923001234567" (a `+` decoded to a space in a query string). */
export function normalisePhone(input: string): string | null {
  const raw = input.trim();
  const phone = raw.startsWith('+') ? raw : /^\d{8,15}$/.test(raw) && input.startsWith(' ') ? `+${raw}` : raw;
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(UsersService.name) private readonly logger: PinoLogger,
  ) {}

  async getById(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new DomainError('NOT_FOUND', 'User not found');
    return user;
  }

  findByPhone(phone: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { phone } });
  }

  async updateProfile(id: string, data: { fullName?: string; username?: string }): Promise<User> {
    const username = data.username === undefined ? undefined : normaliseUsername(data.username);
    if (username === null) throw new DomainError('VALIDATION_FAILED', 'username must be 3-20 characters of a-z, 0-9 or _');
    try {
      return await this.prisma.user.update({ where: { id }, data: { fullName: data.fullName, username } });
    } catch (err) {
      if (isUniqueViolation(err, 'username')) throw new DomainError('USERNAME_TAKEN', 'That username is already taken');
      throw err;
    }
  }

  /** Resolve an ACTIVE user by phone or username (for transfers, requests and lookup). */
  async findRecipient(ref: RecipientRef): Promise<User | null> {
    let user: User | null = null;
    if (ref.username) {
      const username = normaliseUsername(ref.username);
      user = username ? await this.prisma.user.findUnique({ where: { username } }) : null;
    } else if (ref.phone) {
      user = await this.prisma.user.findUnique({ where: { phone: ref.phone } });
    }
    return user && user.status === 'ACTIVE' ? user : null;
  }

  /** Public lookup: never exposes the full name or phone number. */
  async lookup(q: string): Promise<UserLookupDto> {
    const phone = normalisePhone(q);
    const user = await this.findRecipient(phone ? { phone } : { username: q });
    if (!user || user.role === 'ADMIN') throw new DomainError('NOT_FOUND', 'No PayCore user matches that phone or username');
    const wallets = await this.prisma.wallet.findMany({
      where: { userId: user.id, status: 'ACTIVE' },
      select: { currency: true },
      orderBy: { createdAt: 'asc' },
    });
    return {
      userId: user.id,
      username: user.username,
      displayName: shortDisplayName(user.fullName),
      phoneMasked: maskPhone(user.phone),
      wallets: wallets.map((w) => w.currency as Currency),
    };
  }

  /** Suspending a user blocks auth immediately by revoking every live session. */
  async suspend(id: string, actorId: string, reason: string): Promise<User> {
    const user = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id }, data: { status: 'SUSPENDED' } });
      await tx.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: 'USER_SUSPENDED' },
      });
      return updated;
    });
    this.logger.warn({ userId: id, actorId, reason }, 'User suspended');
    return user;
  }

  async reactivate(id: string, actorId: string): Promise<User> {
    const current = await this.getById(id);
    if (current.status !== 'SUSPENDED') throw new DomainError('CONFLICT', 'User is not suspended');
    const user = await this.prisma.user.update({
      where: { id },
      data: { status: current.phoneVerifiedAt ? 'ACTIVE' : 'PENDING_VERIFICATION' },
    });
    this.logger.info({ userId: id, actorId }, 'User reactivated');
    return user;
  }
}
