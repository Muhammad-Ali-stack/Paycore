import { Global, Injectable, Module } from '@nestjs/common';
import { AppConfig } from '../../config/app-config';

/**
 * Named points where tests can inject a crash. Keep this list explicit so a typo in a test
 * can't silently arm a point that no code path ever hits.
 */
export const FAULT_POINTS = [
  /** payment row persisted (PROCESSING), money transaction not yet started */
  'payment.afterCreate',
  /** inside the money transaction, right after the ledger entry was posted */
  'payment.afterLedgerPost',
  /** inside the money transaction, after the status change, before the outbox write */
  'payment.beforeOutbox',
  /** after the money transaction committed, before the response is built */
  'payment.afterCommit',
  'refund.afterLedgerPost',
  'refund.afterCommit',
  'funding.afterHold',
  'funding.afterCommit',
  'webhook.afterApply',
  'settlement.afterPost',
  'outbox.publish',
] as const;
export type FaultPoint = (typeof FAULT_POINTS)[number];

export class InjectedFault extends Error {
  constructor(readonly point: FaultPoint) {
    super(`Injected fault at ${point}`);
    this.name = 'InjectedFault';
  }
}

/**
 * Test-only failure injection. Outside NODE_ENV=test every call is a no-op (arming throws), so
 * this can never alter production behaviour.
 */
@Injectable()
export class FaultInjector {
  private readonly armed = new Map<FaultPoint, number>();
  private readonly enabled: boolean;

  constructor(config: AppConfig) {
    this.enabled = config.get('NODE_ENV') === 'test';
  }

  /** Make the next `times` hits of `point` throw an InjectedFault. */
  arm(point: FaultPoint, times = 1): void {
    if (!this.enabled) throw new Error('FaultInjector is only available when NODE_ENV=test');
    this.armed.set(point, times);
  }

  reset(): void {
    this.armed.clear();
  }

  /** Called by production code at a named point. No-op unless armed in a test. */
  hit(point: FaultPoint): void {
    if (!this.enabled) return;
    const remaining = this.armed.get(point);
    if (!remaining) return;
    if (remaining <= 1) this.armed.delete(point);
    else this.armed.set(point, remaining - 1);
    throw new InjectedFault(point);
  }
}

@Global()
@Module({ providers: [FaultInjector], exports: [FaultInjector] })
export class FaultsModule {}
