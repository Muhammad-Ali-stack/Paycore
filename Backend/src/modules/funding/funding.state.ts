import { FundingStatus } from '@prisma/client';
import { StateMachine } from '../../common/state/state-machine';

/**
 * PENDING -> SUCCEEDED -> REVERSED   (bank chargeback / returned payout)
 *    \-> FAILED
 * FAILED and REVERSED are terminal.
 */
export const fundingMachine = new StateMachine<FundingStatus>('FundingTransaction', {
  PENDING: ['SUCCEEDED', 'FAILED'],
  SUCCEEDED: ['REVERSED'],
  FAILED: [],
  REVERSED: [],
});

export type BankOutcome = 'SUCCEEDED' | 'FAILED' | 'REVERSED';

/**
 * What to do with a bank outcome given the current status. Pure, so out-of-order handling is
 * unit-tested:
 *  - APPLY:  legal transition, apply it (money moves);
 *  - IGNORE: already in that state (the bank re-sent the same outcome under a new event id);
 *  - DEFER:  REVERSED arrived before SUCCEEDED; keep it and apply it right after SUCCEEDED lands;
 *  - FLAG:   contradicts a terminal outcome (e.g. SUCCEEDED after FAILED). Never applied blindly:
 *            the transaction is flagged for review and reconciliation surfaces the difference.
 */
export function planBankOutcome(current: FundingStatus, outcome: BankOutcome): 'APPLY' | 'IGNORE' | 'DEFER' | 'FLAG' {
  if (current === outcome) return 'IGNORE';
  if (fundingMachine.can(current, outcome)) return 'APPLY';
  if (current === 'PENDING' && outcome === 'REVERSED') return 'DEFER';
  return 'FLAG';
}

const EVENT_OUTCOMES: Readonly<Record<string, BankOutcome>> = {
  'transaction.succeeded': 'SUCCEEDED',
  'transaction.failed': 'FAILED',
  'transaction.reversed': 'REVERSED',
};

/** Webhook event type -> outcome (null for unknown types). */
export const bankOutcomeOfEventType = (type: string): BankOutcome | null => EVENT_OUTCOMES[type] ?? null;
