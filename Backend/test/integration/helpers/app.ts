import { randomInt, randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Currency, KycTier, Role } from '@prisma/client';
import RedisMock from 'ioredis-mock';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { configureApp, setupSwagger } from '../../../src/bootstrap';
import { PrismaService } from '../../../src/common/prisma/prisma.service';
import { RedisService } from '../../../src/common/redis/redis.service';
import { hashSecret } from '../../../src/modules/auth/credentials.policy';

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  http: () => ReturnType<typeof request>;
  close: () => Promise<void>;
}

export interface TestUser {
  id: string;
  phone: string;
  password: string;
  token: string;
  pin: string;
}

export const PIN = '2580';
export const PASSWORD = 'Password123';

export async function createTestApp(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RedisService)
    .useValue(new RedisMock())
    .compile();
  const app = moduleRef.createNestApplication({ bufferLogs: true, rawBody: true });
  configureApp(app);
  setupSwagger(app);
  // Listen once on an ephemeral port so supertest doesn't re-bind the server per request.
  await app.listen(0, '127.0.0.1');
  return {
    app,
    prisma: app.get(PrismaService),
    http: () => request(app.getHttpServer()),
    close: () => app.close(),
  };
}

export const randomPhone = (): string => `+92300${randomInt(0, 10_000_000).toString().padStart(7, '0')}`;
export const idemKey = (): string => `test-${randomUUID()}`;

/** Register -> verify OTP -> login -> set PIN -> (optionally) raise KYC tier. */
export async function signUp(
  ctx: TestContext,
  opts: { tier?: KycTier; role?: 'CONSUMER' | 'MERCHANT'; pin?: string | null; fullName?: string } = {},
): Promise<TestUser> {
  const phone = randomPhone();
  const reg = await ctx
    .http()
    .post('/v1/auth/register')
    .send({ phone, password: PASSWORD, fullName: opts.fullName ?? 'Test User', role: opts.role })
    .expect(201);
  await ctx.http().post('/v1/auth/verify-phone').send({ phone, code: reg.body.devOtp }).expect(200);
  const login = await ctx
    .http()
    .post('/v1/auth/login')
    .send({ phone, password: PASSWORD, deviceId: 'device-1' })
    .expect(200);
  const token = login.body.accessToken as string;
  const pin = opts.pin === undefined ? PIN : opts.pin;
  if (pin) {
    await ctx.http().post('/v1/auth/pin').set('Authorization', `Bearer ${token}`).send({ password: PASSWORD, pin }).expect(200);
  }
  if (opts.tier && opts.tier !== 'TIER_0') {
    await ctx.prisma.user.update({ where: { id: reg.body.userId }, data: { kycTier: opts.tier } });
  }
  return { id: reg.body.userId, phone, password: PASSWORD, token, pin: pin ?? '' };
}

export async function createAdmin(ctx: TestContext): Promise<TestUser> {
  const phone = randomPhone();
  const user = await ctx.prisma.user.create({
    data: {
      phone,
      fullName: 'Admin',
      passwordHash: await hashSecret(PASSWORD),
      role: Role.ADMIN,
      status: 'ACTIVE',
      phoneVerifiedAt: new Date(),
      kycTier: 'TIER_3',
    },
  });
  const login = await ctx.http().post('/v1/auth/login').send({ phone, password: PASSWORD, deviceId: 'admin' }).expect(200);
  return { id: user.id, phone, password: PASSWORD, token: login.body.accessToken, pin: '' };
}

export const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.token}` });

export async function openWallet(ctx: TestContext, user: TestUser, currency: Currency): Promise<string> {
  const res = await ctx.http().post('/v1/wallets').set(auth(user)).send({ currency }).expect(201);
  return res.body.id as string;
}

export async function deposit(ctx: TestContext, user: TestUser, walletId: string, amount: string): Promise<void> {
  await ctx
    .http()
    .post(`/v1/wallets/${walletId}/deposits`)
    .set(auth(user))
    .set('Idempotency-Key', idemKey())
    .send({ amount })
    .expect(201);
}

export async function balanceOf(ctx: TestContext, walletId: string): Promise<bigint> {
  const wallet = await ctx.prisma.wallet.findUniqueOrThrow({ where: { id: walletId }, include: { ledgerAccount: true } });
  return wallet.ledgerAccount.balance;
}
