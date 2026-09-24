// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  addMoney,
  compareMinor,
  decimalStringToMinor,
  exponentOf,
  formatMinor,
  formatMoney,
  formatRate,
  formatShare,
  minorToChartNumber,
  minorToDecimalString,
  moneyFromMinor,
  parseAmountInput,
} from './money';

const NBSP = String.fromCharCode(0xa0);
const norm = (s: string) => s.replace(new RegExp(`[${NBSP}${String.fromCharCode(0x202f)}]`, 'g'), ' ');

describe('formatMinor (en)', () => {
  it('formats USD with symbol and grouping', () => {
    expect(formatMinor('125050', 'USD')).toBe('$1,250.50');
  });
  it('formats PKR and AED with narrow symbols', () => {
    expect(norm(formatMinor('125050', 'PKR'))).toMatch(/^Rs\s?1,250\.50$/);
    expect(norm(formatMinor('100', 'AED'))).toMatch(/1\.00/);
  });
  it('supports code display and no-currency display', () => {
    expect(norm(formatMinor('5', 'USD', { display: 'code' }))).toMatch(/^USD\s?0\.05$/);
    expect(formatMinor('123456789', 'USD', { display: 'none' })).toBe('1,234,567.89');
  });
  it('handles zero and sub-unit amounts', () => {
    expect(formatMinor('0', 'USD')).toBe('$0.00');
    expect(formatMinor('1', 'USD')).toBe('$0.01');
    expect(formatMinor('99', 'USD')).toBe('$0.99');
  });
  it('handles negatives including -0.xx (sign is not lost)', () => {
    expect(formatMinor('-125050', 'USD')).toBe('-$1,250.50');
    expect(formatMinor('-5', 'USD')).toBe('-$0.05');
  });
  it('signed option adds + for positive only', () => {
    expect(formatMinor('500', 'USD', { signed: true })).toBe('+$5.00');
    expect(formatMinor('0', 'USD', { signed: true })).toBe('$0.00');
    expect(formatMinor('-500', 'USD', { signed: true })).toBe('-$5.00');
  });
  it('is exact far beyond float precision (no float conversion)', () => {
    // 2^63 - 1 minor units: a float would round this.
    expect(formatMinor('9223372036854775807', 'USD')).toBe('$92,233,720,368,547,758.07');
    expect(formatMinor(12345678901234567890123n, 'USD', { display: 'none' })).toBe('123,456,789,012,345,678,901.23');
  });
  it('accepts bigint input', () => {
    expect(formatMinor(125050n, 'USD')).toBe('$1,250.50');
  });
  it('trimZeroFraction drops .00 only', () => {
    expect(formatMinor('100000', 'USD', { trimZeroFraction: true })).toBe('$1,000');
    expect(formatMinor('100050', 'USD', { trimZeroFraction: true })).toBe('$1,000.50');
  });
  it('rejects non-integer minor strings', () => {
    expect(() => formatMinor('12.5', 'USD')).toThrow();
    expect(() => formatMinor('abc', 'USD')).toThrow();
  });
  it('formatMoney uses amountMinor, never amount', () => {
    expect(formatMoney({ currency: 'USD', amountMinor: '100' })).toBe('$1.00');
  });
});

describe('formatMinor (ur)', () => {
  it('formats with the Urdu locale and keeps exact digits', () => {
    const s = formatMinor('125050', 'PKR', { locale: 'ur' });
    // ur-PK uses Latin digits; digits must be exact regardless of symbol placement.
    expect(s.replace(/[^\d.,]/g, '')).toBe('1,250.50');
  });
  it('keeps the minus sign for negatives', () => {
    const s = formatMinor('-5', 'USD', { locale: 'ur' });
    expect(s).toMatch(/[-−]/);
    expect(s.replace(/[^\d.]/g, '')).toBe('0.05');
  });
});

