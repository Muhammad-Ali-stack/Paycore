import { LedgerService } from '../../src/modules/ledger/ledger.service';
import { TransfersService } from '../../src/modules/transfers/transfers.service';
import { PaymentsService } from '../../src/modules/wallets/payments.service';
import { TestContext, auth, balanceOf, createTestApp, deposit, idemKey, openWallet, signUp } from './helpers/app';

/**
 * Concurrency proofs. Each test fires many overlapping requests at the same accounts and then
 * checks the invariants: no double-spend, no negative balances, no deadlocks, books balance.
 */
describe('Concurrency (integration)', () => {
  let ctx: TestContext;
  let ledger: LedgerService;
  let payments: PaymentsService;
  let transfers: TransfersService;

  beforeAll(async () => {
    ctx = await createTestApp();
    ledger = ctx.app.get(LedgerService);
    payments = ctx.app.get(PaymentsService);
    transfers = ctx.app.get(TransfersService);
  });

  afterAll(async () => {
    const report = await ledger.integrityReport();
    expect(report).toMatchObject({ healthy: true, unbalancedEntries: [], balanceCacheMismatches: [] });
    await ctx.close();
  });

  it('prevents double-spend: 25 parallel transfers against funds for 10', async () => {
    const alice = await signUp(ctx, { tier: 'TIER_2' });
    const bob = await signUp(ctx, { tier: 'TIER_2' });
    const a = await openWallet(ctx, alice, 'PKR');
    const b = await openWallet(ctx, bob, 'PKR');
    await deposit(ctx, alice, a, '1000.00');

    const results = await Promise.all(
      Array.from({ length: 25 }, () =>
        ctx
          .http()
          .post('/v1/transfers')
          .set(auth(alice))
          .set('Idempotency-Key', idemKey())
          .send({ fromWalletId: a, toPhone: bob.phone, amount: '100.00', pin: alice.pin }),
      ),
    );
    const ok = results.filter((r) => r.status === 201);
    const rejected = results.filter((r) => r.status === 422);
    expect(ok).toHaveLength(10);
    expect(rejected).toHaveLength(15);
    rejected.forEach((r) => expect(r.body.error.code).toBe('INSUFFICIENT_FUNDS'));
    expect(await balanceOf(ctx, a)).toBe(0n);
    expect(await balanceOf(ctx, b)).toBe(100000n);
  });

  it('executes a request exactly once when the same Idempotency-Key is sent 10x concurrently', async () => {
    const user = await signUp(ctx, { tier: 'TIER_2' });
    const pkr = await openWallet(ctx, user, 'PKR');
    await deposit(ctx, user, pkr, '500.00');
    const key = idemKey();

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        ctx
          .http()
          .post(`/v1/wallets/${pkr}/withdrawals`)
          .set(auth(user))
          .set('Idempotency-Key', key)
          .send({ amount: '100.00', pin: user.pin }),
      ),
    );
    // Either the original 201, a replay of it, or "still in progress" - never a second execution.
    results.forEach((r) => expect([201, 409]).toContain(r.status));
    const created = results.filter((r) => r.status === 201);
    expect(new Set(created.map((r) => r.body.id)).size).toBe(1);
    expect(await ctx.prisma.journalEntry.count({ where: { externalRef: `idem:${user.id}:${key}` } })).toBe(1);
    expect(await balanceOf(ctx, pkr)).toBe(50000n - 10010n);
  });

  it('never deadlocks on opposite-direction transfers (consistent lock ordering)', async () => {
    const alice = await signUp(ctx, { tier: 'TIER_2' });
    const bob = await signUp(ctx, { tier: 'TIER_2' });
    const a = await openWallet(ctx, alice, 'PKR');
    const b = await openWallet(ctx, bob, 'PKR');
    await deposit(ctx, alice, a, '5000.00');
    await deposit(ctx, bob, b, '5000.00');

    const n = 30;
    const jobs = Array.from({ length: n * 2 }, (_, i) =>
      i % 2 === 0
        ? transfers.transfer(alice.id, { fromWalletId: a, toPhone: bob.phone, amount: '10.00', pin: alice.pin }, idemKey())
        : transfers.transfer(bob.id, { fromWalletId: b, toPhone: alice.phone, amount: '7.00', pin: bob.pin }, idemKey()),
    );
    const settled = await Promise.allSettled(jobs);
    const failures = settled.filter((s) => s.status === 'rejected');
    expect(failures).toEqual([]);

    // Alice: 5000 - 30*10 + 30*7 = 4910; Bob: 5000 + 300 - 210 = 5090. Total preserved.
    expect(await balanceOf(ctx, a)).toBe(491000n);
    expect(await balanceOf(ctx, b)).toBe(509000n);
  });

  it('lets a single-use FX quote execute only once under concurrent attempts', async () => {
    const user = await signUp(ctx, { tier: 'TIER_2' });
    const usd = await openWallet(ctx, user, 'USD');
    const pkr = await openWallet(ctx, user, 'PKR');
    await deposit(ctx, user, usd, '1000');
    const quote = await ctx
      .http()
      .post('/v1/fx/quotes')
      .set(auth(user))
      .send({ fromCurrency: 'USD', toCurrency: 'PKR', sellAmount: '100' })
      .expect(201);

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        ctx
          .http()
          .post('/v1/fx/conversions')
          .set(auth(user))
          .set('Idempotency-Key', idemKey())
          .send({ quoteId: quote.body.id, pin: user.pin }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await balanceOf(ctx, usd)).toBe(100000n - 10025n);
    expect(await balanceOf(ctx, pkr)).toBe(2771075n);
  });

  it('cannot exceed the daily limit via parallel withdrawals', async () => {
    const user = await signUp(ctx); // TIER_0 PKR: per-txn 5,000 / daily 10,000 / max balance 20,000
    const pkr = await openWallet(ctx, user, 'PKR');
    for (let i = 0; i < 4; i++) await deposit(ctx, user, pkr, '5000');

    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        ctx
          .http()
          .post(`/v1/wallets/${pkr}/withdrawals`)
          .set(auth(user))
          .set('Idempotency-Key', idemKey())
          .send({ amount: '1500', pin: user.pin }), // 1,501.50 incl. fee -> at most 6 fit in 10,000
      ),
    );
    const ok = results.filter((r) => r.status === 201);
    expect(ok).toHaveLength(6);
    results.filter((r) => r.status !== 201).forEach((r) => expect(r.body.error.details?.limit).toBe('DAILY'));
    expect(await balanceOf(ctx, pkr)).toBe(2000000n - 6n * 150150n);
  });

  it('keeps the whole book balanced after a burst of mixed operations', async () => {
    const users = await Promise.all(Array.from({ length: 4 }, () => signUp(ctx, { tier: 'TIER_2' })));
    const wallets = await Promise.all(users.map((u) => openWallet(ctx, u, 'PKR')));
    await Promise.all(users.map((u, i) => deposit(ctx, u, wallets[i] as string, '1000')));

    const ops = Array.from({ length: 60 }, (_, i) => {
      const from = i % 4;
      const to = (i + 1 + (i % 3)) % 4;
      const u = users[from]!;
      if (i % 5 === 0) {
        return payments.withdraw(u.id, wallets[from]!, '3.33', u.pin, idemKey());
      }
      return transfers.transfer(u.id, { fromWalletId: wallets[from]!, toPhone: users[to]!.phone, amount: '12.34', pin: u.pin }, idemKey());
    });
    await Promise.allSettled(ops);

    const report = await ledger.integrityReport();
    expect(report.healthy).toBe(true);
    for (const w of wallets) {
      const wallet = await ctx.prisma.wallet.findUniqueOrThrow({ where: { id: w } });
      expect(await ledger.derivedBalance(wallet.ledgerAccountId)).toBe(await balanceOf(ctx, w));
    }
  });
});
