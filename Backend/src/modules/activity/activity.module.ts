import { Controller, Get, Injectable, Module, Query, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiProduces, ApiTags } from '@nestjs/swagger';
import { EntryType, FundingTransaction, JournalEntry, Payment, Posting, Prisma } from '@prisma/client';
import { AuthUser, CurrentUser } from '../../common/auth/auth.decorators';
import { PartyDto } from '../../common/dto/common.dto';
import { DomainError } from '../../common/errors/domain-error';
import { moneyView } from '../../common/money/money';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PartiesService, PaymentParties } from '../payments/parties';
import { PaymentsModule } from '../payments/payments.module';
import { csvRow } from '../settlement/settlement.mapper';
import { ActivityItemDto, ActivityPageDto, ActivityQuery, StatementQuery } from './activity.dto';

const ENTRY_TYPES = new Set<string>(Object.values(EntryType));
const STATEMENT_MAX_ROWS = 10_000;

type PostingWithEntry = Posting & { entry: JournalEntry };

function metaOf(entry: JournalEntry): Record<string, unknown> {
  return entry.metadata && typeof entry.metadata === 'object' && !Array.isArray(entry.metadata)
    ? (entry.metadata as Record<string, unknown>)
    : {};
}

/** Human title from the viewer's point of view. Pure. */
export function activityTitle(p: {
  direction: 'IN' | 'OUT';
  payment?: Payment | null;
  parties?: PaymentParties | null;
  funding?: FundingTransaction | null;
  entry: JournalEntry;
}): string {
  const reversal = p.entry.type === 'REVERSAL';
  if (p.payment && p.parties) {
    const other = p.direction === 'OUT' ? p.parties.payee : p.parties.payer;
    const base =
      p.payment.type === 'QR_MERCHANT'
        ? `Paid ${other.displayName}`
        : p.payment.type === 'REFUND'
          ? `Refund from ${p.parties.payer.displayName}`
          : p.payment.type === 'REQUEST'
            ? p.direction === 'OUT'
              ? `Paid request from ${other.displayName}`
              : `Request paid by ${other.displayName}`
            : p.direction === 'OUT'
              ? `To ${other.displayName}`
              : `From ${other.displayName}`;
    return reversal ? `${base} (reversed)` : base;
  }
  if (p.funding) {
    const bankName = (p.funding.bankAccount as { bankName?: string } | null)?.bankName;
    if (p.funding.direction === 'TOPUP') return reversal ? 'Top-up reversed' : `Top-up (${p.funding.method === 'CARD' ? 'card' : 'bank transfer'})`;
    return reversal ? 'Withdrawal returned' : `Withdrawal${bankName ? ` to ${bankName}` : ''}`;
  }
  return p.entry.description;
}

/**
 * Unified activity feed across all of a user's wallets: every posting on the user's wallet
 * accounts, enriched with its payment or funding transaction (type, counterparty, fee, status).
 */
