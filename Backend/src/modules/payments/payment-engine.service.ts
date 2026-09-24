import { Injectable } from '@nestjs/common';
import { Currency, EntryType, Payment, PaymentStatus, PaymentType, Prisma } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { DomainError, isErrorCode } from '../../common/errors/domain-error';
import { isUniqueViolation } from '../../common/errors/error-response';
import { FaultInjector } from '../../common/faults/fault-injector';
import { OutboxService } from '../../common/outbox/outbox.service';
import { PrismaService, Tx } from '../../common/prisma/prisma.service';
import { appendTimeline, timelineEntry } from '../../common/state/state-machine';
import { canonicalJson, sha256, toJsonSafe } from '../../common/util/crypto';
import { AppConfig } from '../../config/app-config';
import { LedgerService } from '../ledger/ledger.service';
import { LockedAccount, PostedEntry } from '../ledger/ledger.types';
import { LegInput } from '../ledger/ledger.validation';
import { WalletsService } from '../wallets/wallets.service';
import { paymentEventPayload } from './payment.mapper';
import { paymentMachine } from './payment.state';

/** Fingerprint of a business operation's inputs (never includes the PIN). */
export function operationHash(operation: string, input: Record<string, unknown>): string {
  const { pin: _pin, ...rest } = input;
  return sha256(canonicalJson({ operation, input: rest }));
}

export interface PaymentDraft {
  type: PaymentType;
  externalRef: string;
  requestHash: string;
  payerUserId: string | null;
  payerWalletId: string | null;
  payeeUserId?: string | null;
  payeeWalletId?: string | null;
  merchantId?: string | null;
  outletId?: string | null;
  terminalId?: string | null;
  qrCodeId?: string | null;
  paymentRequestId?: string | null;
  transferQuoteId?: string | null;
  originalPaymentId?: string | null;
  currency: Currency;
  amount: bigint;
  fee: bigint;
  mdrFee?: bigint;
  receivedCurrency?: Currency | null;
  receivedAmount?: bigint | null;
  reference?: string | null;
  previewJti?: string | null;
}

/**
 * How to move the money for a payment. Built from the persisted payment row (so a resumed
 * attempt posts exactly what the first attempt priced).
 */
export interface MoneyPlan {
  /** Every ledger account the entry touches (fee revenue only when a fee is charged). */
  lockAccountIds: string[];
  /** Wallets that must be ACTIVE (checked FOR SHARE after the locks). */
  activeWalletIds: string[];
  /** Claims (QR / quote / request) and KYC limit checks, run after locks + wallet status. */
  validate?: (tx: Tx, locked: Map<string, LockedAccount>, payment: Payment) => Promise<void>;
  entryType: EntryType;
  description: string;
  legs: LegInput[];
  metadata?: Record<string, unknown>;
  initiatedBy?: string | null;
  /** Set on completion: UNIQUE, so a single-use QR can only ever complete one payment. */
  singleUseQrId?: string | null;
  /** Extra writes in the same transaction once the payment is COMPLETED (links, claims). */
  onCompleted?: (tx: Tx, payment: Payment, posted: PostedEntry) => Promise<void>;
}

/** Domain errors that mean "try again", not "this payment failed". */
const TRANSIENT_CODES = new Set(['CONCURRENT_MODIFICATION', 'IDEMPOTENCY_IN_PROGRESS']);

/**
 * Executes payments exactly once, crash-safe.
 *
 *  1. find-or-create the payment row by its external_ref (idempotency key), status PROCESSING;
 *  2. ONE money transaction: lock all accounts (id order) -> wallet status FOR SHARE -> claims and
 *     limits -> ledger.post (same external_ref) -> PROCESSING->COMPLETED -> outbox event;
 *  3. business failure => the transaction rolls back, the payment is marked FAILED with the
 *     error code, and a retry with the same key replays that failure;
 *  4. a crash anywhere leaves either nothing (rolled back; the payment stays PROCESSING and a
 *     retry with the same key resumes it) or everything (committed; a retry returns it).
 *     Stale PROCESSING payments are failed by the timeout job.
 */
