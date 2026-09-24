import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppConfig } from '../../config/app-config';
import { parseMaxmemoryPolicy } from './redis.util';


/**
 * Hosted Redis (e.g. Redis Cloud) over rediss:// — TLS is negotiated from the URL scheme.
 * The instance must use the `noeviction` policy: rate-limit counters, OTP cooldowns and (next
 * phase) BullMQ queues must never be silently evicted under memory pressure.
 */
@Injectable()
export class RedisService extends Redis implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly appConfig: AppConfig,
    @InjectPinoLogger(RedisService.name) private readonly logger: PinoLogger,
  ) {
    super(appConfig.get('REDIS_URL'), {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      connectTimeout: 10_000,
      keepAlive: 30_000,
      connectionName: 'paycore-api',
    });
  }

  async onModuleInit(): Promise<void> {
    let policy: string | null = null;
    try {
      policy = parseMaxmemoryPolicy(await this.info('memory'));
    } catch (err) {
      this.logger.warn({ err }, 'Could not read Redis maxmemory-policy');
    }
    if (policy && policy !== 'noeviction') {
      const message = `Redis maxmemory-policy is "${policy}"; PayCore requires "noeviction"`;
      if (this.appConfig.isProduction) throw new Error(message);
      this.logger.warn(message);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.quit().catch(() => this.disconnect());
  }
}
