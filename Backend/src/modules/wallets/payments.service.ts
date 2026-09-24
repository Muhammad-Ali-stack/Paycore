import { Injectable } from '@nestjs/common';
import { EntryType } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppConfig } from '../../config/app-config';
import { DomainError } from '../../common/errors/domain-error';
import { isUniqueViolation } from '../../common/errors/error-response';
import { bpsOf, formatAmount } from '../../common/money/money';
import { PrismaService, Tx } from '../../common/prisma/prisma.service';
import { PinService } from '../auth/pin.service';
import { LimitsService } from '../kyc/limits.service';
import { LedgerService } from '../ledger/ledger.service';
import { PostedEntry } from '../ledger/ledger.types';
import { LegInput, credit, debit } from '../ledger/ledger.validation';
import { WalletsService, toMinor } from './wallets.service';

export const externalRefFor = (userId: string, idempotencyKey: string): string => `idem:${userId}:${idempotencyKey}`;

/**
 * Phase-1 synchronous sandbox rail (deposits/withdrawals). P2P transfers moved to the transfers
 * module (payments engine) in phase 2; async bank funding lives in the funding module. Every operation:
 *   1. verifies the PIN (outside the transaction, so failed attempts persist);
 *   2. opens one DB transaction, locks ALL involved ledger accounts in id order;
 *   3. re-checks wallet status and KYC limits against the locked balances;
 *   4. posts one balanced journal entry carrying the idempotency key as external_ref.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly wallets: WalletsService,
    private readonly limits: LimitsService,
    private readonly pins: PinService,
    private readonly config: AppConfig,
    @InjectPinoLogger(PaymentsService.name) private readonly logger: PinoLogger,
  ) {}

  /** Simulated top-up from a bank/card rail: DR bank clearing, CR user wallet. */
  async deposit(userId: string, walletId: string, amountInput: string, idempotencyKey: string) {
    const wallet = await this.wallets.getOwned(userId, walletId);
    const amount = toMinor(amountInput, wallet.currency);
    const bank = await this.ledger.systemAccountId('BANK_CLEARING', wallet.currency);
    const externalRef = externalRefFor(userId, idempotencyKey);

    const posted = await this.postOnce(externalRef, 'DEPOSIT', async (tx) => {
      const locked = await this.ledger.lockAccounts(tx, [wallet.ledgerAccountId, bank]);
      await this.wallets.assertActive(tx, [wallet.id]);
      const { kycTier } = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { kycTier: true } });
      await this.limits.assertInflow(tx, {
        tier: kycTier,
        currency: wallet.currency,
        currentBalance: locked.get(wallet.ledgerAccountId)?.balance ?? 0n,
        amount,
        enforcePerTxn: true,
      });
      return this.ledger.post(tx, {
        type: 'DEPOSIT',
        description: `Deposit to ${wallet.currency} wallet`,
        externalRef,
        initiatedBy: userId,
        metadata: { walletId: wallet.id, amount: formatAmount(amount, wallet.currency), rail: 'SIMULATED_BANK' },
        legs: [debit(bank, amount), credit(wallet.ledgerAccountId, amount)],
      });
    });
    return this.wallets.viewForUser(posted, userId);
  }

  /** Payout to a bank account: DR wallet (amount + fee), CR bank clearing, CR fee revenue. */
  async withdraw(userId: string, walletId: string, amountInput: string, pin: string, idempotencyKey: string) {
    const wallet = await this.wallets.getOwned(userId, walletId);
    const amount = toMinor(amountInput, wallet.currency);
    await this.pins.verify(userId, pin);

    const fee = bpsOf(amount, this.config.get('WITHDRAWAL_FEE_BPS'));
    const bank = await this.ledger.systemAccountId('BANK_CLEARING', wallet.currency);
    const feeRevenue = await this.ledger.systemAccountId('FEE_REVENUE', wallet.currency);
    const externalRef = externalRefFor(userId, idempotencyKey);

    const posted = await this.postOnce(externalRef, 'WITHDRAWAL', async (tx) => {
      // The fee account is only touched (and locked) when there is a fee: it's a hot row.
      await this.ledger.lockAccounts(tx, fee > 0n ? [wallet.ledgerAccountId, bank, feeRevenue] : [wallet.ledgerAccountId, bank]);
      await this.wallets.assertActive(tx, [wallet.id]);
      const { kycTier } = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { kycTier: true } });
      await this.limits.assertOutflow(tx, {
        tier: kycTier,
        currency: wallet.currency,
        accountId: wallet.ledgerAccountId,
        amount: amount + fee,
      });
      const legs: LegInput[] = [debit(wallet.ledgerAccountId, amount + fee), credit(bank, amount)];
      if (fee > 0n) legs.push(credit(feeRevenue, fee));
      return this.ledger.post(tx, {
        type: 'WITHDRAWAL',
        description: `Withdrawal from ${wallet.currency} wallet`,
        externalRef,
        initiatedBy: userId,
        metadata: {
          walletId: wallet.id,
          amount: formatAmount(amount, wallet.currency),
          fee: formatAmount(fee, wallet.currency),
          rail: 'SIMULATED_BANK',
        },
        legs,
      });
    });
    return this.wallets.viewForUser(posted, userId);
  }

  /**
   * Run a posting transaction at most once per external reference. If a previous attempt
   * with the same key already committed (e.g. the idempotency record was lost after a crash),
   * return that entry instead of posting again.
   */
  async postOnce(
    externalRef: string,
    type: EntryType,
    work: (tx: Tx) => Promise<PostedEntry>,
  ): Promise<PostedEntry> {
    const existing = await this.ledger.findByExternalRef(externalRef);
    if (existing) return this.replayed(existing, externalRef, type);
    try {
      return await this.prisma.runInTransaction(work);
    } catch (err) {
      if (isUniqueViolation(err, 'external_ref')) {
        const committed = await this.ledger.findByExternalRef(externalRef);
        if (committed) return this.replayed(committed, externalRef, type);
      }
      throw err;
    }
  }

  private replayed(entry: PostedEntry, externalRef: string, type: EntryType): PostedEntry {
    if (entry.entry.type !== type) {
      throw new DomainError('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was already used for a different operation');
    }
    this.logger.warn({ externalRef, entryId: entry.entry.id }, 'Duplicate posting prevented by external_ref');
    return entry;
  }
}
