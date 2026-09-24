import { randomUUID } from 'node:crypto';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Currency, Role } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { DomainError } from '../../common/errors/domain-error';
import { DomainEventBus } from '../../common/outbox/event-bus';
import { OutboxService } from '../../common/outbox/outbox.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AppConfig } from '../../config/app-config';
import { BankWebhookService, WebhookReceipt } from './bank-webhook.service';
import { SimulationResultDto } from './funding.dto';
import { utcDate } from './reconciliation.diff';
import { SimulatedBankAdapter } from './simulated-bank.adapter';
import { SIGNATURE_HEADER, signatureHeader } from './webhook.signature';

type Outcome = 'SUCCEEDED' | 'FAILED' | 'REVERSED';

const EVENT_TYPE: Record<Outcome, string> = {
  SUCCEEDED: 'transaction.succeeded',
  FAILED: 'transaction.failed',
  REVERSED: 'transaction.reversed',
};

/**
 * Drives the simulated bank for demos and tests: records the bank-side outcome (and its statement
 * line, which reconciliation later reads), then delivers a signed webhook exactly like a real bank
 * would, over HTTP (BANK_SIM_WEBHOOK_URL) or in-process through the same verification code path.
 * It deliberately allows any sequence (e.g. FAILED then SUCCEEDED) so out-of-order handling can
 * be exercised. Never available in production (env validation + route guard).
 */
@Injectable()
export class BankSimulatorService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly adapter: SimulatedBankAdapter,
    private readonly webhooks: BankWebhookService,
    private readonly outbox: OutboxService,
    private readonly bus: DomainEventBus,
    private readonly config: AppConfig,
    @InjectPinoLogger(BankSimulatorService.name) private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe('bank.simulation.requested', 'bank-simulator.deliver', async (e) => {
      if (!this.enabled) return;
      await this.execute(String(e.payload.reference), e.payload.outcome as Outcome, String(e.payload.eventId));
    });
  }

  get enabled(): boolean {
    return !this.config.isProduction && this.config.get('BANK_SIM_ENABLED');
  }

  async simulate(
    actor: { id: string; role: Role },
    input: { fundingId?: string; settlementId?: string; outcome: Outcome; delayMs?: number },
  ): Promise<SimulationResultDto> {
    if (!this.enabled) throw new DomainError('FEATURE_DISABLED', 'Not found');
    if (!!input.fundingId === !!input.settlementId) {
      throw new DomainError('VALIDATION_FAILED', 'Provide exactly one of fundingId or settlementId');
    }
    const reference = await this.referenceFor(actor, input);
    const eventId = `evt_${randomUUID()}`;
    if (input.delayMs && input.delayMs > 0) {
      const at = new Date(Date.now() + input.delayMs);
      await this.prisma.$transaction((tx) =>
        this.outbox.enqueue(tx, {
          aggregateType: 'bank_simulation',
          aggregateId: reference,
          eventType: 'bank.simulation.requested',
          payload: { reference, outcome: input.outcome, eventId },
          availableAt: at,
        }),
      );
      return { reference, outcome: input.outcome, eventId, delivered: false, scheduledFor: at.toISOString() };
    }
    const receipt = await this.execute(reference, input.outcome, eventId);
    return { reference, outcome: input.outcome, eventId, delivered: true, scheduledFor: null, receipt };
  }

  private async referenceFor(actor: { id: string; role: Role }, input: { fundingId?: string; settlementId?: string }): Promise<string> {
    if (input.fundingId) {
      const f = await this.prisma.fundingTransaction.findUnique({ where: { id: input.fundingId } });
      if (!f || (f.userId !== actor.id && actor.role !== 'ADMIN')) throw new DomainError('NOT_FOUND', 'Funding transaction not found');
      await this.adapter.register(f.bankReference, f.direction === 'TOPUP' ? 'TOPUP' : 'PAYOUT', f.currency, f.amount);
      return f.bankReference;
    }
    const s = await this.prisma.settlement.findUnique({ where: { id: input.settlementId } });
    const merchant = s ? await this.prisma.merchant.findUnique({ where: { id: s.merchantId } }) : null;
    if (!s || (merchant?.ownerUserId !== actor.id && actor.role !== 'ADMIN')) throw new DomainError('NOT_FOUND', 'Settlement not found');
    await this.adapter.register(s.bankReference, 'PAYOUT', s.currency, s.net);
    return s.bankReference;
  }

  /** Bank-side effect + statement line, then a signed webhook delivery. */
  async execute(reference: string, outcome: Outcome, eventId: string = `evt_${randomUUID()}`): Promise<WebhookReceipt> {
    const txn = await this.prisma.simBankTransaction.findUnique({ where: { reference } });
    if (!txn) throw new DomainError('NOT_FOUND', `Unknown bank reference ${reference}`);
    const sign = txn.kind === 'TOPUP' ? 1n : -1n; // + into PayCore's account, - out of it
    const statementAmount = outcome === 'SUCCEEDED' ? sign * txn.amount : outcome === 'REVERSED' ? -sign * txn.amount : null;
    await this.prisma.$transaction(async (tx) => {
      await tx.simBankTransaction.update({ where: { reference }, data: { status: outcome } });
      if (statementAmount !== null) {
        await tx.simBankStatementLine.create({
          data: { reference, currency: txn.currency, amount: statementAmount, valueDate: utcDate(new Date()) },
        });
      }
    });
    this.logger.info({ reference, outcome, eventId }, 'Simulated bank outcome recorded; delivering webhook');
    return this.deliver({
      id: eventId,
      type: EVENT_TYPE[outcome],
      createdAt: new Date().toISOString(),
      data: { reference, amountMinor: txn.amount.toString(), currency: txn.currency as Currency, ...(outcome === 'FAILED' ? { reason: 'Rejected by the beneficiary bank' } : {}) },
    });
  }

  /** Signs and delivers a raw event (also used by tests to replay / reorder deliveries). */
  async deliver(event: Record<string, unknown>): Promise<WebhookReceipt> {
    const body = JSON.stringify(event);
    const header = signatureHeader(this.config.get('BANK_WEBHOOK_SECRET'), body);
    const url = this.config.get('BANK_SIM_WEBHOOK_URL');
    if (!url) return this.webhooks.receive(body, header);
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', [SIGNATURE_HEADER]: header }, body });
    if (!res.ok) throw new Error(`Webhook delivery failed with HTTP ${res.status}`);
    return (await res.json()) as WebhookReceipt;
  }
}
