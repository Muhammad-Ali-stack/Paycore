import { Redis } from 'ioredis';
import { AppConfig } from '../../config/app-config';

/**
 * Conservative BullMQ settings for a hosted Redis with tight command and connection quotas
 * (e.g. Redis Cloud free tier). Used by the worker process (src/worker.ts).
 *
 *  - drainDelay: how long an idle worker blocks waiting for jobs before re-polling. A long value
 *    means an idle worker issues very few commands.
 *  - stalledInterval: how often stalled-job detection runs. Every run costs commands.
 *  - low concurrency, and retained completed/failed jobs are capped so memory stays bounded.
 *  - worker connections need maxRetriesPerRequest: null (BullMQ requirement).
 */
export function bullmqDefaults(config: AppConfig) {
  return {
    connection: {
      url: config.get('REDIS_URL'),
      options: {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        connectionName: 'paycore-worker',
      },
    },
    worker: {
      concurrency: config.get('BULLMQ_WORKER_CONCURRENCY'),
      drainDelay: config.get('BULLMQ_DRAIN_DELAY_SECONDS'),
      stalledInterval: config.get('BULLMQ_STALLED_INTERVAL_MS'),
      maxStalledCount: 2,
      removeOnComplete: { count: 1000, age: 24 * 3600 },
      removeOnFail: { count: 5000, age: 7 * 24 * 3600 },
    },
    defaultJobOptions: {
      attempts: 8,
      backoff: { type: 'exponential' as const, delay: 5_000 },
      removeOnComplete: { count: 1000, age: 24 * 3600 },
      removeOnFail: { count: 5000, age: 7 * 24 * 3600 },
    },
  } as const;
}

/**
 * BullMQ ignores a `url` connection option (it would silently fall back to localhost), so build
 * the ioredis client from the URL ourselves. rediss:// URLs negotiate TLS.
 */
export function createBullmqConnection(config: AppConfig): Redis {
  const { url, options } = bullmqDefaults(config).connection;
  return new Redis(url, { ...options });
}
