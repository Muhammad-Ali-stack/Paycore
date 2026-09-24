import { TestContext, TestUser, auth, balanceOf, createAdmin, createTestApp, idemKey, openWallet, signUp } from './helpers/app';
import { TestMerchant, createMerchant, dynamicQr, expectHealthyBooks, fundedUser, payQr, resolveQr, scanAndPay, systemAccount } from './helpers/phase2';

const tamper = (payload: string, mutate: (claims: Record<string, unknown>) => void): string => {
  const [prefix, body, sig] = payload.split('.') as [string, string, string];
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>;
  mutate(claims);
  return `${prefix}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${sig}`;
};

/** Change the first signature character (the last one may only carry base64 padding bits). */
const flipSignature = (payload: string): string => {
  const [prefix, body, sig] = payload.split('.') as [string, string, string];
  return `${prefix}.${body}.${sig[0] === 'A' ? 'B' : 'A'}${sig.slice(1)}`;
};

describe('QR payments (integration)', () => {
  let ctx: TestContext;
  let admin: TestUser;
  let merchant: TestMerchant;
  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await createAdmin(ctx);
    merchant = await createMerchant(ctx, admin, { name: 'Karachi Chai' }); // MDR 1.5% (default)
  });
  afterAll(async () => {
    await expectHealthyBooks(ctx);
    await ctx.close();
  });

  const payableBalance = async () => (await ctx.prisma.ledgerAccount.findUniqueOrThrow({ where: { id: merchant.ledgerAccountId } })).balance;

  it('pays a static merchant QR: resolve -> preview -> pay with PIN, MDR to fee revenue', async () => {
    const { user, wallet } = await fundedUser(ctx, { amount: '2000' });
    const feeBefore = (await systemAccount(ctx, 'FEE_REVENUE.PKR')).balance;
    const payableBefore = await payableBalance();

    const preview = await resolveQr(ctx, user, merchant.staticPayload).expect(200);
    expect(preview.body).toMatchObject({
      kind: 'STATIC_MERCHANT',
      payee: { type: 'MERCHANT', displayName: 'Karachi Chai', merchantId: merchant.merchantId, outletName: 'Main Branch' },
      amount: null,
      currency: 'PKR',
      fee: null,
      expiresAt: null,
    });
    expect(preview.body.previewToken).toMatch(/^PV1\./);

    const missing = await payQr(ctx, user, wallet, preview.body.previewToken).expect(400);
    expect(missing.body.error.code).toBe('VALIDATION_FAILED');
    const paid = await payQr(ctx, user, wallet, preview.body.previewToken, { amount: '1000.00' }).expect(201);
    expect(paid.body).toMatchObject({
      type: 'QR_MERCHANT',
      status: 'COMPLETED',
      amount: { amount: '1000.00' },
      fee: { amount: '0.00' },
      payee: { type: 'MERCHANT', merchantId: merchant.merchantId, outletName: 'Main Branch' },
    });
    expect(await balanceOf(ctx, wallet)).toBe(200000n - 100000n);
    expect((await payableBalance()) - payableBefore).toBe(100000n - 1500n);
    expect((await systemAccount(ctx, 'FEE_REVENUE.PKR')).balance - feeBefore).toBe(1500n);

    // a preview token is single use: replaying it with a new Idempotency-Key is refused by the DB
    const replay = await payQr(ctx, user, wallet, preview.body.previewToken, { amount: '1000.00' }).expect(409);
    expect(replay.body.error.code).toBe('QR_PREVIEW_USED');
    // ...but a static QR is reusable after a fresh scan
    await scanAndPay(ctx, user, wallet, merchant.staticPayload, '50');
  });

  it('rejects tampered, forged and foreign payloads and binds previews to the payer', async () => {
    const { user, wallet } = await fundedUser(ctx, { amount: '500' });
    const other = await fundedUser(ctx, { amount: '500' });
    const qr = await dynamicQr(ctx, merchant, '100.00');

    for (const bad of [
      tamper(qr.payload, (c) => (c.amt = '1')), // cheaper amount
      tamper(qr.payload, (c) => (c.qid = merchant.outletId)), // another code
      flipSignature(qr.payload), // signature altered
      'PC1.eyJ9.abc',
      'not-a-qr-code',
      `PC2.${qr.payload.slice(4)}`,
    ]) {
      const res = await resolveQr(ctx, user, bad);
      expect([400]).toContain(res.status);
      expect(res.body.error.code).toMatch(/QR_INVALID|VALIDATION_FAILED/);
    }

    const preview = await resolveQr(ctx, user, qr.payload).expect(200);
    expect(preview.body).toMatchObject({ kind: 'DYNAMIC_MERCHANT', amount: { amount: '100.00' }, fee: { amount: '0.00' } });
    const stolen = await payQr(ctx, other.user, other.wallet, preview.body.previewToken).expect(400);
    expect(stolen.body.error.code).toBe('QR_PREVIEW_INVALID');
    const forgedPreview = tamper(preview.body.previewToken, (c) => (c.amt = '1'));
    const forged = await payQr(ctx, user, wallet, forgedPreview).expect(400);
    expect(forged.body.error.code).toBe('QR_PREVIEW_INVALID');
    const wrongAmount = await payQr(ctx, user, wallet, preview.body.previewToken, { amount: '99.99' }).expect(400);
    expect(wrongAmount.body.error.code).toBe('VALIDATION_FAILED');
    const usd = await openWallet(ctx, user, 'USD');
    const mismatch = await payQr(ctx, user, usd, preview.body.previewToken).expect(422);
    expect(mismatch.body.error.code).toBe('CURRENCY_MISMATCH');
    expect(await balanceOf(ctx, wallet)).toBe(50000n);
  });

  it('dynamic QRs are single use and expire; the cashier polls the status', async () => {
    const a = await fundedUser(ctx, { amount: '1000' });
    const b = await fundedUser(ctx, { amount: '1000' });
    const qr = await dynamicQr(ctx, merchant, '250.00', { reference: 'INV-1001' });
    const poll1 = await ctx.http().get(`/v1/merchant/qr/${qr.qrId}`).set(auth(merchant.owner)).expect(200);
    expect(poll1.body).toMatchObject({ status: 'ACTIVE', amount: { amount: '250.00' }, reference: 'INV-1001', paymentId: null });

    const paid = await scanAndPay(ctx, a.user, a.wallet, qr.payload);
    expect(paid.body.reference).toBe('INV-1001');
    const poll2 = await ctx.http().get(`/v1/merchant/qr/${qr.qrId}`).set(auth(merchant.owner)).expect(200);
    expect(poll2.body).toMatchObject({ status: 'PAID', paymentId: paid.body.id });

    const second = await resolveQr(ctx, b.user, qr.payload).expect(409);
    expect(second.body.error.code).toBe('QR_ALREADY_PAID');

    const expiring = await dynamicQr(ctx, merchant, '10.00');
    await ctx.prisma.qrCode.update({ where: { id: expiring.qrId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await resolveQr(ctx, b.user, expiring.payload).expect(422);
    expect(expired.body.error.code).toBe('QR_EXPIRED');
    const poll3 = await ctx.http().get(`/v1/merchant/qr/${expiring.qrId}`).set(auth(merchant.owner)).expect(200);
    expect(poll3.body.status).toBe('EXPIRED');
    await ctx.http().get(`/v1/merchant/qr/${expiring.qrId}`).set(auth(a.user)).expect(403);
  });

  it('a preview that outlives its QR cannot pay it (expiry is re-checked in the money transaction)', async () => {
    const a = await fundedUser(ctx, { amount: '100' });
    const qr = await dynamicQr(ctx, merchant, '10.00');
    const preview = await resolveQr(ctx, a.user, qr.payload).expect(200);
    await ctx.prisma.qrCode.update({ where: { id: qr.qrId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await payQr(ctx, a.user, a.wallet, preview.body.previewToken).expect(422);
    expect(res.body.error.code).toBe('QR_EXPIRED');
    expect(await balanceOf(ctx, a.wallet)).toBe(10000n);
  });

  it('concurrent double-pay of one dynamic QR succeeds exactly once', async () => {
    const payers = await Promise.all(Array.from({ length: 6 }, () => fundedUser(ctx, { amount: '1000' })));
    const qr = await dynamicQr(ctx, merchant, '300.00');
    const previews = await Promise.all(payers.map((p) => resolveQr(ctx, p.user, qr.payload).expect(200)));
    const payableBefore = await payableBalance();

    const results = await Promise.all(payers.map((p, i) => payQr(ctx, p.user, p.wallet, previews[i]!.body.previewToken)));
    const ok = results.filter((r) => r.status === 201);
    expect(ok).toHaveLength(1);
    results.filter((r) => r.status !== 201).forEach((r) => expect(r.body.error.code).toBe('QR_ALREADY_PAID'));
    expect((await payableBalance()) - payableBefore).toBe(30000n - 450n);
    expect(await ctx.prisma.payment.count({ where: { qrCodeId: qr.qrId, status: 'COMPLETED' } })).toBe(1);
    const balances = await Promise.all(payers.map((p) => balanceOf(ctx, p.wallet)));
    expect(balances.filter((b) => b === 100000n - 30000n)).toHaveLength(1);
    expect(balances.filter((b) => b === 100000n)).toHaveLength(5);
  });

  it('consumer "My QR": fixed amount is single use; open amount is reusable', async () => {
    const receiver = await signUp(ctx, { tier: 'TIER_1', fullName: 'Hina Baig' });
    const rw = await openWallet(ctx, receiver, 'PKR');
    const payer = await fundedUser(ctx, { amount: '1000' });

    const fixed = await ctx.http().post('/v1/qr/receive').set(auth(receiver)).send({ currency: 'PKR', amount: '75.00' }).expect(201);
    expect(fixed.body.expiresAt).not.toBeNull();
    const preview = await resolveQr(ctx, payer.user, fixed.body.payload).expect(200);
    expect(preview.body).toMatchObject({ kind: 'P2P_RECEIVE', payee: { type: 'USER', displayName: 'Hina B.' }, amount: { amount: '75.00' } });
    const paid = await payQr(ctx, payer.user, payer.wallet, preview.body.previewToken).expect(201);
    expect(paid.body.type).toBe('QR_P2P');
    await resolveQr(ctx, payer.user, fixed.body.payload).expect(409);

    const open = await ctx.http().post('/v1/qr/receive').set(auth(receiver)).send({ currency: 'PKR' }).expect(201);
    expect(open.body.expiresAt).toBeNull();
    await scanAndPay(ctx, payer.user, payer.wallet, open.body.payload, '10');
    await scanAndPay(ctx, payer.user, payer.wallet, open.body.payload, '15');
    expect(await balanceOf(ctx, rw)).toBe(7500n + 1000n + 1500n);

    const own = await resolveQr(ctx, receiver, open.body.payload).expect(422);
    expect(own.body.error.code).toBe('SELF_TRANSFER');
    await ctx.http().post('/v1/qr/receive').set(auth(receiver)).send({ currency: 'AED' }).expect(404);
  });

  it('a suspended merchant cannot be paid', async () => {
    const m2 = await createMerchant(ctx, admin, { name: 'Soon Suspended' });
    const payer = await fundedUser(ctx, { amount: '100' });
    const preview = await resolveQr(ctx, payer.user, m2.staticPayload).expect(200);
    await ctx.http().post(`/v1/admin/merchants/${m2.merchantId}/suspend`).set(auth(admin)).expect(200);
    const res = await resolveQr(ctx, payer.user, m2.staticPayload).expect(422);
    expect(res.body.error.code).toBe('MERCHANT_NOT_ACTIVE');
    const pay = await payQr(ctx, payer.user, payer.wallet, preview.body.previewToken, { amount: '5', key: idemKey() }).expect(422);
    expect(pay.body.error.code).toBe('MERCHANT_NOT_ACTIVE');
  });
});
