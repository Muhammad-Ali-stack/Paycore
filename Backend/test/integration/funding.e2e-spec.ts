import { randomUUID } from 'node:crypto';
import { OutboxRelay } from '../../src/common/outbox/outbox.service';
import { FundingService } from '../../src/modules/funding/funding.service';
import { ReconciliationService } from '../../src/modules/funding/reconciliation.service';
import { TestContext, TestUser, auth, balanceOf, createAdmin, createTestApp, idemKey, openWallet, signUp } from './helpers/app';
import { drainOutbox, expectHealthyBooks, fundedUser, postWebhook, signedWebhook, systemAccount } from './helpers/phase2';

const today = () => new Date().toISOString().slice(0, 10);
const bankAccount = { iban: 'PK36UNIL0000001123456702', accountTitle: 'Test User', bankName: 'UBL' };

describe('Funding: top-ups, withdrawals, webhooks, reconciliation (integration)', () => {
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

  const topup = (user: TestUser, walletId: string, amount: string, method = 'BANK_TRANSFER', key = idemKey()) =>
    ctx.http().post('/v1/funding/topups').set(auth(user)).set('Idempotency-Key', key).send({ walletId, amount, method });
  const withdraw = (user: TestUser, walletId: string, amount: string, key = idemKey()) =>
    ctx.http().post('/v1/funding/withdrawals').set(auth(user)).set('Idempotency-Key', key).send({ walletId, amount, bankAccount, pin: user.pin });
  const simulate = (user: TestUser, fundingId: string, outcome: string, extra: Record<string, unknown> = {}) =>
    ctx.http().post('/v1/dev/bank/simulate').set(auth(user)).send({ fundingId, outcome, ...extra });
  const funding = (id: string) => ctx.prisma.fundingTransaction.findUniqueOrThrow({ where: { id } });
  const event = (reference: string, type: string, extra: Record<string, unknown> = {}) => ({
    id: `evt_${randomUUID()}`,
    type,
    createdAt: new Date().toISOString(),
    data: { reference, ...extra },
  });

  it('top-up by bank transfer: PENDING with instructions, credited only on SUCCEEDED', async () => {
    const user = await signUp(ctx, { tier: 'TIER_1' });
    const w = await openWallet(ctx, user, 'PKR');
    const key = idemKey();
    const res = await topup(user, w, '5000', 'BANK_TRANSFER', key).expect(201);
    expect(res.body).toMatchObject({
      direction: 'TOPUP',
      method: 'BANK_TRANSFER',
      status: 'PENDING',
      walletId: w,
      amount: { amount: '5000.00' },
      fee: { amount: '0.00' },
      instructions: { iban: expect.any(String), accountTitle: expect.any(String), bankName: expect.any(String), reference: res.body.bankReference },
      failureReason: null,
      timeline: [expect.objectContaining({ status: 'PENDING' })],
    });
    expect(await balanceOf(ctx, w)).toBe(0n);
    const replay = await topup(user, w, '5000', 'BANK_TRANSFER', key).expect(201);
    expect(replay.body.id).toBe(res.body.id);

    const sim = await simulate(user, res.body.id, 'SUCCEEDED').expect(200);
    expect(sim.body).toMatchObject({ delivered: true, receipt: { outcome: 'APPLIED', duplicate: false } });
    expect(await balanceOf(ctx, w)).toBe(500000n);
    const got = await ctx.http().get(`/v1/funding/transactions/${res.body.id}`).set(auth(user)).expect(200);
    expect(got.body.status).toBe('SUCCEEDED');
    expect(got.body.timeline.map((t: { status: string }) => t.status)).toEqual(['PENDING', 'SUCCEEDED']);
    const list = await ctx.http().get('/v1/funding/transactions?status=SUCCEEDED').set(auth(user)).expect(200);
    expect(list.body.items.map((i: { id: string }) => i.id)).toEqual([res.body.id]);
    const other = await signUp(ctx);
    await ctx.http().get(`/v1/funding/transactions/${res.body.id}`).set(auth(other)).expect(404);
    await simulate(other, res.body.id, 'FAILED').expect(404);
  });

  it('card top-ups pay a 1.5% fee, deducted from the credited amount', async () => {
    const user = await signUp(ctx, { tier: 'TIER_1' });
    const w = await openWallet(ctx, user, 'PKR');
    const feeBefore = (await systemAccount(ctx, 'FEE_REVENUE.PKR')).balance;
    const res = await topup(user, w, '1000', 'CARD').expect(201);
    expect(res.body).toMatchObject({ fee: { amount: '15.00' }, instructions: null });
    await simulate(user, res.body.id, 'SUCCEEDED').expect(200);
    expect(await balanceOf(ctx, w)).toBe(98500n);
    expect((await systemAccount(ctx, 'FEE_REVENUE.PKR')).balance - feeBefore).toBe(1500n);
  });

  it('withdrawal: holds funds immediately, pays out on SUCCEEDED, restores on FAILED', async () => {
    const { user, wallet } = await fundedUser(ctx, { amount: '10000' });
    const inFlightBefore = (await systemAccount(ctx, 'FUNDS_IN_FLIGHT.PKR')).balance;
    const w1 = await withdraw(user, wallet, '2000').expect(201);
    expect(w1.body).toMatchObject({ direction: 'WITHDRAWAL', status: 'PENDING', fee: { amount: '10.00' } }); // min fee 10
    expect(await balanceOf(ctx, wallet)).toBe(1000000n - 201000n);
    expect((await systemAccount(ctx, 'FUNDS_IN_FLIGHT.PKR')).balance - inFlightBefore).toBe(201000n);

    await drainOutbox(ctx); // worker submits the payout to the bank
    expect((await funding(w1.body.id)).submittedAt).not.toBeNull();
    await simulate(user, w1.body.id, 'SUCCEEDED').expect(200);
    expect((await funding(w1.body.id)).status).toBe('SUCCEEDED');
    expect((await systemAccount(ctx, 'FUNDS_IN_FLIGHT.PKR')).balance).toBe(inFlightBefore);

    const w2 = await withdraw(user, wallet, '1000').expect(201);
    await simulate(user, w2.body.id, 'FAILED').expect(200);
    const failed = await funding(w2.body.id);
    expect(failed).toMatchObject({ status: 'FAILED', failureReason: 'Rejected by the beneficiary bank' });
    expect(await balanceOf(ctx, wallet)).toBe(1000000n - 201000n);

    const over = await withdraw(user, wallet, '9000').expect(422);
    expect(over.body.error.code).toBe('INSUFFICIENT_FUNDS');
    expect(await ctx.prisma.fundingTransaction.count({ where: { userId: user.id } })).toBe(2);
  });

  it('a returned payout (REVERSED after SUCCEEDED) gives the customer everything back, fee included', async () => {
    const { user, wallet } = await fundedUser(ctx, { amount: '5000' });
    const res = await withdraw(user, wallet, '3000').expect(201);
    await simulate(user, res.body.id, 'SUCCEEDED').expect(200);
    expect(await balanceOf(ctx, wallet)).toBe(500000n - 301000n); // 0.1% = 3.00, raised to the 10.00 minimum
    await simulate(user, res.body.id, 'REVERSED').expect(200);
    const f = await funding(res.body.id);
    expect(f.status).toBe('REVERSED');
    expect((f.timeline as Array<{ status: string }>).map((t) => t.status)).toEqual(['PENDING', 'SUCCEEDED', 'REVERSED']);
    expect(await balanceOf(ctx, wallet)).toBe(500000n);
  });

  describe('webhook security and delivery semantics', () => {
    it('rejects missing, forged and stale signatures', async () => {
      const user = await signUp(ctx, { tier: 'TIER_1' });
      const w = await openWallet(ctx, user, 'PKR');
      const t = await topup(user, w, '100').expect(201);
      const ev = event(t.body.bankReference, 'transaction.succeeded', { amountMinor: '10000' });

      const none = await ctx.http().post('/v1/webhooks/bank').set('Content-Type', 'application/json').send(JSON.stringify(ev)).expect(401);
      expect(none.body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
      await postWebhook(ctx, ev, { secret: 'a-completely-different-secret-value-1234' }).expect(401);
      const stale = await postWebhook(ctx, ev, { at: new Date(Date.now() - 10 * 60_000) }).expect(401);
      expect(stale.body.error.details.reason).toBe('TIMESTAMP');
      const future = await postWebhook(ctx, ev, { at: new Date(Date.now() + 10 * 60_000) }).expect(401);
      expect(future.body.error.details.reason).toBe('TIMESTAMP');
      // body tampered after signing
      const { body, signature } = signedWebhook(ev);
      await ctx
        .http()
        .post('/v1/webhooks/bank')
        .set('Content-Type', 'application/json')
        .set('X-PayCore-Signature', signature)
        .send(body.replace('10000', '99999'))
        .expect(401);
      expect(await balanceOf(ctx, w)).toBe(0n);

      const ok = await postWebhook(ctx, ev).expect(200);
      expect(ok.body).toEqual({ received: true, duplicate: false, outcome: 'APPLIED' });
      expect(await balanceOf(ctx, w)).toBe(10000n);
    });

    it('applies duplicate deliveries once (sequential and concurrent)', async () => {
      const user = await signUp(ctx, { tier: 'TIER_1' });
      const w = await openWallet(ctx, user, 'PKR');
      const t = await topup(user, w, '700').expect(201);
      const ev = event(t.body.bankReference, 'transaction.succeeded', { amountMinor: '70000' });
      const results = await Promise.all(Array.from({ length: 6 }, () => postWebhook(ctx, ev)));
      results.forEach((r) => expect(r.status).toBe(200));
      expect(results.filter((r) => r.body.duplicate === false)).toHaveLength(1);
      const again = await postWebhook(ctx, ev).expect(200);
      expect(again.body).toEqual({ received: true, duplicate: true, outcome: 'DUPLICATE' });
      expect(await balanceOf(ctx, w)).toBe(70000n);
      expect(await ctx.prisma.bankWebhookEvent.count({ where: { id: ev.id } })).toBe(1);

      // the same outcome under a NEW event id (bank re-sent it) is recorded and ignored
      const resent = await postWebhook(ctx, event(t.body.bankReference, 'transaction.succeeded', { amountMinor: '70000' })).expect(200);
      expect(resent.body.outcome).toBe('IGNORED');
      expect(await balanceOf(ctx, w)).toBe(70000n);
    });

    it('never applies SUCCEEDED blindly after FAILED: it is flagged for review', async () => {
      const { user, wallet } = await fundedUser(ctx, { amount: '1000' });
      const res = await withdraw(user, wallet, '500').expect(201);
      await postWebhook(ctx, event(res.body.bankReference, 'transaction.failed', { reason: 'account closed' })).expect(200);
      expect(await balanceOf(ctx, wallet)).toBe(100000n);
      const late = await postWebhook(ctx, event(res.body.bankReference, 'transaction.succeeded', { amountMinor: '50000' })).expect(200);
      expect(late.body.outcome).toBe('FLAGGED');
      const f = await funding(res.body.id);
      expect(f).toMatchObject({ status: 'FAILED', failureReason: 'account closed', needsReview: true });
      expect(f.reviewReason).toMatch(/SUCCEEDED received after FAILED/);
      expect(await balanceOf(ctx, wallet)).toBe(100000n);
    });

    it('defers a REVERSED that overtakes its SUCCEEDED, then compensates when SUCCEEDED lands', async () => {
      const user = await signUp(ctx, { tier: 'TIER_1' });
      const w = await openWallet(ctx, user, 'PKR');
      const t = await topup(user, w, '300').expect(201);
      const reversed = await postWebhook(ctx, event(t.body.bankReference, 'transaction.reversed')).expect(200);
      expect(reversed.body.outcome).toBe('DEFERRED');
      expect((await funding(t.body.id)).status).toBe('PENDING');
      const succeeded = await postWebhook(ctx, event(t.body.bankReference, 'transaction.succeeded', { amountMinor: '30000' })).expect(200);
      expect(succeeded.body.outcome).toBe('APPLIED');
      const f = await funding(t.body.id);
      expect(f.status).toBe('REVERSED');
      expect((f.timeline as Array<{ status: string }>).map((x) => x.status)).toEqual(['PENDING', 'SUCCEEDED', 'REVERSED']);
      expect(await balanceOf(ctx, w)).toBe(0n);
      const events = await ctx.prisma.bankWebhookEvent.findMany({ where: { bankReference: t.body.bankReference } });
      expect(events.map((e) => e.outcome).sort()).toEqual(['APPLIED', 'APPLIED']);
    });

    it('flags an unrecoverable chargeback instead of overdrawing the wallet', async () => {
      const user = await signUp(ctx, { tier: 'TIER_1' });
      const w = await openWallet(ctx, user, 'PKR');
      const bob = await signUp(ctx);
      await openWallet(ctx, bob, 'PKR');
      const t = await topup(user, w, '200').expect(201);
      await simulate(user, t.body.id, 'SUCCEEDED').expect(200);
      await ctx.http().post('/v1/transfers').set(auth(user)).set('Idempotency-Key', idemKey()).send({ fromWalletId: w, toPhone: bob.phone, amount: '150', pin: user.pin }).expect(201);
      const cb = await simulate(user, t.body.id, 'REVERSED').expect(200);
      expect(cb.body.receipt.outcome).toBe('FLAGGED');
      expect(await funding(t.body.id)).toMatchObject({ status: 'SUCCEEDED', needsReview: true });
      expect(await balanceOf(ctx, w)).toBe(5000n);
    });

    it('rejects events for unknown references without failing the delivery', async () => {
      const res = await postWebhook(ctx, event('TOPDOESNOTEXIST', 'transaction.succeeded')).expect(200);
      expect(res.body.outcome).toBe('UNMATCHED');
      await ctx.http().post('/v1/webhooks/bank').set('X-PayCore-Signature', 't=1,v1=' + 'a'.repeat(64)).send({}).expect((r) => expect([400, 401]).toContain(r.status));
    });
  });

  it('parks a top-up that arrives for a frozen wallet in suspense and flags it', async () => {
    const user = await signUp(ctx);
    const w = await openWallet(ctx, user, 'PKR');
    const a = await topup(user, w, '4000').expect(201);
    const b = await topup(user, w, '4000').expect(201);
    const suspenseBefore = (await systemAccount(ctx, 'SUSPENSE.PKR')).balance;
    await simulate(user, a.body.id, 'SUCCEEDED').expect(200);
    await ctx.http().post(`/v1/admin/wallets/${w}/status`).set(auth(admin)).send({ status: 'FROZEN', reason: 'fraud check' }).expect(200);
    await simulate(user, b.body.id, 'SUCCEEDED').expect(200);
    const parked = await funding(b.body.id);
    expect(parked).toMatchObject({ status: 'SUCCEEDED', needsReview: true });
    expect(parked.reviewReason).toMatch(/WALLET_NOT_ACTIVE/);
    expect((await systemAccount(ctx, 'SUSPENSE.PKR')).balance - suspenseBefore).toBe(400000n);
    expect(await balanceOf(ctx, w)).toBe(400000n);
  });

  it('delivers delayed simulations through the outbox relay', async () => {
    const user = await signUp(ctx, { tier: 'TIER_1' });
    const w = await openWallet(ctx, user, 'PKR');
    const t = await topup(user, w, '50').expect(201);
    const sim = await simulate(user, t.body.id, 'SUCCEEDED', { delayMs: 60_000 }).expect(200);
    expect(sim.body).toMatchObject({ delivered: false, scheduledFor: expect.any(String) });
    await ctx.app.get(OutboxRelay).drainAll();
    expect((await funding(t.body.id)).status).toBe('PENDING'); // not due yet
    await ctx.prisma.outboxEvent.updateMany({
      where: { eventType: 'bank.simulation.requested', aggregateId: t.body.bankReference },
      data: { availableAt: new Date(Date.now() - 1000) },
    });
    await ctx.app.get(OutboxRelay).drainAll();
    expect((await funding(t.body.id)).status).toBe('SUCCEEDED');
    expect(await balanceOf(ctx, w)).toBe(5000n);
  });

  it('times out stale items: top-ups fail, unsubmitted withdrawals are compensated, in-flight ones are flagged', async () => {
    const fundingSvc = ctx.app.get(FundingService);
    const user = await signUp(ctx, { tier: 'TIER_1' });
    const w = await openWallet(ctx, user, 'PKR');
    const t = await topup(user, w, '100').expect(201);
    const rich = await fundedUser(ctx, { amount: '3000' });
    const neverSubmitted = await withdraw(rich.user, rich.wallet, '1000').expect(201);
    const lost = await withdraw(rich.user, rich.wallet, '500').expect(201);
    await drainOutbox(ctx); // submits both payouts...
    await ctx.prisma.simBankTransaction.delete({ where: { reference: neverSubmitted.body.bankReference } }); // ...but the bank lost one
    const old = new Date(Date.now() - 100 * 3600_000);
    await ctx.prisma.fundingTransaction.updateMany({ where: { id: { in: [t.body.id, neverSubmitted.body.id, lost.body.id] } }, data: { createdAt: old } });

    await fundingSvc.timeoutStale();
    expect(await funding(t.body.id)).toMatchObject({ status: 'FAILED', failureReason: 'Timed out waiting for the bank' });
    expect(await funding(neverSubmitted.body.id)).toMatchObject({ status: 'FAILED' });
    expect(await funding(lost.body.id)).toMatchObject({ status: 'PENDING', needsReview: true });
    // the compensated hold (1000 + 10 fee) is back; the in-flight one (500 + 10) stays held
    expect(await balanceOf(ctx, rich.wallet)).toBe(300000n - 51000n);
  });

  it('reconciliation detects every mismatch type', async () => {
    const recon = ctx.app.get(ReconciliationService);
    const u = await signUp(ctx, { tier: 'TIER_1' });
    const w = await openWallet(ctx, u, 'PKR');
    const matched = await topup(u, w, '100').expect(201);
    const missingInBank = await topup(u, w, '200').expect(201);
    const mismatch = await topup(u, w, '300').expect(201);
    for (const f of [matched, missingInBank, mismatch]) await simulate(u, f.body.id, 'SUCCEEDED').expect(200);
    // bank statement anomalies
    await ctx.prisma.simBankStatementLine.deleteMany({ where: { reference: missingInBank.body.bankReference } });
    await ctx.prisma.simBankStatementLine.updateMany({ where: { reference: mismatch.body.bankReference }, data: { amount: 29_999n } });
    // a payout the bank made after we recorded it as FAILED -> money left the bank, not the ledger
    const { user, wallet } = await fundedUser(ctx, { amount: '1000' });
    const wd = await withdraw(user, wallet, '400').expect(201);
    await simulate(user, wd.body.id, 'FAILED').expect(200);
    await simulate(user, wd.body.id, 'SUCCEEDED').expect(200);

    const res = await ctx.http().post('/v1/admin/reconciliation/runs').set(auth(admin)).send({ date: today() }).expect(201);
    expect(res.body.status).toBe('COMPLETED');
    const byRef = new Map(res.body.items.map((i: { bankReference: string }) => [i.bankReference, i]));
    expect(byRef.has(matched.body.bankReference)).toBe(false);
    expect(byRef.get(missingInBank.body.bankReference)).toMatchObject({
      type: 'MISSING_IN_BANK',
      bankAmount: null,
      ledgerAmount: { amount: '200.00' },
      fundingId: missingInBank.body.id,
    });
    expect(byRef.get(mismatch.body.bankReference)).toMatchObject({
      type: 'AMOUNT_MISMATCH',
      bankAmount: { amount: '299.99' },
      ledgerAmount: { amount: '300.00' },
    });
    expect(byRef.get(wd.body.bankReference)).toMatchObject({ type: 'MISSING_IN_LEDGER', bankAmount: { amount: '-400.00' }, ledgerAmount: null });
    expect(res.body.matched).toBeGreaterThanOrEqual(1);
    expect(res.body.missingInBank).toBeGreaterThanOrEqual(1);
    expect(res.body.amountMismatches).toBeGreaterThanOrEqual(1);
    expect(res.body.missingInLedger).toBeGreaterThanOrEqual(1);

    const got = await ctx.http().get(`/v1/admin/reconciliation/runs/${res.body.id}`).set(auth(admin)).expect(200);
    expect(got.body.items).toHaveLength(res.body.items.length);
    const list = await ctx.http().get('/v1/admin/reconciliation/runs?limit=5').set(auth(admin)).expect(200);
    expect(list.body.items[0].id).toBe(res.body.id);
    await ctx.http().post('/v1/admin/reconciliation/runs').set(auth(u)).send({}).expect(403);
    await ctx.http().post('/v1/admin/reconciliation/runs').set(auth(admin)).send({ date: '2026-02-30' }).expect(400);
    expect((await recon.run('2000-01-01')).items).toEqual([]);
  });
});
