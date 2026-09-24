import { bpsOf, formatAmount, parseAmount, parsePositiveAmount } from '../../src/common/money/money';

describe('money', () => {
  it('parses decimal strings into minor units without floats', () => {
    expect(parseAmount('1250.50', 'PKR')).toBe(125050n);
    expect(parseAmount('0.01', 'USD')).toBe(1n);
    expect(parseAmount('7', 'AED')).toBe(700n);
    expect(parseAmount('0.1', 'USD')).toBe(10n);
    // classic float trap: 0.1 + 0.2
    expect(parseAmount('0.1', 'USD') + parseAmount('0.2', 'USD')).toBe(parseAmount('0.3', 'USD'));
  });

  it('handles very large amounts exactly', () => {
    expect(parseAmount('9999999999999999.99', 'PKR')).toBe(999999999999999999n);
  });

  it('rejects excess precision and malformed input', () => {
    expect(() => parseAmount('1.001', 'USD')).toThrow(/at most 2 decimal/);
    for (const bad of ['', '-1', '1e3', '01', '1.', '.5', 'abc', '1,000']) {
      expect(() => parseAmount(bad, 'USD')).toThrow();
    }
  });

  it('requires positive amounts where asked', () => {
    expect(() => parsePositiveAmount('0', 'USD')).toThrow(/greater than zero/);
    expect(() => parsePositiveAmount('0.00', 'USD')).toThrow();
  });

  it('formats minor units, including negatives and small values', () => {
    expect(formatAmount(125050n, 'PKR')).toBe('1250.50');
    expect(formatAmount(5n, 'USD')).toBe('0.05');
    expect(formatAmount(0n, 'USD')).toBe('0.00');
    expect(formatAmount(-1999n, 'AED')).toBe('-19.99');
  });

  it('round-trips parse/format', () => {
    for (const s of ['0.00', '0.01', '1.00', '123456789.99']) {
      expect(formatAmount(parseAmount(s, 'USD'), 'USD')).toBe(s);
    }
  });

  it('computes basis-point fees rounding up', () => {
    expect(bpsOf(10000n, 10)).toBe(10n);
    expect(bpsOf(1n, 10)).toBe(1n); // tiny amount still pays the minimum unit
    expect(bpsOf(12345n, 25)).toBe(31n); // 30.8625 -> 31
    expect(bpsOf(10000n, 0)).toBe(0n);
  });
});
