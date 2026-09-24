import { Currency, FundingMethod } from '@prisma/client';

export const BANK_ADAPTER = Symbol('BANK_ADAPTER');

export interface BankAccountDetails {
  iban: string;
  accountTitle: string;
  bankName: string;
}

export interface FundingInstructions {
  bankName: string;
  iban: string;
  accountTitle: string;
  /** The payer must quote this reference so the bank can match the transfer */
  reference: string;
}

/** What the bank says about one of our references (used by timeouts to resolve stuck items). */
export type BankTxnStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REVERSED' | 'UNKNOWN';

/** A movement on PayCore's account at the bank: + money in, - money out (minor units). */
export interface BankStatementLine {
  reference: string;
  currency: Currency;
  amountMinor: bigint;
  valueDate: string;
}

/**
 * Port to the partner bank. Outcomes are asynchronous: the bank calls POST /v1/webhooks/bank
 * (HMAC-signed). Every call is idempotent on `reference` (our end-to-end id), so a retry after a
 * crash can never create a second transfer at the bank.
 */
export interface BankAdapter {
  readonly name: string;
  /** Register an expected inbound bank transfer / card charge and return payer instructions. */
  initiateTopup(input: { reference: string; method: FundingMethod; currency: Currency; amountMinor: bigint }): Promise<{
    instructions: FundingInstructions | null;
  }>;
  /** Submit an outbound transfer (customer withdrawal or merchant settlement). */
  submitPayout(input: {
    reference: string;
    kind: 'WITHDRAWAL' | 'SETTLEMENT';
    currency: Currency;
    amountMinor: bigint;
    beneficiary: BankAccountDetails;
  }): Promise<{ accepted: boolean }>;
  getStatus(reference: string): Promise<BankTxnStatus>;
  /** The bank statement for a UTC business date (YYYY-MM-DD). */
  statement(date: string): Promise<BankStatementLine[]>;
}
