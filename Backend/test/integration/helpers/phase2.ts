import { Currency, KycTier } from '@prisma/client';
import { OutboxRelay } from '../../../src/common/outbox/outbox.service';
import { LedgerService } from '../../../src/modules/ledger/ledger.service';
import { signatureHeader } from '../../../src/modules/funding/webhook.signature';
import { TestContext, TestUser, auth, deposit, idemKey, openWallet, signUp } from './app';

export const WEBHOOK_SECRET = 'integration-test-webhook-secret-0123456789';

export async function expectHealthyBooks(ctx: TestContext): Promise<void> {
  const report = await ctx.app.get(LedgerService).integrityReport();
  expect(report).toMatchObject({ healthy: true, unbalancedEntries: [], balanceCacheMismatches: [] });
}

export const drainOutbox = (ctx: TestContext) => ctx.app.get(OutboxRelay).drainAll();

/** A verified consumer with a funded wallet (phase-1 sandbox deposit). */
export async function fundedUser(
  ctx: TestContext,
  opts: { currency?: Currency; amount?: string; tier?: KycTier; fullName?: string } = {},
): Promise<{ user: TestUser; wallet: string }> {
  const user = await signUp(ctx, { tier: opts.tier ?? 'TIER_2', fullName: opts.fullName });
  const wallet = await openWallet(ctx, user, opts.currency ?? 'PKR');
  if (opts.amount !== '0') await deposit(ctx, user, wallet, opts.amount ?? '10000');
  return { user, wallet };
}

export interface TestMerchant {
  owner: TestUser;
  merchantId: string;
  outletId: string;
  staticPayload: string;
  ledgerAccountId: string;
}

/** Onboard + approve a merchant and create one outlet (with its static QR). */
export async function createMerchant(
  ctx: TestContext,
  admin: TestUser,
  opts: { currency?: Currency; mdrBps?: number; delayDays?: number; name?: string } = {},
): Promise<TestMerchant> {
  const owner = await signUp(ctx, { role: 'MERCHANT', tier: 'TIER_3' });
  const created = await ctx
    .http()
    .post('/v1/merchants')
    .set(auth(owner))
    .send({
      businessName: opts.name ?? 'Chai Corner',
      category: '5812',
      registrationNumber: 'REG-12345',
      settlementCurrency: opts.currency ?? 'PKR',
      settlementBank: { iban: 'PK36MEZN0000001123456702', accountTitle: 'Chai Corner Pvt', bankName: 'Meezan Bank' },
    })
    .expect(201);
  const merchantId = created.body.id as string;
  await ctx.http().post(`/v1/admin/merchants/${merchantId}/approve`).set(auth(admin)).expect(200);
  if (opts.mdrBps !== undefined || opts.delayDays !== undefined) {
    await ctx
      .http()
      .put(`/v1/admin/merchants/${merchantId}/pricing`)
      .set(auth(admin))
      .send({ mdrBps: opts.mdrBps ?? 150, settlementDelayDays: opts.delayDays ?? 1 })
      .expect(200);
  }
  const outlet = await ctx.http().post('/v1/merchant/outlets').set(auth(owner)).send({ name: 'Main Branch', address: 'Mall Road' }).expect(201);
  const m = await ctx.prisma.merchant.findUniqueOrThrow({ where: { id: merchantId } });
  return { owner, merchantId, outletId: outlet.body.id, staticPayload: outlet.body.staticQr.payload, ledgerAccountId: m.ledgerAccountId };
}

export async function dynamicQr(ctx: TestContext, m: TestMerchant, amount: string, extra: Record<string, unknown> = {}) {
  const res = await ctx
    .http()
    .post('/v1/merchant/qr/dynamic')
    .set(auth(m.owner))
    .send({ amount, currency: 'PKR', expiresInSeconds: 300, ...extra })
    .expect(201);
  return res.body as { qrId: string; payload: string };
}

export function resolveQr(ctx: TestContext, payer: TestUser, payload: string) {
  return ctx.http().post('/v1/qr/resolve').set(auth(payer)).send({ payload });
}

export function payQr(
  ctx: TestContext,
  payer: TestUser,
  walletId: string,
  previewToken: string,
  opts: { amount?: string; key?: string } = {},
) {
  return ctx
    .http()
    .post('/v1/qr/pay')
    .set(auth(payer))
    .set('Idempotency-Key', opts.key ?? idemKey())
    .send({ previewToken, fromWalletId: walletId, pin: payer.pin, ...(opts.amount ? { amount: opts.amount } : {}) });
}

/** Resolve + pay in one go; asserts the pay status (default 201) and returns the response. */
export async function scanAndPay(ctx: TestContext, payer: TestUser, walletId: string, payload: string, amount?: string, status = 201) {
  const preview = await resolveQr(ctx, payer, payload).expect(200);
  return payQr(ctx, payer, walletId, preview.body.previewToken, { amount }).expect(status);
}

export function signedWebhook(event: Record<string, unknown>, opts: { secret?: string; at?: Date } = {}) {
  const body = JSON.stringify(event);
  return { body, signature: signatureHeader(opts.secret ?? WEBHOOK_SECRET, body, opts.at ?? new Date()) };
}

export function postWebhook(ctx: TestContext, event: Record<string, unknown>, opts: { secret?: string; at?: Date } = {}) {
  const { body, signature } = signedWebhook(event, opts);
  return ctx.http().post('/v1/webhooks/bank').set('Content-Type', 'application/json').set('X-PayCore-Signature', signature).send(body);
}

export const systemAccount = async (ctx: TestContext, code: string) =>
  ctx.prisma.ledgerAccount.findUniqueOrThrow({ where: { code } });
