import { TestContext, auth, balanceOf, createTestApp, deposit, idemKey, openWallet, signUp } from './helpers/app';
import { expectHealthyBooks, fundedUser } from './helpers/phase2';

describe('P2P transfers: quotes, FX, fees, limits (integration)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await expectHealthyBooks(ctx);
    await ctx.close();
  });

  const transfer = (user: { token: string }, body: Record<string, unknown>, key = idemKey()) =>
    ctx.http().post('/v1/transfers').set(auth(user as never)).set('Idempotency-Key', key).send(body);

  it('publishes the fee schedule', async () => {
    const user = await signUp(ctx);
    const res = await ctx.http().get('/v1/fees').set(auth(user)).expect(200);
    expect(res.body).toContainEqual({
      product: 'P2P_FX',
      currency: 'USD',
      bps: 25,
      fixed: { currency: 'USD', amount: '0.00', amountMinor: '0' },
      min: { currency: 'USD', amount: '0.00', amountMinor: '0' },
      max: null,
    });
    expect(res.body).toContainEqual(
      expect.objectContaining({ product: 'WITHDRAWAL', currency: 'PKR', bps: 10, min: expect.objectContaining({ amount: '10.00' }) }),
    );
  });

  it('quotes and executes a same-currency transfer by username (single-use quote)', async () => {
    const { user: alice, wallet: a } = await fundedUser(ctx, { amount: '1000' });
    const bob = await signUp(ctx, { tier: 'TIER_1', fullName: 'Bob Marley' });
    const b = await openWallet(ctx, bob, 'PKR');
    const handle = `bob_${Math.random().toString(36).slice(2, 8)}`;
    await ctx.http().patch('/v1/users/me').set(auth(bob)).send({ username: handle }).expect(200);

    const quote = await ctx
      .http()
      .post('/v1/transfers/quotes')
      .set(auth(alice))
      .send({ fromWalletId: a, to: { username: `@${handle}` }, toCurrency: 'PKR', amount: '250.50', amountSide: 'SEND' })
      .expect(201);
    expect(quote.body).toMatchObject({
      send: { amount: '250.50' },
      receive: { amount: '250.50' },
      fee: { amount: '0.00' },
      totalDebit: { amount: '250.50' },
      fx: null,
      recipient: { displayName: 'Bob M.', username: handle },
    });

    const res = await transfer(alice, { quoteId: quote.body.id, pin: alice.pin, note: 'lunch' }).expect(201);
    expect(res.body).toMatchObject({ type: 'P2P', status: 'COMPLETED', reference: 'lunch', payee: { username: handle } });
    expect(await balanceOf(ctx, a)).toBe(100000n - 25050n);
    expect(await balanceOf(ctx, b)).toBe(25050n);

    const again = await transfer(alice, { quoteId: quote.body.id, pin: alice.pin }).expect(409);
    expect(again.body.error.code).toBe('QUOTE_ALREADY_EXECUTED');
    // mixing the two body shapes is rejected
    const mixed = await transfer(alice, { quoteId: quote.body.id, fromWalletId: a, amount: '1', pin: alice.pin }).expect(400);
    expect(mixed.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('sends cross-currency (USD -> PKR) through an FX quote, balanced per currency', async () => {
    const { user: alice, wallet: usd } = await fundedUser(ctx, { currency: 'USD', amount: '500' });
    const bob = await signUp(ctx, { tier: 'TIER_2' });
    const bobPkr = await openWallet(ctx, bob, 'PKR');

    const quote = await ctx
      .http()
      .post('/v1/transfers/quotes')
      .set(auth(alice))
      .send({ fromWalletId: usd, to: { phone: bob.phone }, toCurrency: 'PKR', amount: '100.00', amountSide: 'SEND' })
      .expect(201);
    expect(quote.body).toMatchObject({
      send: { currency: 'USD', amount: '100.00' },
      receive: { currency: 'PKR', amount: '27710.75' },
      fee: { currency: 'USD', amount: '0.25' },
      totalDebit: { amount: '100.25' },
      fx: { midRate: '278.50000000', customerRate: '277.10750000' },
    });

    const res = await transfer(alice, { quoteId: quote.body.id, pin: alice.pin }).expect(201);
    expect(res.body).toMatchObject({
      type: 'P2P_FX',
      amount: { currency: 'USD', amount: '100.00' },
      fee: { amount: '0.25' },
      received: { currency: 'PKR', amount: '27710.75' },
    });
    expect(await balanceOf(ctx, usd)).toBe(50000n - 10025n);
    expect(await balanceOf(ctx, bobPkr)).toBe(2771075n);
    const sums = await ctx.prisma.posting.groupBy({ by: ['currency'], where: { entryId: res.body.journalEntryId }, _sum: { amount: true } });
    expect(sums).toHaveLength(2);
    for (const s of sums) expect(s._sum.amount).toBe(0n);
  });

  it('prices RECEIVE-side quotes so the recipient gets exactly the requested amount', async () => {
    const { user: alice, wallet: usd } = await fundedUser(ctx, { currency: 'USD', amount: '100' });
    const bob = await signUp(ctx, { tier: 'TIER_2' });
    const bobPkr = await openWallet(ctx, bob, 'PKR');
    const quote = await ctx
      .http()
      .post('/v1/transfers/quotes')
      .set(auth(alice))
      .send({ fromWalletId: usd, to: { phone: bob.phone }, toCurrency: 'PKR', amount: '1000.00', amountSide: 'RECEIVE' })
      .expect(201);
    // 1000 / 277.1075 = 3.6087... -> rounded up to 3.61 USD
    expect(quote.body).toMatchObject({ receive: { amount: '1000.00' }, send: { amount: '3.61' }, fee: { amount: '0.01' } });
    await transfer(alice, { quoteId: quote.body.id, pin: alice.pin }).expect(201);
    expect(await balanceOf(ctx, bobPkr)).toBe(100000n);
    expect(await balanceOf(ctx, usd)).toBe(10000n - 361n - 1n);
  });

  it('rejects expired quotes and unknown or self recipients', async () => {
    const { user: alice, wallet: a } = await fundedUser(ctx, { amount: '100' });
    const bob = await signUp(ctx);
    await openWallet(ctx, bob, 'PKR');
    const quote = await ctx
      .http()
      .post('/v1/transfers/quotes')
      .set(auth(alice))
      .send({ fromWalletId: a, to: { phone: bob.phone }, toCurrency: 'PKR', amount: '10', amountSide: 'SEND' })
      .expect(201);
    await ctx.prisma.transferQuote.update({ where: { id: quote.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await transfer(alice, { quoteId: quote.body.id, pin: alice.pin }).expect(422);
    expect(expired.body.error.code).toBe('QUOTE_EXPIRED');

    const noWallet = await ctx
      .http()
      .post('/v1/transfers/quotes')
      .set(auth(alice))
      .send({ fromWalletId: a, to: { phone: bob.phone }, toCurrency: 'USD', amount: '10', amountSide: 'SEND' })
      .expect(404);
    expect(noWallet.body.error.message).toMatch(/no USD wallet/);
    const self = await transfer(alice, { fromWalletId: a, toPhone: alice.phone, amount: '1', pin: alice.pin }).expect(422);
    expect(self.body.error.code).toBe('SELF_TRANSFER');
    await transfer(alice, { fromWalletId: a, toUsername: 'nobody_at_all', amount: '1', pin: alice.pin }).expect(404);
    const both = await transfer(alice, { fromWalletId: a, toPhone: bob.phone, toUsername: 'x_y_z', amount: '1', pin: alice.pin }).expect(400);
    expect(both.body.error.code).toBe('VALIDATION_FAILED');
    expect(await balanceOf(ctx, a)).toBe(10000n);
  });

  it('verifies the PIN before creating anything', async () => {
    const { user: alice, wallet: a } = await fundedUser(ctx, { amount: '100' });
    const bob = await signUp(ctx);
    await openWallet(ctx, bob, 'PKR');
    const key = idemKey();
    const bad = await transfer(alice, { fromWalletId: a, toPhone: bob.phone, amount: '5', pin: '9082' }, key).expect(403);
    expect(bad.body.error.code).toBe('PIN_INVALID');
    expect(await ctx.prisma.payment.count({ where: { externalRef: `idem:${alice.id}:${key}` } })).toBe(0);
    await transfer(alice, { fromWalletId: a, toPhone: bob.phone, amount: '5', pin: alice.pin }, key).expect(201);
  });

  it('enforces KYC limits; a failed payment is recorded and its key replays the failure', async () => {
    const alice = await signUp(ctx); // TIER_0 PKR: per-transaction 5,000
    const a = await openWallet(ctx, alice, 'PKR');
    for (let i = 0; i < 3; i++) await deposit(ctx, alice, a, '5000');
    const bob = await signUp(ctx);
    const bw = await openWallet(ctx, bob, 'PKR');
    const key = idemKey();
    const res = await transfer(alice, { fromWalletId: a, toPhone: bob.phone, amount: '6000', pin: alice.pin }, key).expect(422);
    expect(res.body.error).toMatchObject({ code: 'LIMIT_EXCEEDED', details: { limit: 'PER_TRANSACTION' } });
    const failed = await ctx.prisma.payment.findUniqueOrThrow({ where: { externalRef: `idem:${alice.id}:${key}` } });
    expect(failed).toMatchObject({ status: 'FAILED', failureCode: 'LIMIT_EXCEEDED', journalEntryId: null });

    const replay = await transfer(alice, { fromWalletId: a, toPhone: bob.phone, amount: '6000', pin: alice.pin }, key).expect(422);
    expect(replay.body.error.code).toBe('LIMIT_EXCEEDED');
    const reuse = await transfer(alice, { fromWalletId: a, toPhone: bob.phone, amount: '10', pin: alice.pin }, key).expect(422);
    expect(reuse.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await balanceOf(ctx, a)).toBe(1500000n);

    // the recipient's max balance is enforced too (TIER_0 max balance 20,000)
    const rich = await fundedUser(ctx, { amount: '30000' });
    for (const amt of ['5000', '5000', '5000', '4000']) await deposit(ctx, bob, bw, amt);
    const over = await transfer(rich.user, { fromWalletId: rich.wallet, toPhone: bob.phone, amount: '2000', pin: rich.user.pin }).expect(422);
    expect(over.body.error).toMatchObject({ code: 'LIMIT_EXCEEDED', details: { limit: 'MAX_BALANCE', reason: 'RECIPIENT_LIMIT' } });
  });

  it('replays a completed transfer for the same key and exposes it via GET /payments/:id to its parties only', async () => {
    const { user: alice, wallet: a } = await fundedUser(ctx, { amount: '300' });
    const bob = await signUp(ctx);
    await openWallet(ctx, bob, 'PKR');
    const eve = await signUp(ctx);
    const key = idemKey();
    const body = { fromWalletId: a, toPhone: bob.phone, amount: '20', pin: alice.pin };
    const first = await transfer(alice, body, key).expect(201);
    const second = await transfer(alice, body, key).expect(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body.id).toBe(first.body.id);
    // even if the idempotency record is lost, the payment's external_ref returns the original
    await ctx.prisma.idempotencyRecord.deleteMany({ where: { scope: alice.id, key } });
    const third = await transfer(alice, body, key).expect(201);
    expect(third.body.id).toBe(first.body.id);
    expect(await ctx.prisma.journalEntry.count({ where: { externalRef: `idem:${alice.id}:${key}` } })).toBe(1);

    const asPayee = await ctx.http().get(`/v1/payments/${first.body.id}`).set(auth(bob)).expect(200);
    expect(asPayee.body).toMatchObject({ id: first.body.id, status: 'COMPLETED', payer: { type: 'USER', displayName: 'Test U.' } });
    await ctx.http().get(`/v1/payments/${first.body.id}`).set(auth(eve)).expect(404);
  });
});
