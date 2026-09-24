/**
 * Money utilities. The ONLY place that turns amounts into strings.
 *
 * Rules:
 * - Amounts are integer minor units carried as `string` or `bigint`. Never `number`.
 * - Formatting uses Intl.NumberFormat for symbols, grouping, sign and locale digits,
 *   but the digits themselves come from bigint arithmetic, so there is no float step.
 * - Parsing user input is pure string manipulation.
 */
import type { Currency, Money } from './api/contracts/common';

export type AppLocale = 'en' | 'ur';

/** ISO 4217 exponents for the currencies PayCore supports. */
export const CURRENCY_EXPONENT: Record<Currency, number> = { PKR: 2, AED: 2, USD: 2 };

const INTL_LOCALE: Record<AppLocale, string> = { en: 'en-US', ur: 'ur-PK' };

export function exponentOf(currency: string): number {
  return CURRENCY_EXPONENT[currency as Currency] ?? 2;
}

function toBigInt(minor: string | bigint): bigint {
  if (typeof minor === 'bigint') return minor;
  const s = minor.trim();
  if (!/^-?\d+$/.test(s)) throw new Error(`Invalid minor amount: ${minor}`);
  return BigInt(s);
}

const pow10 = (n: number) => 10n ** BigInt(n);

export type FormatMoneyOptions = {
  locale?: AppLocale;
  /** 'symbol' (Rs, $), 'code' (PKR), 'none' (just the number). Default 'symbol'. */
  display?: 'symbol' | 'code' | 'none';
  /** Force a leading + for positive amounts (e.g. incoming transactions). */
  signed?: boolean;
  /** Drop the fraction when it is all zeros (e.g. chart axes). */
  trimZeroFraction?: boolean;
};

const formatterCache = new Map<string, Intl.NumberFormat>();
function nf(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = formatterCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, options);
    formatterCache.set(key, f);
  }
  return f;
}

/** Locale digits 0-9 (Latin for en and ur-PK, but stays correct for any numbering system). */
function localeDigits(locale: string): string[] {
  const f = nf(locale, { useGrouping: false });
  return Array.from({ length: 10 }, (_, d) => f.format(d));
}

/**
 * Format integer minor units as a localized currency string.
 * formatMinor("125050", "PKR") -> "Rs 1,250.50"
 */
export function formatMinor(amountMinor: string | bigint, currency: string, opts: FormatMoneyOptions = {}): string {
  const locale = INTL_LOCALE[opts.locale ?? 'en'];
  const exp = exponentOf(currency);
  const value = toBigInt(amountMinor);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const major = abs / pow10(exp);
  const fraction = (abs % pow10(exp)).toString().padStart(exp, '0');
  const showFraction = exp > 0 && !(opts.trimZeroFraction && /^0*$/.test(fraction));
  const display = opts.display ?? 'symbol';

  const base: Intl.NumberFormatOptions =
    display === 'none'
      ? { style: 'decimal' }
      : {
          style: 'currency',
          currency,
          currencyDisplay: display === 'code' ? 'code' : 'narrowSymbol',
        };
  const digits = showFraction ? exp : 0;
  const templateFormatter = nf(locale, {
    ...base,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    signDisplay: opts.signed ? 'exceptZero' : 'auto',
  });

  // Template gives us the locale's arrangement of sign, symbol, spaces and separators.
  // Format a sentinel of 1 (or -1) and splice in our exact digits.
  const sentinel = negative ? -1n : 1n;
  const parts = templateFormatter.formatToParts(sentinel);
  const integerText = nf(locale, { useGrouping: true, maximumFractionDigits: 0 }).format(major);
  const ld = localeDigits(locale);
  const fractionText = fraction.replace(/\d/g, (d) => ld[Number(d)] ?? d);

  let out = '';
  let integerDone = false;
  for (const part of parts) {
    if (part.type === 'integer' || part.type === 'group') {
      if (!integerDone) {
        out += integerText;
        integerDone = true;
      }
      continue;
    }
    if (part.type === 'fraction') {
      out += fractionText;
      continue;
    }
    if (part.type === 'plusSign' && value === 0n) continue;
    out += part.value;
  }
  return out;
}

/** Format a contract `Money` object (uses amountMinor, never amount). */
export function formatMoney(money: Pick<Money, 'amountMinor' | 'currency'>, opts?: FormatMoneyOptions) {
  return formatMinor(money.amountMinor, money.currency, opts);
}

/** "125050" (exp 2) -> "1250.50". The decimal string the API expects in requests. */
export function minorToDecimalString(amountMinor: string | bigint, currency: string): string {
  const exp = exponentOf(currency);
  const v = toBigInt(amountMinor);
  const negative = v < 0n;
  const abs = negative ? -v : v;
  const major = (abs / pow10(exp)).toString();
  const frac = (abs % pow10(exp)).toString().padStart(exp, '0');
  return `${negative ? '-' : ''}${major}${exp > 0 ? `.${frac}` : ''}`;
}

/** "1250.5" -> 125050n. Throws on anything that is not a plain decimal string. */
export function decimalStringToMinor(amount: string, currency: string): bigint {
  const r = parseAmountInput(amount, currency);
  if (!r.ok) throw new Error(`Invalid decimal amount: ${amount}`);
  return r.minor;
}

