import { Injectable } from '@nestjs/common';
import { Prisma, WebhookEventOutcome } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { DomainError } from '../../common/errors/domain-error';
import { isUniqueViolation } from '../../common/errors/error-response';
import { PrismaService, Tx } from '../../common/prisma/prisma.service';
import { toJsonSafe } from '../../common/util/crypto';
import { AppConfig } from '../../config/app-config';
import { BankOutcome, bankOutcomeOfEventType } from './funding.state';
import { verifyWebhookSignature } from './webhook.signature';

export interface BankEvent {
  /** The bank's unique event id (dedupe key) */
  id: string;
  /** transaction.succeeded | transaction.failed | transaction.reversed */
  type: string;
  createdAt?: string;
  data: { reference: string; amountMinor?: string; currency?: string; reason?: string };
}

export interface BankEventContext {
  event: BankEvent;
  outcome: BankOutcome;
  signedAt: Date;
}

/** A module that owns some bank references (funding transactions, settlement payouts). */
export interface BankEventTarget {
  readonly name: string;
  owns(reference: string): Promise<boolean>;
  /** Apply the event. MUST call `webhooks.record(tx, ...)` inside the same transaction as its effects. */
  handle(ctx: BankEventContext): Promise<WebhookEventOutcome>;
}

export interface WebhookReceipt {
  received: true;
  duplicate: boolean;
  outcome: WebhookEventOutcome | 'DUPLICATE';
}

function parseEvent(raw: string): BankEvent {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new DomainError('VALIDATION_FAILED', 'Webhook body must be JSON');
  }
  const e = body as Partial<BankEvent> | null;
  if (
    !e ||
    typeof e.id !== 'string' ||
    !/^[A-Za-z0-9_.:-]{6,128}$/.test(e.id) ||
    typeof e.type !== 'string' ||
    !e.data ||
    typeof e.data.reference !== 'string' ||
    e.data.reference.length > 64 ||
    (e.data.amountMinor !== undefined && !/^\d{1,19}$/.test(String(e.data.amountMinor)))
  ) {
    throw new DomainError('VALIDATION_FAILED', 'Malformed bank event');
  }
  return e as BankEvent;
}

/**
 * Intake for POST /v1/webhooks/bank. Order of checks: signature + timestamp tolerance (reject
 * forgeries and stale replays) -> schema -> dedupe by the bank's event id (PK of
 * bank_webhook_events; a duplicate delivery is acknowledged and not applied) -> route by
 * reference to the owning module, which records the event in the same transaction as its effects.
 */
@Injectable()
export class BankWebhookService {
  private readonly targets: BankEventTarget[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    @InjectPinoLogger(BankWebhookService.name) private readonly logger: PinoLogger,
  ) {}

  registerTarget(target: BankEventTarget): void {
    if (!this.targets.some((t) => t.name === target.name)) this.targets.push(target);
  }

  async receive(rawBody: Buffer | string | undefined, signature: string | undefined): Promise<WebhookReceipt> {
    if (rawBody === undefined || rawBody.length === 0) throw new DomainError('VALIDATION_FAILED', 'Empty webhook body');
    const { timestamp } = verifyWebhookSignature({
      header: signature,
      rawBody,
      secret: this.config.get('BANK_WEBHOOK_SECRET'),
      toleranceSeconds: this.config.get('BANK_WEBHOOK_TOLERANCE_SECONDS'),
    });
    const event = parseEvent(rawBody.toString());
    const signedAt = new Date(timestamp * 1000);

    if (await this.prisma.bankWebhookEvent.findUnique({ where: { id: event.id }, select: { id: true } })) {
      this.logger.info({ eventId: event.id }, 'Duplicate bank webhook ignored');
      return { received: true, duplicate: true, outcome: 'DUPLICATE' };
    }

    try {
      const outcome = bankOutcomeOfEventType(event.type);
      if (!outcome) return await this.recordStandalone(event, signedAt, 'IGNORED', `unknown event type ${event.type}`);
      const target = await this.findTarget(event.data.reference);
      if (!target) return await this.recordStandalone(event, signedAt, 'UNMATCHED', 'no transaction with this reference');
      const result = await target.handle({ event, outcome, signedAt });
      this.logger.info({ eventId: event.id, type: event.type, reference: event.data.reference, result }, 'Bank webhook processed');
      return { received: true, duplicate: false, outcome: result };
    } catch (err) {
      if (isUniqueViolation(err)) {
        const dup = await this.prisma.bankWebhookEvent.findUnique({ where: { id: event.id }, select: { id: true } });
        if (dup) return { received: true, duplicate: true, outcome: 'DUPLICATE' };
      }
      throw err;
    }
  }

  private async findTarget(reference: string): Promise<BankEventTarget | null> {
    for (const t of this.targets) if (await t.owns(reference)) return t;
    return null;
  }

  private async recordStandalone(event: BankEvent, signedAt: Date, outcome: WebhookEventOutcome, note: string): Promise<WebhookReceipt> {
    await this.prisma.$transaction((tx) => this.record(tx, { event, signedAt }, outcome, note));
    this.logger.warn({ eventId: event.id, outcome, note }, 'Bank webhook not applied');
    return { received: true, duplicate: false, outcome };
  }

  /** Persist the event (PK = bank event id). A concurrent duplicate fails here and rolls back its tx. */
  async record(tx: Tx, ctx: { event: BankEvent; signedAt: Date }, outcome: WebhookEventOutcome, note?: string): Promise<void> {
    await tx.bankWebhookEvent.create({
      data: {
        id: ctx.event.id,
        type: ctx.event.type,
        bankReference: ctx.event.data.reference,
        payload: toJsonSafe(ctx.event) as Prisma.InputJsonValue,
        outcome,
        note: note ?? null,
        signedAt: ctx.signedAt,
        appliedAt: outcome === 'APPLIED' ? new Date() : null,
      },
    });
  }
}
