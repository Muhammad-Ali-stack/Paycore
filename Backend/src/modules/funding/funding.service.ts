import { randomBytes } from 'node:crypto';
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { FundingStatus, FundingTransaction, Prisma, WebhookEventOutcome } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { DomainError } from '../../common/errors/domain-error';
import { isUniqueViolation } from '../../common/errors/error-response';
import { FaultInjector } from '../../common/faults/fault-injector';
import { moneyView } from '../../common/money/money';
import { DomainEventBus } from '../../common/outbox/event-bus';
import { OutboxService } from '../../common/outbox/outbox.service';
import { PrismaService, Tx } from '../../common/prisma/prisma.service';
import { appendTimeline, readTimeline, timelineEntry } from '../../common/state/state-machine';
import { AppConfig } from '../../config/app-config';
import { PinService } from '../auth/pin.service';
import { FeesService } from '../fees/fees.service';
import { LimitsService } from '../kyc/limits.service';
import { LedgerService } from '../ledger/ledger.service';
import { LockedAccount, PostedEntry } from '../ledger/ledger.types';
import { LegInput, credit, debit } from '../ledger/ledger.validation';
import { operationHash } from '../payments/payment-engine.service';
import { externalRefFor } from '../wallets/payments.service';
import { WalletsService, toMinor } from '../wallets/wallets.service';
import { BANK_ADAPTER, BankAccountDetails, BankAdapter, FundingInstructions } from './bank.adapter';
import { BankEventContext, BankEventTarget, BankWebhookService } from './bank-webhook.service';
import { CreateTopupDto, CreateWithdrawalDto, FundingPageDto, FundingTransactionDto, ListFundingQuery } from './funding.dto';
import { BankOutcome, bankOutcomeOfEventType, fundingMachine, planBankOutcome } from './funding.state';

export function fundingView(f: FundingTransaction): FundingTransactionDto {
  return {
    id: f.id,
    direction: f.direction,
    method: f.method,
    status: f.status,
    walletId: f.walletId,
    amount: moneyView(f.amount, f.currency),
    fee: moneyView(f.fee, f.currency),
    bankReference: f.bankReference,
    instructions: (f.instructions as FundingInstructions | null) ?? null,
    failureReason: f.failureReason,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
    timeline: readTimeline(f.timeline),
  };
}

export const newBankReference = (prefix: 'TOP' | 'WDR' | 'STL'): string => `${prefix}${randomBytes(8).toString('hex').toUpperCase()}`;

/** The funding row changed between planning and locking: re-read and plan again. */
class StaleFundingState extends Error {}
/** A top-up can't be credited to the wallet (frozen / over max balance): park it in suspense. */
class RouteToSuspense extends Error {}

/** Where an outcome came from: a webhook event, a previously deferred event, or a system job. */
type OutcomeSource = { event: BankEventContext } | { deferredEventId: string } | { system: string };

/**
 * Bank top-ups and withdrawals (async, via the bank adapter and signed webhooks).
 *
 * Posting recipes (see README, section 3):
 *   TOPUP succeeded      DR BANK_CLEARING amount | CR wallet amount-fee | CR FEE_REVENUE fee
 *   TOPUP reversed       reversal of the above (chargeback)
 *   WITHDRAWAL requested DR wallet amount+fee    | CR FUNDS_IN_FLIGHT amount+fee      (hold)
 *   WITHDRAWAL succeeded DR FUNDS_IN_FLIGHT a+f  | CR BANK_CLEARING amount | CR FEE_REVENUE fee
 *   WITHDRAWAL failed    reversal of the hold (funds released to the wallet)
 *   WITHDRAWAL reversed  reversal of the payout, then reversal of the hold (bank returned funds)
 */
