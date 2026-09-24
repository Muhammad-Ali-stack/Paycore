import { PaymentRequestsService } from '../../src/modules/transfers/payment-requests.service';
import { TestContext, TestUser, auth, balanceOf, createTestApp, idemKey, openWallet, signUp } from './helpers/app';
import { expectHealthyBooks, fundedUser } from './helpers/phase2';

describe('Payment requests (integration)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await expectHealthyBooks(ctx);
    await ctx.close();
  });

  async function pair() {
    const requester = await signUp(ctx, { tier: 'TIER_2', fullName: 'Sara Ahmed' });
    const requesterWallet = await openWallet(ctx, requester, 'PKR');
    const { user: payer, wallet: payerWallet } = await fundedUser(ctx, { amount: '5000', fullName: 'Omar Farooq' });
    return { requester, requesterWallet, payer, payerWallet };
  }

  const request = (from: TestUser, to: TestUser, amount = '1200', extra: Record<string, unknown> = {}) =>
    ctx.http().post('/v1/payment-requests').set(auth(from)).send({ to: { phone: to.phone }, amount, currency: 'PKR', note: 'dinner', ...extra });

  const accept = (payer: TestUser, id: string, walletId: string, key = idemKey()) =>
    ctx.http().post(`/v1/payment-requests/${id}/accept`).set(auth(payer)).set('Idempotency-Key', key).send({ fromWalletId: walletId, pin: payer.pin });

  it('creates, lists and accepts a request (payer pays the requester)', async () => {
    const { requester, requesterWallet, payer, payerWallet } = await pair();
    const created = await request(requester, payer).expect(201);
    expect(created.body).toMatchObject({
      status: 'PENDING',
      amount: { currency: 'PKR', amount: '1200.00' },
      note: 'dinner',
      requester: { type: 'USER', displayName: 'Sara A.' },
      payer: { type: 'USER', displayName: 'Omar F.' },
      paymentId: null,
    });

    const incoming = await ctx.http().get('/v1/payment-requests?direction=INCOMING&status=PENDING').set(auth(payer)).expect(200);
    expect(incoming.body.items.map((r: { id: string }) => r.id)).toContain(created.body.id);
    const outgoing = await ctx.http().get('/v1/payment-requests?direction=OUTGOING').set(auth(requester)).expect(200);
    expect(outgoing.body.items[0].id).toBe(created.body.id);

    const paid = await accept(payer, created.body.id, payerWallet).expect(201);
    expect(paid.body).toMatchObject({ type: 'REQUEST', status: 'COMPLETED', amount: { amount: '1200.00' }, reference: 'dinner' });
    expect(await balanceOf(ctx, payerWallet)).toBe(500000n - 120000n);
    expect(await balanceOf(ctx, requesterWallet)).toBe(120000n);

    const after = await ctx.http().get('/v1/payment-requests?direction=OUTGOING&status=ACCEPTED').set(auth(requester)).expect(200);
    expect(after.body.items[0]).toMatchObject({ id: created.body.id, status: 'ACCEPTED', paymentId: paid.body.id });
    const again = await accept(payer, created.body.id, payerWallet).expect(409);
    expect(again.body.error.code).toBe('PAYMENT_REQUEST_NOT_PENDING');
  });

  it('lets the payer decline and the requester cancel; only parties can act', async () => {
    const { requester, payer, payerWallet } = await pair();
    const outsider = await signUp(ctx);
    const r1 = await request(requester, payer).expect(201);
    await ctx.http().post(`/v1/payment-requests/${r1.body.id}/decline`).set(auth(requester)).expect(404);
    await ctx.http().post(`/v1/payment-requests/${r1.body.id}/decline`).set(auth(outsider)).expect(404);
    const declined = await ctx.http().post(`/v1/payment-requests/${r1.body.id}/decline`).set(auth(payer)).expect(200);
    expect(declined.body.status).toBe('DECLINED');
    const late = await accept(payer, r1.body.id, payerWallet).expect(409);
    expect(late.body.error.code).toBe('PAYMENT_REQUEST_NOT_PENDING');

    const r2 = await request(requester, payer).expect(201);
    await ctx.http().post(`/v1/payment-requests/${r2.body.id}/cancel`).set(auth(payer)).expect(404);
    const cancelled = await ctx.http().post(`/v1/payment-requests/${r2.body.id}/cancel`).set(auth(requester)).expect(200);
    expect(cancelled.body.status).toBe('CANCELLED');
    await ctx.http().post(`/v1/payment-requests/${r2.body.id}/decline`).set(auth(payer)).expect(409);
    await accept(outsider, r2.body.id, payerWallet).expect(404);
  });

  it('expires requests (lazily on read and by the expiry job) and refuses to pay them', async () => {
    const { requester, payer, payerWallet } = await pair();
    const created = await request(requester, payer, '100', { expiresInHours: 1 }).expect(201);
    expect(new Date(created.body.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(3600_000);
    await ctx.prisma.paymentRequest.update({ where: { id: created.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const listed = await ctx.http().get('/v1/payment-requests?direction=INCOMING&status=EXPIRED').set(auth(payer)).expect(200);
    expect(listed.body.items.map((r: { id: string; status: string }) => [r.id, r.status])).toContainEqual([created.body.id, 'EXPIRED']);
    const res = await accept(payer, created.body.id, payerWallet).expect(422);
    expect(res.body.error.code).toBe('PAYMENT_REQUEST_EXPIRED');

    expect(await ctx.app.get(PaymentRequestsService).expireDue()).toBeGreaterThanOrEqual(1);
    const row = await ctx.prisma.paymentRequest.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row.status).toBe('EXPIRED');
    expect((row.timeline as Array<{ status: string }>).map((t) => t.status)).toEqual(['PENDING', 'EXPIRED']);
    expect(await balanceOf(ctx, payerWallet)).toBe(500000n);
  });

  it('requires a wallet in the request currency on both sides', async () => {
    const { requester, payer } = await pair();
    const noUsd = await request(requester, payer, '10', { currency: 'USD' }).expect(404);
    expect(noUsd.body.error.message).toMatch(/USD wallet/);
    const usdWallet = await openWallet(ctx, payer, 'USD').catch(() => null);
    const created = await request(requester, payer).expect(201);
    if (usdWallet) {
      const mismatch = await accept(payer, created.body.id, usdWallet).expect(422);
      expect(mismatch.body.error.code).toBe('CURRENCY_MISMATCH');
    }
    const self = await ctx.http().post('/v1/payment-requests').set(auth(requester)).send({ to: { phone: requester.phone }, amount: '1', currency: 'PKR' }).expect(422);
    expect(self.body.error.code).toBe('SELF_TRANSFER');
  });

  it('accepts the same request exactly once under concurrent accepts', async () => {
    const { requester, requesterWallet, payer, payerWallet } = await pair();
    const created = await request(requester, payer, '700').expect(201);
    const results = await Promise.all(Array.from({ length: 8 }, () => accept(payer, created.body.id, payerWallet)));
    const ok = results.filter((r) => r.status === 201);
    expect(ok).toHaveLength(1);
    results.filter((r) => r.status !== 201).forEach((r) => expect(r.body.error.code).toBe('PAYMENT_REQUEST_NOT_PENDING'));
    expect(await balanceOf(ctx, payerWallet)).toBe(500000n - 70000n);
    expect(await balanceOf(ctx, requesterWallet)).toBe(70000n);
    const completed = await ctx.prisma.payment.count({ where: { paymentRequestId: created.body.id, status: 'COMPLETED' } });
    expect(completed).toBe(1);
  });
});
