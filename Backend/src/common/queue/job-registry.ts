import { Injectable } from '@nestjs/common';
import { AppConfig } from '../../config/app-config';

export const JOBS = {
  OUTBOX_RELAY: 'outbox-relay',
  PAYMENT_TIMEOUTS: 'payment-timeouts',
  REQUEST_EXPIRY: 'payment-request-expiry',
  QUOTE_QR_EXPIRY: 'quote-qr-expiry',
  SETTLEMENT_BATCH: 'settlement-batch',
  RECONCILIATION: 'reconciliation-daily',
} as const;
export type JobName = (typeof JOBS)[keyof typeof JOBS];

export interface JobSchedule {
  name: JobName;
  /** BullMQ repeat: fixed interval (ms) ... */
  every?: number;
  /** ... or a cron pattern (UTC). */
  cron?: string;
  /** Interval used by the inline scheduler (which has no cron support). */
  inlineEveryMs: number;
}

export function jobSchedules(config: AppConfig): JobSchedule[] {
  const maintenance = config.get('MAINTENANCE_INTERVAL_MS');
  return [
    { name: JOBS.OUTBOX_RELAY, every: config.get('OUTBOX_POLL_INTERVAL_MS'), inlineEveryMs: config.get('OUTBOX_POLL_INTERVAL_MS') },
    { name: JOBS.PAYMENT_TIMEOUTS, every: maintenance, inlineEveryMs: maintenance },
    { name: JOBS.REQUEST_EXPIRY, every: maintenance, inlineEveryMs: maintenance },
    { name: JOBS.QUOTE_QR_EXPIRY, every: maintenance, inlineEveryMs: maintenance },
    { name: JOBS.SETTLEMENT_BATCH, cron: config.get('SETTLEMENT_CRON'), inlineEveryMs: 3600_000 },
    { name: JOBS.RECONCILIATION, cron: config.get('RECONCILIATION_CRON'), inlineEveryMs: 24 * 3600_000 },
  ];
}

export type JobHandler = (data: Record<string, unknown>) => Promise<unknown>;

/** Job name -> handler. Filled by JobsModule; executed by the BullMQ worker or the inline scheduler. */
@Injectable()
export class JobRegistry {
  private readonly handlers = new Map<string, JobHandler>();

  register(name: JobName, handler: JobHandler): void {
    this.handlers.set(name, handler);
  }

  has(name: string): boolean {
    return this.handlers.has(name);
  }

  async run(name: string, data: Record<string, unknown> = {}): Promise<unknown> {
    const handler = this.handlers.get(name);
    if (!handler) throw new Error(`No handler registered for job "${name}"`);
    return handler(data);
  }
}
