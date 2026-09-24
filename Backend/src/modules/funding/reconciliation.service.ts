import { Inject, Injectable } from '@nestjs/common';
import { Currency, ReconciliationItem, ReconciliationRun } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { DomainError } from '../../common/errors/domain-error';
import { moneyView, SUPPORTED_CURRENCIES } from '../../common/money/money';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { BANK_ADAPTER, BankAdapter } from './bank.adapter';
import { ReconciliationRunDto, ReconciliationRunPageDto } from './funding.dto';
import { businessDay, diffStatement, utcDate } from './reconciliation.diff';

export function reconciliationView(run: ReconciliationRun & { items: ReconciliationItem[] }): ReconciliationRunDto {
  return {
    id: run.id,
    date: run.date,
    status: run.status,
    matched: run.matched,
    missingInLedger: run.missingInLedger,
    missingInBank: run.missingInBank,
    amountMismatches: run.amountMismatches,
    items: run.items.map((i) => ({
      type: i.type,
      bankReference: i.bankReference,
      currency: i.currency,
      bankAmount: i.bankAmount === null ? null : moneyView(i.bankAmount, i.currency),
      ledgerAmount: i.ledgerAmount === null ? null : moneyView(i.ledgerAmount, i.currency),
      fundingId: i.fundingId,
      settlementId: i.settlementId,
    })),
    createdAt: run.createdAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
  };
}

/**
 * Daily reconciliation: the bank statement for a UTC date vs the ledger's BANK_CLEARING postings
 * made that date, netted per bank reference (every bank-facing entry carries
 * metadata.bankReference). Phase-1 sandbox deposits/withdrawals have no bank reference and are
 * not part of the bank statement, so they are excluded.
 */
@Injectable()
export class ReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    @Inject(BANK_ADAPTER) private readonly bank: BankAdapter,
    @InjectPinoLogger(ReconciliationService.name) private readonly logger: PinoLogger,
  ) {}

  /** Yesterday (UTC): the default target of the daily job. */
  static defaultDate(now = new Date()): string {
    return utcDate(new Date(now.getTime() - 86_400_000));
  }

  async run(date: string = ReconciliationService.defaultDate(), triggeredBy: string | null = null): Promise<ReconciliationRunDto> {
    let day: { start: Date; end: Date };
    try {
      day = businessDay(date);
    } catch {
      throw new DomainError('VALIDATION_FAILED', 'date must be a valid YYYY-MM-DD');
    }
    const run = await this.prisma.reconciliationRun.create({ data: { date, triggeredBy } });
    try {
      const statement = await this.bank.statement(date);
      const clearing = await Promise.all(SUPPORTED_CURRENCIES.map((c) => this.ledger.systemAccountId('BANK_CLEARING', c)));
      const ledgerRows = await this.prisma.$queryRaw<Array<{ reference: string; currency: Currency; amount: bigint }>>`
        SELECT e.metadata->>'bankReference' AS reference, p.currency::text AS currency, SUM(p.amount)::bigint AS amount
          FROM postings p
          JOIN journal_entries e ON e.id = p.entry_id
         WHERE p.account_id = ANY(${clearing}::uuid[])
           AND e.created_at >= ${day.start.toISOString()}::timestamp AND e.created_at < ${day.end.toISOString()}::timestamp
           AND e.metadata->>'bankReference' IS NOT NULL
         GROUP BY 1, 2`;
      const diff = diffStatement(
        statement.map((s) => ({ reference: s.reference, currency: s.currency, amount: s.amountMinor })),
        ledgerRows,
      );

      const refs = diff.items.map((i) => i.reference);
      const [fundings, settlements] = await Promise.all([
        this.prisma.fundingTransaction.findMany({ where: { bankReference: { in: refs } }, select: { id: true, bankReference: true } }),
        this.prisma.settlement.findMany({ where: { bankReference: { in: refs } }, select: { id: true, bankReference: true } }),
      ]);
      const fundingOf = new Map(fundings.map((f) => [f.bankReference, f.id]));
      const settlementOf = new Map(settlements.map((s) => [s.bankReference, s.id]));
      const count = (t: string) => diff.items.filter((i) => i.type === t).length;

      const done = await this.prisma.$transaction(async (tx) => {
        if (diff.items.length > 0) {
          await tx.reconciliationItem.createMany({
            data: diff.items.map((i) => ({
              runId: run.id,
              type: i.type,
              bankReference: i.reference,
              currency: i.currency,
              bankAmount: i.bankAmount,
              ledgerAmount: i.ledgerAmount,
              fundingId: fundingOf.get(i.reference) ?? null,
              settlementId: settlementOf.get(i.reference) ?? null,
            })),
          });
        }
        return tx.reconciliationRun.update({
          where: { id: run.id },
          data: {
            status: 'COMPLETED',
            matched: diff.matched,
            missingInLedger: count('MISSING_IN_LEDGER'),
            missingInBank: count('MISSING_IN_BANK'),
            amountMismatches: count('AMOUNT_MISMATCH'),
            completedAt: new Date(),
          },
          include: { items: { orderBy: { bankReference: 'asc' } } },
        });
      });
      const level = diff.items.length > 0 ? 'warn' : 'info';
      this.logger[level]({ runId: run.id, date, matched: diff.matched, mismatches: diff.items.length }, 'Reconciliation completed');
      return reconciliationView(done);
    } catch (err) {
      await this.prisma.reconciliationRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', error: (err as Error).message.slice(0, 1000), completedAt: new Date() },
      });
      throw err;
    }
  }

  async list(cursor?: string, limit = 25): Promise<ReconciliationRunPageDto> {
    const rows = await this.prisma.reconciliationRun.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { items: { orderBy: { bankReference: 'asc' } } },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, limit);
    return { items: page.map(reconciliationView), nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null };
  }

  async get(id: string): Promise<ReconciliationRunDto> {
    const run = await this.prisma.reconciliationRun.findUnique({ where: { id }, include: { items: { orderBy: { bankReference: 'asc' } } } });
    if (!run) throw new DomainError('NOT_FOUND', 'Reconciliation run not found');
    return reconciliationView(run);
  }
}
