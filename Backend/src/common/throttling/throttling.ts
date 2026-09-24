import { Injectable } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

/** Rate-limit per authenticated user when known, otherwise per client IP. */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const user = req.user as { id?: string } | undefined;
    return user?.id ? `user:${user.id}` : `ip:${String(req.ip ?? 'unknown')}`;
  }
}

/**
 * Stricter limit for credential/OTP endpoints (brute-force protection on top of account lockout).
 * Resolved at request time so it follows the validated AUTH_THROTTLE_LIMIT setting.
 */
export const AuthRateLimit = () =>
  Throttle({
    default: {
      limit: () => Number(process.env.AUTH_THROTTLE_LIMIT ?? 10),
      ttl: 60_000,
    },
  });
