import { BankSimulatorService } from '../../src/modules/funding/bank-simulator.service';
import { ReconciliationService } from '../../src/modules/funding/reconciliation.service';
import { SettlementService } from '../../src/modules/settlement/settlement.service';
import { TestContext, TestUser, auth, createAdmin, createTestApp, idemKey } from './helpers/app';
import { TestMerchant, createMerchant, drainOutbox, dynamicQr, expectHealthyBooks, fundedUser, scanAndPay, systemAccount } from './helpers/phase2';

const DAY = 86_400_000;

describe('T+N settlement (integration)', () => {
  let ctx: TestContext;
  let admin: TestUser;
  let settlement: SettlementService;
  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await createAdmin(ctx);
    settlement = ctx.app.get(SettlementService);
  });
  afterAll(async () => {
    await expectHealthyBooks(ctx);
    await ctx.close();
  });

  async function sales(m: TestMerchant, amounts: string[]) {
    const payer = await fundedUser(ctx, { amount: '20000' });
    const ids: string[] = [];
    for (const a of amounts) {
      const qr = await dynamicQr(ctx, m, a);
      ids.push((await scanAndPay(ctx, payer.user, payer.wallet, qr.payload)).body.id);
    }
    return ids;
  }

  const payable = async (m: TestMerchant) => (await ctx.prisma.ledgerAccount.findUniqueOrThrow({ where: { id: m.ledgerAccountId } })).balance;
  const settlementsOf = (m: TestMerchant) => ctx.prisma.settlement.findMany({ where: { merchantId: m.merchantId }, orderBy: { createdAt: 'asc' } });

  it('settles only items older than T+N, with totals equal to the ledger, exactly once', async () => {
    const m = await createMerchant(ctx, admin, { mdrBps: 200, delayDays: 1 });
    const ids = await sales(m, ['1000.00', '500.00', '250.00']);
    await ctx.http().post(`/v1/merchant/payments/${ids[0]}/refunds`).set(auth(m.owner)).set('Idempotency-Key', idemKey()).send({ amount: '100.00', reason: 'return' }).expect(201);

    // T+1: nothing from today is due today or tomorrow before midnight
    await settlement.runBatch(new Date());
    await settlement.runBatch(new Date(Date.now() + DAY));
    expect(await settlementsOf(m)).toHaveLength(0);

    const payableBefore = await payable(m);
    const asOf = new Date(Date.now() + 2 * DAY);
    const created = (await settlement.runBatch(asOf)).filter((s) => s.merchantId === m.merchantId);
    expect(created).toHaveLength(1);
    const s = created[0]!;
    // gross 1750; MDR 2% = 35.00, 2.00 returned with the 100 refund => 33.00; refunds 100; net 1617
    expect(s).toMatchObject({ gross: 175000n, mdr: 3300n, refunds: 10000n, net: 161700n, status: 'PENDING' });
    expect(s.net).toBe(payableBefore);
    expect(await payable(m)).toBe(0n);

    // the batch entry moves exactly `net` out of the merchant payable
    const posting = await ctx.prisma.posting.findFirstOrThrow({ where: { entryId: s.journalEntryId!, accountId: m.ledgerAccountId } });
    expect(posting.amount).toBe(s.net);
    // every item is claimed by this settlement, and the lines add up
    const lines = await ctx.prisma.settlementLine.findMany({ where: { settlementId: s.id } });
    expect(lines).toHaveLength(4);
    expect(lines.reduce((a, l) => a + l.net, 0n)).toBe(s.net);
    expect(await ctx.prisma.payment.count({ where: { id: { in: ids }, settlementId: s.id } })).toBe(3);

    // re-running is a no-op
    expect((await settlement.runBatch(asOf)).filter((x) => x.merchantId === m.merchantId)).toHaveLength(0);
  });

  it('pays out through the bank (PAID), reconciles, and serves the report', async () => {
    const m = await createMerchant(ctx, admin, { mdrBps: 100, delayDays: 0 });
    await sales(m, ['300.00']);
    const run = await ctx.http().post('/v1/admin/settlements/run').set(auth(admin)).send({ asOf: new Date(Date.now() + DAY).toISOString() }).expect(200);
    const s = (await settlementsOf(m))[0]!;
    expect(run.body.settlements).toContainEqual(expect.objectContaining({ id: s.id, status: 'PENDING', net: expect.objectContaining({ amount: '297.00' }) }));
    expect(s.net).toBe(29700n);

    const bankBefore = (await systemAccount(ctx, 'BANK_CLEARING.PKR')).balance;
    await drainOutbox(ctx); // worker: submit the payout to the bank
    expect((await ctx.prisma.settlement.findUniqueOrThrow({ where: { id: s.id } })).submittedAt).not.toBeNull();
    const sim = await ctx.http().post('/v1/dev/bank/simulate').set(auth(m.owner)).send({ settlementId: s.id, outcome: 'SUCCEEDED' }).expect(200);
    expect(sim.body).toMatchObject({ delivered: true, receipt: { outcome: 'APPLIED' } });
    const paid = await ctx.prisma.settlement.findUniqueOrThrow({ where: { id: s.id } });
    expect(paid).toMatchObject({ status: 'PAID' });
    expect(paid.paidAt).not.toBeNull();
    expect((await systemAccount(ctx, 'BANK_CLEARING.PKR')).balance - bankBefore).toBe(-29700n);

    const list = await ctx.http().get('/v1/merchant/settlements').set(auth(m.owner)).expect(200);
    expect(list.body.items[0]).toMatchObject({ id: s.id, status: 'PAID', net: { amount: '297.00' }, bankReference: s.bankReference });
    const detail = await ctx.http().get(`/v1/merchant/settlements/${s.id}`).set(auth(m.owner)).expect(200);
    expect(detail.body.lines).toHaveLength(1);
    const csv = await ctx.http().get(`/v1/merchant/settlements/${s.id}/report.csv`).set(auth(m.owner)).expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain('Net,297.00');
    expect(csv.text).toContain('kind,payment_id,refund_id,occurred_at,gross,mdr,net');
    const dash = await ctx.http().get('/v1/merchant/dashboard').set(auth(m.owner)).expect(200);
    expect(dash.body.lastSettlement).toMatchObject({ id: s.id, status: 'PAID' });

    const recon = await ctx.app.get(ReconciliationService).run(new Date().toISOString().slice(0, 10));
    expect(recon.items.filter((i) => i.bankReference === s.bankReference)).toEqual([]);
  });

  it('a failed payout reverses the batch and the items settle again in the next batch', async () => {
    const m = await createMerchant(ctx, admin, { mdrBps: 0, delayDays: 0 });
    await sales(m, ['120.00']);
    const asOf = new Date(Date.now() + DAY);
    const [first] = (await settlement.runBatch(asOf)).filter((x) => x.merchantId === m.merchantId);
    expect(await payable(m)).toBe(0n);
    await ctx.app.get(BankSimulatorService).simulate({ id: admin.id, role: 'ADMIN' }, { settlementId: first!.id, outcome: 'FAILED' });
    const failed = await ctx.prisma.settlement.findUniqueOrThrow({ where: { id: first!.id } });
    expect(failed.status).toBe('FAILED');
    expect(failed.reversalEntryId).not.toBeNull();
    expect(await payable(m)).toBe(12000n);
    // a late SUCCEEDED for the failed payout is flagged, never applied
    const late = await ctx.app.get(BankSimulatorService).simulate({ id: admin.id, role: 'ADMIN' }, { settlementId: first!.id, outcome: 'SUCCEEDED' });
    expect(late.receipt?.outcome).toBe('FLAGGED');

    const [second] = (await settlement.runBatch(asOf)).filter((x) => x.merchantId === m.merchantId);
    expect(second).toMatchObject({ net: 12000n, status: 'PENDING' });
    expect(second!.id).not.toBe(first!.id);
    expect(await payable(m)).toBe(0n);
    // the unmatched bank movement from the flagged late SUCCEEDED shows up in reconciliation
    const recon = await ctx.app.get(ReconciliationService).run(new Date().toISOString().slice(0, 10));
    expect(recon.items.filter((i) => i.bankReference === failed.bankReference)).toEqual([
      expect.objectContaining({ type: 'MISSING_IN_LEDGER', settlementId: failed.id }),
    ]);
  });

  it('refuses a refund the merchant payable can no longer cover (already settled out)', async () => {
    const m = await createMerchant(ctx, admin, { mdrBps: 0, delayDays: 0 });
    const [p] = await sales(m, ['80.00']);
    await settlement.runBatch(new Date(Date.now() + DAY)); // settles the 80
    const res = await ctx
      .http()
      .post(`/v1/merchant/payments/${p}/refunds`)
      .set(auth(m.owner))
      .set('Idempotency-Key', idemKey())
      .send({ amount: '10.00', reason: 'late return' })
      .expect(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_FUNDS');
    const r = await ctx.prisma.refund.findFirstOrThrow({ where: { paymentId: p } });
    expect(r).toMatchObject({ status: 'FAILED', failureCode: 'INSUFFICIENT_FUNDS', journalEntryId: null });
    expect(await payable(m)).toBe(0n);
  });
});
