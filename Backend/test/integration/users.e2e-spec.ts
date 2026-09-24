import { TestContext, auth, createAdmin, createTestApp, openWallet, signUp } from './helpers/app';

describe('Users: username and lookup (integration)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => ctx.close());

  const handle = () => `u_${Math.random().toString(36).slice(2, 10)}`;

  it('sets a unique, case-insensitive username', async () => {
    const alice = await signUp(ctx, { fullName: 'Alice Khan' });
    const bob = await signUp(ctx);
    const name = handle();
    const res = await ctx.http().patch('/v1/users/me').set(auth(alice)).send({ username: name.toUpperCase() }).expect(200);
    expect(res.body.username).toBe(name);
    const me = await ctx.http().get('/v1/users/me').set(auth(alice)).expect(200);
    expect(me.body).toMatchObject({ username: name, fullName: 'Alice Khan' });

    const taken = await ctx.http().patch('/v1/users/me').set(auth(bob)).send({ username: name.toUpperCase() }).expect(409);
    expect(taken.body.error.code).toBe('USERNAME_TAKEN');
    const invalid = await ctx.http().patch('/v1/users/me').set(auth(bob)).send({ username: 'no spaces!' }).expect(400);
    expect(invalid.body.error.code).toBe('VALIDATION_FAILED');
    await ctx.http().patch('/v1/users/me').set(auth(bob)).send({ username: 'ab' }).expect(400);
  });

  it('looks users up by phone or @username without exposing personal data', async () => {
    const viewer = await signUp(ctx);
    const target = await signUp(ctx, { tier: 'TIER_1', fullName: 'Ali Raza Khan' });
    await openWallet(ctx, target, 'PKR');
    await openWallet(ctx, target, 'USD');
    const name = handle();
    await ctx.http().patch('/v1/users/me').set(auth(target)).send({ username: name }).expect(200);

    const byPhone = await ctx.http().get(`/v1/users/lookup?q=${encodeURIComponent(target.phone)}`).set(auth(viewer)).expect(200);
    expect(byPhone.body).toEqual({
      userId: target.id,
      username: name,
      displayName: 'Ali K.',
      phoneMasked: `${target.phone.slice(0, 6)}****${target.phone.slice(-3)}`,
      wallets: ['PKR', 'USD'],
    });
    expect(JSON.stringify(byPhone.body)).not.toContain('Raza');

    const byHandle = await ctx.http().get(`/v1/users/lookup?q=@${name.toUpperCase()}`).set(auth(viewer)).expect(200);
    expect(byHandle.body.userId).toBe(target.id);
    const bare = await ctx.http().get(`/v1/users/lookup?q=${name}`).set(auth(viewer)).expect(200);
    expect(bare.body.userId).toBe(target.id);

    // A "+" that arrived un-encoded (decoded to a space) is still understood.
    const plusAsSpace = await ctx.http().get(`/v1/users/lookup?q=+${target.phone.slice(1)}`).set(auth(viewer)).expect(200);
    expect(plusAsSpace.body.userId).toBe(target.id);

    const missing = await ctx.http().get('/v1/users/lookup?q=@nobody_here_xx').set(auth(viewer)).expect(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
    await ctx.http().get('/v1/users/lookup?q=x').set(auth(viewer)).expect(400);
  });

  it('never returns admins or unverified users from lookup', async () => {
    const viewer = await signUp(ctx);
    const admin = await createAdmin(ctx);
    await ctx.http().get(`/v1/users/lookup?q=${encodeURIComponent(admin.phone)}`).set(auth(viewer)).expect(404);
    const phone = `+92311${Math.floor(Math.random() * 1e7).toString().padStart(7, '0')}`;
    await ctx.http().post('/v1/auth/register').send({ phone, password: 'Password123', fullName: 'Pending Person' }).expect(201);
    await ctx.http().get(`/v1/users/lookup?q=${encodeURIComponent(phone)}`).set(auth(viewer)).expect(404);
  });
});
