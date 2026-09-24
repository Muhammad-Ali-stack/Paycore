import { Currency, NormalBalance } from '@prisma/client';
import { DomainError } from '../../common/errors/domain-error';

/** A leg of an entry. amount > 0 = DEBIT, amount < 0 = CREDIT (signed minor units). */
export interface LegInput {
  accountId: string;
  amount: bigint;
}

export interface ResolvedLeg extends LegInput {
  currency: Currency;
}

export const debit = (accountId: string, amount: bigint): LegInput => {
  if (amount <= 0n) throw new DomainError('LEDGER_INVALID_ENTRY', 'Debit amount must be positive');
  return { accountId, amount };
};

export const credit = (accountId: string, amount: bigint): LegInput => {
  if (amount <= 0n) throw new DomainError('LEDGER_INVALID_ENTRY', 'Credit amount must be positive');
  return { accountId, amount: -amount };
};

export function assertWellFormed(legs: readonly LegInput[]): void {
  if (legs.length < 2) {
    throw new DomainError('LEDGER_INVALID_ENTRY', 'A journal entry needs at least two postings');
  }
  for (const leg of legs) {
    if (typeof leg.amount !== 'bigint') {
      throw new DomainError('LEDGER_INVALID_ENTRY', 'Posting amounts must be integer minor units (bigint)');
    }
    if (leg.amount === 0n) throw new DomainError('LEDGER_INVALID_ENTRY', 'Posting amount cannot be zero');
  }
}

export function netByCurrency(legs: readonly ResolvedLeg[]): Map<Currency, bigint> {
  const net = new Map<Currency, bigint>();
  for (const leg of legs) net.set(leg.currency, (net.get(leg.currency) ?? 0n) + leg.amount);
  return net;
}

/** Every entry must balance to exactly zero in every currency it touches. */
export function assertBalanced(legs: readonly ResolvedLeg[]): void {
  for (const [currency, total] of netByCurrency(legs)) {
    if (total !== 0n) {
      throw new DomainError('LEDGER_UNBALANCED', `Entry does not balance in ${currency}`, {
        currency,
        net: total.toString(),
      });
    }
  }
}

/** Apply a signed posting to a balance expressed on the account's normal side. */
export function applyPosting(balance: bigint, normal: NormalBalance, amount: bigint): bigint {
  return normal === 'DEBIT' ? balance + amount : balance - amount;
}

export function normalBalanceFor(type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE'): NormalBalance {
  return type === 'ASSET' || type === 'EXPENSE' ? 'DEBIT' : 'CREDIT';
}
