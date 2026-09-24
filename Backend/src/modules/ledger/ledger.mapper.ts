import { LedgerAccount } from '@prisma/client';
import { formatAmount, moneyView } from '../../common/money/money';
import { PostedEntry } from './ledger.types';

export function entryView({ entry, postings }: PostedEntry) {
  return {
    id: entry.id,
    type: entry.type,
    description: entry.description,
    reversalOfId: entry.reversalOfId,
    initiatedBy: entry.initiatedBy,
    metadata: entry.metadata,
    createdAt: entry.createdAt.toISOString(),
    postings: postings.map((p) => ({
      id: p.id,
      accountId: p.accountId,
      direction: p.amount > 0n ? 'DEBIT' : 'CREDIT',
      ...moneyView(p.amount > 0n ? p.amount : -p.amount, p.currency),
      balanceAfter: formatAmount(p.balanceAfter, p.currency),
    })),
  };
}

export function accountView(a: LedgerAccount) {
  return {
    id: a.id,
    code: a.code,
    name: a.name,
    type: a.type,
    normalBalance: a.normalBalance,
    ownerType: a.ownerType,
    currency: a.currency,
    balance: moneyView(a.balance, a.currency),
    version: a.version,
  };
}
