import { PASSWORD, TestContext, auth, createTestApp, randomPhone, signUp } from './helpers/app';

describe('Auth (integration)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => ctx.close());

  it('exposes health and a correlation id', async () => {
    const res = await ctx.http().get('/health').set('x-correlation-id', 'abc-123').expect(200);
    expect(res.body).toEqual({ status: 'ok', db: 'up', redis: 'up' });
    expect(res.headers['x-correlation-id']).toBe('abc-123');
  });

  it('serves the OpenAPI document', async () => {
    const res = await ctx.http().get('/docs/openapi.json').expect(200);
    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining(['/v1/auth/login', '/v1/transfers', '/v1/fx/conversions', '/v1/admin/ledger/integrity']),
    );
  });

  it('registers, verifies the phone via OTP and logs in', async () => {
    const phone = randomPhone();
    const reg = await ctx.http().post('/v1/auth/register').send({ phone, password: PASSWORD, fullName: 'Ali' }).expect(201);
    expect(reg.body.devOtp).toMatch(/^\d{6}$/);

    // cannot log in before verification
    const early = await ctx.http().post('/v1/auth/login').send({ phone, password: PASSWORD, deviceId: 'd' }).expect(403);
    expect(early.body.error.code).toBe('PHONE_NOT_VERIFIED');

    const wrong = reg.body.devOtp === '000000' ? '111111' : '000000';
    await ctx.http().post('/v1/auth/verify-phone').send({ phone, code: wrong }).expect(400);
    await ctx.http().post('/v1/auth/verify-phone').send({ phone, code: reg.body.devOtp }).expect(200);
    // OTP is single use
    await ctx.http().post('/v1/auth/verify-phone').send({ phone, code: reg.body.devOtp }).expect(400);

    const login = await ctx.http().post('/v1/auth/login').send({ phone, password: PASSWORD, deviceId: 'd' }).expect(200);
    expect(login.body.tokenType).toBe('Bearer');
    const me = await ctx.http().get('/v1/users/me').set('Authorization', `Bearer ${login.body.accessToken}`).expect(200);
    expect(me.body).toMatchObject({ phone, status: 'ACTIVE', kycTier: 'TIER_0', role: 'CONSUMER' });
  });

  it('rejects duplicate registration and self-registration as ADMIN', async () => {
    const user = await signUp(ctx);
    await ctx.http().post('/v1/auth/register').send({ phone: user.phone, password: PASSWORD, fullName: 'Xavier' }).expect(409);
    await ctx
      .http()
      .post('/v1/auth/register')
      .send({ phone: randomPhone(), password: PASSWORD, fullName: 'Xavier', role: 'ADMIN' })
      .expect(400);
  });

  it('rotates refresh tokens and revokes the session on reuse', async () => {
    const user = await signUp(ctx);
    const login = await ctx.http().post('/v1/auth/login').send({ phone: user.phone, password: PASSWORD, deviceId: 'phone-2' }).expect(200);
    const first = login.body.refreshToken;

    const rotated = await ctx.http().post('/v1/auth/refresh').send({ refreshToken: first }).expect(200);
    expect(rotated.body.refreshToken).not.toBe(first);
    expect(rotated.body.sessionId).toBe(login.body.sessionId);

    // replaying the old token = theft signal -> whole session revoked
    const reuse = await ctx.http().post('/v1/auth/refresh').send({ refreshToken: first }).expect(401);
    expect(reuse.body.error.message).toMatch(/reuse/);
    await ctx.http().post('/v1/auth/refresh').send({ refreshToken: rotated.body.refreshToken }).expect(401);
    await ctx.http().get('/v1/users/me').set('Authorization', `Bearer ${rotated.body.accessToken}`).expect(401);
  });

  it('lists device sessions and logs out', async () => {
    const user = await signUp(ctx);
    const sessions = await ctx.http().get('/v1/auth/sessions').set(auth(user)).expect(200);
    expect(sessions.body).toHaveLength(1);
    expect(sessions.body[0].current).toBe(true);
    await ctx.http().post('/v1/auth/logout').set(auth(user)).expect(204);
    await ctx.http().get('/v1/users/me').set(auth(user)).expect(401);
  });

  it('locks the account after repeated failed logins', async () => {
    const user = await signUp(ctx);
    for (let i = 0; i < 3; i++) {
      await ctx.http().post('/v1/auth/login').send({ phone: user.phone, password: 'WrongPass999', deviceId: 'd' }).expect(401);
    }
    const locked = await ctx.http().post('/v1/auth/login').send({ phone: user.phone, password: PASSWORD, deviceId: 'd' }).expect(423);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('does not reveal whether a phone exists', async () => {
    const res = await ctx.http().post('/v1/auth/login').send({ phone: randomPhone(), password: PASSWORD, deviceId: 'd' }).expect(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('enforces PIN strength and locks the PIN after repeated failures', async () => {
    const user = await signUp(ctx, { pin: null });
    await ctx.http().post('/v1/auth/pin').set(auth(user)).send({ password: PASSWORD, pin: '1234' }).expect(400);
    await ctx.http().post('/v1/auth/pin').set(auth(user)).send({ password: PASSWORD, pin: '2580' }).expect(200);

    for (let i = 0; i < 2; i++) {
      const bad = await ctx.http().put('/v1/auth/pin').set(auth(user)).send({ currentPin: '9999', newPin: '1357' }).expect(403);
      expect(bad.body.error.code).toBe('PIN_INVALID');
    }
    const locked = await ctx.http().put('/v1/auth/pin').set(auth(user)).send({ currentPin: '9999', newPin: '1357' }).expect(423);
    expect(locked.body.error.code).toBe('PIN_LOCKED');
    // even the right PIN is refused while locked
    await ctx.http().put('/v1/auth/pin').set(auth(user)).send({ currentPin: '2580', newPin: '1357' }).expect(423);
  });

  it('resets the password via OTP and revokes existing sessions', async () => {
    const user = await signUp(ctx);
    const forgot = await ctx.http().post('/v1/auth/password/forgot').send({ phone: user.phone }).expect(200);
    await ctx
      .http()
      .post('/v1/auth/password/reset')
      .send({ phone: user.phone, code: forgot.body.devOtp, newPassword: 'NewPassword456' })
      .expect(200);
    await ctx.http().get('/v1/users/me').set(auth(user)).expect(401);
    await ctx.http().post('/v1/auth/login').send({ phone: user.phone, password: 'NewPassword456', deviceId: 'd' }).expect(200);
  });

  it('protects admin routes with RBAC', async () => {
    const user = await signUp(ctx);
    const res = await ctx.http().get('/v1/admin/ledger/integrity').set(auth(user)).expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    await ctx.http().get('/v1/users/me').expect(401);
  });
});
