import { bpsOf } from '../../common/money/money';

/** Merchant discount rate on a payment, rounded up (never fractional). Never exceeds the amount. */
export function mdrFor(amount: bigint, mdrBps: number): bigint {
  const fee = bpsOf(amount, mdrBps);
  return fee > amount ? amount : fee;
}

/**
 * The part of the original MDR returned to the merchant with a refund, proportional to the
 * refunded amount. Computed on cumulative totals so a sequence of partial refunds that adds up
 * to the full amount returns exactly the full MDR (no rounding drift).
 */
export function mdrRefundShare(p: { amount: bigint; mdr: bigint; refundedBefore: bigint; refund: bigint }): bigint {
  if (p.amount <= 0n) return 0n;
  const after = p.refundedBefore + p.refund;
  return (p.mdr * after) / p.amount - (p.mdr * p.refundedBefore) / p.amount;
}

/** What is still refundable on a payment. */
export const refundableRemaining = (amount: bigint, refunded: bigint): bigint => (amount > refunded ? amount - refunded : 0n);
