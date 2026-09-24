import { Injectable } from '@nestjs/common';
import { Currency, FundingMethod } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BankAdapter, BankStatementLine, BankTxnStatus, FundingInstructions } from './bank.adapter';

/** PayCore's collection account at the simulated partner bank (shown in top-up instructions). */
export const SIM_COLLECTION_ACCOUNT = {
  bankName: 'PayCore Partner Bank (simulated)',
  iban: 'PK36SCBL0000001123456702',
  accountTitle: 'PayCore Payments Ltd - Client Money',
} as const;

/**
 * Simulated partner bank. Keeps "the bank's view of the world" in sim_bank_* tables so the
 * reconciliation job has a real statement to compare against. Outcomes are produced by the
 * BankSimulator (dev endpoint / tests), which then sends signed webhooks like a real bank would.
 */
@Injectable()
export class SimulatedBankAdapter implements BankAdapter {
  readonly name = 'simulated';

  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(SimulatedBankAdapter.name) private readonly logger: PinoLogger,
  ) {}

  async initiateTopup(input: { reference: string; method: FundingMethod; currency: Currency; amountMinor: bigint }) {
    await this.register(input.reference, 'TOPUP', input.currency, input.amountMinor);
    const instructions: FundingInstructions | null =
      input.method === 'BANK_TRANSFER' ? { ...SIM_COLLECTION_ACCOUNT, reference: input.reference } : null;
    return { instructions };
  }

  async submitPayout(input: { reference: string; kind: 'WITHDRAWAL' | 'SETTLEMENT'; currency: Currency; amountMinor: bigint }) {
    await this.register(input.reference, 'PAYOUT', input.currency, input.amountMinor);
    this.logger.info({ reference: input.reference, kind: input.kind }, 'Simulated bank accepted payout');
    return { accepted: true };
  }

  async getStatus(reference: string): Promise<BankTxnStatus> {
    const txn = await this.prisma.simBankTransaction.findUnique({ where: { reference } });
    return txn ? txn.status : 'UNKNOWN';
  }

  async statement(date: string): Promise<BankStatementLine[]> {
    const lines = await this.prisma.simBankStatementLine.findMany({ where: { valueDate: date }, orderBy: { createdAt: 'asc' } });
    return lines.map((l) => ({ reference: l.reference, currency: l.currency, amountMinor: l.amount, valueDate: l.valueDate }));
  }

  /** Idempotent on reference (a retried submission never creates a second bank transaction). */
  async register(reference: string, kind: 'TOPUP' | 'PAYOUT', currency: Currency, amount: bigint): Promise<void> {
    await this.prisma.simBankTransaction.upsert({
      where: { reference },
      create: { reference, kind, currency, amount },
      update: {},
    });
  }
}
