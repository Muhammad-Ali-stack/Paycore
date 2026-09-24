import { LedgerAccount, Wallet } from '@prisma/client';
import { formatAmount, moneyView } from '../../common/money/money';
import { PostedEntry } from '../ledger/ledger.types';

export function walletView(w: Wallet & { ledgerAccount: LedgerAccount }) {
  return {
    id: w.id,
    currency: w.currency,
    status: w.status,
    balance: moneyView(w.ledgerAccount.balance, w.currency),
    createdAt: w.createdAt.toISOString(),
  };
}

export interface WalletRef {
  id: string;
  userId: string;
}

/**
 * User-facing view of a journal entry: only the legs that touch wallets the viewer may see.
 * For wallets (liabilities) a credit is money IN and a debit is money OUT.
 */
export function transactionView(posted: PostedEntry, walletsByAccount: Map<string, WalletRef>, viewerId?: string) {
  const { entry, postings } = posted;
  return {
    id: entry.id,
    type: entry.type,
    status: 'COMPLETED' as const,
    description: entry.description,
    reversalOfId: entry.reversalOfId,
    metadata: entry.metadata,
    createdAt: entry.createdAt.toISOString(),
    legs: postings
      .filter((p) => {
        const wallet = walletsByAccount.get(p.accountId);
        return wallet && (!viewerId || wallet.userId === viewerId);
      })
      .map((p) => ({
        walletId: (walletsByAccount.get(p.accountId) as WalletRef).id,
        direction: p.amount < 0n ? ('IN' as const) : ('OUT' as const),
        ...moneyView(p.amount < 0n ? -p.amount : p.amount, p.currency),
        balanceAfter: formatAmount(p.balanceAfter, p.currency),
      })),
  };
}