describe('parseAmountInput', () => {
  it('parses plain and grouped decimals', () => {
    expect(parseAmountInput('1250.5', 'PKR')).toEqual({ ok: true, minor: 125050n, normalized: '1250.50' });
    expect(parseAmountInput('1,250.50', 'USD')).toMatchObject({ ok: true, minor: 125050n });
    expect(parseAmountInput(' 1 250 ', 'USD')).toMatchObject({ ok: true, minor: 125000n, normalized: '1250.00' });
  });
  it('parses integers, leading dot and leading zeros', () => {
    expect(parseAmountInput('5', 'USD')).toMatchObject({ ok: true, minor: 500n });
    expect(parseAmountInput('.5', 'USD')).toMatchObject({ ok: true, minor: 50n, normalized: '0.50' });
    expect(parseAmountInput('007.10', 'USD')).toMatchObject({ ok: true, minor: 710n, normalized: '7.10' });
    expect(parseAmountInput('5.', 'USD')).toMatchObject({ ok: true, minor: 500n });
  });
  it('accepts Urdu / Arabic-Indic digits and the Arabic decimal separator', () => {
    const urduDigits = [0x6f1, 0x6f2, 0x6f3].map((c) => String.fromCharCode(c)).join(''); // "123"
    expect(parseAmountInput(urduDigits, 'PKR')).toMatchObject({ ok: true, minor: 12300n });
    const arabic = `${String.fromCharCode(0x661)}${String.fromCharCode(0x66b)}${String.fromCharCode(0x665)}`; // 1.5
    expect(parseAmountInput(arabic, 'PKR')).toMatchObject({ ok: true, minor: 150n });
  });
  it('rejects too many decimals, junk, negatives and empty', () => {
    expect(parseAmountInput('1.234', 'USD')).toEqual({ ok: false, reason: 'TOO_MANY_DECIMALS' });
    expect(parseAmountInput('12a', 'USD')).toEqual({ ok: false, reason: 'INVALID' });
    expect(parseAmountInput('1.2.3', 'USD')).toEqual({ ok: false, reason: 'INVALID' });
    expect(parseAmountInput('.', 'USD')).toEqual({ ok: false, reason: 'INVALID' });
    expect(parseAmountInput('-5', 'USD')).toEqual({ ok: false, reason: 'NEGATIVE' });
    expect(parseAmountInput('', 'USD')).toEqual({ ok: false, reason: 'EMPTY' });
    expect(parseAmountInput('   ', 'USD')).toEqual({ ok: false, reason: 'EMPTY' });
    expect(parseAmountInput('1e5', 'USD')).toEqual({ ok: false, reason: 'INVALID' });
  });
  it('never loses precision on huge inputs', () => {
    expect(parseAmountInput('92233720368547758.07', 'USD')).toMatchObject({ ok: true, minor: 9223372036854775807n });
  });
  it('round-trips with minorToDecimalString', () => {
    for (const s of ['0.01', '1.00', '1250.50', '999999999999.99']) {
      const r = parseAmountInput(s, 'USD');
      expect(r.ok && minorToDecimalString(r.minor, 'USD')).toBe(s);
    }
  });
});

describe('conversions and arithmetic', () => {
  it('minorToDecimalString pads fractions and keeps sign', () => {
    expect(minorToDecimalString('5', 'USD')).toBe('0.05');
    expect(minorToDecimalString('-125050', 'USD')).toBe('-1250.50');
    expect(minorToDecimalString(0n, 'PKR')).toBe('0.00');
  });
  it('decimalStringToMinor throws on invalid input', () => {
    expect(decimalStringToMinor('12.34', 'USD')).toBe(1234n);
    expect(() => decimalStringToMinor('12.345', 'USD')).toThrow();
  });
  it('moneyFromMinor builds contract Money', () => {
    expect(moneyFromMinor(125050n, 'PKR')).toEqual({ currency: 'PKR', amountMinor: '125050', amount: '1250.50' });
  });
  it('addMoney adds in minor units and rejects mixed currencies', () => {
    const a = moneyFromMinor('10', 'USD');
    const b = moneyFromMinor('20', 'USD');
    expect(addMoney(a, b).amountMinor).toBe('30');
    expect(() => addMoney(a, moneyFromMinor('1', 'PKR'))).toThrow();
  });
  it('compareMinor compares big values exactly', () => {
    expect(compareMinor('9007199254740993', '9007199254740992')).toBe(1);
    expect(compareMinor(1n, '1')).toBe(0);
    expect(compareMinor('-1', '0')).toBe(-1);
  });
  it('exponentOf knows the supported currencies', () => {
    expect(exponentOf('PKR')).toBe(2);
    expect(exponentOf('AED')).toBe(2);
    expect(exponentOf('USD')).toBe(2);
  });
  it('minorToChartNumber is for plotting only', () => {
    expect(minorToChartNumber('125050', 'USD')).toBeCloseTo(1250.5);
  });
  it('formatRate trims to 4dp without float math', () => {
    expect(formatRate('277.10750000')).toBe('277.1075');
    expect(formatRate('3.67250000')).toBe('3.6725');
    expect(formatRate('1.00000000')).toBe('1');
  });
  it('formatShare renders a decimal share as percent', () => {
    expect(formatShare('0.2345')).toBe('23.5%');
    expect(formatShare('1.0000')).toBe('100.0%');
    expect(formatShare('0.0004')).toBe('0.0%');
  });
});