@Injectable()
export class FundingService implements BankEventTarget, OnModuleInit {
  readonly name = 'funding';

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly wallets: WalletsService,
    private readonly limits: LimitsService,
    private readonly pins: PinService,
    private readonly fees: FeesService,
    private readonly outbox: OutboxService,
    private readonly bus: DomainEventBus,
    private readonly webhooks: BankWebhookService,
    @Inject(BANK_ADAPTER) private readonly bank: BankAdapter,
    private readonly faults: FaultInjector,
    private readonly config: AppConfig,
    @InjectPinoLogger(FundingService.name) private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.webhooks.registerTarget(this);
    this.bus.subscribe('funding.withdrawal.requested', 'funding.submit-payout', async (e) => {
      await this.submitWithdrawal(String(e.payload.fundingId));
    });
  }

  async owns(reference: string): Promise<boolean> {
    return (await this.prisma.fundingTransaction.count({ where: { bankReference: reference } })) > 0;
  }

  // ─────────────────────────── initiation ───────────────────────────

  private async existing(externalRef: string, requestHash: string): Promise<FundingTransaction | null> {
    const found = await this.prisma.fundingTransaction.findUnique({ where: { externalRef } });
    if (found && found.requestHash !== requestHash) {
      throw new DomainError('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was already used for a different request');
    }
    return found;
  }

  /** Creates a PENDING top-up. Nothing is credited until the bank confirms (webhook SUCCEEDED). */
  async topup(userId: string, dto: CreateTopupDto, idempotencyKey: string): Promise<FundingTransaction> {
    const wallet = await this.wallets.getOwned(userId, dto.walletId);
    const amount = toMinor(dto.amount, wallet.currency);
    const externalRef = externalRefFor(userId, idempotencyKey);
    const requestHash = operationHash('funding.topup', { walletId: wallet.id, amount: amount.toString(), method: dto.method });
    const prior = await this.existing(externalRef, requestHash);
    if (prior) return prior;

    if (wallet.status !== 'ACTIVE') throw new DomainError('WALLET_NOT_ACTIVE', `Wallet is ${wallet.status.toLowerCase()}`);
    const fee = await this.fees.fee(dto.method === 'CARD' ? 'TOPUP_CARD' : 'TOPUP_BANK_TRANSFER', wallet.currency, amount);
    if (fee >= amount) throw new DomainError('INVALID_AMOUNT', 'Amount is too small to cover the top-up fee');
    // Non-binding pre-check (the binding check runs when the money actually arrives).
    const { kycTier } = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { kycTier: true } });
    await this.limits.assertInflow(this.prisma, {
      tier: kycTier,
      currency: wallet.currency,
      currentBalance: wallet.ledgerAccount.balance,
      amount: amount - fee,
      enforcePerTxn: true,
    });

    const bankReference = newBankReference('TOP');
    const { instructions } = await this.bank.initiateTopup({ reference: bankReference, method: dto.method, currency: wallet.currency, amountMinor: amount });
    try {
      return await this.prisma.runInTransaction(async (tx) => {
        const f = await tx.fundingTransaction.create({
          data: {
            userId,
            walletId: wallet.id,
            direction: 'TOPUP',
            method: dto.method,
            currency: wallet.currency,
            amount,
            fee,
            bankReference,
            instructions: instructions ? ({ ...instructions } as Prisma.InputJsonValue) : Prisma.DbNull,
            externalRef,
            requestHash,
            submittedAt: new Date(),
            timeline: [timelineEntry('PENDING')] as unknown as Prisma.InputJsonValue,
          },
        });
        await this.event(tx, f, 'funding.topup.created');
        return f;
      });
    } catch (err) {
      if (isUniqueViolation(err, 'external_ref')) {
        const raced = await this.existing(externalRef, requestHash);
        if (raced) return raced;
      }
      throw err;
    }
  }

  /** Holds amount + fee immediately (wallet -> funds in flight); the bank outcome releases or settles it. */
  async withdraw(userId: string, dto: CreateWithdrawalDto, idempotencyKey: string): Promise<FundingTransaction> {
    const wallet = await this.wallets.getOwned(userId, dto.walletId);
    const amount = toMinor(dto.amount, wallet.currency);
    const externalRef = externalRefFor(userId, idempotencyKey);
    const requestHash = operationHash('funding.withdrawal', {
      walletId: wallet.id,
      amount: amount.toString(),
      iban: dto.bankAccount.iban,
      accountTitle: dto.bankAccount.accountTitle,
      bankName: dto.bankAccount.bankName,
    });
    await this.pins.verify(userId, dto.pin);
    const prior = await this.existing(externalRef, requestHash);
    if (prior) return prior;

    const fee = await this.fees.fee('WITHDRAWAL', wallet.currency, amount);
    const inFlight = await this.ledger.systemAccountId('FUNDS_IN_FLIGHT', wallet.currency);
    const bankReference = newBankReference('WDR');

    let created: FundingTransaction;
    try {
      created = await this.prisma.runInTransaction(async (tx) => {
        await this.ledger.lockAccounts(tx, [wallet.ledgerAccountId, inFlight]);
        await this.wallets.assertActive(tx, [wallet.id]);
        const { kycTier } = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { kycTier: true } });
        await this.limits.assertOutflow(tx, { tier: kycTier, currency: wallet.currency, accountId: wallet.ledgerAccountId, amount: amount + fee });
        const hold = await this.ledger.post(tx, {
          type: 'WITHDRAWAL_HOLD',
          description: `Withdrawal to ${dto.bankAccount.bankName}`.slice(0, 200),
          externalRef,
          initiatedBy: userId,
          metadata: { walletId: wallet.id, bankReference, activityType: 'WITHDRAWAL', fee: fee.toString() },
          legs: [debit(wallet.ledgerAccountId, amount + fee), credit(inFlight, amount + fee)],
        });
        this.faults.hit('funding.afterHold');
        const f = await tx.fundingTransaction.create({
          data: {
            userId,
            walletId: wallet.id,
            direction: 'WITHDRAWAL',
            method: 'BANK_TRANSFER',
            currency: wallet.currency,
            amount,
            fee,
            bankReference,
            bankAccount: { ...dto.bankAccount } as Prisma.InputJsonValue,
            holdEntryId: hold.entry.id,
            externalRef,
            requestHash,
            timeline: [timelineEntry('PENDING', 'funds held')] as unknown as Prisma.InputJsonValue,
          },
        });
        // The worker submits the payout to the bank (idempotent on the reference).
        await this.event(tx, f, 'funding.withdrawal.requested');
        return f;
      });
    } catch (err) {
      if (isUniqueViolation(err, 'external_ref')) {
        const raced = await this.existing(externalRef, requestHash);
        if (raced) return raced;
      }
      throw err;
    }
    this.faults.hit('funding.afterCommit');
    return created;
  }

  async submitWithdrawal(fundingId: string): Promise<void> {
    const f = await this.prisma.fundingTransaction.findUnique({ where: { id: fundingId } });
    if (!f || f.direction !== 'WITHDRAWAL' || f.status !== 'PENDING' || f.submittedAt) return;
    await this.bank.submitPayout({
      reference: f.bankReference,
      kind: 'WITHDRAWAL',
      currency: f.currency,
      amountMinor: f.amount,
      beneficiary: f.bankAccount as unknown as BankAccountDetails,
    });
    await this.prisma.fundingTransaction.updateMany({ where: { id: f.id, submittedAt: null }, data: { submittedAt: new Date() } });
  }

  // ─────────────────────────── queries ───────────────────────────

  async list(userId: string, q: ListFundingQuery): Promise<FundingPageDto> {
    const take = q.limit ?? 25;
    const rows = await this.prisma.fundingTransaction.findMany({
      where: { userId, ...(q.status ? { status: q.status } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, take);
    return { items: page.map(fundingView), nextCursor: rows.length > take ? (page[page.length - 1]?.id ?? null) : null };
  }

  async get(userId: string, id: string): Promise<FundingTransaction> {
    const f = await this.prisma.fundingTransaction.findUnique({ where: { id } });
    if (!f || f.userId !== userId) throw new DomainError('NOT_FOUND', 'Funding transaction not found');
    return f;
  }

  // ─────────────────────────── bank outcomes ───────────────────────────

  /** Webhook target: apply, ignore, defer or flag the outcome (re-planning if the row moved). */
  async handle(ctx: BankEventContext): Promise<WebhookEventOutcome> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const f = await this.prisma.fundingTransaction.findUniqueOrThrow({ where: { bankReference: ctx.event.data.reference } });
      try {
        return await this.dispatch(f, ctx);
      } catch (err) {
        if (err instanceof StaleFundingState) continue;
        throw err;
      }
    }
    throw new DomainError('CONCURRENT_MODIFICATION', 'Funding transaction kept changing; retry the webhook');
  }

  private async dispatch(f: FundingTransaction, ctx: BankEventContext): Promise<WebhookEventOutcome> {
    const source = { event: ctx };
    const reported = ctx.event.data.amountMinor;
    if (ctx.outcome === 'SUCCEEDED' && reported !== undefined && BigInt(reported) !== f.amount) {
      await this.flag(f, source, `bank reported ${reported} minor units, expected ${f.amount}`);
      return 'FLAGGED';
    }
    const plan = planBankOutcome(f.status, ctx.outcome);
    if (plan === 'IGNORE') {
      await this.prisma.$transaction((tx) => this.webhooks.record(tx, ctx, 'IGNORED', `already ${f.status}`));
      return 'IGNORED';
    }
    if (plan === 'DEFER') {
      await this.prisma.$transaction((tx) => this.webhooks.record(tx, ctx, 'DEFERRED', `${ctx.outcome} received while ${f.status}`));
      this.logger.warn({ fundingId: f.id, outcome: ctx.outcome }, 'Out-of-order bank event deferred');
      return 'DEFERRED';
    }
    if (plan === 'FLAG') {
      await this.flag(f, source, `${ctx.outcome} received after ${f.status}`);
      return 'FLAGGED';
    }
    const result = await this.apply(f, ctx.outcome, source);
    if (result === 'APPLIED' && ctx.outcome === 'SUCCEEDED') await this.applyDeferred(f.bankReference);
    return result;
  }

  /** Apply REVERSED events that arrived before SUCCEEDED (compensation once the success landed). */
  private async applyDeferred(bankReference: string): Promise<void> {
    const deferred = await this.prisma.bankWebhookEvent.findMany({
      where: { bankReference, outcome: 'DEFERRED', appliedAt: null },
      orderBy: { receivedAt: 'asc' },
    });
    for (const ev of deferred) {
      const outcome = bankOutcomeOfEventType(ev.type);
      const f = await this.prisma.fundingTransaction.findUniqueOrThrow({ where: { bankReference } });
      if (!outcome || planBankOutcome(f.status, outcome) !== 'APPLY') continue;
      await this.apply(f, outcome, { deferredEventId: ev.id });
      this.logger.warn({ fundingId: f.id, eventId: ev.id, outcome }, 'Deferred bank event applied');
    }
  }

  private async recordSource(tx: Tx, source: OutcomeSource, outcome: WebhookEventOutcome, note?: string): Promise<void> {
    if ('event' in source) await this.webhooks.record(tx, source.event, outcome, note);
    else if ('deferredEventId' in source) {
      await tx.bankWebhookEvent.update({
        where: { id: source.deferredEventId },
        data: { outcome: 'APPLIED', appliedAt: new Date(), note: note ?? 'applied after out-of-order delivery' },
      });
    }
  }

  /** Lock (ascending ids) -> re-read the row -> run `body` if the status is still `expected`. */
  private moneyTx<T>(
    fundingId: string,
    expected: FundingStatus,
    lockIds: string[],
    body: (tx: Tx, current: FundingTransaction, locked: Map<string, LockedAccount>) => Promise<T>,
  ): Promise<T> {
    return this.prisma.runInTransaction(async (tx) => {
      const locked = await this.ledger.lockAccounts(tx, lockIds);
      const current = await tx.fundingTransaction.findUniqueOrThrow({ where: { id: fundingId } });
      if (current.status !== expected) throw new StaleFundingState();
      return body(tx, current, locked);
    });
  }

  private async transition(
    tx: Tx,
    current: FundingTransaction,
    to: FundingStatus,
    reason: string | undefined,
    data: Prisma.FundingTransactionUncheckedUpdateManyInput = {},
  ): Promise<void> {
    fundingMachine.assert(current.status, to);
    const res = await tx.fundingTransaction.updateMany({
      where: { id: current.id, status: current.status },
      data: { ...data, status: to, timeline: appendTimeline(current.timeline, to, reason) as unknown as Prisma.InputJsonValue },
    });
    if (res.count !== 1) throw new StaleFundingState();
    await this.event(tx, { ...current, status: to }, `funding.${to.toLowerCase()}`);
  }

  private meta(f: FundingTransaction): Record<string, unknown> {
    return { fundingId: f.id, bankReference: f.bankReference, walletId: f.walletId, activityType: f.direction };
  }

  private entry(id: string | null): Promise<PostedEntry> {
    if (!id) throw new Error('Funding transaction is missing its ledger entry');
    return this.ledger.getEntry(id);
  }

  private accountsOf(...entries: PostedEntry[]): string[] {
    return [...new Set(entries.flatMap((e) => e.postings.map((p) => p.accountId)))];
  }

  /** Performs a legal transition with its ledger effects. */
  private async apply(f: FundingTransaction, outcome: BankOutcome, source: OutcomeSource, reason?: string): Promise<WebhookEventOutcome> {
    const meta = this.meta(f);
    const failureReason = reason ?? ('event' in source ? source.event.event.data.reason : undefined) ?? 'Rejected by the bank';

    if (f.direction === 'TOPUP') {
      if (outcome === 'SUCCEEDED') {
        try {
          await this.settleTopup(f, source, 'WALLET');
        } catch (err) {
          if (!(err instanceof RouteToSuspense)) throw err;
          await this.settleTopup(f, source, 'SUSPENSE', err.message);
        }
        return 'APPLIED';
      }
      if (outcome === 'FAILED') {
        await this.moneyTx(f.id, 'PENDING', [], async (tx, current) => {
          await this.recordSource(tx, source, 'APPLIED');
          await this.transition(tx, current, 'FAILED', failureReason, { failureReason });
        });
        return 'APPLIED';
      }
      // REVERSED: chargeback of a credited top-up.
      const settled = await this.entry(f.settleEntryId);
      try {
        await this.moneyTx(f.id, 'SUCCEEDED', this.accountsOf(settled), async (tx, current) => {
          await this.recordSource(tx, source, 'APPLIED');
          await this.ledger.reverseInTx(tx, settled, { reason: 'bank chargeback', externalRef: `funding:${f.id}:chargeback`, metadata: meta });
          await this.transition(tx, current, 'REVERSED', 'bank chargeback', { failureReason: 'Reversed by the bank' });
        });
        return 'APPLIED';
      } catch (err) {
        if (err instanceof DomainError && err.code === 'INSUFFICIENT_FUNDS') {
          await this.flag(f, source, 'chargeback exceeds the wallet balance; manual recovery required');
          return 'FLAGGED';
        }
        throw err;
      }
    }

    // WITHDRAWAL
    const inFlight = await this.ledger.systemAccountId('FUNDS_IN_FLIGHT', f.currency);
    const bank = await this.ledger.systemAccountId('BANK_CLEARING', f.currency);
    const feeRevenue = await this.ledger.systemAccountId('FEE_REVENUE', f.currency);
    if (outcome === 'SUCCEEDED') {
      await this.moneyTx(f.id, 'PENDING', f.fee > 0n ? [inFlight, bank, feeRevenue] : [inFlight, bank], async (tx, current) => {
        await this.recordSource(tx, source, 'APPLIED');
        const legs: LegInput[] = [debit(inFlight, f.amount + f.fee), credit(bank, f.amount)];
        if (f.fee > 0n) legs.push(credit(feeRevenue, f.fee));
        const posted = await this.ledger.post(tx, {
          type: 'WITHDRAWAL_PAYOUT',
          description: 'Withdrawal paid out by the bank',
          externalRef: `funding:${f.id}:settle`,
          metadata: meta,
          legs,
        });
        this.faults.hit('webhook.afterApply');
        await this.transition(tx, current, 'SUCCEEDED', undefined, { settleEntryId: posted.entry.id });
      });
      return 'APPLIED';
    }
    const hold = await this.entry(f.holdEntryId);
    if (outcome === 'FAILED') {
      await this.moneyTx(f.id, 'PENDING', this.accountsOf(hold), async (tx, current) => {
        await this.recordSource(tx, source, 'APPLIED');
        await this.ledger.reverseInTx(tx, hold, { reason: 'withdrawal failed; funds released', externalRef: `funding:${f.id}:release`, metadata: meta });
        await this.transition(tx, current, 'FAILED', failureReason, { failureReason });
      });
      return 'APPLIED';
    }
    // REVERSED: the bank returned a paid-out withdrawal -> undo the payout, then the hold.
    const payout = await this.entry(f.settleEntryId);
    await this.moneyTx(f.id, 'SUCCEEDED', this.accountsOf(payout, hold), async (tx, current) => {
      await this.recordSource(tx, source, 'APPLIED');
      await this.ledger.reverseInTx(tx, payout, { reason: 'payout returned by the bank', externalRef: `funding:${f.id}:return`, metadata: meta });
      await this.ledger.reverseInTx(tx, hold, { reason: 'payout returned; funds released', externalRef: `funding:${f.id}:release`, metadata: meta });
      await this.transition(tx, current, 'REVERSED', 'returned by the bank', { failureReason: 'Returned by the bank' });
    });
    return 'APPLIED';
  }

  /** Credit a confirmed top-up to the wallet, or to SUSPENSE (flagged) if the wallet can't take it. */
  private async settleTopup(f: FundingTransaction, source: OutcomeSource, target: 'WALLET' | 'SUSPENSE', why?: string): Promise<void> {
    const wallet = await this.wallets.getById(f.walletId);
    const bank = await this.ledger.systemAccountId('BANK_CLEARING', f.currency);
    const feeRevenue = await this.ledger.systemAccountId('FEE_REVENUE', f.currency);
    const suspense = await this.ledger.systemAccountId('SUSPENSE', f.currency);
    const toWallet = target === 'WALLET';
    const lock = toWallet ? [wallet.ledgerAccountId, bank, ...(f.fee > 0n ? [feeRevenue] : [])] : [bank, suspense];

    await this.moneyTx(f.id, 'PENDING', lock, async (tx, current, locked) => {
      if (toWallet) {
        try {
          await this.wallets.assertActive(tx, [wallet.id]);
          const { kycTier } = await tx.user.findUniqueOrThrow({ where: { id: f.userId }, select: { kycTier: true } });
          await this.limits.assertInflow(tx, {
            tier: kycTier,
            currency: f.currency,
            currentBalance: locked.get(wallet.ledgerAccountId)?.balance ?? 0n,
            amount: f.amount - f.fee,
            enforcePerTxn: false,
          });
        } catch (err) {
          if (err instanceof DomainError) throw new RouteToSuspense(`${err.code}: ${err.message}`);
          throw err;
        }
      }
      await this.recordSource(tx, source, 'APPLIED', toWallet ? undefined : `credited to suspense (${why})`);
      const legs: LegInput[] = toWallet
        ? [debit(bank, f.amount), credit(wallet.ledgerAccountId, f.amount - f.fee), ...(f.fee > 0n ? [credit(feeRevenue, f.fee)] : [])]
        : [debit(bank, f.amount), credit(suspense, f.amount)];
      const posted = await this.ledger.post(tx, {
        type: 'TOPUP',
        description: toWallet ? `Top-up (${f.method === 'CARD' ? 'card' : 'bank transfer'})` : 'Top-up parked in suspense',
        externalRef: `funding:${f.id}:settle`,
        initiatedBy: f.userId,
        metadata: { ...this.meta(f), fee: f.fee.toString(), ...(toWallet ? {} : { suspense: true }) },
        legs,
      });
      this.faults.hit('webhook.afterApply');
      await this.transition(tx, current, 'SUCCEEDED', toWallet ? undefined : 'credited to suspense for review', {
        settleEntryId: posted.entry.id,
        ...(toWallet ? {} : { needsReview: true, reviewReason: `Credited to suspense: ${why}` }),
      });
    });
    if (!toWallet) this.logger.warn({ fundingId: f.id, why }, 'Top-up credited to suspense');
  }

  /** Contradictory / suspicious outcome: never applied blindly, flagged for review and reconciliation. */
  private async flag(f: FundingTransaction, source: OutcomeSource, reason: string): Promise<void> {
    await this.prisma.runInTransaction(async (tx) => {
      await this.recordSource(tx, source, 'FLAGGED', reason);
      await tx.fundingTransaction.update({ where: { id: f.id }, data: { needsReview: true, reviewReason: reason.slice(0, 500) } });
      await this.event(tx, f, 'funding.flagged', { reason });
    });
    this.logger.warn({ fundingId: f.id, reason }, 'Funding transaction flagged for review');
  }

  // ─────────────────────────── timeouts ───────────────────────────

  /**
   * Resolve PENDING items the bank never reported on. The bank is asked first (a lost webhook is
   * the usual cause). Top-ups -> FAILED (no money moved). Withdrawals the bank never received or
   * rejected -> FAILED with the hold reversed (compensation). Withdrawals still pending at the
   * bank are flagged instead of being released (the bank might still pay them out).
   */
  async timeoutStale(now = new Date()): Promise<{ resolved: number; flagged: number }> {
    const topupCutoff = new Date(now.getTime() - this.config.get('TOPUP_PENDING_TIMEOUT_HOURS') * 3600_000);
    const withdrawalCutoff = new Date(now.getTime() - this.config.get('WITHDRAWAL_PENDING_TIMEOUT_HOURS') * 3600_000);
    const stale = await this.prisma.fundingTransaction.findMany({
      where: {
        status: 'PENDING',
        OR: [
          { direction: 'TOPUP', createdAt: { lt: topupCutoff } },
          { direction: 'WITHDRAWAL', createdAt: { lt: withdrawalCutoff } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    let resolved = 0;
    let flagged = 0;
    for (const f of stale) {
      try {
        const status = await this.bank.getStatus(f.bankReference);
        const source = { system: 'timeout' };
        if (status === 'SUCCEEDED') {
          await this.apply(f, 'SUCCEEDED', source);
          resolved++;
        } else if (status === 'PENDING' && f.direction === 'WITHDRAWAL') {
          if (!f.needsReview) {
            await this.flag(f, source, 'withdrawal still pending at the bank after the timeout');
            flagged++;
          }
        } else {
          await this.apply(f, 'FAILED', source, 'Timed out waiting for the bank');
          resolved++;
        }
      } catch (err) {
        if (!(err instanceof StaleFundingState)) this.logger.error({ err, fundingId: f.id }, 'Funding timeout handling failed');
      }
    }
    if (resolved + flagged > 0) this.logger.warn({ resolved, flagged }, 'Stale funding transactions handled');
    return { resolved, flagged };
  }

  private event(tx: Tx, f: FundingTransaction, eventType: string, extra: Record<string, unknown> = {}): Promise<void> {
    return this.outbox.enqueue(tx, {
      aggregateType: 'funding',
      aggregateId: f.id,
      eventType,
      payload: {
        fundingId: f.id,
        userId: f.userId,
        walletId: f.walletId,
        direction: f.direction,
        status: f.status,
        currency: f.currency,
        amountMinor: f.amount.toString(),
        bankReference: f.bankReference,
        ...extra,
      },
    });
  }
}
