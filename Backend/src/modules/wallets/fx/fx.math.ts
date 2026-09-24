import { Currency } from '@prisma/client';
import { CURRENCY_EXPONENT, bpsOf } from '../../../common/money/money';

/** FX rates are fixed-point integers: 1.0 == 100_000_000n. Never floats. */
export const RATE_DECIMALS = 8;
export const RATE_SCALE = 10n ** BigInt(RATE_DECIMALS);
const BPS_SCALE = 10_000n;

export function parseRate(input: string): bigint {
  const match = /^(\d{1,12})(?:\.(\d{1,8}))?$/.exec(input.trim());
  if (!match) throw new Error(`Invalid rate "${input}"`);
  const rate = BigInt((match[1] ?? '0') + (match[2] ?? '').padEnd(RATE_DECIMALS, '0'));
  if (rate <= 0n) throw new Error('Rate must be positive');
  return rate;
}

export function formatRate(rate: bigint): string {
  const digits = rate.toString().padStart(RATE_DECIMALS + 1, '0');
  return `${digits.slice(0, -RATE_DECIMALS)}.${digits.slice(-RATE_DECIMALS)}`;
}

/** Units of `to` per one unit of `from`, given both currencies' rates against USD. */
export function crossRate(usdToFrom: bigint, usdToTo: bigint): bigint {
  return (usdToTo * RATE_SCALE) / usdToFrom;
}

/** Customer rate = mid rate less the spread (rounded down: customer never gets more than mid). */
export function applySpread(midRate: bigint, spreadBps: number): bigint {
  return (midRate * (BPS_SCALE - BigInt(spreadBps))) / BPS_SCALE;
}

/** Convert minor units of `from` into minor units of `to`, rounding down. */
export function convertMinor(amount: bigint, rate: bigint, from: Currency, to: Currency): bigint {
  const fromScale = 10n ** BigInt(CURRENCY_EXPONENT[from]);
  const toScale = 10n ** BigInt(CURRENCY_EXPONENT[to]);
  return (amount * rate * toScale) / (RATE_SCALE * fromScale);
}

export interface PricedQuote {
  midRate: bigint;
  customerRate: bigint;
  sellAmount: bigint;
  buyAmount: bigint;
  feeAmount: bigint;
  /** Total debited from the source wallet (sell + fee). */
  totalDebit: bigint;
}

export function priceQuote(p: {
  from: Currency;
  to: Currency;
  sellAmount: bigint;
  midRate: bigint;
  spreadBps: number;
  feeBps: number;
}): PricedQuote {
  const customerRate = applySpread(p.midRate, p.spreadBps);
  const buyAmount = convertMinor(p.sellAmount, customerRate, p.from, p.to);
  const feeAmount = bpsOf(p.sellAmount, p.feeBps);
  return {
    midRate: p.midRate,
    customerRate,
    sellAmount: p.sellAmount,
    buyAmount,
    feeAmount,
    totalDebit: p.sellAmount + feeAmount,
  };
}

/**
 * Smallest source amount whose conversion yields at least `receive` (RECEIVE-side quotes).
 * Rounds up, so the house never pays out more than the rate allows.
 */
export function sendForReceive(receive: bigint, rate: bigint, from: Currency, to: Currency): bigint {
  const fromScale = 10n ** BigInt(CURRENCY_EXPONENT[from]);
  const toScale = 10n ** BigInt(CURRENCY_EXPONENT[to]);
  const numerator = receive * RATE_SCALE * fromScale;
  const denominator = rate * toScale;
  return (numerator + denominator - 1n) / denominator;
}