@Injectable()
export class ActivityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parties: PartiesService,
  ) {}

  async feed(userId: string, q: ActivityQuery): Promise<ActivityPageDto> {
    const take = q.limit ?? 25;
    const wallets = await this.prisma.wallet.findMany({
      where: { userId, ...(q.walletId ? { id: q.walletId } : {}), ...(q.currency ? { currency: q.currency } : {}) },
      select: { id: true, ledgerAccountId: true },
    });
    if (q.walletId && wallets.length === 0) throw new DomainError('NOT_FOUND', 'Wallet not found');
    if (wallets.length === 0) return { items: [], nextCursor: null };

    const entryFilters: Prisma.JournalEntryWhereInput[] = [];
    if (q.type) {
      entryFilters.push({
        OR: [
          { metadata: { path: ['activityType'], equals: q.type } },
          ...(ENTRY_TYPES.has(q.type) ? [{ type: q.type as EntryType }] : []),
        ],
      });
    }
    if (q.q) entryFilters.push({ description: { contains: q.q, mode: 'insensitive' } });

    const postings = await this.prisma.posting.findMany({
      where: {
        accountId: { in: wallets.map((w) => w.ledgerAccountId) },
        ...(q.direction ? { amount: q.direction === 'IN' ? { lt: 0n } : { gt: 0n } } : {}),
        ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lt: new Date(q.to) } : {}) } } : {}),
        ...(entryFilters.length ? { entry: { AND: entryFilters } } : {}),
      },
      include: { entry: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const page = postings.slice(0, take);
    return { items: await this.enrich(userId, page), nextCursor: postings.length > take ? (page[page.length - 1]?.id ?? null) : null };
  }

  private async enrich(userId: string, postings: PostingWithEntry[]): Promise<ActivityItemDto[]> {
    const entryIds = postings.map((p) => p.entryId);
    const payments = entryIds.length
      ? await this.prisma.payment.findMany({ where: { OR: [{ journalEntryId: { in: entryIds } }, { reversalEntryId: { in: entryIds } }] } })
      : [];
    const paymentByEntry = new Map<string, Payment>();
    for (const p of payments) {
      if (p.journalEntryId) paymentByEntry.set(p.journalEntryId, p);
      if (p.reversalEntryId) paymentByEntry.set(p.reversalEntryId, p);
    }
    const refs = [...new Set(postings.map((p) => metaOf(p.entry).bankReference).filter((r): r is string => typeof r === 'string'))];
    const fundings = refs.length ? await this.prisma.fundingTransaction.findMany({ where: { bankReference: { in: refs } } }) : [];
    const fundingByRef = new Map(fundings.map((f) => [f.bankReference, f]));
    const parties = await this.parties.forPayments(payments);

    return postings.map((posting) => {
      const direction = posting.amount < 0n ? ('IN' as const) : ('OUT' as const);
      const abs = posting.amount < 0n ? -posting.amount : posting.amount;
      const payment = paymentByEntry.get(posting.entryId) ?? null;
      const ref = metaOf(posting.entry).bankReference;
      const funding = !payment && typeof ref === 'string' ? (fundingByRef.get(ref) ?? null) : null;
      const pp = payment ? (parties.get(payment.id) ?? null) : null;
      const isReversal = posting.entry.type === 'REVERSAL';

      let fee: bigint | null = null;
      if (payment && !isReversal && payment.payerUserId === userId && direction === 'OUT' && payment.fee > 0n) fee = payment.fee;
      if (funding && !isReversal && funding.fee > 0n) fee = funding.fee;
      const amount = direction === 'OUT' && fee !== null ? abs - fee : abs;

      let counterparty: PartyDto | null = null;
      if (pp) counterparty = payment?.payerUserId === userId || (payment?.type === 'REFUND' && direction === 'OUT') ? pp.payee : pp.payer;

      const activityType = metaOf(posting.entry).activityType;
      return {
        id: posting.id,
        paymentId: payment?.id ?? null,
        transactionId: posting.entryId,
        type: payment?.type ?? funding?.direction ?? (typeof activityType === 'string' ? activityType : posting.entry.type),
        title: activityTitle({ direction, payment, parties: pp, funding, entry: posting.entry }),
        counterparty,
        direction,
        amount: moneyView(amount, posting.currency),
        fee: fee === null ? null : moneyView(fee, posting.currency),
        balanceAfter: moneyView(posting.balanceAfter, posting.currency),
        status: payment?.status ?? funding?.status ?? 'COMPLETED',
        createdAt: posting.createdAt.toISOString(),
      };
    });
  }

  /** CSV statement (oldest first), capped at 10k rows. */
  async statementCsv(userId: string, q: StatementQuery): Promise<string> {
    const rows: ActivityItemDto[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.feed(userId, { walletId: q.walletId, from: q.from, to: q.to, cursor, limit: 100 });
      rows.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor && rows.length < STATEMENT_MAX_ROWS);
    rows.reverse();
    const header = csvRow(['date', 'transaction_id', 'payment_id', 'type', 'title', 'counterparty', 'direction', 'currency', 'amount', 'fee', 'balance_after', 'status']);
    const lines = rows.map((r) =>
      csvRow([
        r.createdAt,
        r.transactionId,
        r.paymentId,
        r.type,
        r.title,
        r.counterparty?.displayName ?? '',
        r.direction,
        r.amount.currency,
        r.amount.amount,
        r.fee?.amount ?? '',
        r.balanceAfter.amount,
        r.status,
      ]),
    );
    return `${[header, ...lines].join('\r\n')}\r\n`;
  }
}

@ApiTags('activity')
@ApiBearerAuth()
@Controller('transactions')
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  /** Unified activity feed across all wallets (payments, transfers, QR, funding, FX, refunds). */
  @Get()
  @ApiOkResponse({ type: ActivityPageDto })
  feed(@CurrentUser() user: AuthUser, @Query() query: ActivityQuery): Promise<ActivityPageDto> {
    return this.activity.feed(user.id, query);
  }

  /** CSV statement download (oldest first). */
  @Get('statement')
  @ApiProduces('text/csv')
  @ApiOkResponse({ description: 'CSV statement', schema: { type: 'string' } })
  async statement(@CurrentUser() user: AuthUser, @Query() query: StatementQuery): Promise<StreamableFile> {
    const csv = await this.activity.statementCsv(user.id, query);
    const name = `paycore-statement-${new Date().toISOString().slice(0, 10)}.csv`;
    return new StreamableFile(Buffer.from(csv, 'utf8'), { type: 'text/csv; charset=utf-8', disposition: `attachment; filename="${name}"` });
  }
}

@Module({
  imports: [PaymentsModule],
  controllers: [ActivityController],
  providers: [ActivityService],
})
export class ActivityModule {}
