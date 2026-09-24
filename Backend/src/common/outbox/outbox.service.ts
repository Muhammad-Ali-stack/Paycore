import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppConfig } from '../../config/app-config';
import { FaultInjector } from '../faults/fault-injector';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { toJsonSafe } from '../util/crypto';
import { DomainEvent, DomainEventBus } from './event-bus';

export interface OutboxInput {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  /** Deliver no earlier than this (delayed events, e.g. simulated bank outcomes). */
  availableAt?: Date;
}

/** Writes domain events in the SAME transaction as the state change they describe. */
@Injectable()
export class OutboxService {
  async enqueue(tx: Tx, input: OutboxInput): Promise<void> {
    await tx.outboxEvent.create({
      data: {
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        eventType: input.eventType,
        payload: toJsonSafe(input.payload) as Prisma.InputJsonValue,
        ...(input.availableAt ? { availableAt: input.availableAt } : {}),
      },
    });
  }
}

interface OutboxRow {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  attempts: number;
  createdAt: Date;
}

/** A claimed row is invisible to other relays for this long; a crashed relay's rows reappear after it. */
const CLAIM_LEASE_SECONDS = 60;

export const backoffSeconds = (attempts: number): number => Math.min(5 * 2 ** Math.max(attempts - 1, 0), 3600);

/**
 * Moves outbox rows to their consumers. Pooler-safe claim: a short transaction selects due rows
 * with `FOR UPDATE SKIP LOCKED` (so parallel relays never pick the same row) and pushes their
 * `available_at` forward by a lease. Publishing happens outside that transaction; success stamps
 * `published_at`, failure schedules a retry with exponential backoff. After OUTBOX_MAX_ATTEMPTS a
 * row stays unpublished with its last error (dead letter) for an operator to inspect.
 */
@Injectable()
export class OutboxRelay {
  private publisher: ((event: DomainEvent) => Promise<void>) | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: DomainEventBus,
    private readonly config: AppConfig,
    private readonly faults: FaultInjector,
    @InjectPinoLogger(OutboxRelay.name) private readonly logger: PinoLogger,
  ) {}

  /** The BullMQ worker host installs a publisher that enqueues to the events queue. */
  setPublisher(publisher: ((event: DomainEvent) => Promise<void>) | null): void {
    this.publisher = publisher;
  }

  async drainOnce(limit = this.config.get('OUTBOX_BATCH_SIZE')): Promise<{ published: number; failed: number }> {
    const maxAttempts = this.config.get('OUTBOX_MAX_ATTEMPTS');
    const rows = await this.prisma.runInTransaction(async (tx) => {
      const due = await tx.$queryRaw<OutboxRow[]>`
        SELECT id, aggregate_type AS "aggregateType", aggregate_id AS "aggregateId", event_type AS "eventType",
               payload, attempts, created_at AS "createdAt"
          FROM outbox_events
         WHERE published_at IS NULL AND available_at <= now() AND attempts < ${maxAttempts}
         ORDER BY created_at, id
         LIMIT ${limit}
           FOR UPDATE SKIP LOCKED`;
      if (due.length > 0) {
        await tx.$executeRaw`
          UPDATE outbox_events
             SET available_at = now() + (${CLAIM_LEASE_SECONDS}::int * interval '1 second'), attempts = attempts + 1
           WHERE id IN (${Prisma.join(due.map((r) => Prisma.sql`${r.id}::uuid`))})`;
      }
      return due;
    });

    let published = 0;
    let failed = 0;
    for (const row of rows) {
      const event: DomainEvent = {
        id: row.id,
        type: row.eventType,
        aggregateType: row.aggregateType,
        aggregateId: row.aggregateId,
        payload: row.payload,
        occurredAt: row.createdAt.toISOString(),
      };
      try {
        this.faults.hit('outbox.publish');
        await (this.publisher ? this.publisher(event) : this.bus.dispatch(event));
        await this.prisma.outboxEvent.update({ where: { id: row.id }, data: { publishedAt: new Date(), lastError: null } });
        published++;
      } catch (err) {
        failed++;
        const attempts = row.attempts + 1;
        const message = err instanceof Error ? err.message : String(err);
        await this.prisma.outboxEvent.update({
          where: { id: row.id },
          data: {
            lastError: message.slice(0, 1000),
            availableAt: new Date(Date.now() + backoffSeconds(attempts) * 1000),
          },
        });
        const level = attempts >= this.config.get('OUTBOX_MAX_ATTEMPTS') ? 'error' : 'warn';
        this.logger[level]({ eventId: row.id, type: row.eventType, attempts, err: message }, 'Outbox publish failed');
      }
    }
    return { published, failed };
  }

  /** Drain until nothing is due (bounded), e.g. for the repeatable relay job and tests. */
  async drainAll(maxRounds = 20): Promise<{ published: number; failed: number }> {
    const total = { published: 0, failed: 0 };
    for (let i = 0; i < maxRounds; i++) {
      const r = await this.drainOnce();
      total.published += r.published;
      total.failed += r.failed;
      if (r.published + r.failed === 0) break;
    }
    return total;
  }
}
