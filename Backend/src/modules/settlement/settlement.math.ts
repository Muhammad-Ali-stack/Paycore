import { SettlementStatus } from '@prisma/client';
import { StateMachine } from '../../common/state/state-machine';
import { startOfUtcDay } from '../../common/util/time';

/** PENDING (batch posted, payout at the bank) -> PAID | FAILED (batch reversed, items re-eligible). */
export const settlementMachine = new StateMachine<SettlementStatus>('Settlement', {
  PENDING: ['PAID', 'FAILED'],
  PAID: [],
  FAILED: [],
});

export interface SettlementItem {
  kind: 'PAYMENT' | 'REFUND';
  id: string;
  /** payment amount, or refund amount (both positive) */
  amount: bigint;
  /** MDR charged (payment) or MDR returned (refund) */
  mdr: bigint;
  occurredAt: Date;
}

export interface SettlementLineValues {
  kind: 'PAYMENT' | 'REFUND';
  id: string;
  gross: bigint;
  mdr: bigint;
  net: bigint;
  occurredAt: Date;
}

export interface SettlementTotals {
  gross: bigint;
  mdr: bigint;
  refunds: bigint;
  net: bigint;
  lines: SettlementLineValues[];
  periodStart: Date | null;
}

/**
 * T+N cut-off: items completed before the start of (asOf's UTC day - N days) are due.
 * With N = 1, a batch run on Wednesday settles everything up to Tuesday 00:00 UTC.
 */
export function settlementCutoff(asOf: Date, delayDays: number): Date {
  return new Date(startOfUtcDay(asOf).getTime() - delayDays * 86_400_000);
}

/**
 * Batch totals. A payment credits the merchant payable with amount - MDR; a refund debits it with
 * refund - returned MDR. So net = gross - (MDR charged - MDR returned) - refunds, which equals the
 * movement of the merchant payable for exactly these items (asserted against the ledger in tests).
 */
export function summarizeSettlement(items: readonly SettlementItem[]): SettlementTotals {
  let gross = 0n;
  let mdr = 0n;
  let refunds = 0n;
  const lines: SettlementLineValues[] = [];
  for (const i of items) {
    if (i.kind === 'PAYMENT') {
      gross += i.amount;
      mdr += i.mdr;
      lines.push({ kind: 'PAYMENT', id: i.id, gross: i.amount, mdr: i.mdr, net: i.amount - i.mdr, occurredAt: i.occurredAt });
    } else {
      refunds += i.amount;
      mdr -= i.mdr;
      lines.push({ kind: 'REFUND', id: i.id, gross: -i.amount, mdr: -i.mdr, net: -(i.amount - i.mdr), occurredAt: i.occurredAt });
    }
  }
  const periodStart = items.length ? new Date(Math.min(...items.map((i) => i.occurredAt.getTime()))) : null;
  return { gross, mdr, refunds, net: gross - mdr - refunds, lines, periodStart };
}
