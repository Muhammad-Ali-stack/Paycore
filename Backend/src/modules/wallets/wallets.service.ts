import { Injectable } from '@nestjs/common';
import { Currency, LedgerAccount, Prisma, Wallet, WalletStatus } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { DomainError } from '../../common/errors/domain-error';
import { isUniqueViolation } from '../../common/errors/error-response';
import { InvalidAmountError, formatAmount, moneyView, parsePositiveAmount } from '../../common/money/money';
import { PrismaService, Tx } from '../../common/prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { PostedEntry } from '../ledger/ledger.types';
import { LimitsService } from '../kyc/limits.service';
import { isCurrencyPermitted } from '../kyc/limits.policy';
import { WalletRef, transactionView } from './wallet.mapper';

export type WalletWithAccount = Wallet & { ledgerAccount: LedgerAccount };

export function toMinor(amount: string, currency: Currency): bigint {
  try {
    return parsePositiveAmount(amount, currency);
  } catch (err) {
    if (err instanceof InvalidAmountError) throw new DomainError('INVALID_AMOUNT', err.message);
    throw err;
  }
}

@Injectable()
export class WalletsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly limits: LimitsService,
    @InjectPinoLogger(WalletsService.name) private readonly logger: PinoLogger,
  ) {}

  /** Opens a wallet and its backing ledger account (a liability: we owe the user) atomically. */
  async create(userId: string, currency: Currency): Promise<WalletWithAccount> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { kycTier: true } });
    const limit = await this.limits.getLimit(user.kycTier, currency);
    if (!isCurrencyPermitted(limit)) {
      throw new DomainError('CURRENCY_NOT_PERMITTED', `${currency} wallets require a higher KYC tier`, {
        tier: user.kycTier,
      });
    }
    try {
      return await this.prisma.runInTransaction(async (tx) => {
        const account = await this.ledger.createAccount(tx, {
          name: `Wallet ${currency} / user ${userId}`,
          type: 'LIABILITY',
          ownerType: 'WALLET',
          currency,
          allowNegative: false,
        });
        return tx.wallet.create({
          data: { userId, currency, ledgerAccountId: account.id },
          include: { ledgerAccount: true },
        });
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new DomainError('WALLET_EXISTS', `You already have a ${currency} wallet`);
      throw err;
    }
  }

  list(userId: string): Promise<WalletWithAccount[]> {
    return this.prisma.wallet.findMany({
      where: { userId },
      include: { ledgerAccount: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getOwned(userId: string, walletId: string): Promise<WalletWithAccount> {
    const wallet = await this.prisma.wallet.findUnique({ where: { id: walletId }, include: { ledgerAccount: true } });
    if (!wallet || wallet.userId !== userId) throw new DomainError('NOT_FOUND', 'Wallet not found');
    return wallet;
  }

  async getById(walletId: string): Promise<WalletWithAccount> {
    const wallet = await this.prisma.wallet.findUnique({ where: { id: walletId }, include: { ledgerAccount: true } });
    if (!wallet) throw new DomainError('NOT_FOUND', 'Wallet not found');
    return wallet;
  }

  /**
   * Read wallet status inside the money transaction, after the ledger rows are locked.
   * FOR SHARE makes a status change that committed after our snapshot raise 40001 (retried)
   * instead of returning a stale ACTIVE. Lock order is always ledger account, then wallet,
   * which matches setStatus.
   */
  async assertActive(tx: Tx, walletIds: string[]): Promise<void> {
    const ids = [...new Set(walletIds)].sort();
    const wallets = await tx.$queryRaw<Array<{ id: string; status: WalletStatus }>>`
      SELECT id, status::text AS status FROM wallets
       WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
       ORDER BY id
         FOR SHARE`;
    for (const w of wallets) {
      if (w.status !== 'ACTIVE') {
        throw new DomainError('WALLET_NOT_ACTIVE', `Wallet is ${w.status.toLowerCase()}`, { walletId: w.id, status: w.status });
      }
    }
  }

  async history(userId: string, walletId: string, opts: { cursor?: string; limit?: number }) {
    const wallet = await this.getOwned(userId, walletId);
    const take = opts.limit ?? 25;
    const postings = await this.prisma.posting.findMany({
      where: { accountId: wallet.ledgerAccountId },
      include: { entry: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    const page = postings.slice(0, take);
    return {
      items: page.map((p) => ({
        postingId: p.id,
        transactionId: p.entryId,
        type: p.entry.type,
        description: p.entry.description,
        direction: p.amount < 0n ? ('IN' as const) : ('OUT' as const),
        ...moneyView(p.amount < 0n ? -p.amount : p.amount, p.currency),
        balanceAfter: formatAmount(p.balanceAfter, p.currency),
        metadata: p.entry.metadata,
        createdAt: p.createdAt.toISOString(),
      })),
      nextCursor: postings.length > take ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  /** Admin: freeze / unfreeze / close. Closing requires a zero balance. */
  async setStatus(walletId: string, status: WalletStatus, actorId: string, reason: string): Promise<WalletWithAccount> {
    const wallet = await this.getById(walletId);
    const updated = await this.prisma.runInTransaction(async (tx) => {
      const locked = await this.ledger.lockAccounts(tx, [wallet.ledgerAccountId]);
      const current = await tx.wallet.findUniqueOrThrow({ where: { id: walletId } });
      if (current.status === 'CLOSED') throw new DomainError('WALLET_NOT_ACTIVE', 'Closed wallets cannot be changed');
      if (status === 'CLOSED' && locked.get(wallet.ledgerAccountId)?.balance !== 0n) {
        throw new DomainError('WALLET_NOT_EMPTY', 'Wallet balance must be zero before closing');
      }
      return tx.wallet.update({ where: { id: walletId }, data: { status }, include: { ledgerAccount: true } });
    });
    this.logger.warn({ walletId, from: wallet.status, to: status, actorId, reason }, 'Wallet status changed');
    return updated;
  }

  // ─────────────────────────── views ───────────────────────────

  async walletRefsForAccounts(accountIds: string[]): Promise<Map<string, WalletRef>> {
    const wallets = await this.prisma.wallet.findMany({
      where: { ledgerAccountId: { in: accountIds } },
      select: { id: true, userId: true, ledgerAccountId: true },
    });
    return new Map(wallets.map((w) => [w.ledgerAccountId, { id: w.id, userId: w.userId }]));
  }

  async viewForUser(posted: PostedEntry, viewerId: string) {
    const refs = await this.walletRefsForAccounts(posted.postings.map((p) => p.accountId));
    return transactionView(posted, refs, viewerId);
  }
}
