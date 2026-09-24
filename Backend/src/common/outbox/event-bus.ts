import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

export interface DomainEvent {
  /** outbox row id: stable across redeliveries, so consumers can dedupe on it */
  id: string;
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export type EventHandler = (event: DomainEvent) => Promise<void>;

/**
 * In-process dispatch of domain events to subscribers. Delivery is at-least-once (the outbox
 * may redeliver after a crash), so every handler must be idempotent.
 *
 * With QUEUE_DRIVER=bullmq the relay publishes events to the `paycore-events` queue and the
 * worker process dispatches them here; with `inline` the relay dispatches directly.
 */
@Injectable()
export class DomainEventBus {
  private readonly handlers: Array<{ pattern: string; name: string; handler: EventHandler }> = [];

  constructor(@InjectPinoLogger(DomainEventBus.name) private readonly logger: PinoLogger) {}

  /** `pattern` is an exact event type, a prefix ending in `.*`, or `*` for everything. */
  subscribe(pattern: string, name: string, handler: EventHandler): void {
    if (this.handlers.some((h) => h.name === name && h.pattern === pattern)) return;
    this.handlers.push({ pattern, name, handler });
  }

  private matches(pattern: string, type: string): boolean {
    if (pattern === '*') return true;
    if (pattern.endsWith('.*')) return type.startsWith(pattern.slice(0, -1));
    return pattern === type;
  }

  /** Runs every matching handler; the first failure is rethrown after all handlers ran. */
  async dispatch(event: DomainEvent): Promise<void> {
    let firstError: unknown = null;
    for (const h of this.handlers) {
      if (!this.matches(h.pattern, event.type)) continue;
      try {
        await h.handler(event);
      } catch (err) {
        this.logger.error({ err, eventId: event.id, type: event.type, handler: h.name }, 'Event handler failed');
        firstError ??= err;
      }
    }
    if (firstError) throw firstError;
  }
}
