import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { DomainEvent, DomainEventBus } from '../../common/outbox/event-bus';
import { OutboxRelay } from '../../common/outbox/outbox.service';
import { JobRegistry, jobSchedules } from '../../common/queue/job-registry';
import { bullmqDefaults, createBullmqConnection } from '../../common/redis/bullmq.defaults';
import { AppConfig } from '../../config/app-config';

export const JOBS_QUEUE = 'paycore-jobs';
export const EVENTS_QUEUE = 'paycore-events';

/**
 * Runs ONLY in the worker process (src/worker.ts). Registers the repeatable job schedulers,
 * consumes the jobs queue, and consumes domain events published by the outbox relay.
 * Connections: one for the queues, one per worker (BullMQ duplicates for blocking reads).
 */
@Injectable()
export class BullmqWorkerHost implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly connections: Redis[] = [];
  private readonly queues: Queue[] = [];
  private readonly workers: Worker[] = [];

  constructor(
    private readonly config: AppConfig,
    private readonly jobs: JobRegistry,
    private readonly bus: DomainEventBus,
    private readonly relay: OutboxRelay,
    @InjectPinoLogger(BullmqWorkerHost.name) private readonly logger: PinoLogger,
  ) {}

  private connection(): Redis {
    const c = createBullmqConnection(this.config);
    this.connections.push(c);
    return c;
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.get('QUEUE_DRIVER') !== 'bullmq') {
      this.logger.warn('QUEUE_DRIVER is not bullmq: the worker has nothing to do (jobs run inline in the API)');
      return;
    }
    const d = bullmqDefaults(this.config);
    const shared = this.connection();
    const jobsQueue = new Queue(JOBS_QUEUE, { connection: shared, defaultJobOptions: d.defaultJobOptions });
    const eventsQueue = new Queue(EVENTS_QUEUE, { connection: shared, defaultJobOptions: d.defaultJobOptions });
    this.queues.push(jobsQueue, eventsQueue);

    for (const s of jobSchedules(this.config)) {
      await jobsQueue.upsertJobScheduler(
        s.name,
        s.every ? { every: s.every } : { pattern: s.cron as string, tz: 'UTC' },
        // Schedules re-fire on their own; a failed run is retried by the next tick, not by backoff.
        { name: s.name, data: {}, opts: { attempts: 1, removeOnComplete: d.worker.removeOnComplete, removeOnFail: d.worker.removeOnFail } },
      );
    }

    const workerOpts = {
      concurrency: d.worker.concurrency,
      drainDelay: d.worker.drainDelay,
      stalledInterval: d.worker.stalledInterval,
      maxStalledCount: d.worker.maxStalledCount,
      removeOnComplete: d.worker.removeOnComplete,
      removeOnFail: d.worker.removeOnFail,
    };
    this.workers.push(
      new Worker(JOBS_QUEUE, async (job) => this.jobs.run(job.name, (job.data ?? {}) as Record<string, unknown>), {
        ...workerOpts,
        connection: this.connection(),
      }),
      new Worker(EVENTS_QUEUE, async (job) => this.bus.dispatch(job.data as DomainEvent), {
        ...workerOpts,
        connection: this.connection(),
      }),
    );
    for (const w of this.workers) {
      w.on('failed', (job, err) => this.logger.warn({ queue: w.name, job: job?.name, jobId: job?.id, err: err.message }, 'Job failed'));
      w.on('error', (err) => this.logger.error({ queue: w.name, err }, 'Worker error'));
    }

    // Outbox relay publishes into the events queue; jobId = outbox id, so a re-relayed row is a no-op.
    this.relay.setPublisher(async (event) => {
      await eventsQueue.add(event.type, event, { jobId: event.id });
    });
    this.logger.info({ schedules: jobSchedules(this.config).map((s) => s.name) }, 'BullMQ worker started');
  }

  async onApplicationShutdown(): Promise<void> {
    this.relay.setPublisher(null);
    await Promise.allSettled(this.workers.map((w) => w.close()));
    await Promise.allSettled(this.queues.map((q) => q.close()));
    await Promise.allSettled(this.connections.map((c) => c.quit()));
  }
}
