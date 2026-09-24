import { backoffSeconds } from '../../src/common/outbox/outbox.service';
import { computeFee, maxSendWithinBudget } from '../../src/modules/fees/fee.policy';
import { businessDay, diffStatement } from '../../src/modules/funding/reconciliation.diff';
import { mdrFor, mdrRefundShare, refundableRemaining } from '../../src/modules/merchants/merchant.math';
import { refundLegs } from '../../src/modules/merchants/refunds.service';
import { maskPhone, shortDisplayName } from '../../src/modules/payments/parties';
import { settlementCutoff, summarizeSettlement } from '../../src/modules/settlement/settlement.math';
import { p2pLegs } from '../../src/modules/transfers/transfers.service';
import { applySpread, convertMinor, sendForReceive } from '../../src/modules/wallets/fx/fx.math';

describe('fee rules', () => {
  const rule = (bps: number, fixed = 0n, min = 0n, max: bigint | null = null) => ({ bps, fixed, min, max });

  it('bps (rounded up) + fixed, clamped to [min, max], never more than the amount', () => {
    expect(computeFee(rule(0), 100_000n)).toBe(0n);
    expect(computeFee(rule(25), 10_000n)).toBe(25n);
    expect(computeFee(rule(25), 361n)).toBe(1n); // 0.9025 -> 1
    expect(computeFee(rule(150, 500n), 100_000n)).toBe(2_000n);
    expect(computeFee(rule(10, 0n, 1_000n, 50_000n), 200_000n)).toBe(1_000n); // min
    expect(computeFee(rule(10, 0n, 1_000n, 50_000n), 100_000_000n)).toBe(50_000n); // max
    expect(computeFee(rule(10, 0n, 1_000n), 500n)).toBe(500n); // capped at the amount
    expect(computeFee(rule(100), 0n)).toBe(0n);
  });

  it('finds the largest send that fits a total budget', () => {
    const r = rule(150, 0n, 100n);
    const budget = 10_000n;
    const send = maxSendWithinBudget(r, budget);
    expect(send + computeFee(r, send)).toBeLessThanOrEqual(budget);
    expect(send + 1n + computeFee(r, send + 1n)).toBeGreaterThan(budget);
  });
});

describe('FX: receive-side pricing', () => {
  it('rounds the send amount up so the recipient always receives at least the requested amount', () => {
    const rate = applySpread(27_850_000_000n, 50); // USD->PKR 277.1075
    for (const receive of [1n, 99n, 100_000n, 2_771_075n, 123_456_789n]) {
      const send = sendForReceive(receive, rate, 'USD', 'PKR');
      expect(convertMinor(send, rate, 'USD', 'PKR')).toBeGreaterThanOrEqual(receive);
      expect(convertMinor(send - 1n, rate, 'USD', 'PKR')).toBeLessThan(receive);
    }
  });
});

describe('merchant MDR and refunds', () => {
  it('computes MDR rounded up and never above the amount', () => {
    expect(mdrFor(100_000n, 150)).toBe(1_500n);
    expect(mdrFor(1n, 150)).toBe(1n);
    expect(mdrFor(0n, 150)).toBe(0n);
    expect(mdrFor(100n, 0)).toBe(0n);
  });

  it('returns MDR proportionally so partial refunds sum to exactly the original MDR', () => {
    const amount = 25_000n;
    const mdr = mdrFor(amount, 150); // 375
    const parts = [3_333n, 7_000n, 1n, 14_666n];
    let refunded = 0n;
    let returned = 0n;
    for (const refund of parts) {
      returned += mdrRefundShare({ amount, mdr, refundedBefore: refunded, refund });
      refunded += refund;
    }
    expect(refunded).toBe(amount);
    expect(returned).toBe(mdr);
    expect(refundableRemaining(amount, 10_000n)).toBe(15_000n);
    expect(refundableRemaining(amount, amount)).toBe(0n);
  });

  it('refund legs balance and skip zero legs', () => {
    const legs = refundLegs({ merchantAccount: 'm', feeRevenue: 'f', payerAccount: 'p', amount: 10_000n, mdrShare: 150n });
    expect(legs).toEqual([
      { accountId: 'm', amount: 9_850n },
      { accountId: 'f', amount: 150n },
      { accountId: 'p', amount: -10_000n },
    ]);
    expect(legs.reduce((s, l) => s + l.amount, 0n)).toBe(0n);
    expect(refundLegs({ merchantAccount: 'm', feeRevenue: 'f', payerAccount: 'p', amount: 500n, mdrShare: 0n })).toHaveLength(2);
  });
});

