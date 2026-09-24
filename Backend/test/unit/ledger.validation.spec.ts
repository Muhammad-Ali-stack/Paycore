import { DomainError } from '../../src/common/errors/domain-error';
import {
  applyPosting,
  assertBalanced,
  assertWellFormed,
  credit,
  debit,
  netByCurrency,
  normalBalanceFor,
} from '../../src/modules/ledger/ledger.validation';

describe('ledger validation', () => {
  it('builds signed legs from debit/credit helpers', () => {
    expect(debit('a', 5n).amount).toBe(5n);
    expect(credit('a', 5n).amount).toBe(-5n);
    expect(() => debit('a', 0n)).toThrow(DomainError);
    expect(() => credit('a', -1n)).toThrow(DomainError);
  });

  it('requires at least two non-zero bigint legs', () => {
    expect(() => assertWellFormed([debit('a', 1n)])).toThrow(/at least two/);
    expect(() => assertWellFormed([{ accountId: 'a', amount: 0n }, { accountId: 'b', amount: 0n }])).toThrow(/zero/);
    expect(() =>
      assertWellFormed([
        { accountId: 'a', amount: 1 as unknown as bigint },
        { accountId: 'b', amount: -1n },
      ]),
    ).toThrow(/bigint/);
  });

  it('accepts entries that balance per currency', () => {
    expect(() =>
      assertBalanced([
        { accountId: 'w1', amount: 10025n, currency: 'USD' },
        { accountId: 's-usd', amount: -10000n, currency: 'USD' },
        { accountId: 'fee', amount: -25n, currency: 'USD' },
        { accountId: 's-pkr', amount: 2771075n, currency: 'PKR' },
        { accountId: 'w2', amount: -2771075n, currency: 'PKR' },
      ]),
    ).not.toThrow();
  });

  it('rejects entries that only balance across currencies', () => {
    const legs = [
      { accountId: 'a', amount: 100n, currency: 'USD' as const },
      { accountId: 'b', amount: -100n, currency: 'PKR' as const },
    ];
    expect(netByCurrency(legs).get('USD')).toBe(100n);
    expect(() => assertBalanced(legs)).toThrow(expect.objectContaining({ code: 'LEDGER_UNBALANCED' }));
  });

  it('applies postings on the normal side', () => {
    expect(normalBalanceFor('ASSET')).toBe('DEBIT');
    expect(normalBalanceFor('LIABILITY')).toBe('CREDIT');
    expect(normalBalanceFor('REVENUE')).toBe('CREDIT');
    // wallet (liability): a credit increases the balance, a debit reduces it
    expect(applyPosting(100n, 'CREDIT', -50n)).toBe(150n);
    expect(applyPosting(100n, 'CREDIT', 30n)).toBe(70n);
    expect(applyPosting(100n, 'DEBIT', 30n)).toBe(130n);
  });
});
