import { randomUUID } from 'node:crypto';
import { FaultInjector, FaultPoint } from '../../src/common/faults/fault-injector';
import { OutboxRelay } from '../../src/common/outbox/outbox.service';
import { DomainEventBus } from '../../src/common/outbox/event-bus';
import { BankSimulatorService } from '../../src/modules/funding/bank-simulator.service';
import { LedgerService } from '../../src/modules/ledger/ledger.service';
import { credit, debit } from '../../src/modules/ledger/ledger.validation';
import { PaymentEngine } from '../../src/modules/payments/payment-engine.service';
import { SettlementService } from '../../src/modules/settlement/settlement.service';
import { TestContext, TestUser, auth, balanceOf, createAdmin, createTestApp, idemKey, openWallet, signUp } from './helpers/app';
import { createMerchant, dynamicQr, expectHealthyBooks, fundedUser, postWebhook, scanAndPay } from './helpers/phase2';

/**
 * Failure injection: crash at named points inside and outside the money transaction and prove
 * that nothing partial is left behind and that retries are exactly-once.
 */
describe('Failure injection (integration)', () => {
  let ctx: TestContext;
  let faults: FaultInjector;
  let admin: TestUser;
  beforeAll(async () => {
    ctx = await createTestApp();
    faults = ctx.app.get(FaultInjector);
    admin = await createAdmin(ctx);
  });
  afterEach(() => faults.reset());
  afterAll(async () => {
    await expectHealthyBooks(ctx);
    await ctx.close();
  });

  async function parties() {
    const { user: alice, wallet: a } = await fundedUser(ctx, { amount: '1000' });
    const bob = await signUp(ctx);
    const b = await openWallet(ctx, bob, 'PKR');
    return { alice, a, bob, b };
  }

  const send = (from: TestUser, fromWalletId: string, to: TestUser, key: string, amount = '100') =>
    ctx.http().post('/v1/transfers').set(auth(from)).set('Idempotency-Key', key).send({ fromWalletId, toPhone: to.phone, amount, pin: from.pin });

  describe.each<FaultPoint>(['payment.afterLedgerPost', 'payment.beforeOutbox'])('crash inside the money transaction at %s', (point) => {
    it('rolls back everything; the retry with the same key completes exactly once', async () => {
      const { alice, a, bob, b } = await parties();
      const key = idemKey();
      const ref = `idem:${alice.id}:${key}`;
      faults.arm(point);
      const crashed = await send(alice, a, bob, key).expect(500);
      expect(crashed.body.error.code).toBe('INTERNAL');

      expect(await ctx.prisma.journalEntry.count({ where: { externalRef: ref } })).toBe(0);
      const pending = await ctx.prisma.payment.findUniqueOrThrow({ where: { externalRef: ref } });
      expect(pending).toMatchObject({ status: 'PROCESSING', journalEntryId: null });
      expect(await ctx.prisma.outboxEvent.count({ where: { aggregateId: pending.id } })).toBe(0);
      expect(await balanceOf(ctx, a)).toBe(100000n);
      expect(await balanceOf(ctx, b)).toBe(0n);

      const retry = await send(alice, a, bob, key).expect(201);
      expect(retry.body).toMatchObject({ id: pending.id, status: 'COMPLETED' });
      expect(await ctx.prisma.journalEntry.count({ where: { externalRef: ref } })).toBe(1);
      expect(await ctx.prisma.outboxEvent.count({ where: { aggregateId: pending.id, eventType: 'payment.completed' } })).toBe(1);
      expect(await balanceOf(ctx, a)).toBe(90000n);
      expect(await balanceOf(ctx, b)).toBe(10000n);
    });
  });

  it('crash after commit (response lost): the retry returns the same payment, money moved once', async () => {
    const { alice, a, bob, b } = await parties();
    const key = idemKey();
    faults.arm('payment.afterCommit');
    await send(alice, a, bob, key).expect(500);
    const committed = await ctx.prisma.payment.findUniqueOrThrow({ where: { externalRef: `idem:${alice.id}:${key}` } });
    expect(committed.status).toBe('COMPLETED');
    const retry = await send(alice, a, bob, key).expect(201);
    expect(retry.body.id).toBe(committed.id);
    expect(await balanceOf(ctx, a)).toBe(90000n);
    expect(await balanceOf(ctx, b)).toBe(10000n);
  });

  it('crash between creating the payment and moving money: the timeout job fails it and the key replays the failure', async () => {
    const { alice, a, bob, b } = await parties();
    const key = idemKey();
    faults.arm('payment.afterCreate');
    await send(alice, a, bob, key).expect(500);
    const stuck = await ctx.prisma.payment.findUniqueOrThrow({ where: { externalRef: `idem:${alice.id}:${key}` } });
    expect(stuck.status).toBe('PROCESSING');

    const engine = ctx.app.get(PaymentEngine);
    expect((await engine.timeoutStale(new Date())).failed).toBe(0); // not stale yet
    const result = await engine.timeoutStale(new Date(Date.now() + 10 * 60_000));
    expect(result.failed).toBeGreaterThanOrEqual(1);
    const failed = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: stuck.id } });
    expect(failed).toMatchObject({ status: 'FAILED', failureCode: 'PAYMENT_TIMEOUT' });
    expect((failed.timeline as Array<{ status: string }>).map((t) => t.status)).toEqual(['CREATED', 'PROCESSING', 'FAILED']);

    const replay = await send(alice, a, bob, key).expect(422);
    expect(replay.body.error.code).toBe('PAYMENT_FAILED');
    expect(await balanceOf(ctx, a)).toBe(100000n);
    expect(await balanceOf(ctx, b)).toBe(0n);
    // a fresh key works
    await send(alice, a, bob, idemKey()).expect(201);
  });

  it('compensates a payment whose entry was posted without completing (reversal on timeout)', async () => {
    const { alice, a, bob, b } = await parties();
    const ledger = ctx.app.get(LedgerService);
    const aw = await ctx.prisma.wallet.findUniqueOrThrow({ where: { id: a } });
    const bw = await ctx.prisma.wallet.findUniqueOrThrow({ where: { id: b } });
    const externalRef = `idem:${alice.id}:${idemKey()}`;
    // Simulate a corrupted state that the engine itself never produces: entry posted, payment still PROCESSING.
    const payment = await ctx.prisma.payment.create({
      data: {
        type: 'P2P',
        status: 'PROCESSING',
        payerUserId: alice.id,
        payerWalletId: a,
        payeeUserId: bob.id,
        payeeWalletId: b,
        currency: 'PKR',
        amount: 5000n,
        totalDebit: 5000n,
        externalRef,
        requestHash: 'manual',
        updatedAt: new Date(Date.now() - 3600_000),
        timeline: [{ status: 'CREATED', at: new Date().toISOString() }, { status: 'PROCESSING', at: new Date().toISOString() }],
      },
    });
    await ctx.prisma.runInTransaction((tx) =>
      ledger.post(tx, {
        type: 'PAYMENT',
        description: 'orphaned',
        externalRef,
        metadata: { paymentId: payment.id },
        legs: [debit(aw.ledgerAccountId, 5000n), credit(bw.ledgerAccountId, 5000n)],
      }),
    );
    await ctx.prisma.$executeRaw`UPDATE payments SET updated_at = now() - interval '1 hour' WHERE id = ${payment.id}::uuid`;
    expect(await balanceOf(ctx, b)).toBe(5000n);

    const result = await ctx.app.get(PaymentEngine).timeoutStale();
    expect(result.reversed).toBeGreaterThanOrEqual(1);
    const reversed = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(reversed.status).toBe('REVERSED');
    expect(reversed.reversalEntryId).not.toBeNull();
    expect(await balanceOf(ctx, a)).toBe(100000n);
    expect(await balanceOf(ctx, b)).toBe(0n);
  });

  it('crash inside a refund transaction leaves the refund PENDING with no money moved; the retry completes once', async () => {
    const m = await createMerchant(ctx, admin);
    const payer = await fundedUser(ctx, { amount: '1000' });
    const qr = await dynamicQr(ctx, m, '100.00');
    const paid = await scanAndPay(ctx, payer.user, payer.wallet, qr.payload);
    const key = idemKey();
    const refund = () =>
      ctx.http().post(`/v1/merchant/payments/${paid.body.id}/refunds`).set(auth(m.owner)).set('Idempotency-Key', key).send({ amount: '40', reason: 'broken' });
    faults.arm('refund.afterLedgerPost');
    await refund().expect(500);
    const pending = await ctx.prisma.refund.findUniqueOrThrow({ where: { externalRef: `idem:${m.owner.id}:${key}` } });
    expect(pending).toMatchObject({ status: 'PENDING', journalEntryId: null });
    expect((await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paid.body.id } })).refundedAmount).toBe(0n);
    const done = await refund().expect(201);
    expect(done.body).toMatchObject({ id: pending.id, status: 'COMPLETED' });
    expect((await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paid.body.id } })).refundedAmount).toBe(4000n);
    expect(await balanceOf(ctx, payer.wallet)).toBe(100000n - 10000n + 4000n);
  });

  it('crash after a withdrawal hold (inside the tx) leaves no hold and no funding row', async () => {
    const { user, wallet } = await fundedUser(ctx, { amount: '500' });
    const key = idemKey();
    const body = { walletId: wallet, amount: '100', bankAccount: { iban: 'PK36UNIL0000001123456702', accountTitle: 'X Y', bankName: 'UBL' }, pin: user.pin };
    faults.arm('funding.afterHold');
    await ctx.http().post('/v1/funding/withdrawals').set(auth(user)).set('Idempotency-Key', key).send(body).expect(500);
    expect(await ctx.prisma.fundingTransaction.count({ where: { userId: user.id } })).toBe(0);
    expect(await balanceOf(ctx, wallet)).toBe(50000n);
    await ctx.http().post('/v1/funding/withdrawals').set(auth(user)).set('Idempotency-Key', key).send(body).expect(201);
    expect(await balanceOf(ctx, wallet)).toBe(50000n - 11000n);
  });

  it('a webhook that crashes mid-apply is not recorded, so the redelivery applies it exactly once', async () => {
    const user = await signUp(ctx, { tier: 'TIER_1' });
    const w = await openWallet(ctx, user, 'PKR');
    const t = await ctx.http().post('/v1/funding/topups').set(auth(user)).set('Idempotency-Key', idemKey()).send({ walletId: w, amount: '250', method: 'BANK_TRANSFER' }).expect(201);
    const ev = { id: `evt_${randomUUID()}`, type: 'transaction.succeeded', data: { reference: t.body.bankReference, amountMinor: '25000' } };
    faults.arm('webhook.afterApply');
    await postWebhook(ctx, ev).expect(500);
    expect(await ctx.prisma.bankWebhookEvent.count({ where: { id: ev.id } })).toBe(0);
    expect(await balanceOf(ctx, w)).toBe(0n);
    const ok = await postWebhook(ctx, ev).expect(200);
    expect(ok.body.outcome).toBe('APPLIED');
    await postWebhook(ctx, ev).expect(200);
    expect(await balanceOf(ctx, w)).toBe(25000n);
  });

  it('a crashed settlement batch claims nothing; the rerun settles every item once', async () => {
    const m = await createMerchant(ctx, admin, { mdrBps: 0, delayDays: 0 });
    const payer = await fundedUser(ctx, { amount: '1000' });
    await scanAndPay(ctx, payer.user, payer.wallet, (await dynamicQr(ctx, m, '60.00')).payload);
    const settlement = ctx.app.get(SettlementService);
    const merchant = await ctx.prisma.merchant.findUniqueOrThrow({ where: { id: m.merchantId } });
    faults.arm('settlement.afterPost');
    await expect(settlement.settleMerchant(merchant, new Date(Date.now() + 86_400_000))).rejects.toThrow(/Injected fault/);
    expect(await ctx.prisma.settlement.count({ where: { merchantId: m.merchantId } })).toBe(0);
    expect(await ctx.prisma.payment.count({ where: { merchantId: m.merchantId, settlementId: { not: null } } })).toBe(0);
    const s = await settlement.settleMerchant(merchant, new Date(Date.now() + 86_400_000));
    expect(s?.net).toBe(6000n);
  });

  describe('outbox relay', () => {
    it('publishes each event, retries failures with backoff, and redelivers after a crash', async () => {
      const relay = ctx.app.get(OutboxRelay);
      await relay.drainAll(); // flush whatever earlier tests left
      const seen: string[] = [];
      ctx.app.get(DomainEventBus).subscribe('payment.completed', `test-recorder-${randomUUID()}`, async (e) => {
        seen.push(String(e.payload.paymentId));
      });
      const { alice, a, bob } = await parties();
      await relay.drainAll();
      seen.length = 0;
      const paid = await send(alice, a, bob, idemKey()).expect(201);
      const row = await ctx.prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: paid.body.id, eventType: 'payment.completed' } });
      expect(row.publishedAt).toBeNull();

      faults.arm('outbox.publish');
      const first = await relay.drainOnce();
      expect(first.failed).toBe(1);
      const failed = await ctx.prisma.outboxEvent.findUniqueOrThrow({ where: { id: row.id } });
      expect(failed).toMatchObject({ publishedAt: null, attempts: 1 });
      expect(failed.lastError).toMatch(/Injected fault/);
      expect(failed.availableAt.getTime()).toBeGreaterThan(Date.now());
      expect((await relay.drainOnce()).published).toBe(0); // backing off

      await ctx.prisma.outboxEvent.update({ where: { id: row.id }, data: { availableAt: new Date(Date.now() - 1000) } });
      expect((await relay.drainOnce()).published).toBe(1);
      expect(seen).toEqual([paid.body.id]);
      expect((await ctx.prisma.outboxEvent.findUniqueOrThrow({ where: { id: row.id } })).publishedAt).not.toBeNull();
      expect((await relay.drainOnce()).published).toBe(0); // never twice
    });

    it('concurrent relays never publish the same row twice (FOR UPDATE SKIP LOCKED + lease)', async () => {
      const relay = ctx.app.get(OutboxRelay);
      await relay.drainAll();
      const counts = new Map<string, number>();
      ctx.app.get(DomainEventBus).subscribe('payment.completed', `test-counter-${randomUUID()}`, async (e) => {
        counts.set(e.id, (counts.get(e.id) ?? 0) + 1);
      });
      const { alice, a, bob } = await parties();
      for (let i = 0; i < 6; i++) await send(alice, a, bob, idemKey(), '10').expect(201);
      await Promise.all(Array.from({ length: 4 }, () => relay.drainOnce(2)));
      await relay.drainAll();
      expect(counts.size).toBeGreaterThanOrEqual(6);
      expect([...counts.values()].every((c) => c === 1)).toBe(true);
    });
  });

  it('the fault injector is inert outside NODE_ENV=test', () => {
    const inert = new FaultInjector({ get: () => 'production' } as never);
    expect(() => inert.arm('payment.afterCommit')).toThrow(/only available/);
    expect(() => inert.hit('payment.afterCommit')).not.toThrow();
  });

  it('the bank simulator refuses to run when disabled', async () => {
    const sim = ctx.app.get(BankSimulatorService);
    const disabled = Object.create(sim, { enabled: { get: () => false } }) as BankSimulatorService;
    await expect(disabled.simulate({ id: admin.id, role: 'ADMIN' }, { fundingId: randomUUID(), outcome: 'SUCCEEDED' })).rejects.toMatchObject({
      code: 'FEATURE_DISABLED',
    });
  });
});
