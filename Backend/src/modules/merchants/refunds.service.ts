import { Injectable } from '@nestjs/common';
import { Payment, Prisma, Refund } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { DomainError, isErrorCode } from '../../common/errors/domain-error';
import { isUniqueViolation } from '../../common/errors/error-response';
import { FaultInjector } from '../../common/faults/fault-injector';
import { moneyView } from '../../common/money/money';
import { OutboxService } from '../../common/outbox/outbox.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { appendTimeline, timelineEntry } from '../../common/state/state-machine';
import { LedgerService } from '../ledger/ledger.service';
import { LegInput, credit, debit } from '../ledger/ledger.validation';
import { operationHash } from '../payments/payment-engine.service';
import { paymentEventPayload } from '../payments/payment.mapper';
import { paymentMachine, statusAfterRefund } from '../payments/payment.state';
import { externalRefFor } from '../wallets/payments.service';
import { WalletsService, toMinor } from '../wallets/wallets.service';
import { mdrRefundShare, refundableRemaining } from './merchant.math';
import { refundMachine } from './merchant.state';
import { RefundDto } from './merchants.dto';
import { MerchantsService } from './merchants.service';

export function refundView(r: Refund): RefundDto {
  return {
    id: r.id,
    paymentId: r.paymentId,
    amount: moneyView(r.amount, r.currency),
    status: r.status,
    reason: r.reason,
    failureReason: r.failureReason,
    createdAt: r.createdAt.toISOString(),
  };
}

/** Pure legs of a refund: DR merchant payable (refund - MDR share) | DR fee revenue (MDR share) | CR payer wallet. */
export function refundLegs(p: { merchantAccount: string; feeRevenue: string; payerAccount: string; amount: bigint; mdrShare: bigint }): LegInput[] {
  const legs: LegInput[] = [];
  if (p.amount - p.mdrShare > 0n) legs.push(debit(p.merchantAccount, p.amount - p.mdrShare));
  if (p.mdrShare > 0n) legs.push(debit(p.feeRevenue, p.mdrShare));
  legs.push(credit(p.payerAccount, p.amount));
  return legs;
}

/**
 * Full and partial refunds of merchant QR payments. Two phases like payments: a PENDING refund row
 * keyed by the Idempotency-Key, then ONE money transaction that locks the merchant payable, the
 * payer wallet and (if an MDR share is returned) fee revenue, re-checks the refundable remainder
 * on the locked snapshot, posts the entry, bumps refunded_amount with a compare-and-set, writes a
 * REFUND payment for the consumer and the outbox events. Refunds can never exceed the original:
 * checked here and by a CHECK constraint on payments.refunded_amount.
 */
