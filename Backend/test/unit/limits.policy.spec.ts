import { checkInflow, checkOutflow, isCurrencyPermitted, tierRank } from '../../src/modules/kyc/limits.policy';

const limit = { perTxnMax: 1000n, dailyMax: 2000n, monthlyMax: 5000n, maxBalance: 10000n };
const blocked = { perTxnMax: 0n, dailyMax: 0n, monthlyMax: 0n, maxBalance: 0n };

describe('limits policy', () => {
  it('orders tiers', () => {
    expect(tierRank('TIER_0')).toBeLessThan(tierRank('TIER_1'));
    expect(tierRank('TIER_3')).toBe(3);
  });

  it('treats zero limits as currency not permitted', () => {
    expect(isCurrencyPermitted(blocked)).toBe(false);
    expect(checkOutflow(blocked, { daily: 0n, monthly: 0n }, 1n)).toBe('CURRENCY_NOT_PERMITTED');
    expect(checkInflow(blocked, 0n, 1n, { enforcePerTxn: false })).toBe('CURRENCY_NOT_PERMITTED');
  });

  it('enforces per-transaction, daily and monthly outflow limits (inclusive bounds)', () => {
    const none = { daily: 0n, monthly: 0n };
    expect(checkOutflow(limit, none, 1000n)).toBeNull();
    expect(checkOutflow(limit, none, 1001n)).toBe('PER_TRANSACTION');
    expect(checkOutflow(limit, { daily: 1500n, monthly: 1500n }, 500n)).toBeNull();
    expect(checkOutflow(limit, { daily: 1500n, monthly: 1500n }, 501n)).toBe('DAILY');
    expect(checkOutflow(limit, { daily: 0n, monthly: 4500n }, 501n)).toBe('MONTHLY');
  });

  it('enforces max balance on inflow and optionally per-transaction', () => {
    expect(checkInflow(limit, 9000n, 1000n, { enforcePerTxn: true })).toBeNull();
    expect(checkInflow(limit, 9000n, 1001n, { enforcePerTxn: false })).toBe('MAX_BALANCE');
    expect(checkInflow(limit, 0n, 1001n, { enforcePerTxn: true })).toBe('PER_TRANSACTION');
    expect(checkInflow(limit, 0n, 1001n, { enforcePerTxn: false })).toBeNull();
  });
});
