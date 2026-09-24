import { randomUUID } from 'node:crypto';
import { LedgerService } from '../../src/modules/ledger/ledger.service';
import { TestContext, auth, balanceOf, createAdmin, createTestApp, deposit, idemKey, openWallet, signUp } from './helpers/app';

describe('Ledger integrity (integration)', () => {
  let ctx: TestContext;
  let ledger: LedgerService;
  beforeAll(async () => {
    ctx = await createTestApp();
    ledger = ctx.app.get(LedgerService);
  });
  afterAll(async () => ctx.close());

  async function someEntry() {
    const user = await signUp(ctx, { tier: 'TIER_1' });
    const pkr = await openWallet(ctx, user, 'PKR');
    await deposit(ctx, user, pkr, '25.00');
    const posting = await ctx.prisma.posting.findFirstOrThrow({
      where: { account: { wallet: { id: pkr } } },
      orderBy: { createdAt: 'desc' },
    });
    return { user, pkr, posting };
  }

  it('seeds 5 system accounts per currency and tier limits', async () => {
    const system = await ctx.prisma.ledgerAccount.findMany({ where: { ownerType: 'SYSTEM' } });
    expect(system).toHaveLength(15);
    expect(system.map((a) => a.code)).toEqual(
      expect.arrayContaining(['BANK_CLEARING.PKR', 'FEE_REVENUE.USD', 'SETTLEMENT.AED', 'SUSPENSE.PKR', 'FUNDS_IN_FLIGHT.USD']),
    );
    expect(await ctx.prisma.tierLimit.count()).toBe(12);
  });

  it('every table (including future ones) has row-level security enabled', async () => {
    const tables = await ctx.prisma.$queryRaw<Array<{ tablename: string; rls: boolean }>>`
      SELECT c.relname AS tablename, c.relrowsecurity AS rls
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'`;
    expect(tables.length).toBeGreaterThanOrEqual(13);
    expect(tables.filter((t) => !t.rls).map((t) => t.tablename)).toEqual([]);
    const policies = await ctx.prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM pg_policies WHERE schemaname = 'public'`;
    expect(policies[0]?.n).toBe(0n);
  });

  it('postings and journal entries are append-only at the database level', async () => {
    const { posting } = await someEntry();
    await expect(ctx.prisma.$executeRaw`UPDATE postings SET amount = amount + 1 WHERE id = ${posting.id}::uuid`).rejects.toThrow(/append-only/);
    await expect(ctx.prisma.$executeRaw`DELETE FROM postings WHERE id = ${posting.id}::uuid`).rejects.toThrow(/append-only/);
    await expect(
      ctx.prisma.$executeRaw`UPDATE journal_entries SET description = 'tampered' WHERE id = ${posting.entryId}::uuid`,
    ).rejects.toThrow(/append-only/);
    await expect(ctx.prisma.$executeRaw`TRUNCATE postings CASCADE`).rejects.toThrow(/append-only/);
  });

  it('the database rejects an unbalanced entry even if application checks are bypassed', async () => {
    const { posting } = await someEntry();
    const entryId = randomUUID();
    await expect(
      ctx.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`INSERT INTO journal_entries (id, type, description) VALUES (${entryId}::uuid, 'ADJUSTMENT', 'rogue')`;
        await tx.$executeRaw`INSERT INTO postings (id, entry_id, account_id, currency, amount, balance_after)
          VALUES (gen_random_uuid(), ${entryId}::uuid, ${posting.accountId}::uuid, 'PKR', -500, 0)`;
        const clearing = await tx.ledgerAccount.findUniqueOrThrow({ where: { code: 'BANK_CLEARING.PKR' } });
        await tx.$executeRaw`INSERT INTO postings (id, entry_id, account_id, currency, amount, balance_after)
          VALUES (gen_random_uuid(), ${entryId}::uuid, ${clearing.id}::uuid, 'PKR', 499, 0)`;
      }),
    ).rejects.toThrow(/does not balance/);
    expect(await ctx.prisma.journalEntry.findUnique({ where: { id: entryId } })).toBeNull();
  });

  it('the database rejects single-leg entries and currency mismatches', async () => {
    const { posting } = await someEntry();
    const lonely = randomUUID();
    await expect(
      ctx.prisma.$executeRaw`INSERT INTO journal_entries (id, type, description) VALUES (${lonely}::uuid, 'ADJUSTMENT', 'x')`,
    ).rejects.toThrow(/at least 2 postings/);

    const entryId = randomUUID();
    await expect(
      ctx.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`INSERT INTO journal_entries (id, type, description) VALUES (${entryId}::uuid, 'ADJUSTMENT', 'x')`;
        await tx.$executeRaw`INSERT INTO postings (id, entry_id, account_id, currency, amount, balance_after)
          VALUES (gen_random_uuid(), ${entryId}::uuid, ${posting.accountId}::uuid, 'USD', 1, 0)`;
      }),
    ).rejects.toThrow(/does not match account/);
  });

  it('a wallet balance can never be negative, even via direct SQL', async () => {
    const { posting } = await someEntry();
    await expect(
      ctx.prisma.$executeRaw`UPDATE ledger_accounts SET balance = -1, version = version + 1 WHERE id = ${posting.accountId}::uuid`,
    ).rejects.toThrow(/ledger_accounts_non_negative/);
    await expect(
      ctx.prisma.$executeRaw`UPDATE ledger_accounts SET balance = balance + 100 WHERE id = ${posting.accountId}::uuid`,
    ).rejects.toThrow(/without version bump/);
  });

  it('corrects mistakes with reversal entries, at most once', async () => {
    const admin = await createAdmin(ctx);
    const { pkr, posting } = await someEntry();
    const reversal = await ctx
      .http()
      .post(`/v1/admin/ledger/entries/${posting.entryId}/reversals`)
      .set(auth(admin))
      .set('Idempotency-Key', idemKey())
      .send({ reason: 'Deposit sent in error' })
      .expect(201);
    expect(reversal.body).toMatchObject({ type: 'REVERSAL', reversalOfId: posting.entryId });
    expect(await balanceOf(ctx, pkr)).toBe(0n);

    // the original is untouched
    const original = await ledger.getEntry(posting.entryId);
    expect(original.postings.map((p) => p.amount).sort()).toEqual([-2500n, 2500n]);

    const again = await ctx
      .http()
      .post(`/v1/admin/ledger/entries/${posting.entryId}/reversals`)
      .set(auth(admin))
      .set('Idempotency-Key', idemKey())
      .send({ reason: 'Deposit sent in error' })
      .expect(409);
    expect(again.body.error.code).toBe('ENTRY_ALREADY_REVERSED');
    await ctx
      .http()
      .post(`/v1/admin/ledger/entries/${reversal.body.id}/reversals`)
      .set(auth(admin))
      .set('Idempotency-Key', idemKey())
      .send({ reason: 'Reverse the reversal' })
      .expect(422);
  });

  it('refuses a reversal that would overdraw a wallet whose funds were already spent', async () => {
    const admin = await createAdmin(ctx);
    const { user, pkr, posting } = await someEntry();
    await ctx
      .http()
      .post(`/v1/wallets/${pkr}/withdrawals`)
      .set(auth(user))
      .set('Idempotency-Key', idemKey())
      .send({ amount: '20', pin: user.pin })
      .expect(201);
    const res = await ctx
      .http()
      .post(`/v1/admin/ledger/entries/${posting.entryId}/reversals`)
      .set(auth(admin))
      .set('Idempotency-Key', idemKey())
      .send({ reason: 'Chargeback from bank' })
      .expect(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_FUNDS');
  });

  it('cached balances equal balances derived from postings; books balance', async () => {
    const { pkr } = await someEntry();
    const wallet = await ctx.prisma.wallet.findUniqueOrThrow({ where: { id: pkr } });
    expect(await ledger.derivedBalance(wallet.ledgerAccountId)).toBe(await balanceOf(ctx, pkr));
    const admin = await createAdmin(ctx);
    const report = await ctx.http().get('/v1/admin/ledger/integrity').set(auth(admin)).expect(200);
    expect(report.body.healthy).toBe(true);
    expect(report.body.balanceCacheMismatches).toEqual([]);
    expect(report.body.unbalancedEntries).toEqual([]);
  });
});
