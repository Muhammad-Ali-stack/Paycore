import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Merchant, Prisma, Settlement, SettlementStatus, WebhookEventOutcome } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { DomainError } from '../../common/errors/domain-error';
import { FaultInjector } from '../../common/faults/fault-injector';
import { DomainEventBus } from '../../common/outbox/event-bus';
import { OutboxService } from '../../common/outbox/outbox.service';
import { PrismaService, Tx } from '../../common/prisma/prisma.service';
import { appendTimeline, timelineEntry } from '../../common/state/state-machine';
import { AppConfig } from '../../config/app-config';
import { BANK_ADAPTER, BankAccountDetails, BankAdapter } from '../funding/bank.adapter';
import { BankEventContext, BankEventTarget, BankWebhookService } from '../funding/bank-webhook.service';
import { BankOutcome } from '../funding/funding.state';
import { newBankReference } from '../funding/funding.service';
import { LedgerService } from '../ledger/ledger.service';
import { credit, debit } from '../ledger/ledger.validation';
import { SettlementPageDto } from '../merchants/merchants.dto';
import { settlementView } from './settlement.mapper';
import { SettlementItem, settlementCutoff, settlementMachine, summarizeSettlement } from './settlement.math';

class StaleSettlementState extends Error {}

/**
 * T+N merchant settlement.
 *
 *   batch   (PENDING)  DR merchant payable net | CR FUNDS_IN_FLIGHT net
 *   payout  (PAID)     DR FUNDS_IN_FLIGHT net  | CR BANK_CLEARING net
 *   failed  (FAILED)   reversal of the batch entry; the items become eligible for the next batch
 *
 * A batch claims its payments/refunds (settlement_id IS NULL -> id) in the same transaction as
 * the entry, after locking the merchant payable, so an item can never be settled twice and
 * re-running a batch for the same date is a no-op.
 */