export type ParseResult =
  | { ok: true; minor: bigint; normalized: string }
  | { ok: false; reason: 'EMPTY' | 'INVALID' | 'TOO_MANY_DECIMALS' | 'NEGATIVE' };

const NON_LATIN_DIGITS: Record<string, string> = {};
// Arabic-Indic (U+0660..) and Extended Arabic-Indic / Urdu (U+06F0..) digits.
for (let i = 0; i < 10; i++) {
  NON_LATIN_DIGITS[String.fromCharCode(0x0660 + i)] = String(i);
  NON_LATIN_DIGITS[String.fromCharCode(0x06f0 + i)] = String(i);
}
const ch = (code: number) => String.fromCharCode(code);
const NON_LATIN_DIGIT_RE = new RegExp(`[${ch(0x660)}-${ch(0x669)}${ch(0x6f0)}-${ch(0x6f9)}]`, 'g');
/** Arabic decimal separator (U+066B). */
const ARABIC_DECIMAL_RE = new RegExp(ch(0x66b), 'g');
/** Grouping: comma, Arabic thousands (U+066C), whitespace, NBSP, narrow NBSP, apostrophe. */
const GROUPING_RE = new RegExp(`[,${ch(0x66c)}\\s${ch(0xa0)}${ch(0x202f)}']`, 'g');

/**
 * Parse what a user typed into minor units, by string manipulation only.
 * Accepts "1,250.50", "1250.5", " 1 250 ", Urdu/Arabic digits and the Arabic decimal
 * separator. Rejects more fraction digits than the currency allows.
 */
export function parseAmountInput(input: string, currency: string): ParseResult {
  const exp = exponentOf(currency);
  let s = (input ?? '').trim();
  if (!s) return { ok: false, reason: 'EMPTY' };
  s = s.replace(NON_LATIN_DIGIT_RE, (c) => NON_LATIN_DIGITS[c] ?? c);
  s = s.replace(ARABIC_DECIMAL_RE, '.');
  s = s.replace(GROUPING_RE, '');
  if (s.startsWith('-')) return { ok: false, reason: 'NEGATIVE' };
  if (s.startsWith('+')) s = s.slice(1);
  if (!/^\d*\.?\d*$/.test(s) || s === '.' || s === '') return { ok: false, reason: 'INVALID' };
  const [intRaw = '', fracRaw = ''] = s.split('.');
  if (fracRaw.length > exp) return { ok: false, reason: 'TOO_MANY_DECIMALS' };
  const intPart = intRaw.replace(/^0+(?=\d)/, '') || '0';
  const fracPart = fracRaw.padEnd(exp, '0');
  const minor = BigInt(intPart + fracPart);
  const normalized = exp > 0 ? `${intPart}.${fracPart}` : intPart;
  return { ok: true, minor, normalized };
}

/** Build a contract Money from minor units. */
export function moneyFromMinor(amountMinor: string | bigint, currency: Currency): Money {
  const minor = toBigInt(amountMinor);
  return {
    currency,
    amountMinor: minor.toString(),
    amount: minorToDecimalString(minor, currency),
  };
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new Error('Currency mismatch');
  return moneyFromMinor(toBigInt(a.amountMinor) + toBigInt(b.amountMinor), a.currency);
}

export function compareMinor(a: string | bigint, b: string | bigint): -1 | 0 | 1 {
  const x = toBigInt(a);
  const y = toBigInt(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function isZero(m: Pick<Money, 'amountMinor'>) {
  return toBigInt(m.amountMinor) === 0n;
}

/**
 * Chart helper: Recharts needs numbers for geometry. We convert minor units to a
 * major-unit number ONLY for plotting positions; labels/tooltips always go back
 * through formatMinor. Safe for any realistic wallet amount (< 2^53 minor units).
 */
export function minorToChartNumber(amountMinor: string | bigint, currency: string): number {
  const v = toBigInt(amountMinor);
  const exp = exponentOf(currency);
  const whole = Number(v / pow10(exp));
  const frac = Number(v % pow10(exp)) / Number(pow10(exp));
  return whole + frac;
}

/** Rate "277.10750000" -> "277.1075" (display only, string trimming). */
export function formatRate(rate: string, maxDecimals = 4): string {
  const [i = '0', f = ''] = rate.split('.');
  const trimmed = f.slice(0, maxDecimals).replace(/0+$/, '');
  return trimmed ? `${i}.${trimmed}` : i;
}

/** Share "0.2345" -> "23.5%" (string math, one decimal). */
export function formatShare(share: string): string {
  const [i = '0', f = ''] = share.split('.');
  const padded = (f + '0000').slice(0, 4); // 4 decimals of the fraction
  const basisPoints = BigInt(i) * 10000n + BigInt(padded); // share * 10000
  const tenthsOfPercent = (basisPoints + 5n) / 10n; // round half up
  const whole = tenthsOfPercent / 10n;
  const dec = tenthsOfPercent % 10n;
  return `${whole}.${dec}%`;
}
