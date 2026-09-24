import { TestContext, auth, createAdmin, createTestApp, idemKey, openWallet, signUp } from './helpers/app';

const basic = { dateOfBirth: '1990-05-01', address: '12 Mall Road, Lahore' };

describe('KYC (integration)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => ctx.close());

  it('auto-approves TIER_1 when document verification passes', async () => {
    const user = await signUp(ctx);
    const res = await ctx
      .http()
      .post('/v1/kyc/submissions')
      .set(auth(user))
      .send({ targetTier: 'TIER_1', documentType: 'CNIC', documentNumber: '35202-1234567-1', ...basic })
      .expect(201);
    expect(res.body.status).toBe('APPROVED');
    expect(res.body.documentNumberLast4).toBe('5671');
    expect(JSON.stringify(res.body)).not.toContain('1234567');

    const me = await ctx.http().get('/v1/kyc/me').set(auth(user)).expect(200);
    expect(me.body.tier).toBe('TIER_1');
    expect(me.body.limits.find((l: { currency: string }) => l.currency === 'USD').permitted).toBe(true);
  });

  it('auto-rejects on failed verification and records the audit trail', async () => {
    const user = await signUp(ctx);
    const admin = await createAdmin(ctx);
    const res = await ctx
      .http()
      .post('/v1/kyc/submissions')
      .set(auth(user))
      .send({ targetTier: 'TIER_1', documentType: 'CNIC', documentNumber: '35202-999-0000', ...basic })
      .expect(201);
    expect(res.body.status).toBe('REJECTED');

    const audit = await ctx.http().get(`/v1/admin/kyc/users/${user.id}/audit`).set(auth(admin)).expect(200);
    expect(audit.body.map((a: { action: string }) => a.action)).toEqual(['SUBMITTED', 'AUTO_VERIFICATION_FAILED', 'REJECTED']);
  });

  it('routes TIER_2 to admin review; approve raises the tier with a full audit trail', async () => {
    const user = await signUp(ctx);
    const admin = await createAdmin(ctx);
    const sub = await ctx
      .http()
      .post('/v1/kyc/submissions')
      .set(auth(user))
      .send({ targetTier: 'TIER_2', documentType: 'PASSPORT', documentNumber: 'AB1234567', ...basic })
      .expect(201);
    expect(sub.body.status).toBe('PENDING');

    // only one pending submission at a time
    await ctx
      .http()
      .post('/v1/kyc/submissions')
      .set(auth(user))
      .send({ targetTier: 'TIER_2', documentType: 'PASSPORT', documentNumber: 'AB1234567', ...basic })
      .expect(409);

    const queue = await ctx.http().get('/v1/admin/kyc/submissions?status=PENDING').set(auth(admin)).expect(200);
    expect(queue.body.some((s: { id: string }) => s.id === sub.body.id)).toBe(true);

    await ctx.http().post(`/v1/admin/kyc/submissions/${sub.body.id}/approve`).set(auth(user)).send({}).expect(403);
    await ctx.http().post(`/v1/admin/kyc/submissions/${sub.body.id}/approve`).set(auth(admin)).send({ note: 'ok' }).expect(200);
    // cannot be decided twice
    await ctx.http().post(`/v1/admin/kyc/submissions/${sub.body.id}/reject`).set(auth(admin)).send({ reason: 'changed mind' }).expect(409);

    const me = await ctx.http().get('/v1/users/me').set(auth(user)).expect(200);
    expect(me.body.kycTier).toBe('TIER_2');

    const audit = await ctx.prisma.kycAuditLog.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'asc' } });
    expect(audit.map((a) => a.action)).toEqual(['SUBMITTED', 'AUTO_VERIFICATION_PASSED', 'APPROVED', 'TIER_CHANGED']);
    expect(audit.find((a) => a.action === 'TIER_CHANGED')).toMatchObject({ actorId: admin.id, fromTier: 'TIER_0', toTier: 'TIER_2' });
  });

  it('lets admins reject with a reason', async () => {
    const user = await signUp(ctx);
    const admin = await createAdmin(ctx);
    const sub = await ctx
      .http()
      .post('/v1/kyc/submissions')
      .set(auth(user))
      .send({ targetTier: 'TIER_2', documentType: 'CNIC', documentNumber: '35202-1111111-9999', ...basic })
      .expect(201);
    expect(sub.body.status).toBe('PENDING'); // manual review outcome
    const res = await ctx
      .http()
      .post(`/v1/admin/kyc/submissions/${sub.body.id}/reject`)
      .set(auth(admin))
      .send({ reason: 'Image unreadable' })
      .expect(200);
    expect(res.body).toMatchObject({ status: 'REJECTED', rejectionReason: 'Image unreadable', reviewedById: admin.id });
  });

  it('restricts TIER_3 to merchants with business documents', async () => {
    const consumer = await signUp(ctx);
    await ctx
      .http()
      .post('/v1/kyc/submissions')
      .set(auth(consumer))
      .send({ targetTier: 'TIER_3', documentType: 'BUSINESS_REGISTRATION', documentNumber: 'SECP-12345', businessName: 'Shop', ...basic })
      .expect(422);
    const merchant = await signUp(ctx, { role: 'MERCHANT' });
    const ok = await ctx
      .http()
      .post('/v1/kyc/submissions')
      .set(auth(merchant))
      .send({ targetTier: 'TIER_3', documentType: 'BUSINESS_REGISTRATION', documentNumber: 'SECP-12345', businessName: 'Shop', ...basic })
      .expect(201);
    expect(ok.body.status).toBe('PENDING');
  });

  it('enforces tier limits: TIER_0 cannot hold USD, and per-transaction limits apply', async () => {
    const user = await signUp(ctx);
    const res = await ctx.http().post('/v1/wallets').set(auth(user)).send({ currency: 'USD' }).expect(422);
    expect(res.body.error.code).toBe('CURRENCY_NOT_PERMITTED');

    const pkr = await openWallet(ctx, user, 'PKR');
    const big = await ctx
      .http()
      .post(`/v1/wallets/${pkr}/deposits`)
      .set(auth(user))
      .set('Idempotency-Key', idemKey())
      .send({ amount: '5000.01' }) // TIER_0 PKR per-txn max is 5,000.00
      .expect(422);
    expect(big.body.error).toMatchObject({ code: 'LIMIT_EXCEEDED', details: { limit: 'PER_TRANSACTION' } });
  });

  it('enforces the daily outflow limit across transactions', async () => {
    const user = await signUp(ctx); // TIER_0 PKR: per-txn 5,000 / daily 10,000 / max balance 20,000
    const pkr = await openWallet(ctx, user, 'PKR');
    for (let i = 0; i < 4; i++) {
      await ctx.http().post(`/v1/wallets/${pkr}/deposits`).set(auth(user)).set('Idempotency-Key', idemKey()).send({ amount: '5000' }).expect(201);
    }
    const withdraw = (amount: string) =>
      ctx.http().post(`/v1/wallets/${pkr}/withdrawals`).set(auth(user)).set('Idempotency-Key', idemKey()).send({ amount, pin: user.pin });
    await withdraw('4990').expect(201); // + 4.99 fee
    await withdraw('4990').expect(201); // cumulative 9,989.98
    const third = await withdraw('20').expect(422);
    expect(third.body.error.details.limit).toBe('DAILY');
  });
});
