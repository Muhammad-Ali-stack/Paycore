import { Payment } from '@prisma/client';
import { moneyView } from '../../common/money/money';
import { readTimeline } from '../../common/state/state-machine';
import { MerchantPaymentDto, PaymentDto } from './payment.dto';
import { PaymentParties } from './parties';

export function paymentView(p: Payment, parties: PaymentParties): PaymentDto {
  return {
    id: p.id,
    type: p.type,
    status: p.status,
    amount: moneyView(p.amount, p.currency),
    fee: moneyView(p.fee, p.currency),
    totalDebit: moneyView(p.totalDebit, p.currency),
    ...(p.receivedCurrency && p.receivedAmount !== null ? { received: moneyView(p.receivedAmount, p.receivedCurrency) } : {}),
    payer: parties.payer,
    payee: parties.payee,
    reference: p.reference,
    failureReason: p.failureReason,
    journalEntryId: p.journalEntryId,
    createdAt: p.createdAt.toISOString(),
    completedAt: p.completedAt?.toISOString() ?? null,
    timeline: readTimeline(p.timeline),
  };
}

export function merchantPaymentView(p: Payment, parties: PaymentParties): MerchantPaymentDto {
  return {
    ...paymentView(p, parties),
    mdrFee: moneyView(p.mdrFee, p.currency),
    net: moneyView(p.amount - p.mdrFee, p.currency),
    refundedAmount: moneyView(p.refundedAmount, p.currency),
  };
}

/** Payload of payment.* outbox events (ids and amounts only; consumers re-read what they need). */
export function paymentEventPayload(p: Payment): Record<string, unknown> {
  return {
    paymentId: p.id,
    type: p.type,
    status: p.status,
    payerUserId: p.payerUserId,
    payeeUserId: p.payeeUserId,
    merchantId: p.merchantId,
    currency: p.currency,
    amountMinor: p.amount.toString(),
    feeMinor: p.fee.toString(),
    journalEntryId: p.journalEntryId,
  };
}
