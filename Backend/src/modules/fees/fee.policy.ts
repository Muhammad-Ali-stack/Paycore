import { bpsOf } from '../../common/money/money';

export const FEE_PRODUCTS = [
  'P2P',
  'P2P_FX',
  'REQUEST',
  'QR_P2P',
  'QR_MERCHANT',
  'TOPUP_BANK_TRANSFER',
  'TOPUP_CARD',
  'WITHDRAWAL',
] as const;
export type FeeProduct = (typeof FEE_PRODUCTS)[number];

export interface FeeRuleValues {
  bps: number;
  fixed: bigint;
  min: bigint;
  /** null = uncapped */
  max: bigint | null;
}

/**
 * fee = clamp(ceil(amount * bps / 10_000) + fixed, min, max). Integer minor units only.
 * The fee can never exceed the amount itself (a 1-paisa transfer can't cost 10 PKR).
 */
export function computeFee(rule: FeeRuleValues, amount: bigint): bigint {
  if (amount <= 0n) return 0n;
  let fee = bpsOf(amount, rule.bps) + rule.fixed;
  if (fee < rule.min) fee = rule.min;
  if (rule.max !== null && fee > rule.max) fee = rule.max;
  if (fee < 0n) fee = 0n;
  return fee > amount ? amount : fee;
}

/**
 * Largest `send` such that send + fee(send) <= budget. Used when the payer must stay within a
 * total debit. Monotone in `send`, so binary search over [0, budget].
 */
export function maxSendWithinBudget(rule: FeeRuleValues, budget: bigint): bigint {
  let lo = 0n;
  let hi = budget;
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    if (mid + computeFee(rule, mid) <= budget) lo = mid;
    else hi = mid - 1n;
  }
  return lo;
}
