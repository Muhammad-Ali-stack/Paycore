import { AccountOwnerType, AccountType, Currency, EntryType, JournalEntry, NormalBalance, Posting } from '@prisma/client';
import { LegInput } from './ledger.validation';

export const SYSTEM_ACCOUNT_KINDS = ['BANK_CLEARING', 'FEE_REVENUE', 'SETTLEMENT', 'SUSPENSE', 'FUNDS_IN_FLIGHT'] as const;
export type SystemAccountKind = (typeof SYSTEM_ACCOUNT_KINDS)[number];

export const systemAccountCode = (kind: SystemAccountKind, currency: Currency): string => `${kind}.${currency}`;

export interface CreateAccountInput {
  name: string;
  type: AccountType;
  ownerType: AccountOwnerType;
  currency: Currency;
  allowNegative?: boolean;
  code?: string;
}

export interface PostEntryInput {
  type: EntryType;
  description: string;
  legs: LegInput[];
  /** At-most-once key for the business operation (unique across all entries). */
  externalRef?: string;
  reversalOfId?: string;
  initiatedBy?: string;
  metadata?: Record<string, unknown>;
}

export interface LockedAccount {
  id: string;
  currency: Currency;
  normalBalance: NormalBalance;
  allowNegative: boolean;
  balance: bigint;
  version: number;
}

export interface PostedEntry {
  entry: JournalEntry;
  postings: Posting[];
}
