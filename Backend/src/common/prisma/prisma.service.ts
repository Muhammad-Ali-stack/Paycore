import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppConfig } from '../../config/app-config';
import { isRetryableTxError } from '../errors/error-response';
import { sleep } from '../util/time';

export type Tx = Prisma.TransactionClient;

export interface TxOptions {
  /** Retries on deadlock / serialization failure. The callback must be safe to re-run. */
  maxRetries?: number;
  timeoutMs?: number;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly isolationLevel: Prisma.TransactionIsolationLevel;
  private readonly maxRetries: number;

  constructor(
    config: AppConfig,
    @InjectPinoLogger(PrismaService.name) private readonly logger: PinoLogger,
  ) {
    // Runtime always uses DATABASE_URL (Supabase transaction pooler). Nothing here relies on
    // session state (no advisory locks, SET, LISTEN or prepared statements), so every
    // interactive transaction is self-contained on one pooled connection.
    super({ datasourceUrl: config.get('DATABASE_URL') });
    this.isolationLevel = Prisma.TransactionIsolationLevel[config.get('DB_TX_ISOLATION')];
    this.maxRetries = config.get('DB_TX_MAX_RETRIES');
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Run `fn` in a REPEATABLE READ (or SERIALIZABLE, via DB_TX_ISOLATION) transaction.
   *
   * Money movement takes row locks with SELECT ... FOR UPDATE in ascending id order as its
   * first statement. Under snapshot isolation, if a locked row was changed by a transaction that
   * committed after our snapshot, PostgreSQL raises 40001 instead of silently using newer data;
   * we then retry the whole callback with capped, jittered exponential backoff. Ordered locking
   * means deadlocks (40P01) should not happen, but they are retried too.
   */
  async runInTransaction<T>(fn: (tx: Tx) => Promise<T>, options: TxOptions = {}): Promise<T> {
    const maxRetries = options.maxRetries ?? this.maxRetries;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.$transaction(fn, {
          isolationLevel: this.isolationLevel,
          maxWait: 10_000,
          timeout: options.timeoutMs ?? 20_000,
        });
      } catch (err) {
        if (attempt < maxRetries && isRetryableTxError(err)) {
          // "Full jitter": spreads contenders out so a hot row isn't hit by a synchronized herd.
          const backoff = Math.floor(Math.random() * Math.min(15 * 2 ** attempt, 1_000)) + 5;
          this.logger.warn({ attempt, backoff }, 'Retrying transaction after concurrency conflict');
          await sleep(backoff);
          continue;
        }
        throw err;
      }
    }
  }
}
