import { Global, Injectable, Module, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppConfig } from '../../config/app-config';
import { DomainEventBus } from '../outbox/event-bus';
import { OutboxRelay, OutboxService } from '../outbox/outbox.service';
import { JobRegistry, jobSchedules } from './job-registry';

/**
 * QUEUE_DRIVER=inline: repeatable jobs run on in-process timers inside the API (local development
 * without Redis workers). Disabled under NODE_ENV=test, where tests drive jobs deterministically
 * (outboxRelay.drainOnce(), settlement.runBatch(asOf), reconciliation.run(date), ...).
 * QUEUE_DRIVER=bullmq: the API never runs jobs; the worker process (src/worker.ts) does.
 */
@Injectable()
export class InlineScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly running = new Set<string>();

  constructor(
    private readonly config: AppConfig,
    private readonly jobs: JobRegistry,
    @InjectPinoLogger(InlineScheduler.name) private readonly logger: PinoLogger,
  ) {}

  get enabled(): boolean {
    return (
      this.config.get('QUEUE_DRIVER') === 'inline' &&
      this.config.get('NODE_ENV') !== 'test' &&
      this.config.get('INLINE_SCHEDULER_ENABLED')
    );
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) return;
    for (const schedule of jobSchedules(this.config)) {
      const timer = setInterval(() => void this.tick(schedule.name), schedule.inlineEveryMs);
      timer.unref();
      this.timers.push(timer);
    }
    this.logger.info('Inline job scheduler started (QUEUE_DRIVER=inline)');
  }

  private async tick(name: string): Promise<void> {
    if (this.running.has(name) || !this.jobs.has(name)) return; // no overlapping runs
    this.running.add(name);
    try {
      await this.jobs.run(name);
    } catch (err) {
      this.logger.error({ err, job: name }, 'Inline job failed');
    } finally {
      this.running.delete(name);
    }
  }

  onApplicationShutdown(): void {
    this.timers.forEach((t) => clearInterval(t));
    this.timers.length = 0;
  }
}

@Global()
@Module({
  providers: [DomainEventBus, OutboxService, OutboxRelay, JobRegistry, InlineScheduler],
  exports: [DomainEventBus, OutboxService, OutboxRelay, JobRegistry],
})
export class QueueModule {}
