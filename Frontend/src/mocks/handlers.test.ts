// @vitest-environment node
/**
 * The mock backend must behave like the contract: stateful balances, quote
 * expiry, single-use dynamic QR, async funding, idempotency and error shapes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getResponse } from 'msw';
import { handlers } from './handlers';
import { DEMO, STATIC_QR_PAYLOAD, resetDb } from './db';
import type { z } from 'zod';
import * as P1 from '@/lib/api/contracts/phase1';
import * as P2 from '@/lib/api/contracts/phase2';
import * as F from '@/lib/api/contracts/future';

type Opts = { token?: string; body?: unknown; key?: string };
async function api(method: string, path: string, { token, body, key }: Opts = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (key) headers['idempotency-key'] = key;
  const res = (await getResponse(
    handlers,
    new Request(`http://backend.test/v1${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  ))!;
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

async function tokenFor(phone: string) {
  const r = await api('POST', '/auth/login', { body: { phone, password: 'Password123!', deviceId: 't' } });
  expect(r.status).toBe(200);
  return r.body.accessToken as string;
}

let consumer = '';
let merchant = '';
beforeEach(async () => {
  resetDb();
  consumer = await tokenFor(DEMO.consumer.phone);
  merchant = await tokenFor(DEMO.merchant.phone);
});

async function walletOf(token: string, currency: string) {
  const r = await api('GET', '/wallets', { token });
  return (r.body as { id: string; currency: string; balance: { amountMinor: string } }[]).find(
    (w) => w.currency === currency,
  )!;
}

describe('errors and auth', () => {
  it('returns the contract error envelope with a correlation id', async () => {
    const r = await api('GET', '/wallets');
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({
      error: { code: 'UNAUTHORIZED', message: expect.any(String), correlationId: expect.any(String) },
    });
    expect(r.headers.get('x-correlation-id')).toBeTruthy();
  });
  it('refresh tokens are single use: replaying a rotated one revokes the session', async () => {
    const login = await api('POST', '/auth/login', {
      body: { phone: DEMO.consumer.phone, password: 'Password123!', deviceId: 'r' },
    });
    const rt = login.body.refreshToken;
    const first = await api('POST', '/auth/refresh', { body: { refreshToken: rt } });
    expect(first.status).toBe(200);
    const replay = await api('POST', '/auth/refresh', { body: { refreshToken: rt } });
    expect(replay.status).toBe(401);
    const newer = await api('POST', '/auth/refresh', { body: { refreshToken: first.body.refreshToken } });
    expect(newer.status).toBe(401); // whole session revoked
  });
});

describe('P2P transfers with FX quotes', () => {
  it('moves balances on both sides and replays on the same Idempotency-Key', async () => {
    const pkr = await walletOf(consumer, 'PKR');
    const quote = await api('POST', '/transfers/quotes', {
      token: consumer,
      body: {
        fromWalletId: pkr.id,
        to: { username: 'ali_k' },
        toCurrency: 'PKR',
        amount: '1000.00',
        amountSide: 'SEND',
      },
    });
    expect(quote.status).toBe(201);
    expect(quote.body.fx).toBeNull();
    const body = { quoteId: quote.body.id, pin: DEMO.consumer.pin };
    const pay = await api('POST', '/transfers', { token: consumer, body, key: 'k-transfer-0001' });
    expect(pay.status).toBe(201);
    expect(pay.body).toMatchObject({ type: 'P2P', status: 'COMPLETED', amount: { amountMinor: '100000' } });
    const after = await walletOf(consumer, 'PKR');
    expect(BigInt(after.balance.amountMinor)).toBe(BigInt(pkr.balance.amountMinor) - 100000n);

    const replay = await api('POST', '/transfers', { token: consumer, body, key: 'k-transfer-0001' });
    expect(replay.status).toBe(201);
    expect(replay.headers.get('idempotent-replayed')).toBe('true');
    expect(replay.body.id).toBe(pay.body.id);
    expect((await walletOf(consumer, 'PKR')).balance.amountMinor).toBe(after.balance.amountMinor);

    const reused = await api('POST', '/transfers', {
      token: consumer,
      body: { ...body, note: 'different' },
      key: 'k-transfer-0001',
    });
    expect(reused.status).toBe(422);
    expect(reused.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('cross-currency quotes carry fx rates, a fee, and expire', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const usd = await walletOf(consumer, 'USD');
      const q = await api('POST', '/transfers/quotes', {
        token: consumer,
        body: {
          fromWalletId: usd.id,
          to: { username: 'ali_k' },
          toCurrency: 'PKR',
          amount: '10.00',
          amountSide: 'SEND',
        },
      });
      expect(q.body.fx.midRate).toMatch(/^\d+\.\d{8}$/);
      expect(q.body.fee.amountMinor).toBe('50');
      expect(q.body.totalDebit.amountMinor).toBe('1050');
      expect(BigInt(q.body.receive.amountMinor)).toBeGreaterThan(270000n);
      vi.setSystemTime(Date.now() + 31_000);
      const late = await api('POST', '/transfers', {
        token: consumer,
        body: { quoteId: q.body.id, pin: '1234' },
        key: 'k-expired-01',
      });
      expect(late.status).toBe(422);
      expect(late.body.error.code).toBe('QUOTE_EXPIRED');
    } finally {
      vi.useRealTimers();
    }
  });

  it('PIN_INVALID reports attemptsRemaining and locks after 5 attempts', async () => {
    const pkr = await walletOf(consumer, 'PKR');
    const q = await api('POST', '/transfers/quotes', {
      token: consumer,
      body: { fromWalletId: pkr.id, to: { username: 'ali_k' }, toCurrency: 'PKR', amount: '1.00', amountSide: 'SEND' },
    });
    const bad = await api('POST', '/transfers', {
      token: consumer,
      body: { quoteId: q.body.id, pin: '9999' },
      key: 'k-pin-00001',
    });
    expect(bad.body.error).toMatchObject({ code: 'PIN_INVALID', details: { attemptsRemaining: 4 } });
    for (let i = 0; i < 3; i++)
      await api('POST', '/transfers', {
        token: consumer,
        body: { quoteId: q.body.id, pin: '9999' },
        key: `k-pin-1000${i}`,
      });
    const locked = await api('POST', '/transfers', {
      token: consumer,
      body: { quoteId: q.body.id, pin: '9999' },
      key: 'k-pin-99999',
    });
    expect(locked.body.error.code).toBe('PIN_LOCKED');
    expect(locked.body.error.details.lockedUntil).toBeTruthy();
  });

  it('INSUFFICIENT_FUNDS and LIMIT_EXCEEDED are contract-shaped', async () => {
    const aed = await walletOf(consumer, 'AED');
    const q = await api('POST', '/transfers/quotes', {
      token: consumer,
      body: {
        fromWalletId: aed.id,
        to: { username: 'sara' },
        toCurrency: 'AED',
        amount: '9999.00',
        amountSide: 'SEND',
      },
    });
    const r = await api('POST', '/transfers', {
      token: consumer,
      body: { quoteId: q.body.id, pin: '1234' },
      key: 'k-funds-0001',
    });
    expect(r.body.error.code).toBe('INSUFFICIENT_FUNDS');
    const pkr = await walletOf(consumer, 'PKR');
    const big = await api('POST', '/transfers/quotes', {
      token: consumer,
      body: {
        fromWalletId: pkr.id,
        to: { username: 'ali_k' },
        toCurrency: 'PKR',
        amount: '300000.00',
        amountSide: 'SEND',
      },
    });
    const r2 = await api('POST', '/transfers', {
      token: consumer,
      body: { quoteId: big.body.id, pin: '1234' },
      key: 'k-limit-0001',
    });
    expect(r2.body.error).toMatchObject({ code: 'LIMIT_EXCEEDED', details: { limit: 'PER_TRANSACTION' } });
  });

  it('[backend] business failures are final per key; PIN errors are not recorded', async () => {
    const aed = await walletOf(consumer, 'AED');
    const q = await api('POST', '/transfers/quotes', {
      token: consumer,
      body: {
        fromWalletId: aed.id,
        to: { username: 'sara' },
        toCurrency: 'AED',
        amount: '9999.00',
        amountSide: 'SEND',
      },
    });
    const body = { quoteId: q.body.id, pin: '1234' };
    const first = await api('POST', '/transfers', { token: consumer, body, key: 'k-final-00001' });
    expect(first.body.error.code).toBe('INSUFFICIENT_FUNDS');
    const again = await api('POST', '/transfers', { token: consumer, body, key: 'k-final-00001' });
    expect(again.body.error.code).toBe('INSUFFICIENT_FUNDS');
    expect(again.headers.get('idempotent-replayed')).toBe('true');

    const pkr = await walletOf(consumer, 'PKR');
    const q2 = await api('POST', '/transfers/quotes', {
      token: consumer,
      body: { fromWalletId: pkr.id, to: { username: 'ali_k' }, toCurrency: 'PKR', amount: '10.00', amountSide: 'SEND' },
    });
    const wrong = await api('POST', '/transfers', {
      token: consumer,
      body: { quoteId: q2.body.id, pin: '9999' },
      key: 'k-pin-retry-01',
    });
    expect(wrong.body.error.code).toBe('PIN_INVALID');
    const right = await api('POST', '/transfers', {
      token: consumer,
      body: { quoteId: q2.body.id, pin: '1234' },
      key: 'k-pin-retry-01',
    });
    expect(right.status).toBe(201);
  });

  it('[backend] payment requests must be paid from a wallet in the request currency (CURRENCY_MISMATCH)', async () => {
    const incoming = await api('GET', '/payment-requests?direction=INCOMING', { token: consumer });
    const aedReq = incoming.body.items.find((r: { amount: { currency: string } }) => r.amount.currency === 'AED');
    const pkr = await walletOf(consumer, 'PKR');
    const r = await api('POST', `/payment-requests/${aedReq.id}/accept`, {
      token: consumer,
      body: { fromWalletId: pkr.id, pin: '1234' },
      key: 'k-req-mismatch1',
    });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('CURRENCY_MISMATCH');
    expect(aedReq.requester.type).toBe('USER');
  });

  it('requires an Idempotency-Key on money POSTs', async () => {
    const r = await api('POST', '/transfers', { token: consumer, body: { quoteId: 'x', pin: '1234' } });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('QR payments', () => {
  it('static QR: payer enters the amount; tampered payloads are QR_INVALID', async () => {
    const preview = await api('POST', '/qr/resolve', { token: consumer, body: { payload: STATIC_QR_PAYLOAD } });
    expect(preview.body).toMatchObject({ kind: 'STATIC_MERCHANT', amount: null, payee: { displayName: 'Chai Point' } });
    const pkr = await walletOf(consumer, 'PKR');
    const paid = await api('POST', '/qr/pay', {
      token: consumer,
      body: { previewToken: preview.body.previewToken, fromWalletId: pkr.id, amount: '450.00', pin: '1234' },
      key: 'k-qr-static-01',
    });
    expect(paid.body).toMatchObject({ type: 'QR_MERCHANT', status: 'COMPLETED', amount: { amountMinor: '45000' } });
    const tampered = await api('POST', '/qr/resolve', {
      token: consumer,
      body: { payload: `${STATIC_QR_PAYLOAD.slice(0, -2)}xx` },
    });
    expect(tampered.status).toBe(400);
    expect(tampered.body.error.code).toBe('QR_INVALID');
  });

  it('dynamic QR is single use (409 QR_ALREADY_PAID) and the cashier sees PAID', async () => {
    const qr = await api('POST', '/merchant/qr/dynamic', {
      token: merchant,
      body: { amount: '750.00', currency: 'PKR', expiresInSeconds: 120 },
    });
    expect(qr.status).toBe(201);
    const pkr = await walletOf(consumer, 'PKR');
    const pv = await api('POST', '/qr/resolve', { token: consumer, body: { payload: qr.body.payload } });
    expect(pv.body.amount.amountMinor).toBe('75000');
    const pay = await api('POST', '/qr/pay', {
      token: consumer,
      body: { previewToken: pv.body.previewToken, fromWalletId: pkr.id, pin: '1234' },
      key: 'k-qr-dyn-0001',
    });
    expect(pay.status).toBe(201);
    const status = await api('GET', `/merchant/qr/${qr.body.qrId}`, { token: merchant });
    expect(status.body.status).toBe('PAID');
    const again = await api('POST', '/qr/resolve', { token: consumer, body: { payload: qr.body.payload } });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('QR_ALREADY_PAID');
    // Preview tokens are single use too.
    const reuse = await api('POST', '/qr/pay', {
      token: consumer,
      body: { previewToken: pv.body.previewToken, fromWalletId: pkr.id, pin: '1234' },
      key: 'k-qr-dyn-0002',
    });
    expect(reuse.body.error.code).toBe('QR_PREVIEW_USED');
  });

  it('[backend] status codes: resolve is 200, pay is 201; wrong wallet currency is CURRENCY_MISMATCH', async () => {
    const pv = await api('POST', '/qr/resolve', { token: consumer, body: { payload: STATIC_QR_PAYLOAD } });
    expect(pv.status).toBe(200);
    const usd = await walletOf(consumer, 'USD');
    const r = await api('POST', '/qr/pay', {
      token: consumer,
      body: { previewToken: pv.body.previewToken, fromWalletId: usd.id, amount: '1.00', pin: '1234' },
      key: 'k-qr-ccy-00001',
    });
    expect(r.body.error.code).toBe('CURRENCY_MISMATCH');
  });
});

describe('funding (simulated bank)', () => {
  it('top-up goes PENDING -> SUCCEEDED after the delay and only then credits the wallet', async () => {
    const pkr = await walletOf(consumer, 'PKR');
    const f = await api('POST', '/funding/topups', {
      token: consumer,
      body: { walletId: pkr.id, amount: '2500.00', method: 'BANK_TRANSFER' },
      key: 'k-topup-00001',
    });
    expect(f.body).toMatchObject({ status: 'PENDING', direction: 'TOPUP' });
    expect(f.body.instructions.iban).toBeTruthy();
    expect((await walletOf(consumer, 'PKR')).balance.amountMinor).toBe(pkr.balance.amountMinor);
    await new Promise((r) => setTimeout(r, 80)); // MOCK_FUNDING_DELAY_MS=50 in vitest
    const done = await api('GET', `/funding/transactions/${f.body.id}`, { token: consumer });
    expect(done.body.status).toBe('SUCCEEDED');
    expect(done.body.timeline.map((t: { status: string }) => t.status)).toEqual(['PENDING', 'SUCCEEDED']);
    expect(BigInt((await walletOf(consumer, 'PKR')).balance.amountMinor)).toBe(
      BigInt(pkr.balance.amountMinor) + 250000n,
    );
  });

  it('amounts ending in .13 fail and do not credit', async () => {
    const pkr = await walletOf(consumer, 'PKR');
    const f = await api('POST', '/funding/topups', {
      token: consumer,
      body: { walletId: pkr.id, amount: '13.13', method: 'BANK_TRANSFER' },
      key: 'k-topup-00002',
    });
    await new Promise((r) => setTimeout(r, 80));
    const done = await api('GET', `/funding/transactions/${f.body.id}`, { token: consumer });
    expect(done.body.status).toBe('FAILED');
    expect(done.body.failureReason).toBeTruthy();
    expect((await walletOf(consumer, 'PKR')).balance.amountMinor).toBe(pkr.balance.amountMinor);
  });

  it('withdrawals hold funds immediately and release them on failure', async () => {
    const pkr = await walletOf(consumer, 'PKR');
    const f = await api('POST', '/funding/withdrawals', {
      token: consumer,
      body: {
        walletId: pkr.id,
        amount: '100.13',
        pin: '1234',
        bankAccount: { iban: 'PK36MEZN0000001234567890', accountTitle: 'Ayesha', bankName: 'Meezan' },
      },
      key: 'k-withdraw-001',
    });
    expect(f.body.status).toBe('PENDING');
    expect(BigInt((await walletOf(consumer, 'PKR')).balance.amountMinor)).toBe(
      BigInt(pkr.balance.amountMinor) - 10013n - 2500n,
    );
    await new Promise((r) => setTimeout(r, 80));
    await api('GET', `/funding/transactions/${f.body.id}`, { token: consumer });
    expect((await walletOf(consumer, 'PKR')).balance.amountMinor).toBe(pkr.balance.amountMinor);
  });
});

describe('every mock response satisfies the contract schemas', () => {
  const consumerRoutes: [string, z.ZodType][] = [
    ['/users/me', P1.User],
    ['/wallets', P1.WalletList],
    ['/kyc/me', P1.KycMe],
    ['/kyc/tiers', P1.TierLimitList],
    ['/fx/rates', P1.FxRates],
    ['/auth/sessions', P1.SessionList],
    ['/fees', P2.FeeRuleList],
    ['/transactions?limit=50', P2.ActivityPage],
    ['/payment-requests?direction=INCOMING', P2.PaymentRequestPage],
    ['/payment-requests?direction=OUTGOING', P2.PaymentRequestPage],
    ['/funding/transactions', P2.FundingPage],
    ['/users/lookup?q=%40ali_k', P2.UserLookup],
    ['/cards', F.CardList],
    ['/bills/billers', F.BillerList],
    ['/bills/payments', F.BillPaymentPage],
    ['/bills/schedules', F.BillScheduleList],
    ['/analytics/currencies', F.CurrencyBreakdown],
    ['/analytics/trend?currency=PKR&granularity=MONTH&periods=6', F.Trend],
    ['/analytics/spending?currency=PKR&groupBy=CATEGORY', F.SpendingBreakdown],
    ['/users/me/preferences', F.UserPreferences],
    ['/notifications/preferences', F.NotificationPreferences],
    ['/contacts/recent', F.RecentContactList],
  ];
  it.each(consumerRoutes)('consumer GET %s', async (path, schema) => {
    const r = await api('GET', path, { token: consumer });
    expect(r.status).toBe(200);
    const parsed = schema.safeParse(r.body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues.slice(0, 3))).toBe(true);
  });

  const merchantRoutes: [string, z.ZodType][] = [
    ['/merchant/me', P2.Merchant],
    ['/merchant/dashboard', P2.MerchantDashboard],
    ['/merchant/outlets', P2.OutletList],
    ['/merchant/payments', P2.MerchantPaymentPage],
    ['/merchant/settlements', P2.SettlementPage],
    ['/merchant/refunds', F.MerchantRefundPage],
    ['/merchant/api-keys', F.ApiKeyList],
    ['/merchant/webhooks', F.WebhookEndpointList],
  ];
  it.each(merchantRoutes)('merchant GET %s', async (path, schema) => {
    const r = await api('GET', path, { token: merchant });
    expect(r.status).toBe(200);
    const parsed = schema.safeParse(r.body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues.slice(0, 3))).toBe(true);
  });

  it('settlement detail lines and admin pages parse', async () => {
    const list = await api('GET', '/merchant/settlements', { token: merchant });
    const detail = await api('GET', `/merchant/settlements/${list.body.items[0].id}`, { token: merchant });
    expect(P2.Settlement.safeParse(detail.body).success).toBe(true);
    const adminToken = await tokenFor(DEMO.admin.phone);
    for (const [path, schema] of [
      ['/admin/kyc/submissions?status=PENDING', P1.KycSubmissionList],
      ['/admin/merchants', P2.MerchantPage],
      ['/admin/reconciliation/runs', P2.ReconciliationRunPage],
      ['/admin/approvals', F.ApprovalPage],
      ['/admin/fraud/cases', F.FraudCasePage],
      ['/admin/audit', F.AuditEventPage],
      ['/admin/search?q=khan', F.AdminSearchResult],
      [`/admin/users?phone=${encodeURIComponent(DEMO.consumer.phone)}`, P1.User],
    ] as [string, z.ZodType][]) {
      const r = await api('GET', path, { token: adminToken });
      const parsed = schema.safeParse(r.body);
      expect(parsed.success, `${path}: ${JSON.stringify(parsed.error?.issues.slice(0, 3))}`).toBe(true);
    }
    const run = await api('POST', '/admin/settlements/run', { token: adminToken, body: {} });
    expect(run.status).toBe(200);
    expect(P2.SettlementRun.safeParse(run.body).success).toBe(true);
  });
});

describe('future endpoints are mocked too', () => {
  it('cards reveal requires the PIN and is no-store', async () => {
    const cards = await api('GET', '/cards', { token: consumer });
    const id = cards.body[0].id;
    const bad = await api('POST', `/cards/${id}/reveal`, { token: consumer, body: { pin: '0000' } });
    expect(bad.body.error.code).toBe('PIN_INVALID');
    const ok = await api('POST', `/cards/${id}/reveal`, { token: consumer, body: { pin: '1234' } });
    expect(ok.body.pan).toMatch(/^\d{16}$/);
    expect(ok.headers.get('cache-control')).toBe('no-store');
  });
  it('maker-checker forbids self-approval and applies on a second admin', async () => {
    const maker = await tokenFor(DEMO.admin.phone);
    const checker = await tokenFor(DEMO.checker.phone);
    const w = (await api('GET', '/admin/search?q=ayesha', { token: maker })).body.wallets[0];
    const req = await api('POST', '/admin/approvals', {
      token: maker,
      body: {
        action: 'WALLET_FREEZE',
        targetType: 'WALLET',
        targetId: w.id,
        reason: 'Test freeze request',
        payload: { status: 'FROZEN' },
      },
    });
    expect(req.status).toBe(201);
    const self = await api('POST', `/admin/approvals/${req.body.id}/approve`, { token: maker, body: {} });
    expect(self.body.error.code).toBe('SELF_APPROVAL_FORBIDDEN');
    const ok = await api('POST', `/admin/approvals/${req.body.id}/approve`, { token: checker, body: { note: 'ok' } });
    expect(ok.body.status).toBe('APPROVED');
    const audit = await api('GET', '/admin/audit?action=WALLET_FROZEN', { token: checker });
    expect(audit.body.items.length).toBeGreaterThan(0);
  });
  it('analytics totals are consistent with the currency breakdown', async () => {
    const c = await api('GET', '/analytics/currencies', { token: consumer });
    const sum = c.body.items.reduce(
      (s: bigint, i: { converted: { amountMinor: string } }) => s + BigInt(i.converted.amountMinor),
      0n,
    );
    expect(sum.toString()).toBe(c.body.total.amountMinor);
  });
  it('statement CSV and PDF downloads', async () => {
    const res = (await getResponse(
      handlers,
      new Request('http://backend.test/v1/transactions/statement?format=pdf', {
        headers: { authorization: `Bearer ${consumer}` },
      }),
    ))!;
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect((await res.text()).startsWith('%PDF-1.4')).toBe(true);
  });
});
