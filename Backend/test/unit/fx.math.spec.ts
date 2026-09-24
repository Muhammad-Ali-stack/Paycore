import {
  RATE_SCALE,
  applySpread,
  convertMinor,
  crossRate,
  formatRate,
  parseRate,
  priceQuote,
} from '../../src/modules/wallets/fx/fx.math';

describe('fx math (fixed-point, no floats)', () => {
  const usdPkr = parseRate('278.50');
  const usdAed = parseRate('3.6725');
  const one = parseRate('1');

  it('parses and formats rates at 8 decimals', () => {
    expect(one).toBe(RATE_SCALE);
    expect(formatRate(usdPkr)).toBe('278.50000000');
    expect(() => parseRate('1.123456789')).toThrow();
    expect(() => parseRate('0')).toThrow();
  });

  it('derives cross rates via USD', () => {
    expect(crossRate(one, usdPkr)).toBe(usdPkr);
    const aedPkr = crossRate(usdAed, usdPkr); // ~75.8339
    expect(formatRate(aedPkr)).toBe('75.83390061');
  });

  it('applies spread in the house favour', () => {
    expect(applySpread(parseRate('100'), 50)).toBe(parseRate('99.5'));
  });

  it('converts minor units, rounding down', () => {
    // 100.00 USD at 278.5 = 27850.00 PKR
    expect(convertMinor(10000n, usdPkr, 'USD', 'PKR')).toBe(2785000n);
    // 1.00 PKR -> USD at 1/278.5 = 0.00359 -> 0 cents (rounded down)
    expect(convertMinor(100n, crossRate(usdPkr, one), 'PKR', 'USD')).toBe(0n);
  });

  it('prices a quote with spread and fee', () => {
    const q = priceQuote({ from: 'USD', to: 'PKR', sellAmount: 10000n, midRate: usdPkr, spreadBps: 50, feeBps: 25 });
    expect(q.customerRate).toBe(applySpread(usdPkr, 50));
    expect(q.buyAmount).toBe(2771075n); // 100 * 277.1075
    expect(q.feeAmount).toBe(25n); // 0.25 USD
    expect(q.totalDebit).toBe(10025n);
  });

  it('never gives the customer more than the mid rate', () => {
    for (const sell of [1n, 99n, 12345n, 999999999n]) {
      const q = priceQuote({ from: 'AED', to: 'USD', sellAmount: sell, midRate: crossRate(usdAed, one), spreadBps: 50, feeBps: 0 });
      expect(q.buyAmount).toBeLessThanOrEqual(convertMinor(sell, q.midRate, 'AED', 'USD'));
    }
  });
});