@Injectable()
export class PaymentEngine {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly wallets: WalletsService,
    private readonly outbox: OutboxService,
    private readonly faults: FaultInjector,
    private readonly config: AppConfig,
    @InjectPinoLogger(PaymentEngine.name) private readonly logger: PinoLogger,
  ) {}

  /** The payment for an idempotency key, if a previous attempt created one. */
  findByExternalRef(externalRef: string): Promise<Payment | null> {
    return this.prisma.payment.findUnique({ where: { externalRef } });
  }

  /**
   * Replay semantics for a key that already has a payment: completed => return it,
   * failed => rethrow the recorded failure, in flight => null (caller resumes).
   */
  replayOrNull(payment: Payment, requestHash: string): Payment | null {
    if (payment.requestHash !== requestHash) {
      throw new DomainError('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was already used for a different payment');
    }
    if (payment.status === 'FAILED') throw this.storedFailure(payment);
    if (payment.status === 'CREATED' || payment.status === 'PROCESSING') return null;
    this.logger.info({ paymentId: payment.id }, 'Payment replayed for an existing key');
    return payment;
  }

  async execute(draft: PaymentDraft, buildPlan: (payment: Payment) => MoneyPlan | Promise<MoneyPlan>): Promise<Payment> {
    const payment = await this.findOrCreate(draft);
    const replay = this.replayOrNull(payment, draft.requestHash);
    if (replay) return replay;

    this.faults.hit('payment.afterCreate');
    const plan = await buildPlan(payment);

    let completed: Payment;
    try {
      completed = await this.prisma.runInTransaction(async (tx) => {
        const locked = await this.ledger.lockAccounts(tx, plan.lockAccountIds);
        if (plan.activeWalletIds.length > 0) await this.wallets.assertActive(tx, plan.activeWalletIds);
        await plan.validate?.(tx, locked, payment);

        const posted = await this.ledger.post(tx, {
          type: plan.entryType,
          description: plan.description,
          externalRef: payment.externalRef,
          initiatedBy: plan.initiatedBy ?? payment.payerUserId ?? undefined,
          metadata: { ...(plan.metadata ?? {}), paymentId: payment.id, activityType: payment.type },
          legs: plan.legs,
        });
        this.faults.hit('payment.afterLedgerPost');

        const updated = await this.transition(tx, payment, 'COMPLETED', undefined, {
          journalEntryId: posted.entry.id,
          completedAt: new Date(),
          singleUseQrId: plan.singleUseQrId ?? null,
        });
        await plan.onCompleted?.(tx, updated, posted);
        this.faults.hit('payment.beforeOutbox');
        await this.outbox.enqueue(tx, {
          aggregateType: 'payment',
          aggregateId: updated.id,
          eventType: 'payment.completed',
          payload: paymentEventPayload(updated),
        });
        return updated;
      });
    } catch (err) {
      return this.handleFailure(payment, err);
    }

    this.logger.info({ paymentId: completed.id, type: completed.type, entryId: completed.journalEntryId }, 'Payment completed');
    this.faults.hit('payment.afterCommit');
    return completed;
  }

  /** Conditional status change (compare-and-set on the current status) with a timeline entry. */
  async transition(
    tx: Tx,
    payment: Payment,
    to: PaymentStatus,
    reason?: string,
    data: Prisma.PaymentUncheckedUpdateManyInput = {},
  ): Promise<Payment> {
    paymentMachine.assert(payment.status, to);
    // One statement (UPDATE ... WHERE id AND status ... RETURNING): keeps the locked section short.
    try {
      return await tx.payment.update({
        where: { id: payment.id, status: payment.status },
        data: { ...data, status: to, timeline: appendTimeline(payment.timeline, to, reason) as unknown as Prisma.InputJsonValue },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw new DomainError('INVALID_STATE_TRANSITION', 'Payment was changed concurrently', { paymentId: payment.id, to });
      }
      throw err;
    }
  }

  // ─────────────────────────── internals ───────────────────────────

  private async findOrCreate(draft: PaymentDraft): Promise<Payment> {
    const existing = await this.findByExternalRef(draft.externalRef);
    if (existing) return existing;
    const now = new Date();
    try {
      return await this.prisma.payment.create({
        data: {
          type: draft.type,
          status: 'PROCESSING',
          externalRef: draft.externalRef,
          requestHash: draft.requestHash,
          payerUserId: draft.payerUserId,
          payerWalletId: draft.payerWalletId,
          payeeUserId: draft.payeeUserId ?? null,
          payeeWalletId: draft.payeeWalletId ?? null,
          merchantId: draft.merchantId ?? null,
          outletId: draft.outletId ?? null,
          terminalId: draft.terminalId ?? null,
          qrCodeId: draft.qrCodeId ?? null,
          paymentRequestId: draft.paymentRequestId ?? null,
          transferQuoteId: draft.transferQuoteId ?? null,
          originalPaymentId: draft.originalPaymentId ?? null,
          currency: draft.currency,
          amount: draft.amount,
          fee: draft.fee,
          totalDebit: draft.amount + draft.fee,
          mdrFee: draft.mdrFee ?? 0n,
          receivedCurrency: draft.receivedCurrency ?? null,
          receivedAmount: draft.receivedAmount ?? null,
          reference: draft.reference ?? null,
          previewJti: draft.previewJti ?? null,
          timeline: [timelineEntry('CREATED', undefined, now), timelineEntry('PROCESSING', undefined, now)] as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      if (isUniqueViolation(err, 'external_ref')) {
        const raced = await this.findByExternalRef(draft.externalRef);
        if (raced) return raced;
      }
      if (isUniqueViolation(err, 'preview_jti')) {
        throw new DomainError('QR_PREVIEW_USED', 'This QR preview was already used; scan the code again');
      }
      throw err;
    }
  }

  private async handleFailure(payment: Payment, err: unknown): Promise<Payment> {
    // A concurrent attempt with the same key already posted the entry (and completed the payment).
    if (isUniqueViolation(err, 'external_ref')) {
      const current = await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      if (current.status === 'COMPLETED') return current;
      throw new DomainError('CONCURRENT_MODIFICATION', 'Payment is being processed; retry shortly');
    }
    let domainErr: DomainError | null = err instanceof DomainError ? err : null;
    if (isUniqueViolation(err, 'single_use_qr_id')) {
      domainErr = new DomainError('QR_ALREADY_PAID', 'This QR code has already been paid');
    }
    if (domainErr?.code === 'INVALID_STATE_TRANSITION') {
      // Lost a race with the timeout job (or another attempt): report the final outcome.
      const current = await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      if (current.status === 'COMPLETED') return current;
      if (current.status === 'FAILED') throw this.storedFailure(current);
      throw domainErr;
    }
    if (domainErr && !TRANSIENT_CODES.has(domainErr.code)) {
      await this.markFailed(payment.id, domainErr.code, domainErr.message, domainErr.details);
      throw domainErr;
    }
    // Infrastructure failure or crash: nothing committed; the payment stays PROCESSING and a retry
    // with the same key resumes it (or the timeout job fails it).
    throw err;
  }

  /** PROCESSING/CREATED -> FAILED (no money moved). Returns false if it was already final. */
  async markFailed(paymentId: string, code: string, reason: string, details?: Record<string, unknown>): Promise<boolean> {
    return this.prisma.runInTransaction(async (tx) => {
      const current = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
      if (current.status !== 'CREATED' && current.status !== 'PROCESSING') return false;
      const failed = await this.transition(tx, current, 'FAILED', reason, {
        failureCode: code,
        failureReason: reason,
        failureDetails: details ? (toJsonSafe(details) as Prisma.InputJsonValue) : Prisma.DbNull,
      });
      await this.outbox.enqueue(tx, {
        aggregateType: 'payment',
        aggregateId: failed.id,
        eventType: 'payment.failed',
        payload: { ...paymentEventPayload(failed), failureCode: code },
      });
      this.logger.info({ paymentId, code }, 'Payment failed');
      return true;
    });
  }

  storedFailure(p: Payment): DomainError {
    const code = isErrorCode(p.failureCode) ? p.failureCode : 'PAYMENT_FAILED';
    const details =
      p.failureDetails && typeof p.failureDetails === 'object' && !Array.isArray(p.failureDetails)
        ? (p.failureDetails as Record<string, unknown>)
        : undefined;
    return new DomainError(code, p.failureReason ?? 'Payment failed', { ...(details ?? {}), paymentId: p.id });
  }

  // ─────────────────────────── timeouts ───────────────────────────

  /**
   * Moves payments stuck in CREATED/PROCESSING (crashed attempt never retried) to a terminal
   * state. No entry posted => FAILED. An entry posted without completion (only possible through
   * manual intervention, since posting and completion share one transaction) => compensating
   * reversal and REVERSED.
   */
  async timeoutStale(now = new Date()): Promise<{ failed: number; reversed: number }> {
    const cutoff = new Date(now.getTime() - this.config.get('PAYMENT_PROCESSING_TIMEOUT_SECONDS') * 1000);
    const stale = await this.prisma.payment.findMany({
      where: { status: { in: ['CREATED', 'PROCESSING'] }, updatedAt: { lt: cutoff } },
      orderBy: { updatedAt: 'asc' },
      take: 200,
    });
    let failed = 0;
    let reversed = 0;
    for (const p of stale) {
      try {
        const entry = await this.ledger.findByExternalRef(p.externalRef);
        if (!entry) {
          if (await this.markFailed(p.id, 'PAYMENT_TIMEOUT', 'Payment timed out before completion')) failed++;
          continue;
        }
        const accounts = entry.postings.map((x) => x.accountId);
        await this.prisma.runInTransaction(async (tx) => {
          await this.ledger.lockAccounts(tx, accounts);
          const current = await tx.payment.findUniqueOrThrow({ where: { id: p.id } });
          if (current.status !== 'CREATED' && current.status !== 'PROCESSING') return;
          const reversal = await this.ledger.reverseInTx(tx, entry, {
            reason: 'payment timed out before completion',
            externalRef: `compensate:payment:${p.id}`,
            metadata: { paymentId: p.id, activityType: p.type },
          });
          const updated = await this.transition(tx, current, 'REVERSED', 'timeout compensation', {
            journalEntryId: entry.entry.id,
            reversalEntryId: reversal.entry.id,
            failureCode: 'PAYMENT_TIMEOUT',
            failureReason: 'Payment timed out; funds were returned',
          });
          await this.outbox.enqueue(tx, {
            aggregateType: 'payment',
            aggregateId: p.id,
            eventType: 'payment.reversed',
            payload: paymentEventPayload(updated),
          });
        });
        reversed++;
      } catch (err) {
        this.logger.error({ err, paymentId: p.id }, 'Payment timeout handling failed');
      }
    }
    if (failed + reversed > 0) this.logger.warn({ failed, reversed }, 'Stale payments resolved');
    return { failed, reversed };
  }
}
