import { db, type MockUser } from '../db';
import { authUser, checkPin, toUser } from '../ledger';
import { DAY, fail, isoIn, json, noContent, nowIso, randomToken, readJson, signJwt, uuid, verifyJwt } from '../util';
import { del, get, postR, putR, str } from './route';

/** Mock OTP is always this code (documented in the README). */
export const MOCK_OTP = '123456';
const OTP_TTL = 5 * 60 * 1000;
const PHONE_RE = /^\+\d{10,15}$/;

function accessTtlSeconds(): number {
  const v = Number(process.env.MOCK_ACCESS_TTL_S);
  return Number.isFinite(v) && v > 0 ? v : 900;
}

function issueTokens(user: MockUser, sessionId: string, refreshToken: string) {
  const ttl = accessTtlSeconds();
  const now = Math.floor(Date.now() / 1000);
  const accessToken = signJwt({ sub: user.id, role: user.role, sid: sessionId, iat: now, exp: now + ttl });
  const session = db().sessions.find((s) => s.id === sessionId)!;
  return {
    tokenType: 'Bearer',
    accessToken,
    accessTokenExpiresIn: ttl,
    refreshToken,
    refreshTokenExpiresAt: new Date(session.refreshExpiresAt).toISOString(),
    sessionId,
  };
}

function validatePassword(pw: string): string[] {
  const errs: string[] = [];
  if (pw.length < 8) errs.push('password must be at least 8 characters');
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) errs.push('password must contain letters and digits');
  return errs;
}

