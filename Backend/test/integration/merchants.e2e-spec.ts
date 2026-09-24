import { TestContext, TestUser, auth, balanceOf, createAdmin, createTestApp, idemKey, signUp } from './helpers/app';
import { TestMerchant, createMerchant, dynamicQr, expectHealthyBooks, fundedUser, scanAndPay, systemAccount } from './helpers/phase2';

describe('Merchants: onboarding, outlets, payments, refunds (integration)', () => {
  let ctx: TestContext;
  let admin: TestUser;
  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await createAdmin(ctx);
  });
  afterAll(async () => {
    await expectHealthyBooks(ctx);
    await ctx.close();
  });

  const onboardBody = {
    businessName: 'Lahore Books',
    category: '5942',
    registrationNumber: 'SECP-0099',
    settlementCurrency: 'PKR',
    settlementBank: { iban: 'PK36HABB0000001123456702', accountTitle: 'Lahore Books', bankName: 'HBL' },
    website: 'https://books.example.pk',
  };

  it('onboards a merchant through KYB review (MERCHANT role only)', async () => {
    const consumer = await signUp(ctx);
    await ctx.http().post('/v1/merchants').set(auth(consumer)).send(onboardBody).expect(403);

    const owner = await signUp(ctx, { role: 'MERCHANT' });
    const created = await ctx.http().post('/v1/merchants').set(auth(owner)).send(onboardBody).expect(201);
    expect(created.body).toMatchObject({
      businessName: 'Lahore Books',
      category: '5942',
      status: 'PENDING_REVIEW',
      kybTier: 'KYB_0',
      settlementCurrency: 'PKR',
      settlementDelayDays: 1,
      mdrBps: 150,
    });
    const dup = await ctx.http().post('/v1/merchants').set(auth(owner)).send(onboardBody).expect(409);
    expect(dup.body.error.code).toBe('MERCHANT_EXISTS');
    await ctx.http().post('/v1/merchants').set(auth(owner)).send({ ...onboardBody, category: '59' }).expect(400);

    // Not approved yet: no dynamic QR
    const early = await ctx.http().post('/v1/merchant/qr/dynamic').set(auth(owner)).send({ amount: '10', currency: 'PKR', expiresInSeconds: 60 }).expect(422);
    expect(early.body.error.code).toBe('MERCHANT_NOT_ACTIVE');

    const pending = await ctx.http().get('/v1/admin/merchants?status=PENDING_REVIEW&limit=100').set(auth(admin)).expect(200);
    expect(pending.body.items.map((m: { id: string }) => m.id)).toContain(created.body.id);
    await ctx.http().get('/v1/admin/merchants').set(auth(owner)).expect(403);

    const approved = await ctx.http().post(`/v1/admin/merchants/${created.body.id}/approve`).set(auth(admin)).expect(200);
    expect(approved.body).toMatchObject({ status: 'ACTIVE', kybTier: 'KYB_1' });
    const priced = await ctx
      .http()
      .put(`/v1/admin/merchants/${created.body.id}/pricing`)
      .set(auth(admin))
      .send({ mdrBps: 200, settlementDelayDays: 2 })
      .expect(200);
    expect(priced.body).toMatchObject({ mdrBps: 200, settlementDelayDays: 2 });
    await ctx.http().put(`/v1/admin/merchants/${created.body.id}/pricing`).set(auth(admin)).send({ mdrBps: 5000, settlementDelayDays: 2 }).expect(400);
    const again = await ctx.http().post(`/v1/admin/merchants/${created.body.id}/approve`).set(auth(admin)).expect(409);
    expect(again.body.error.code).toBe('INVALID_STATE_TRANSITION');
    const me = await ctx.http().get('/v1/merchant/me').set(auth(owner)).expect(200);
    expect(me.body.status).toBe('ACTIVE');
  });

  it('manages outlets (each with a signed static QR) and terminals', async () => {
    const m = await createMerchant(ctx, admin);
    const other = await createMerchant(ctx, admin);
    expect(m.staticPayload).toMatch(/^PC1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const outlets = await ctx.http().get('/v1/merchant/outlets').set(auth(m.owner)).expect(200);
    expect(outlets.body).toEqual([
      expect.objectContaining({ id: m.outletId, name: 'Main Branch', address: 'Mall Road', status: 'ACTIVE', staticQr: { qrId: expect.any(String), payload: m.staticPayload } }),
    ]);
    const t = await ctx.http().post(`/v1/merchant/outlets/${m.outletId}/terminals`).set(auth(m.owner)).send({ label: 'Till 1' }).expect(201);
    expect(t.body).toMatchObject({ label: 'Till 1', status: 'ACTIVE' });
    const list = await ctx.http().get(`/v1/merchant/outlets/${m.outletId}/terminals`).set(auth(m.owner)).expect(200);
    expect(list.body).toHaveLength(1);
    await ctx.http().get(`/v1/merchant/outlets/${m.outletId}/terminals`).set(auth(other.owner)).expect(404);

    // a dynamic QR on a terminal inherits the terminal's outlet
    const qr = await dynamicQr(ctx, m, '99.00', { terminalId: t.body.id });
    const row = await ctx.prisma.qrCode.findUniqueOrThrow({ where: { id: qr.qrId } });
    expect(row).toMatchObject({ outletId: m.outletId, terminalId: t.body.id, singleUse: true });
    await ctx.http().post('/v1/merchant/qr/dynamic').set(auth(other.owner)).send({ amount: '1', currency: 'PKR', expiresInSeconds: 60, terminalId: t.body.id }).expect(404);
    const usd = await ctx.http().post('/v1/merchant/qr/dynamic').set(auth(m.owner)).send({ amount: '1', currency: 'USD', expiresInSeconds: 60 }).expect(422);
    expect(usd.body.error.code).toBe('CURRENCY_MISMATCH');
    await ctx.http().post('/v1/merchant/qr/dynamic').set(auth(m.owner)).send({ amount: '1', currency: 'PKR', expiresInSeconds: 5 }).expect(400);
  });

  async function merchantPayment(m: TestMerchant, amount: string, reference = 'ORDER-1') {
    const payer = await fundedUser(ctx, { amount: '5000', fullName: 'Zainab Ali' });
    const qr = await dynamicQr(ctx, m, amount, { reference });
    const paid = await scanAndPay(ctx, payer.user, payer.wallet, qr.payload);
    return { payer, payment: paid.body as { id: string } };
  }

  const refund = (m: TestMerchant, paymentId: string, body: Record<string, unknown>, key = idemKey()) =>
    ctx.http().post(`/v1/merchant/payments/${paymentId}/refunds`).set(auth(m.owner)).set('Idempotency-Key', key).send(body);

  it('lists merchant payments with MDR, net and refunds', async () => {
    const m = await createMerchant(ctx, admin);
    const { payment } = await merchantPayment(m, '400.00', 'INV-777');
    await merchantPayment(m, '100.00', 'INV-778');
    const page = await ctx.http().get('/v1/merchant/payments?limit=1').set(auth(m.owner)).expect(200);
    expect(page.body.items).toHaveLength(1);
    expect(page.body.nextCursor).toBeTruthy();
    const found = await ctx.http().get('/v1/merchant/payments?q=inv-777').set(auth(m.owner)).expect(200);
    expect(found.body.items).toHaveLength(1);
    expect(found.body.items[0]).toMatchObject({
      id: payment.id,
      reference: 'INV-777',
      amount: { amount: '400.00' },
      mdrFee: { amount: '6.00' },
      net: { amount: '394.00' },
      refundedAmount: { amount: '0.00' },
      payer: { displayName: 'Zainab A.' },
    });
    const detail = await ctx.http().get(`/v1/merchant/payments/${payment.id}`).set(auth(m.owner)).expect(200);
    expect(detail.body.status).toBe('COMPLETED');
    const byStatus = await ctx.http().get('/v1/merchant/payments?status=REFUNDED').set(auth(m.owner)).expect(200);
    expect(byStatus.body.items).toHaveLength(0);
    // the merchant owner may also read it through the unified endpoint
    await ctx.http().get(`/v1/payments/${payment.id}`).set(auth(m.owner)).expect(200);
    const outsider = await createMerchant(ctx, admin);
    await ctx.http().get(`/v1/merchant/payments/${payment.id}`).set(auth(outsider.owner)).expect(404);
  });

  it('refunds partially then fully; cumulative refunds can never exceed the payment', async () => {
    const m = await createMerchant(ctx, admin);
    const { payer, payment } = await merchantPayment(m, '250.00');
    const payerBefore = await balanceOf(ctx, payer.wallet);
    const feeBefore = (await systemAccount(ctx, 'FEE_REVENUE.PKR')).balance;

    const r1 = await refund(m, payment.id, { amount: '100.00', reason: 'one item returned' }).expect(201);
    expect(r1.body).toMatchObject({ paymentId: payment.id, amount: { amount: '100.00' }, status: 'COMPLETED', reason: 'one item returned' });
    const p1 = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p1).toMatchObject({ status: 'PARTIALLY_REFUNDED', refundedAmount: 10000n });

    const over = await refund(m, payment.id, { amount: '150.01', reason: 'too much' }).expect(422);
    expect(over.body.error).toMatchObject({ code: 'REFUND_EXCEEDS_PAYMENT', details: { refundable: { amount: '150.00' } } });

    const r2 = await refund(m, payment.id, { reason: 'rest of the order' }).expect(201); // default: full remainder
    expect(r2.body.amount.amount).toBe('150.00');
    const p2 = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p2).toMatchObject({ status: 'REFUNDED', refundedAmount: 25000n });
    expect((p2.timeline as Array<{ status: string }>).map((t) => t.status)).toEqual([
      'CREATED',
      'PROCESSING',
      'COMPLETED',
      'PARTIALLY_REFUNDED',
      'REFUNDED',
    ]);
    const none = await refund(m, payment.id, { amount: '0.01', reason: 'again' }).expect(422);
    expect(none.body.error.code).toBe('PAYMENT_NOT_REFUNDABLE');

    // consumer got everything back; the full MDR (3.75) went back to the merchant side
    expect(await balanceOf(ctx, payer.wallet)).toBe(payerBefore + 25000n);
    const refunds = await ctx.prisma.refund.findMany({ where: { paymentId: payment.id } });
    expect(refunds.reduce((s, r) => s + r.mdrRefund, 0n)).toBe(375n);
    expect((await systemAccount(ctx, 'FEE_REVENUE.PKR')).balance - feeBefore).toBe(-375n);
    const payable = await ctx.prisma.ledgerAccount.findUniqueOrThrow({ where: { id: m.ledgerAccountId } });
    expect(payable.balance).toBe(0n);

    // the consumer sees the refund as a REFUND payment from the merchant
    const refundPayment = await ctx.prisma.payment.findFirstOrThrow({ where: { originalPaymentId: payment.id, type: 'REFUND' } });
    const view = await ctx.http().get(`/v1/payments/${refundPayment.id}`).set(auth(payer.user)).expect(200);
    expect(view.body).toMatchObject({ type: 'REFUND', payer: { type: 'MERCHANT', merchantId: m.merchantId }, payee: { type: 'USER' } });
  });

  it('replays a refund for the same Idempotency-Key and rejects a different body', async () => {
    const m = await createMerchant(ctx, admin);
    const { payment } = await merchantPayment(m, '50.00');
    const key = idemKey();
    const a = await refund(m, payment.id, { amount: '10.00', reason: 'damaged' }, key).expect(201);
    await ctx.prisma.idempotencyRecord.deleteMany({ where: { key } }); // lost record: business key still dedupes
    const b = await refund(m, payment.id, { amount: '10.00', reason: 'damaged' }, key).expect(201);
    expect(b.body.id).toBe(a.body.id);
    const c = await refund(m, payment.id, { amount: '11.00', reason: 'damaged' }, key).expect(422);
    expect(c.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await ctx.prisma.refund.count({ where: { paymentId: payment.id } })).toBe(1);
  });

  it('concurrent partial refunds never exceed the original amount', async () => {
    const m = await createMerchant(ctx, admin);
    const { payer, payment } = await merchantPayment(m, '250.00');
    const before = await balanceOf(ctx, payer.wallet);
    const results = await Promise.all(Array.from({ length: 6 }, () => refund(m, payment.id, { amount: '100.00', reason: 'parallel' })));
    const ok = results.filter((r) => r.status === 201);
    expect(ok).toHaveLength(2);
    results.filter((r) => r.status !== 201).forEach((r) => expect(r.body.error.code).toBe('REFUND_EXCEEDS_PAYMENT'));
    const p = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p).toMatchObject({ refundedAmount: 20000n, status: 'PARTIALLY_REFUNDED' });
    expect(await balanceOf(ctx, payer.wallet)).toBe(before + 20000n);
  });

  it('shows a dashboard with today, pending settlement and a 14-day series', async () => {
    const m = await createMerchant(ctx, admin);
    const { payment } = await merchantPayment(m, '300.00');
    await merchantPayment(m, '200.00');
    await refund(m, payment.id, { amount: '50.00', reason: 'discount' }).expect(201);
    const res = await ctx.http().get('/v1/merchant/dashboard?currency=PKR').set(auth(m.owner)).expect(200);
    expect(res.body.today).toMatchObject({ volume: { amount: '500.00' }, count: 2, refunds: { amount: '50.00' } });
    const payable = await ctx.prisma.ledgerAccount.findUniqueOrThrow({ where: { id: m.ledgerAccountId } });
    expect(res.body.pendingSettlement.amountMinor).toBe(payable.balance.toString());
    expect(res.body.series).toHaveLength(14);
    expect(res.body.series[13]).toMatchObject({ date: new Date().toISOString().slice(0, 10), count: 2 });
    expect(res.body.lastSettlement).toBeNull();
    await ctx.http().get('/v1/merchant/dashboard?currency=USD').set(auth(m.owner)).expect(422);
  });
});
