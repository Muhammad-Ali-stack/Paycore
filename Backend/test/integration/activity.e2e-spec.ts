import { TestContext, TestUser, auth, createAdmin, createTestApp, deposit, idemKey, openWallet, signUp } from './helpers/app';
import { createMerchant, dynamicQr, expectHealthyBooks, scanAndPay } from './helpers/phase2';

describe('Activity feed and CSV statement (integration)', () => {
  let ctx: TestContext;
  let user: TestUser;
  let pkr: string;
  let usd: string;
  let merchantPaymentId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const admin = await createAdmin(ctx);
    user = await signUp(ctx, { tier: 'TIER_2', fullName: 'Ayesha Siddiqui' });
    pkr = await openWallet(ctx, user, 'PKR');
    usd = await openWallet(ctx, user, 'USD');
    const friend = await signUp(ctx, { tier: 'TIER_2', fullName: 'Kamran Akmal' });
    const friendPkr = await openWallet(ctx, friend, 'PKR');
    await deposit(ctx, user, pkr, '5000'); // phase-1 sandbox deposit
    await deposit(ctx, friend, friendPkr, '5000');
    await deposit(ctx, user, usd, '100');

    const send = (from: TestUser, body: Record<string, unknown>) =>
      ctx.http().post('/v1/transfers').set(auth(from)).set('Idempotency-Key', idemKey()).send({ ...body, pin: from.pin }).expect(201);
    await send(user, { fromWalletId: pkr, toPhone: friend.phone, amount: '300', note: 'cricket tickets' });
    await send(friend, { fromWalletId: friendPkr, toPhone: user.phone, amount: '125.50' });

    const m = await createMerchant(ctx, admin, { name: 'Gourmet Bakers' });
    const qr = await dynamicQr(ctx, m, '800.00', { reference: 'CAKE-9', outletId: m.outletId });
    merchantPaymentId = (await scanAndPay(ctx, user, pkr, qr.payload)).body.id;
    await ctx.http().post(`/v1/merchant/payments/${merchantPaymentId}/refunds`).set(auth(m.owner)).set('Idempotency-Key', idemKey()).send({ amount: '200', reason: 'missing item' }).expect(201);

    const top = await ctx.http().post('/v1/funding/topups').set(auth(user)).set('Idempotency-Key', idemKey()).send({ walletId: pkr, amount: '1000', method: 'CARD' }).expect(201);
    await ctx.http().post('/v1/dev/bank/simulate').set(auth(user)).send({ fundingId: top.body.id, outcome: 'SUCCEEDED' }).expect(200);
  });
  afterAll(async () => {
    await expectHealthyBooks(ctx);
    await ctx.close();
  });

  it('lists every movement across wallets, newest first, with counterparties and fees', async () => {
    const res = await ctx.http().get('/v1/transactions?limit=100').set(auth(user)).expect(200);
    const items = res.body.items as Array<Record<string, any>>;
    expect(items.map((i) => i.type)).toEqual(['TOPUP', 'REFUND', 'QR_MERCHANT', 'P2P', 'P2P', 'DEPOSIT', 'DEPOSIT']);
    const [topup, refund, qr, p2pIn, p2pOut] = items;
    expect(topup).toMatchObject({ title: 'Top-up (card)', direction: 'IN', amount: { amount: '985.00' }, fee: { amount: '15.00' }, status: 'SUCCEEDED', counterparty: null });
    expect(refund).toMatchObject({
      title: 'Refund from Gourmet Bakers',
      direction: 'IN',
      amount: { amount: '200.00' },
      counterparty: { type: 'MERCHANT', displayName: 'Gourmet Bakers' },
      status: 'COMPLETED',
    });
    expect(qr).toMatchObject({
      paymentId: merchantPaymentId,
      title: 'Paid Gourmet Bakers',
      direction: 'OUT',
      amount: { amount: '800.00' },
      status: 'PARTIALLY_REFUNDED',
      counterparty: { type: 'MERCHANT', outletName: 'Main Branch' },
    });
    expect(p2pIn).toMatchObject({ title: 'From Kamran A.', direction: 'IN', amount: { amount: '125.50' }, counterparty: { displayName: 'Kamran A.' } });
    expect(p2pOut).toMatchObject({ title: 'To Kamran A.', direction: 'OUT', amount: { amount: '300.00' }, fee: null });
    expect(items[0]!.balanceAfter).toMatchObject({ currency: 'PKR' });
    for (const i of items) expect(i).toEqual(expect.objectContaining({ id: expect.any(String), transactionId: expect.any(String), createdAt: expect.any(String) }));
  });

  it('filters by wallet, currency, type, direction, date and text, and paginates', async () => {
    const onlyUsd = await ctx.http().get('/v1/transactions?currency=USD').set(auth(user)).expect(200);
    expect(onlyUsd.body.items).toHaveLength(1);
    const byWallet = await ctx.http().get(`/v1/transactions?walletId=${usd}`).set(auth(user)).expect(200);
    expect(byWallet.body.items).toHaveLength(1);
    const p2p = await ctx.http().get('/v1/transactions?type=P2P&direction=IN').set(auth(user)).expect(200);
    expect(p2p.body.items.map((i: { title: string }) => i.title)).toEqual(['From Kamran A.']);
    const text = await ctx.http().get('/v1/transactions?q=cricket').set(auth(user)).expect(200);
    expect(text.body.items).toHaveLength(1);
    const future = await ctx.http().get(`/v1/transactions?from=${encodeURIComponent(new Date(Date.now() + 3600_000).toISOString())}`).set(auth(user)).expect(200);
    expect(future.body.items).toEqual([]);

    const page1 = await ctx.http().get('/v1/transactions?limit=3').set(auth(user)).expect(200);
    expect(page1.body.items).toHaveLength(3);
    const page2 = await ctx.http().get(`/v1/transactions?limit=3&cursor=${page1.body.nextCursor}`).set(auth(user)).expect(200);
    const page3 = await ctx.http().get(`/v1/transactions?limit=3&cursor=${page2.body.nextCursor}`).set(auth(user)).expect(200);
    expect(page3.body.nextCursor).toBeNull();
    const ids = [...page1.body.items, ...page2.body.items, ...page3.body.items].map((i: { id: string }) => i.id);
    expect(new Set(ids).size).toBe(7);

    const stranger = await signUp(ctx);
    await ctx.http().get(`/v1/transactions?walletId=${pkr}`).set(auth(stranger)).expect(404);
    await ctx.http().get('/v1/transactions?type=NOPE').set(auth(user)).expect(400);
  });

  it('downloads a CSV statement (oldest first)', async () => {
    const res = await ctx.http().get(`/v1/transactions/statement?walletId=${pkr}&format=csv`).set(auth(user)).expect(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="paycore-statement-/);
    const lines = res.text.trim().split('\r\n');
    expect(lines[0]).toBe('date,transaction_id,payment_id,type,title,counterparty,direction,currency,amount,fee,balance_after,status');
    expect(lines).toHaveLength(1 + 6);
    expect(lines[1]).toContain(',DEPOSIT,');
    expect(lines[lines.length - 1]).toContain('Top-up (card)');
    expect(lines.find((l) => l.includes('To Kamran A.'))).toContain(',OUT,PKR,300.00,,');
  });
});
