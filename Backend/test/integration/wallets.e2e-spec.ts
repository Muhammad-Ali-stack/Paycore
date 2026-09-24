import {
  TestContext,
  auth,
  balanceOf,
  createAdmin,
  createTestApp,
  deposit,
  idemKey,
  openWallet,
  signUp,
} from './helpers/app';

describe('Wallets, transfers, FX and idempotency (integration)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => ctx.close());

  it('opens one wallet per currency', async () => {
    const user = await signUp(ctx, { tier: 'TIER_1' });
    await openWallet(ctx, user, 'PKR');
    const dup = await ctx.http().post('/v1/wallets').set(auth(user)).send({ currency: 'PKR' }).expect(409);
    expect(dup.body.error.code).toBe('WALLET_EXISTS');
    await openWallet(ctx, user, 'USD');
    const list = await ctx.http().get('/v1/wallets').set(auth(user)).expect(200);
    expect(list.body.map((w: { currency: string }) => w.currency).sort()).toEqual(['PKR', 'USD']);
    expect(list.body[0].balance).toEqual({ currency: 'PKR', amount: '0.00', amountMinor: '0' });
  });

  it('deposits and withdraws with a fee, posting balanced entries', async () => {
    const user = await signUp(ctx, { tier: 'TIER_1' });
    const pkr = await openWallet(ctx, user, 'PKR');
    const dep = await ctx
      .http()
      .post(`/v1/wallets/${pkr}/deposits`)
      .set(auth(user))
      .set('Idempotency-Key', idemKey())
      .send({ amount: '1000.00' })
      .expect(201);
    expect(dep.body.legs).toEqual([
      expect.objectContaining({ walletId: pkr, direction: 'IN', amount: '1000.00', balanceAfter: '1000.00' }),
    ]);

    const wd = await ctx
      .http()
      .post(`/v1/wallets/${pkr}/withdrawals`)
      .set(auth(user))
      .set('Idempotency-Key', idemKey())
      .send({ amount: '500.00', pin: user.pin })
      .expect(201);
    expect(wd.body.metadata).toMatchObject({ amount: '500.00', fee: '0.50' });
    expect(await balanceOf(ctx, pkr)).toBe(49950n);

    const entry = await ctx.prisma.posting.groupBy({ by: ['entryId'], where: { entryId: wd.body.id }, _sum: { amount: true } });
    expect(entry[0]?._sum.amount).toBe(0n);

    const history = await ctx.http().get(`/v1/wallets/${pkr}/transactions?limit=1`).set(auth(user)).expect(200);
    expect(history.body.items).toHaveLength(1);
    expect(history.body.items[0]).toMatchObject({ type: 'WITHDRAWAL', direction: 'OUT', amount: '500.50' });
    expect(history.body.nextCursor).toBeTruthy();
    const page2 = await ctx
      .http()
      .get(`/v1/wallets/${pkr}/transactions?limit=5&cursor=${history.body.nextCursor}`)
      .set(auth(user))
      .expect(200);
    expect(page2.body.items.map((i: { type: string }) => i.type)).toEqual(['DEPOSIT']);
  });

  it('rejects overdrafts and wrong PINs without moving money', async () => {
    const user = await signUp(ctx, { tier: 'TIER_1' });
    const pkr = await openWallet(ctx, user, 'PKR');
    await deposit(ctx, user, pkr, '100');
    const over = await ctx
      .http()
      .post(`/v1/wallets/${pkr}/withdrawals`)
      .set(auth(user))
      .set('Idempotency-Key', idemKey())
      .send({ amount: '100', pin: user.pin }) // 100 + 0.10 fee > balance
      .expect(422);
    expect(over.body.error.code).toBe('INSUFFICIENT_FUNDS');
    const badPin = await ctx
      .http()
      .post(`/v1/wallets/${pkr}/withdrawals`)
      .set(auth(user))
      .set('Idempotency-Key', idemKey())
      .send({ amount: '1', pin: '9082' })
      .expect(403);
    expect(badPin.body.error.code).toBe('PIN_INVALID');
    expect(await balanceOf(ctx, pkr)).toBe(10000n);
  });

  it('transfers between users and prevents access to other users wallets', async () => {
    const alice = await signUp(ctx, { tier: 'TIER_1' });
    const bob = await signUp(ctx, { tier: 'TIER_1' });
    const a = await openWallet(ctx, alice, 'PKR');
    const b = await openWallet(ctx, bob, 'PKR');
    await deposit(ctx, alice, a, '2000');

    const t = await ctx
      .http()
      .post('/v1/transfers')
      .set(auth(alice))
      .set('Idempotency-Key', idemKey())
      .send({ fromWalletId: a, toPhone: bob.phone, amount: '750.25', pin: alice.pin, note: 'rent' })
      .expect(201);
    // phase 2: /transfers returns a Payment (see docs/API_CONTRACT.md)
    expect(t.body).toMatchObject({
      type: 'P2P',
      status: 'COMPLETED',
      amount: { currency: 'PKR', amount: '750.25', amountMinor: '75025' },
      fee: { amount: '0.00' },
      totalDebit: { amount: '750.25' },
      payee: { type: 'USER', displayName: 'Test U.' },
      reference: 'rent',
    });
    expect(t.body.timeline.map((e: { status: string }) => e.status)).toEqual(['CREATED', 'PROCESSING', 'COMPLETED']);
    expect(await balanceOf(ctx, a)).toBe(124975n);
    expect(await balanceOf(ctx, b)).toBe(75025n);

    await ctx.http().get(`/v1/wallets/${a}`).set(auth(bob)).expect(404);
    await ctx
      .http()
      .post('/v1/transfers')
      .set(auth(bob))
      .set('Idempotency-Key', idemKey())
      .send({ fromWalletId: a, toPhone: bob.phone, amount: '1', pin: bob.pin })
      .expect(404);
    await ctx
      .http()
      .post('/v1/transfers')
      .set(auth(alice))
      .set('Idempotency-Key', idemKey())
      .send({ fromWalletId: a, toPhone: alice.phone, amount: '1', pin: alice.pin })
      .expect(422);
  });

  it('frozen wallets cannot send or receive; closing requires zero balance', async () => {
    const admin = await createAdmin(ctx);
    const alice = await signUp(ctx, { tier: 'TIER_1' });
    const bob = await signUp(ctx, { tier: 'TIER_1' });
    const a = await openWallet(ctx, alice, 'PKR');
    const b = await openWallet(ctx, bob, 'PKR');
    await deposit(ctx, alice, a, '100');

    await ctx.http().post(`/v1/admin/wallets/${b}/status`).set(auth(admin)).send({ status: 'FROZEN', reason: 'fraud review' }).expect(200);
    const res = await ctx
      .http()
      .post('/v1/transfers')
      .set(auth(alice))
      .set('Idempotency-Key', idemKey())
      .send({ fromWalletId: a, toPhone: bob.phone, amount: '10', pin: alice.pin })
      .expect(422);
    expect(res.body.error.code).toBe('WALLET_NOT_ACTIVE');

    const close = await ctx.http().post(`/v1/admin/wallets/${a}/status`).set(auth(admin)).send({ status: 'CLOSED', reason: 'user request' }).expect(422);
    expect(close.body.error.code).toBe('WALLET_NOT_EMPTY');
    await ctx.http().post(`/v1/admin/wallets/${b}/status`).set(auth(admin)).send({ status: 'CLOSED', reason: 'user request' }).expect(200);
  });

  describe('idempotency', () => {
    it('requires a well-formed Idempotency-Key on money endpoints', async () => {
      const user = await signUp(ctx, { tier: 'TIER_1' });
      const pkr = await openWallet(ctx, user, 'PKR');
      const missing = await ctx.http().post(`/v1/wallets/${pkr}/deposits`).set(auth(user)).send({ amount: '1' }).expect(400);
      expect(missing.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
      await ctx.http().post(`/v1/wallets/${pkr}/deposits`).set(auth(user)).set('Idempotency-Key', 'bad key!').send({ amount: '1' }).expect(400);
    });

    it('replays the original response for a retried request and posts only once', async () => {
      const user = await signUp(ctx, { tier: 'TIER_1' });
      const pkr = await openWallet(ctx, user, 'PKR');
      const key = idemKey();
      const send = () =>
        ctx.http().post(`/v1/wallets/${pkr}/deposits`).set(auth(user)).set('Idempotency-Key', key).send({ amount: '10.00' });

      const first = await send().expect(201);
      const second = await send().expect(201);
      expect(second.headers['idempotent-replayed']).toBe('true');
      expect(second.body).toEqual(first.body);
      expect(await balanceOf(ctx, pkr)).toBe(1000n);
      expect(await ctx.prisma.journalEntry.count({ where: { externalRef: `idem:${user.id}:${key}` } })).toBe(1);
    });

    it('rejects reuse of a key with a different payload', async () => {
      const user = await signUp(ctx, { tier: 'TIER_1' });
      const pkr = await openWallet(ctx, user, 'PKR');
      const key = idemKey();
      await ctx.http().post(`/v1/wallets/${pkr}/deposits`).set(auth(user)).set('Idempotency-Key', key).send({ amount: '10.00' }).expect(201);
      const res = await ctx
        .http()
        .post(`/v1/wallets/${pkr}/deposits`)
        .set(auth(user))
        .set('Idempotency-Key', key)
        .send({ amount: '11.00' })
        .expect(422);
      expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('releases the key after a failure so the client can retry', async () => {
      const user = await signUp(ctx, { tier: 'TIER_1' });
      const pkr = await openWallet(ctx, user, 'PKR');
      await deposit(ctx, user, pkr, '50');
      const key = idemKey();
      const withdraw = (pin: string) =>
        ctx.http().post(`/v1/wallets/${pkr}/withdrawals`).set(auth(user)).set('Idempotency-Key', key).send({ amount: '10', pin });
      await withdraw('9082').expect(403); // wrong PIN
      await withdraw(user.pin).expect(201); // same key, correct PIN
      expect(await balanceOf(ctx, pkr)).toBe(3999n);
    });

    it('never posts twice even if the idempotency record is lost (external_ref backstop)', async () => {
      const user = await signUp(ctx, { tier: 'TIER_1' });
      const pkr = await openWallet(ctx, user, 'PKR');
      const key = idemKey();
      const send = () =>
        ctx.http().post(`/v1/wallets/${pkr}/deposits`).set(auth(user)).set('Idempotency-Key', key).send({ amount: '10.00' });
      const first = await send().expect(201);
      // simulate a crash between ledger commit and idempotency completion
      await ctx.prisma.idempotencyRecord.deleteMany({ where: { scope: user.id, key } });
      const retry = await send().expect(201);
      expect(retry.body.id).toBe(first.body.id);
      expect(await balanceOf(ctx, pkr)).toBe(1000n);
    });
  });

  describe('FX conversion', () => {
    it('quotes and converts USD -> PKR with spread and fee, balanced per currency', async () => {
      const user = await signUp(ctx, { tier: 'TIER_2' });
      const usd = await openWallet(ctx, user, 'USD');
      const pkr = await openWallet(ctx, user, 'PKR');
      await deposit(ctx, user, usd, '200');

      const rates = await ctx.http().get('/v1/fx/rates').set(auth(user)).expect(200);
      expect(rates.body.pairs).toContainEqual(expect.objectContaining({ from: 'USD', to: 'PKR', midRate: '278.50000000' }));

      const quote = await ctx
        .http()
        .post('/v1/fx/quotes')
        .set(auth(user))
        .send({ fromCurrency: 'USD', toCurrency: 'PKR', sellAmount: '100.00' })
        .expect(201);
      expect(quote.body).toMatchObject({
        status: 'OPEN',
        customerRate: '277.10750000',
        buy: { currency: 'PKR', amount: '27710.75' },
        fee: { currency: 'USD', amount: '0.25' },
        totalDebit: { amount: '100.25' },
      });

      const conv = await ctx
        .http()
        .post('/v1/fx/conversions')
        .set(auth(user))
        .set('Idempotency-Key', idemKey())
        .send({ quoteId: quote.body.id, pin: user.pin })
        .expect(201);
      expect(conv.body.quote.status).toBe('EXECUTED');
      expect(await balanceOf(ctx, usd)).toBe(9975n);
      expect(await balanceOf(ctx, pkr)).toBe(2771075n);

      const sums = await ctx.prisma.posting.groupBy({
        by: ['currency'],
        where: { entryId: conv.body.transaction.id },
        _sum: { amount: true },
      });
      for (const s of sums) expect(s._sum.amount).toBe(0n);

      // quotes are single-use
      const again = await ctx
        .http()
        .post('/v1/fx/conversions')
        .set(auth(user))
        .set('Idempotency-Key', idemKey())
        .send({ quoteId: quote.body.id, pin: user.pin })
        .expect(409);
      expect(again.body.error.code).toBe('QUOTE_ALREADY_EXECUTED');
    });

    it('rejects expired quotes', async () => {
      const user = await signUp(ctx, { tier: 'TIER_2' });
      const usd = await openWallet(ctx, user, 'USD');
      await openWallet(ctx, user, 'AED');
      await deposit(ctx, user, usd, '50');
      const quote = await ctx
        .http()
        .post('/v1/fx/quotes')
        .set(auth(user))
        .send({ fromCurrency: 'USD', toCurrency: 'AED', sellAmount: '10' })
        .expect(201);
      await ctx.prisma.fxQuote.update({ where: { id: quote.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      const res = await ctx
        .http()
        .post('/v1/fx/conversions')
        .set(auth(user))
        .set('Idempotency-Key', idemKey())
        .send({ quoteId: quote.body.id, pin: user.pin })
        .expect(422);
      expect(res.body.error.code).toBe('QUOTE_EXPIRED');
      expect(await balanceOf(ctx, usd)).toBe(5000n);
    });
  });
});
