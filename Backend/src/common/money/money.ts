import { Currency } from '@prisma/client';

/**
 * Money helpers. All amounts are integer minor units held in `bigint`.
 * Parsing and formatting are pure string operations: floats never touch money.
 */
export const CURRENCY_EXPONENT: Readonly<Record<Currency, number>> = {
  PKR: 2,
  AED: 2,
  USD: 2,
};

export const SUPPORTED_CURRENCIES = Object.keys(CURRENCY_EXPONENT) as Currency[];

const AMOUNT_PATTERN = /^(0|[1-9]\d{0,15})(\.\d+)?$/;

export class InvalidAmountError extends Error {}

/** Parse a decimal string ("1250.50") into minor units (125050n). Rejects excess precision. */
export function parseAmount(input: string, currency: Currency): bigint {
  const value = input.trim();
  const match = AMOUNT_PATTERN.exec(value);
  if (!match) throw new InvalidAmountError(`Invalid amount "${input}"`);
  const exponent = CURRENCY_EXPONENT[currency];
  const whole = match[1] ?? '0';
  const fraction = (match[2] ?? '').slice(1);
  if (fraction.length > exponent) {
    throw new InvalidAmountError(`${currency} supports at most ${exponent} decimal places`);
  }
  return BigInt(whole + fraction.padEnd(exponent, '0'));
}

/** Parse and require a strictly positive amount. */
export function parsePositiveAmount(input: string, currency: Currency): bigint {
  const minor = parseAmount(input, currency);
  if (minor <= 0n) throw new InvalidAmountError('Amount must be greater than zero');
  return minor;
}

/** Format minor units as a decimal string (125050n -> "1250.50"). */
export function formatAmount(minor: bigint, currency: Currency): string {
  const exponent = CURRENCY_EXPONENT[currency];
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString().padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = digits.slice(digits.length - exponent);
  return `${negative ? '-' : ''}${whole}${exponent > 0 ? `.${fraction}` : ''}`;
}

export interface MoneyView {
  currency: Currency;
  amount: string;
  amountMinor: string;
}

export function moneyView(minor: bigint, currency: Currency): MoneyView {
  return { currency, amount: formatAmount(minor, currency), amountMinor: minor.toString() };
}

/** Basis-point fee on an amount, rounded up so fees are never fractional. */
export function bpsOf(amount: bigint, bps: number): bigint {
  if (bps <= 0 || amount <= 0n) return 0n;
  return (amount * BigInt(bps) + 9_999n) / 10_000n;
}