@Injectable()
export class SettlementService implements BankEventTarget, OnModuleInit {
  readonly name = 'settlement';

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly outbox: OutboxService,
    private readonly bus: DomainEventBus,
    private readonly webhooks: BankWebhookService,
    @Inject(BANK_ADAPTER) private readonly bank: BankAdapter,
    private readonly faults: FaultInjector,
    private readonly config: AppConfig,
    @InjectPinoLogger(SettlementService.name) private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.webhooks.registerTarget(this);
    this.bus.subscribe('settlement.created', 'settlement.submit-payout', async (e) => {
      await this.submitPayout(String(e.payload.settlementId));
    });
  }

  // ─────────────────────────── batch ───────────────────────────

  async runBatch(asOf: Date = new Date()): Promise<Settlement[]> {
    const merchants = await this.prisma.merchant.findMany({ where: { status: 'ACTIVE' }, orderBy: { id: 'asc' } });
    const created: Settlement[] = [];
    for (const m of merchants) {
      try {
        const s = await this.settleMerchant(m, asOf);
        if (s) created.push(s);
      } catch (err) {
        this.logger.error({ err, merchantId: m.id }, 'Settlement batch failed for merchant');
      }
    }
    if (created.length) this.logger.info({ asOf: asOf.toISOString(), settlements: created.length }, 'Settlement batch completed');
    return created;
  }

  async settleMerchant(m: Merchant, asOf: Date): Promise<Settlement | null> {
    const cutoff = settlementCutoff(asOf, m.settlementDelayDays);
    const inFlight = await this.ledger.systemAccountId('FUNDS_IN_FLIGHT', m.settlementCurrency);

    return this.prisma.runInTransaction(async (tx) => {
      const locked = await this.ledger.lockAccounts(tx, [m.ledgerAccountId, inFlight]);
      const payments = await tx.payment.findMany({
        where: {
          merchantId: m.id,
          type: 'QR_MERCHANT',
          settlementId: null,
          status: { in: ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'] },
          completedAt: { lt: cutoff },
        },
        select: { id: true, amount: true, mdrFee: true, completedAt: true },
      });
      const refunds = await tx.refund.findMany({
        where: { merchantId: m.id, status: 'COMPLETED', settlementId: null, completedAt: { lt: cutoff } },
        select: { id: true, amount: true, mdrRefund: true, completedAt: true },
      });
      const items: SettlementItem[] = [
        ...payments.map((p) => ({ kind: 'PAYMENT' as const, id: p.id, amount: p.amount, mdr: p.mdrFee, occurredAt: p.completedAt as Date })),
        ...refunds.map((r) => ({ kind: 'REFUND' as const, id: r.id, amount: r.amount, mdr: r.mdrRefund, occurredAt: r.completedAt as Date })),
      ];
      const totals = summarizeSettlement(items);
      if (items.length === 0 || totals.net <= 0n) return null; // nothing due, or refunds carried forward

      const balance = locked.get(m.ledgerAccountId)?.balance ?? 0n;
      if (totals.net > balance) {
        // The payable must always cover its unsettled items; anything else is an integrity breach.
        throw new Error(`Merchant ${m.id} payable ${balance} is below unsettled net ${totals.net}`);
      }

      const settlement = await tx.settlement.create({
        data: {
          merchantId: m.id,
          currency: m.settlementCurrency,
          periodStart: totals.periodStart ?? cutoff,
          periodEnd: cutoff,
          gross: totals.gross,
          mdr: totals.mdr,
          refunds: totals.refunds,
          net: totals.net,
          bankReference: newBankReference('STL'),
          timeline: [timelineEntry('PENDING')] as unknown as Prisma.InputJsonValue,
        },
      });
      const claimedPayments = await tx.payment.updateMany({
        where: { id: { in: payments.map((p) => p.id) }, settlementId: null },
        data: { settlementId: settlement.id },
      });
      const claimedRefunds = await tx.refund.updateMany({
        where: { id: { in: refunds.map((r) => r.id) }, settlementId: null },
        data: { settlementId: settlement.id },
      });
      if (claimedPayments.count !== payments.length || claimedRefunds.count !== refunds.length) {
        throw new DomainError('CONCURRENT_MODIFICATION', 'Settlement items were claimed concurrently');
      }
      await tx.settlementLine.createMany({
        data: totals.lines.map((l) => ({
          settlementId: settlement.id,
          kind: l.kind,
          paymentId: l.kind === 'PAYMENT' ? l.id : null,
          refundId: l.kind === 'REFUND' ? l.id : null,
          gross: l.gross,
          mdr: l.mdr,
          net: l.net,
          occurredAt: l.occurredAt,
        })),
      });
      const posted = await this.ledger.post(tx, {
        type: 'SETTLEMENT',
        description: `Settlement batch to ${m.businessName}`.slice(0, 200),
        externalRef: `settlement:${settlement.id}`,
        metadata: { settlementId: settlement.id, merchantId: m.id, activityType: 'SETTLEMENT' },
        legs: [debit(m.ledgerAccountId, totals.net), credit(inFlight, totals.net)],
      });
      this.faults.hit('settlement.afterPost');
      const updated = await tx.settlement.update({ where: { id: settlement.id }, data: { journalEntryId: posted.entry.id } });
      await this.event(tx, updated, 'settlement.created');
      return updated;
    });
  }

  async submitPayout(settlementId: string): Promise<void> {
    const s = await this.prisma.settlement.findUnique({ where: { id: settlementId } });
    if (!s || s.status !== 'PENDING' || s.submittedAt) return;
    const m = await this.prisma.merchant.findUniqueOrThrow({ where: { id: s.merchantId } });
    await this.bank.submitPayout({
      reference: s.bankReference,
      kind: 'SETTLEMENT',
      currency: s.currency,
      amountMinor: s.net,
      beneficiary: m.settlementBank as unknown as BankAccountDetails,
    });
    await this.prisma.settlement.updateMany({ where: { id: s.id, submittedAt: null }, data: { submittedAt: new Date() } });
  }

  // ─────────────────────────── bank outcomes ───────────────────────────

  async owns(reference: string): Promise<boolean> {
    return (await this.prisma.settlement.count({ where: { bankReference: reference } })) > 0;
  }

  async handle(ctx: BankEventContext): Promise<WebhookEventOutcome> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const s = await this.prisma.settlement.findUniqueOrThrow({ where: { bankReference: ctx.event.data.reference } });
      try {
        return await this.applyOutcome(s, ctx.outcome, ctx);
      } catch (err) {
        if (err instanceof StaleSettlementState) continue;
        throw err;
      }
    }
    throw new DomainError('CONCURRENT_MODIFICATION', 'Settlement kept changing; retry the webhook');
  }

  private async applyOutcome(s: Settlement, outcome: BankOutcome, ctx: BankEventContext | null): Promise<WebhookEventOutcome> {
    const target: SettlementStatus | null = outcome === 'SUCCEEDED' ? 'PAID' : outcome === 'FAILED' ? 'FAILED' : null;
    if (target === s.status) {
      if (ctx) await this.prisma.$transaction((tx) => this.webhooks.record(tx, ctx, 'IGNORED', `already ${s.status}`));
      return 'IGNORED';
    }
    if (!target || !settlementMachine.can(s.status, target)) {
      const note = `${outcome} received while ${s.status}; manual review required`;
      if (ctx) await this.prisma.$transaction((tx) => this.webhooks.record(tx, ctx, 'FLAGGED', note));
      this.logger.warn({ settlementId: s.id, outcome, status: s.status }, 'Settlement bank event flagged');
      return 'FLAGGED';
    }

    const merchant = await this.prisma.merchant.findUniqueOrThrow({ where: { id: s.merchantId } });
    const inFlight = await this.ledger.systemAccountId('FUNDS_IN_FLIGHT', s.currency);
    const bank = await this.ledger.systemAccountId('BANK_CLEARING', s.currency);
    const lock = target === 'PAID' ? [inFlight, bank] : [merchant.ledgerAccountId, inFlight];

    await this.prisma.runInTransaction(async (tx) => {
      await this.ledger.lockAccounts(tx, lock);
      const current = await tx.settlement.findUniqueOrThrow({ where: { id: s.id } });
      if (current.status !== s.status) throw new StaleSettlementState();
      if (ctx) await this.webhooks.record(tx, ctx, 'APPLIED');
      const meta = { settlementId: s.id, merchantId: s.merchantId, bankReference: s.bankReference, activityType: 'SETTLEMENT' };
      if (target === 'PAID') {
        const payout = await this.ledger.post(tx, {
          type: 'SETTLEMENT_PAYOUT',
          description: `Settlement paid to ${merchant.businessName}`.slice(0, 200),
          externalRef: `settlement:${s.id}:payout`,
          metadata: meta,
          legs: [debit(inFlight, s.net), credit(bank, s.net)],
        });
        await this.transition(tx, current, 'PAID', undefined, { payoutEntryId: payout.entry.id, paidAt: new Date() });
      } else {
        const batch = await this.ledger.getEntry(current.journalEntryId as string);
        const reversal = await this.ledger.reverseInTx(tx, batch, {
          reason: 'settlement payout failed',
          externalRef: `settlement:${s.id}:reverse`,
          metadata: meta,
        });
        // Release the items so the next batch picks them up again.
        await tx.payment.updateMany({ where: { settlementId: s.id }, data: { settlementId: null } });
        await tx.refund.updateMany({ where: { settlementId: s.id }, data: { settlementId: null } });
        const reason = ctx?.event.data.reason ?? 'Payout failed';
        await this.transition(tx, current, 'FAILED', reason, { reversalEntryId: reversal.entry.id, failureReason: reason });
      }
    });
    return 'APPLIED';
  }

  private async transition(
    tx: Tx,
    current: Settlement,
    to: SettlementStatus,
    reason: string | undefined,
    data: Prisma.SettlementUncheckedUpdateManyInput,
  ): Promise<void> {
    settlementMachine.assert(current.status, to);
    const res = await tx.settlement.updateMany({
      where: { id: current.id, status: current.status },
      data: { ...data, status: to, timeline: appendTimeline(current.timeline, to, reason) as unknown as Prisma.InputJsonValue },
    });
    if (res.count !== 1) throw new StaleSettlementState();
    await this.event(tx, { ...current, status: to }, `settlement.${to.toLowerCase()}`);
  }

  /** PENDING payouts the bank never reported on: ask the bank, then pay or fail (with reversal). */
  async timeoutStale(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.config.get('SETTLEMENT_PAYOUT_TIMEOUT_HOURS') * 3600_000);
    const stale = await this.prisma.settlement.findMany({ where: { status: 'PENDING', createdAt: { lt: cutoff } }, take: 100 });
    let resolved = 0;
    for (const s of stale) {
      try {
        const status = await this.bank.getStatus(s.bankReference);
        if (status === 'PENDING') continue;
        await this.applyOutcome(s, status === 'SUCCEEDED' ? 'SUCCEEDED' : 'FAILED', null);
        resolved++;
      } catch (err) {
        if (!(err instanceof StaleSettlementState)) this.logger.error({ err, settlementId: s.id }, 'Settlement timeout handling failed');
      }
    }
    return resolved;
  }

  // ─────────────────────────── queries ───────────────────────────

  async list(merchantId: string, cursor?: string, limit = 25): Promise<SettlementPageDto> {
    const rows = await this.prisma.settlement.findMany({
      where: { merchantId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, limit);
    return { items: page.map((s) => settlementView(s)), nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null };
  }

  async getWithLines(merchantId: string, id: string) {
    const s = await this.prisma.settlement.findUnique({ where: { id }, include: { lines: { orderBy: { occurredAt: 'asc' } } } });
    if (!s || s.merchantId !== merchantId) throw new DomainError('NOT_FOUND', 'Settlement not found');
    return s;
  }

  private event(tx: Tx, s: Settlement, eventType: string): Promise<void> {
    return this.outbox.enqueue(tx, {
      aggregateType: 'settlement',
      aggregateId: s.id,
      eventType,
      payload: { settlementId: s.id, merchantId: s.merchantId, status: s.status, currency: s.currency, netMinor: s.net.toString() },
    });
  }
}