describe('P2P legs', () => {
  it('same-currency: sender pays amount + fee; fee revenue locked only when charged', () => {
    const r = p2pLegs({ sourceAccount: 's', targetAccount: 't', send: 1_000n, fee: 0n, receive: 1_000n, feeRevenue: 'f', fx: null });
    expect(r.lock).toEqual(['s', 't']);
    expect(r.legs.reduce((a, l) => a + l.amount, 0n)).toBe(0n);
    const withFee = p2pLegs({ sourceAccount: 's', targetAccount: 't', send: 1_000n, fee: 10n, receive: 1_000n, feeRevenue: 'f', fx: null });
    expect(withFee.lock).toContain('f');
    expect(withFee.legs[0]).toEqual({ accountId: 's', amount: 1_010n });
  });

  it('cross-currency legs balance per currency through the settlement accounts', () => {
    const r = p2pLegs({ sourceAccount: 's', targetAccount: 't', send: 10_000n, fee: 25n, receive: 2_771_075n, feeRevenue: 'f', fx: { settleFrom: 'sf', settleTo: 'st' } });
    const from = r.legs.filter((l) => ['s', 'sf', 'f'].includes(l.accountId)).reduce((a, l) => a + l.amount, 0n);
    const to = r.legs.filter((l) => ['t', 'st'].includes(l.accountId)).reduce((a, l) => a + l.amount, 0n);
    expect(from).toBe(0n);
    expect(to).toBe(0n);
    expect(r.lock.sort()).toEqual(['f', 's', 'sf', 'st', 't']);
  });
});

describe('settlement math', () => {
  const at = new Date('2026-09-20T10:00:00Z');

  it('T+N cut-off is the start of the UTC day N days before asOf', () => {
    expect(settlementCutoff(new Date('2026-09-24T15:30:00Z'), 1).toISOString()).toBe('2026-09-23T00:00:00.000Z');
    expect(settlementCutoff(new Date('2026-09-24T00:00:00Z'), 0).toISOString()).toBe('2026-09-24T00:00:00.000Z');
    expect(settlementCutoff(new Date('2026-09-24T23:59:59Z'), 3).toISOString()).toBe('2026-09-21T00:00:00.000Z');
  });

  it('net = gross - (MDR charged - MDR returned) - refunds, and lines sum to net', () => {
    const totals = summarizeSettlement([
      { kind: 'PAYMENT', id: 'p1', amount: 100_000n, mdr: 2_000n, occurredAt: at },
      { kind: 'PAYMENT', id: 'p2', amount: 50_000n, mdr: 1_000n, occurredAt: new Date('2026-09-19T10:00:00Z') },
      { kind: 'REFUND', id: 'r1', amount: 10_000n, mdr: 200n, occurredAt: at },
    ]);
    expect(totals).toMatchObject({ gross: 150_000n, mdr: 2_800n, refunds: 10_000n, net: 137_200n });
    expect(totals.lines.reduce((s, l) => s + l.net, 0n)).toBe(totals.net);
    expect(totals.periodStart?.toISOString()).toBe('2026-09-19T10:00:00.000Z');
    // the merchant payable moved by the same amount: credits (amount - mdr) minus debits (refund - share)
    expect(98_000n + 49_000n - (10_000n - 200n)).toBe(totals.net);
    expect(summarizeSettlement([]).net).toBe(0n);
  });
});

describe('reconciliation diff', () => {
  const l = (reference: string, amount: bigint, currency: 'PKR' | 'USD' = 'PKR') => ({ reference, currency, amount });

  it('classifies matched, missing-in-ledger, missing-in-bank and amount mismatches', () => {
    const bank = [l('A', 10_000n), l('B', 5_000n), l('D', -4_000n), l('E', 700n), l('E', -700n), l('F', 100n, 'USD')];
    const ledger = [l('A', 10_000n), l('C', 2_000n), l('D', -3_999n), l('F', 60n, 'USD'), l('F', 40n, 'USD')];
    const res = diffStatement(bank, ledger);
    expect(res.matched).toBe(3); // A, E (nets to zero on the bank side, absent in the ledger), F (netted)
    expect(res.items).toEqual([
      { type: 'MISSING_IN_LEDGER', reference: 'B', currency: 'PKR', bankAmount: 5_000n, ledgerAmount: null },
      { type: 'MISSING_IN_BANK', reference: 'C', currency: 'PKR', bankAmount: null, ledgerAmount: 2_000n },
      { type: 'AMOUNT_MISMATCH', reference: 'D', currency: 'PKR', bankAmount: -4_000n, ledgerAmount: -3_999n },
    ]);
  });

  it('keys by currency as well as reference, and validates business dates', () => {
    const res = diffStatement([l('X', 100n, 'USD')], [l('X', 100n, 'PKR')]);
    expect(res.items.map((i) => i.type).sort()).toEqual(['MISSING_IN_BANK', 'MISSING_IN_LEDGER']);
    expect(businessDay('2026-09-24')).toEqual({ start: new Date('2026-09-24T00:00:00Z'), end: new Date('2026-09-25T00:00:00Z') });
    expect(() => businessDay('2026-02-30')).toThrow();
    expect(() => businessDay('24-09-2026')).toThrow();
  });
});

describe('presentation helpers and outbox backoff', () => {
  it('shortens names and masks phones', () => {
    expect(shortDisplayName('Ali Raza Khan')).toBe('Ali K.');
    expect(shortDisplayName('  madonna ')).toBe('madonna');
    expect(shortDisplayName('')).toBe('PayCore user');
    expect(maskPhone('+923001234567')).toBe('+92300****567');
  });

  it('backs off exponentially up to an hour', () => {
    expect([1, 2, 3, 4].map(backoffSeconds)).toEqual([5, 10, 20, 40]);
    expect(backoffSeconds(30)).toBe(3600);
  });
});