export const authHandlers = [
  postR('/auth/register', async ({ request }) => {
    const b = await readJson(request);
    const phone = str(b.phone);
    const errs: string[] = [];
    if (!PHONE_RE.test(phone)) errs.push('phone must be E.164, e.g. +923001234567');
    errs.push(...validatePassword(str(b.password)));
    if (str(b.fullName).trim().length < 2) errs.push('fullName must be at least 2 characters');
    if (b.role && b.role !== 'CONSUMER' && b.role !== 'MERCHANT') errs.push('role must be CONSUMER or MERCHANT');
    if (errs.length) fail(400, 'VALIDATION_FAILED', 'Validation failed', errs);
    if (db().users.some((u) => u.phone === phone)) fail(409, 'CONFLICT', 'Phone number already registered');
    const user: MockUser = {
      id: uuid(),
      phone,
      password: str(b.password),
      fullName: str(b.fullName).trim(),
      username: null,
      role: (b.role as MockUser['role']) ?? 'CONSUMER',
      status: 'PENDING_VERIFICATION',
      kycTier: 'TIER_0',
      phoneVerified: false,
      pin: null,
      pinAttempts: 0,
      pinLockedUntil: null,
      failedLogins: 0,
      createdAt: nowIso(),
      lastLoginAt: null,
      preferences: { language: 'en', preferredCurrency: 'PKR', hideBalances: false },
      notifications: {
        channels: { push: true, sms: true, email: false },
        events: {
          TRANSACTIONS: true,
          REQUESTS: true,
          SECURITY: true,
          BILLS: true,
          LOW_BALANCE: false,
          PRODUCT_NEWS: false,
        },
        lowBalanceThreshold: null,
        locked: ['SECURITY'],
      },
    };
    db().users.push(user);
    db().wallets.push({
      id: uuid(),
      userId: user.id,
      currency: 'PKR',
      status: 'ACTIVE',
      balance: 0n,
      createdAt: nowIso(),
    });
    db().otps.set(phone, { code: MOCK_OTP, expiresAt: Date.now() + OTP_TTL, purpose: 'VERIFY' });
    return json({ userId: user.id, otpExpiresAt: isoIn(OTP_TTL), devOtp: MOCK_OTP }, 201);
  }),

  postR('/auth/verify-phone', async ({ request }) => {
    const b = await readJson(request);
    const otp = db().otps.get(str(b.phone));
    const user = db().users.find((u) => u.phone === str(b.phone));
    if (!user || !otp || otp.purpose !== 'VERIFY') fail(400, 'OTP_INVALID', 'Invalid code');
    if (otp!.expiresAt < Date.now()) fail(400, 'OTP_EXPIRED', 'Code expired, request a new one');
    if (otp!.code !== str(b.code)) fail(400, 'OTP_INVALID', 'Invalid code');
    user!.phoneVerified = true;
    user!.status = 'ACTIVE';
    db().otps.delete(user!.phone);
    return json({ verified: true });
  }),

  postR('/auth/otp/resend', async ({ request }) => {
    const b = await readJson(request);
    const user = db().users.find((u) => u.phone === str(b.phone));
    // Never reveal whether the phone exists.
    if (!user || user.phoneVerified) return json({ sent: true });
    db().otps.set(user.phone, { code: MOCK_OTP, expiresAt: Date.now() + OTP_TTL, purpose: 'VERIFY' });
    return json({ sent: true, otpExpiresAt: isoIn(OTP_TTL), devOtp: MOCK_OTP });
  }),

  postR('/auth/login', async ({ request }) => {
    const b = await readJson(request);
    const user = db().users.find((u) => u.phone === str(b.phone));
    if (!str(b.deviceId)) fail(400, 'VALIDATION_FAILED', 'Validation failed', ['deviceId is required']);
    if (user && user.failedLogins >= 5) fail(423, 'ACCOUNT_LOCKED', 'Too many failed logins, try again later');
    if (!user || user.password !== str(b.password)) {
      if (user) user.failedLogins += 1;
      fail(401, 'INVALID_CREDENTIALS', 'Phone or password is incorrect');
    }
    if (!user!.phoneVerified) fail(403, 'PHONE_NOT_VERIFIED', 'Verify your phone number first');
    if (user!.status === 'SUSPENDED') fail(423, 'ACCOUNT_LOCKED', 'Account suspended');
    user!.failedLogins = 0;
    user!.lastLoginAt = nowIso();
    const refreshToken = randomToken();
    const session = {
      id: uuid(),
      userId: user!.id,
      deviceId: str(b.deviceId),
      deviceName: str(b.deviceName) || null,
      userAgent: request.headers.get('user-agent'),
      ipAddress: request.headers.get('x-forwarded-for') ?? '127.0.0.1',
      createdAt: nowIso(),
      lastUsedAt: nowIso(),
      refreshToken,
      refreshExpiresAt: Date.now() + 30 * DAY,
      previousRefreshTokens: [],
      revoked: false,
    };
    db().sessions.push(session);
    return json(issueTokens(user!, session.id, refreshToken));
  }),

  postR('/auth/refresh', async ({ request }) => {
    const b = await readJson(request);
    const token = str(b.refreshToken);
    const session = db().sessions.find((s) => s.refreshToken === token);
    if (!session) {
      // Reuse of a rotated token: revoke that session entirely (contract behaviour).
      const reused = db().sessions.find((s) => s.previousRefreshTokens.includes(token));
      if (reused) reused.revoked = true;
      fail(401, 'UNAUTHORIZED', 'Invalid refresh token');
    }
    if (session!.revoked || session!.refreshExpiresAt < Date.now()) fail(401, 'UNAUTHORIZED', 'Session expired');
    const user = db().users.find((u) => u.id === session!.userId)!;
    session!.previousRefreshTokens.push(token);
    session!.refreshToken = randomToken();
    session!.lastUsedAt = nowIso();
    return json(issueTokens(user, session!.id, session!.refreshToken));
  }),

  postR('/auth/logout', async ({ request }) => {
    const header = request.headers.get('authorization') ?? '';
    const payload = verifyJwt(header.replace(/^Bearer /, ''));
    const session = payload && db().sessions.find((s) => s.id === payload.sid);
    if (session) session.revoked = true;
    return noContent();
  }),

  get('/auth/sessions', ({ request }) => {
    const user = authUser(request);
    const sid = verifyJwt((request.headers.get('authorization') ?? '').slice(7))?.sid;
    return json(
      db()
        .sessions.filter((s) => s.userId === user.id && !s.revoked)
        .map((s) => ({
          id: s.id,
          deviceId: s.deviceId,
          deviceName: s.deviceName,
          userAgent: s.userAgent,
          ipAddress: s.ipAddress,
          createdAt: s.createdAt,
          lastUsedAt: s.lastUsedAt,
          current: s.id === sid,
        })),
    );
  }),

  del('/auth/sessions/:id', ({ request, params }) => {
    const user = authUser(request);
    const s = db().sessions.find((x) => x.id === params.id && x.userId === user.id);
    if (!s) fail(404, 'NOT_FOUND', 'Session not found');
    s!.revoked = true;
    return noContent();
  }),

  postR('/auth/password/forgot', async ({ request }) => {
    const b = await readJson(request);
    const user = db().users.find((u) => u.phone === str(b.phone));
    if (user) db().otps.set(user.phone, { code: MOCK_OTP, expiresAt: Date.now() + OTP_TTL, purpose: 'RESET' });
    return json({ sent: true });
  }),

  postR('/auth/password/reset', async ({ request }) => {
    const b = await readJson(request);
    const otp = db().otps.get(str(b.phone));
    const user = db().users.find((u) => u.phone === str(b.phone));
    if (!user || !otp || otp.purpose !== 'RESET' || otp.code !== str(b.code)) fail(400, 'OTP_INVALID', 'Invalid code');
    if (otp!.expiresAt < Date.now()) fail(400, 'OTP_EXPIRED', 'Code expired');
    const errs = validatePassword(str(b.newPassword));
    if (errs.length) fail(400, 'VALIDATION_FAILED', 'Validation failed', errs);
    user!.password = str(b.newPassword);
    user!.failedLogins = 0;
    db().otps.delete(user!.phone);
    // Resetting the password signs out every device.
    db()
      .sessions.filter((s) => s.userId === user!.id)
      .forEach((s) => (s.revoked = true));
    return json({ reset: true });
  }),

  postR('/auth/pin', async ({ request }) => {
    const user = authUser(request);
    const b = await readJson(request);
    if (user.password !== str(b.password)) fail(401, 'INVALID_CREDENTIALS', 'Password is incorrect');
    if (!/^\d{4,6}$/.test(str(b.pin))) fail(400, 'VALIDATION_FAILED', 'Validation failed', ['pin must be 4-6 digits']);
    if (/^(\d)\1+$/.test(str(b.pin)) || '0123456789'.includes(str(b.pin))) {
      fail(400, 'VALIDATION_FAILED', 'Validation failed', ['pin is too easy to guess']);
    }
    user.pin = str(b.pin);
    user.pinAttempts = 0;
    user.pinLockedUntil = null;
    return json({ pinSet: true });
  }),

  changePinHandler(),

  postR('/auth/pin/verify', async ({ request }) => {
    const user = authUser(request);
    const b = await readJson(request);
    checkPin(user, b.pin);
    return json({ valid: true });
  }),

  get('/users/me', ({ request }) => json(toUser(authUser(request)))),
];

function changePinHandler() {
  return putR('/auth/pin', async ({ request }) => {
    const user = authUser(request);
    const b = await readJson(request);
    if (user.pinLockedUntil && user.pinLockedUntil > Date.now()) {
      fail(423, 'PIN_LOCKED', 'Too many wrong PIN attempts', {
        lockedUntil: new Date(user.pinLockedUntil).toISOString(),
      });
    }
    if (user.pin !== str(b.currentPin)) {
      user.pinAttempts += 1;
      fail(422, 'PIN_INVALID', 'Incorrect PIN', { attemptsRemaining: Math.max(0, 5 - user.pinAttempts) });
    }
    if (!/^\d{4,6}$/.test(str(b.newPin)))
      fail(400, 'VALIDATION_FAILED', 'Validation failed', ['newPin must be 4-6 digits']);
    user.pin = str(b.newPin);
    user.pinAttempts = 0;
    return json({ pinSet: true });
  });
}