@Injectable()
export class RefundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly wallets: WalletsService,
    private readonly merchants: MerchantsService,
    private readonly outbox: OutboxService,
    private readonly faults: FaultInjector,
    @InjectPinoLogger(RefundsService.name) private readonly logger: PinoLogger,
  ) {}

  async refund(ownerUserId: string, paymentId: string, dto: { amount?: string; reason: string }, idempotencyKey: string): Promise<Refund> {
    const merchant = await this.merchants.mine(ownerUserId);
    const payment = await this.merchants.payment(ownerUserId, paymentId);
    const externalRef = externalRefFor(ownerUserId, idempotencyKey);
    const requestHash = operationHash('merchant.refund', { paymentId, amount: dto.amount ?? null, reason: dto.reason });

    let refund = await this.prisma.refund.findUnique({ where: { externalRef } });
    if (refund) {
      if (refund.requestHash !== requestHash) {
        throw new DomainError('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was already used for a different refund');
      }
      if (refund.status === 'COMPLETED') return refund;
      if (refund.status === 'FAILED') throw this.storedFailure(refund);
    } else {
      if (payment.status !== 'COMPLETED' && payment.status !== 'PARTIALLY_REFUNDED') {
        throw new DomainError('PAYMENT_NOT_REFUNDABLE', `A ${payment.status.toLowerCase()} payment cannot be refunded`);
      }
      const remaining = refundableRemaining(payment.amount, payment.refundedAmount);
      const amount = dto.amount ? toMinor(dto.amount, payment.currency) : remaining;
      if (remaining === 0n) throw new DomainError('PAYMENT_NOT_REFUNDABLE', 'This payment has been fully refunded');
      if (amount > remaining) {
        throw new DomainError('REFUND_EXCEEDS_PAYMENT', 'Refund exceeds the refundable amount', {
          refundable: moneyView(remaining, payment.currency),
        });
      }
      try {
        refund = await this.prisma.refund.create({
          data: {
            paymentId,
            merchantId: merchant.id,
            currency: payment.currency,
            amount,
            reason: dto.reason,
            externalRef,
            requestHash,
            timeline: [timelineEntry('PENDING')] as unknown as Prisma.InputJsonValue,
          },
        });
      } catch (err) {
        if (!isUniqueViolation(err, 'external_ref')) throw err;
        return this.refund(ownerUserId, paymentId, dto, idempotencyKey); // raced with a duplicate: replay path
      }
    }
    return this.execute(refund, payment, merchant.ledgerAccountId, ownerUserId);
  }

  private async execute(refund: Refund, original: Payment, merchantAccount: string, actorId: string): Promise<Refund> {
    if (!original.payerWalletId || !original.payerUserId) throw new Error(`Payment ${original.id} has no payer wallet`);
    const payerWallet = await this.wallets.getById(original.payerWalletId);
    const feeRevenue = await this.ledger.systemAccountId('FEE_REVENUE', refund.currency);

    let done: Refund;
    try {
      done = await this.prisma.runInTransaction(async (tx) => {
        // Upper bound of the MDR share decides whether the (hot) fee revenue row must be locked.
        const worstShare = original.mdrFee > 0n;
        await this.ledger.lockAccounts(tx, worstShare ? [merchantAccount, payerWallet.ledgerAccountId, feeRevenue] : [merchantAccount, payerWallet.ledgerAccountId]);
        await this.wallets.assertActive(tx, [payerWallet.id]);

        const current = await tx.payment.findUniqueOrThrow({ where: { id: original.id } });
        const remaining = refundableRemaining(current.amount, current.refundedAmount);
        if (refund.amount > remaining) {
          throw new DomainError('REFUND_EXCEEDS_PAYMENT', 'Refund exceeds the refundable amount', {
            refundable: moneyView(remaining, current.currency),
          });
        }
        const mdrShare = mdrRefundShare({ amount: current.amount, mdr: current.mdrFee, refundedBefore: current.refundedAmount, refund: refund.amount });
        const posted = await this.ledger.post(tx, {
          type: 'REFUND',
          description: `Refund: ${refund.reason}`.slice(0, 200),
          externalRef: refund.externalRef,
          initiatedBy: actorId,
          metadata: {
            refundId: refund.id,
            originalPaymentId: current.id,
            merchantId: current.merchantId,
            activityType: 'REFUND',
            mdrRefund: mdrShare.toString(),
          },
          legs: refundLegs({ merchantAccount, feeRevenue, payerAccount: payerWallet.ledgerAccountId, amount: refund.amount, mdrShare }),
        });
        this.faults.hit('refund.afterLedgerPost');

        const now = new Date();
        const refundPayment = await tx.payment.create({
          data: {
            type: 'REFUND',
            status: 'COMPLETED',
            payerUserId: null,
            payerWalletId: null,
            payeeUserId: current.payerUserId,
            payeeWalletId: payerWallet.id,
            merchantId: current.merchantId,
            outletId: current.outletId,
            originalPaymentId: current.id,
            currency: current.currency,
            amount: refund.amount,
            fee: 0n,
            totalDebit: refund.amount,
            reference: refund.reason.slice(0, 140),
            journalEntryId: posted.entry.id,
            externalRef: refund.externalRef,
            requestHash: refund.requestHash,
            completedAt: now,
            timeline: [timelineEntry('CREATED', undefined, now), timelineEntry('PROCESSING', undefined, now), timelineEntry('COMPLETED', undefined, now)] as unknown as Prisma.InputJsonValue,
          },
        });

        // Compare-and-set on refunded_amount: a concurrent refund on the same payment can't double count.
        const refundedTotal = current.refundedAmount + refund.amount;
        const nextStatus = statusAfterRefund(current.amount, refundedTotal);
        paymentMachine.assert(current.status, nextStatus);
        const bumped = await tx.payment.updateMany({
          where: { id: current.id, refundedAmount: current.refundedAmount, status: current.status },
          data: {
            refundedAmount: refundedTotal,
            status: nextStatus,
            timeline: appendTimeline(current.timeline, nextStatus, `refund ${refund.id}`) as unknown as Prisma.InputJsonValue,
          },
        });
        if (bumped.count !== 1) throw new DomainError('CONCURRENT_MODIFICATION', 'Payment was refunded concurrently; retry');

        refundMachine.assert(refund.status, 'COMPLETED');
        const completed = await tx.refund.update({
          where: { id: refund.id },
          data: {
            status: 'COMPLETED',
            mdrRefund: mdrShare,
            journalEntryId: posted.entry.id,
            refundPaymentId: refundPayment.id,
            completedAt: now,
            timeline: appendTimeline(refund.timeline, 'COMPLETED') as unknown as Prisma.InputJsonValue,
          },
        });
        await this.outbox.enqueue(tx, {
          aggregateType: 'refund',
          aggregateId: refund.id,
          eventType: 'refund.completed',
          payload: { refundId: refund.id, paymentId: current.id, merchantId: current.merchantId, amountMinor: refund.amount.toString(), currency: refund.currency },
        });
        await this.outbox.enqueue(tx, {
          aggregateType: 'payment',
          aggregateId: refundPayment.id,
          eventType: 'payment.completed',
          payload: paymentEventPayload(refundPayment),
        });
        return completed;
      });
    } catch (err) {
      if (isUniqueViolation(err, 'external_ref')) {
        const current = await this.prisma.refund.findUniqueOrThrow({ where: { id: refund.id } });
        if (current.status === 'COMPLETED') return current;
        throw new DomainError('CONCURRENT_MODIFICATION', 'Refund is being processed; retry shortly');
      }
      if (err instanceof DomainError && err.code !== 'CONCURRENT_MODIFICATION') {
        await this.markFailed(refund.id, err);
      }
      throw err;
    }
    this.logger.info({ refundId: done.id, paymentId: original.id, amount: done.amount.toString() }, 'Refund completed');
    this.faults.hit('refund.afterCommit');
    return done;
  }

  private async markFailed(refundId: string, err: DomainError): Promise<void> {
    const current = await this.prisma.refund.findUniqueOrThrow({ where: { id: refundId } });
    if (current.status !== 'PENDING') return;
    refundMachine.assert('PENDING', 'FAILED');
    await this.prisma.refund.updateMany({
      where: { id: refundId, status: 'PENDING' },
      data: {
        status: 'FAILED',
        failureCode: err.code,
        failureReason: err.message,
        timeline: appendTimeline(current.timeline, 'FAILED', err.message) as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private storedFailure(r: Refund): DomainError {
    return new DomainError(isErrorCode(r.failureCode) ? r.failureCode : 'PAYMENT_FAILED', r.failureReason ?? 'Refund failed', { refundId: r.id });
  }

  async listForPayment(paymentId: string): Promise<Refund[]> {
    return this.prisma.refund.findMany({ where: { paymentId }, orderBy: { createdAt: 'asc' } });
  }
}
