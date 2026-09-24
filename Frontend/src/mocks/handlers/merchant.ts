/** Merchant portal (phase 2) + merchant developer endpoints (future) + admin merchant ops. */
import type { Currency } from '@/lib/api/contracts/common';
import type { MerchantPayment } from '@/lib/api/contracts/phase2';
import { db, makeQrPayload, type MockDb, type MockMerchant, type MockUser } from '../db';
import { audit, authUser, idempotent, post, requireRole } from '../ledger';
import {
  DAY,
  fail,
  isoAgo,
  json,
  money,
  noContent,
  nowIso,
  paginate,
  parseDecimal,
  randomToken,
  readJson,
  uuid,
} from '../util';
import { del, get, patchR, postR, putR, str } from './route';

function myMerchant(user: MockUser): MockMerchant {
  requireRole(user, 'MERCHANT');
  const m = db().merchants.find((x) => x.ownerId === user.id);
  if (!m) fail(404, 'NOT_FOUND', 'Merchant profile not found, complete onboarding');
  return m!;
}

function merchantView(m: MockMerchant) {
  const { ownerId: _o, registrationNumber: _r, settlementBank: _s, website: _w, ...view } = m;
  return view;
}

function merchantPaymentView(id: string): MerchantPayment {
  const p = db().payments.get(id)!;
  const mp = db().merchantPayments.get(id)!;
  const c = p.amount.currency;
  const gross = BigInt(p.amount.amountMinor);
  return {
    ...p,
    mdrFee: money(mp.mdr, c),
    net: money(gross - mp.mdr - mp.refunded, c),
    refundedAmount: money(mp.refunded, c),
  };
}

function paymentsOf(merchantId: string) {
  return [...db().merchantPayments.values()]
    .filter((mp) => mp.merchantId === merchantId)
    .map((mp) => db().payments.get(mp.paymentId)!)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function dynamicView(qrId: string) {
  const q = db().qrs.get(qrId)!;
  if (q.status === 'ACTIVE' && q.expiresAt && q.expiresAt < Date.now()) q.status = 'EXPIRED';
  return {
    qrId: q.qrId,
    payload: q.payload,
    amount: money(q.amount ?? 0n, q.currency),
    expiresAt: new Date(q.expiresAt ?? Date.now()).toISOString(),
    status: q.status,
    paymentId: q.paymentId,
    reference: q.reference,
  };
}

export const merchantHandlers = [
  postR('/merchants', async ({ request }) => {
    const user = authUser(request);
    requireRole(user, 'MERCHANT');
    const b = await readJson<{
      businessName?: string;
      category?: string;
      registrationNumber?: string;
      settlementCurrency?: string;
      settlementBank?: { iban?: string; accountTitle?: string; bankName?: string };
      website?: string;
    }>(request);
    if (db().merchants.some((m) => m.ownerId === user.id)) fail(409, 'MERCHANT_EXISTS', 'Merchant already registered');
    const errs: string[] = [];
    if (str(b.businessName).length < 2) errs.push('businessName is required');
    if (!/^\d{4}$/.test(str(b.category))) errs.push('category must be a 4-digit MCC');
    if (str(b.registrationNumber).length < 3) errs.push('registrationNumber is required');
    if (!['PKR', 'AED', 'USD'].includes(str(b.settlementCurrency))) errs.push('settlementCurrency is invalid');
    if (!b.settlementBank?.iban) errs.push('settlementBank.iban is required');
    if (errs.length) fail(400, 'VALIDATION_FAILED', 'Validation failed', errs);
    const m: MockMerchant = {
      id: uuid(),
      ownerId: user.id,
      businessName: str(b.businessName),
      category: str(b.category),
      status: 'PENDING_REVIEW',
      kybTier: 'KYB_0',
      settlementCurrency: str(b.settlementCurrency) as Currency,
      settlementDelayDays: 2,
      mdrBps: 200,
      createdAt: nowIso(),
      registrationNumber: str(b.registrationNumber),
      settlementBank: {
        iban: str(b.settlementBank?.iban),
        accountTitle: str(b.settlementBank?.accountTitle),
        bankName: str(b.settlementBank?.bankName),
      },
      website: str(b.website) || null,
    };
    db().merchants.push(m);
    return json(merchantView(m), 201);
  }),

  get('/merchant/me', ({ request }) => json(merchantView(myMerchant(authUser(request))))),

  get('/merchant/dashboard', ({ request, url }) => {
    const m = myMerchant(authUser(request));
    const currency = (url.searchParams.get('currency') as Currency | null) ?? m.settlementCurrency;
    const all = paymentsOf(m.id).filter((p) => p.amount.currency === currency);
    const startToday = new Date();
    startToday.setUTCHours(0, 0, 0, 0);
    const todayIso = startToday.toISOString();
    const today = all.filter((p) => p.createdAt >= todayIso);
    const sum = (ps: typeof all) => ps.reduce((s, p) => s + BigInt(p.amount.amountMinor), 0n);
    const todayRefunds = db()
      .refunds.filter((r) => r.merchantId === m.id && r.createdAt >= todayIso)
      .reduce((s, r) => s + BigInt(r.amount.amountMinor), 0n);
    const pending = [...db().merchantPayments.values()]
      .filter((mp) => mp.merchantId === m.id && !mp.settlementId)
      .reduce((s, mp) => {
        const p = db().payments.get(mp.paymentId)!;
        return p.amount.currency === currency ? s + BigInt(p.amount.amountMinor) - mp.mdr - mp.refunded : s;
      }, 0n);
    const series = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(startToday.getTime() - (13 - i) * DAY);
      const key = d.toISOString().slice(0, 10);
      const ps = all.filter((p) => p.createdAt.slice(0, 10) === key);
      return { date: key, volume: money(sum(ps), currency), count: ps.length };
    });
    const last = db().settlements.find((s) => s.merchantId === m.id && s.status === 'PAID');
    const { merchantId: _m, ...lastView } = last ?? ({} as never);
    return json({
      today: { volume: money(sum(today), currency), count: today.length, refunds: money(todayRefunds, currency) },
      pendingSettlement: money(pending, currency),
      lastSettlement: last ? { ...lastView, lines: undefined } : null,
      series,
    });
  }),

  get('/merchant/outlets', ({ request }) => {
    const m = myMerchant(authUser(request));
    return json(
      db()
        .outlets.filter((o) => o.merchantId === m.id)
        .map((o) => ({
          id: o.id,
          name: o.name,
          address: o.address,
          status: o.status,
          staticQr: { qrId: o.staticQrId, payload: db().qrs.get(o.staticQrId)!.payload },
          createdAt: o.createdAt,
        })),
    );
  }),
  postR('/merchant/outlets', async ({ request }) => {
    const m = myMerchant(authUser(request));
    const b = await readJson(request);
    if (str(b.name).length < 2) fail(400, 'VALIDATION_FAILED', 'Validation failed', ['name is required']);
    const id = uuid();
    const qrId = uuid();
    db().qrs.set(qrId, {
      qrId,
      payload: makeQrPayload({ qid: qrId, k: 'S' }),
      kind: 'STATIC_MERCHANT',
      merchantId: m.id,
      outletId: id,
      userId: null,
      currency: m.settlementCurrency,
      amount: null,
      reference: null,
      expiresAt: null,
      status: 'ACTIVE',
      paymentId: null,
    });
    const o = {
      id,
      merchantId: m.id,
      name: str(b.name),
      address: str(b.address) || null,
      status: 'ACTIVE',
      staticQrId: qrId,
      createdAt: nowIso(),
    };
    db().outlets.push(o);
    return json(
      {
        id,
        name: o.name,
        address: o.address,
        status: o.status,
        staticQr: { qrId, payload: db().qrs.get(qrId)!.payload },
        createdAt: o.createdAt,
      },
      201,
    );
  }),
  get('/merchant/outlets/:id/terminals', ({ request, params }) => {
    const m = myMerchant(authUser(request));
    const o = db().outlets.find((x) => x.id === params.id && x.merchantId === m.id);
    if (!o) fail(404, 'NOT_FOUND', 'Outlet not found');
    return json(
      db()
        .terminals.filter((t) => t.outletId === o!.id)
        .map(({ outletId: _o, ...t }) => t),
    );
  }),
  postR('/merchant/outlets/:id/terminals', async ({ request, params }) => {
    const m = myMerchant(authUser(request));
    const o = db().outlets.find((x) => x.id === params.id && x.merchantId === m.id);
    if (!o) fail(404, 'NOT_FOUND', 'Outlet not found');
    const b = await readJson(request);
    const t = { id: uuid(), outletId: o!.id, label: str(b.label) || 'Terminal', status: 'ACTIVE', createdAt: nowIso() };
    db().terminals.push(t);
    const { outletId: _o, ...view } = t;
    return json(view, 201);
  }),

  postR('/merchant/qr/dynamic', async ({ request }) => {
    const m = myMerchant(authUser(request));
    if (m.status !== 'ACTIVE') fail(422, 'MERCHANT_NOT_ACTIVE', 'Merchant is not active yet');
    const b = await readJson(request);
    const amount = parseDecimal(b.amount);
    const ttl = Number(b.expiresInSeconds);
    const errs: string[] = [];
    if (amount === null || amount <= 0n) errs.push('amount must be positive');
    if (!Number.isInteger(ttl) || ttl < 30 || ttl > 3600) errs.push('expiresInSeconds must be 30..3600');
    const currency = (str(b.currency) || m.settlementCurrency) as Currency;
    // [backend] a merchant accepts only its settlement currency.
    if (currency !== m.settlementCurrency)
      fail(422, 'CURRENCY_MISMATCH', `This merchant settles in ${m.settlementCurrency}`);
    if (errs.length) fail(400, 'VALIDATION_FAILED', 'Validation failed', errs);
    const qrId = uuid();
    const outletId = str(b.outletId) || db().outlets.find((o) => o.merchantId === m.id)?.id || null;
    db().qrs.set(qrId, {
      qrId,
      payload: makeQrPayload({ qid: qrId, k: 'D' }),
      kind: 'DYNAMIC_MERCHANT',
      merchantId: m.id,
      outletId,
      userId: null,
      currency,
      amount,
      reference: str(b.reference) || null,
      expiresAt: Date.now() + ttl * 1000,
      status: 'ACTIVE',
      paymentId: null,
    });
    return json(dynamicView(qrId), 201);
  }),
  get('/merchant/qr/:qrId', ({ request, params }) => {
    const m = myMerchant(authUser(request));
    const q = db().qrs.get(String(params.qrId));
    if (!q || q.merchantId !== m.id) fail(404, 'NOT_FOUND', 'QR not found');
    return json(dynamicView(q!.qrId));
  }),

  get('/merchant/payments', ({ request, url }) => {
    const m = myMerchant(authUser(request));
    const sp = url.searchParams;
    const q = sp.get('q')?.toLowerCase();
    const rows = paymentsOf(m.id)
      .filter((p) => !sp.get('status') || p.status === sp.get('status'))
      .filter((p) => !sp.get('from') || p.createdAt >= sp.get('from')!)
      .filter((p) => !sp.get('to') || p.createdAt <= `${sp.get('to')}T23:59:59.999Z`)
      .filter(
        (p) =>
          !q ||
          `${p.id} ${p.payer.displayName} ${p.reference ?? ''} ${p.payee.outletName ?? ''}`.toLowerCase().includes(q),
      )
      .map((p) => merchantPaymentView(p.id));
    return json(paginate(rows, url));
  }),
  get('/merchant/payments/:id', ({ request, params }) => {
    const m = myMerchant(authUser(request));
    const mp = db().merchantPayments.get(String(params.id));
    if (!mp || mp.merchantId !== m.id) fail(404, 'NOT_FOUND', 'Payment not found');
    return json(merchantPaymentView(mp!.paymentId));
  }),
  postR('/merchant/payments/:id/refunds', async ({ request, params }) => {
    const user = authUser(request);
    const m = myMerchant(user);
    const b = await readJson(request);
    return idempotent(request, user, b, () => {
      const mp = db().merchantPayments.get(String(params.id));
      if (!mp || mp.merchantId !== m.id) fail(404, 'NOT_FOUND', 'Payment not found');
      const p = db().payments.get(mp!.paymentId)!;
      const gross = BigInt(p.amount.amountMinor);
      const remaining = gross - mp!.refunded;
      if (remaining <= 0n || p.status === 'REFUNDED')
        fail(422, 'PAYMENT_NOT_REFUNDABLE', 'Payment is already fully refunded');
      const amt = b.amount === undefined || b.amount === '' ? remaining : parseDecimal(b.amount);
      if (amt === null || amt <= 0n) fail(400, 'VALIDATION_FAILED', 'Validation failed', ['amount must be positive']);
      if (amt! > remaining) {
        fail(422, 'REFUND_EXCEEDS_PAYMENT', 'Refund exceeds the refundable amount', {
          refundable: money(remaining, p.amount.currency),
        });
      }
      if (str(b.reason).length < 3) fail(400, 'VALIDATION_FAILED', 'Validation failed', ['reason is required']);
      mp!.refunded += amt!;
      p.status = mp!.refunded === gross ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
      p.timeline.push({ status: p.status, at: nowIso(), reason: str(b.reason) });
      // Credit the payer back if they are a known user wallet.
      const payerPosting = db().postings.find((x) => x.paymentId === p.id && x.direction === 'OUT');
      const payerWallet = payerPosting && db().wallets.find((w) => w.id === payerPosting.walletId);
      if (payerWallet) {
        post(payerWallet, {
          paymentId: p.id,
          type: 'REFUND',
          title: `Refund from ${m.businessName}`,
          counterparty: p.payee,
          direction: 'IN',
          amount: amt!,
          fee: 0n,
          category: 'Refunds',
          merchantName: m.businessName,
        });
      }
      const r = {
        id: uuid(),
        paymentId: p.id,
        merchantId: m.id,
        amount: money(amt!, p.amount.currency),
        status: 'COMPLETED' as const,
        reason: str(b.reason),
        failureReason: null,
        createdAt: nowIso(),
      };
      db().refunds.unshift(r);
      const { merchantId: _m, ...view } = r;
      return { body: view };
    });
  }),
  get('/merchant/refunds', ({ request, url }) => {
    const m = myMerchant(authUser(request));
    const rows = db()
      .refunds.filter((r) => r.merchantId === m.id)
      .map(({ merchantId: _m, ...r }) => {
        const p = db().payments.get(r.paymentId)!;
        return { ...r, payerName: p.payer.displayName, paymentAmount: p.amount };
      });
    return json(paginate(rows, url));
  }),

  get('/merchant/settlements', ({ request, url }) => {
    const m = myMerchant(authUser(request));
    return json(
      paginate(
        db()
          .settlements.filter((s) => s.merchantId === m.id)
          .map(({ merchantId: _m, lines: _l, ...s }) => s),
        url,
      ),
    );
  }),
  get('/merchant/settlements/:id', ({ request, params }) => {
    const m = myMerchant(authUser(request));
    const s = db().settlements.find((x) => x.id === params.id && x.merchantId === m.id);
    if (!s) fail(404, 'NOT_FOUND', 'Settlement not found');
    const { merchantId: _m, ...view } = s!;
    return json(view);
  }),
  get('/merchant/settlements/:id/report.csv', ({ request, params }) => {
    const m = myMerchant(authUser(request));
    const s = db().settlements.find((x) => x.id === params.id && x.merchantId === m.id);
    if (!s) fail(404, 'NOT_FOUND', 'Settlement not found');
    const rows = (s!.lines ?? []).map((l) =>
      [l.kind, l.paymentId ?? '', l.refundId ?? '', l.occurredAt, l.gross.amount, l.mdr.amount, l.net.amount].join(','),
    );
    const csv = [
      'kind,payment_id,refund_id,occurred_at,gross,mdr,net',
      ...rows,
      `TOTAL,,,,${s!.gross.amount},${s!.mdr.amount},${s!.net.amount}`,
    ].join('\n');
    return new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="settlement-${s!.id.slice(0, 8)}.csv"`,
      },
    });
  }),

  /* ----------------------------- Developers ------------------------------ */
  get('/merchant/api-keys', ({ request }) => {
    const m = myMerchant(authUser(request));
    return json(
      db()
        .apiKeys.filter((k) => k.merchantId === m.id)
        .map(({ merchantId: _m, ...k }) => k),
    );
  }),
  postR('/merchant/api-keys', async ({ request }) => {
    const m = myMerchant(authUser(request));
    const b = await readJson<{ name?: string; mode?: string; scopes?: string[] }>(request);
    if (str(b.name).length < 2) fail(400, 'VALIDATION_FAILED', 'Validation failed', ['name is required']);
    if (!Array.isArray(b.scopes) || b.scopes.length === 0)
      fail(400, 'VALIDATION_FAILED', 'Validation failed', ['choose at least one scope']);
    const mode = b.mode === 'LIVE' ? 'LIVE' : 'TEST';
    const secret = `${mode === 'LIVE' ? 'sk_live' : 'sk_test'}_${randomToken(24)}`;
    const k = {
      id: uuid(),
      merchantId: m.id,
      name: str(b.name),
      prefix: `${mode === 'LIVE' ? 'pk_live' : 'pk_test'}_${secret.slice(8, 12)}`,
      mode: mode as 'LIVE' | 'TEST',
      scopes: b.scopes!,
      createdAt: nowIso(),
      lastUsedAt: null,
      revokedAt: null,
    };
    db().apiKeys.unshift(k);
    const { merchantId: _m, ...view } = k;
    return json({ ...view, secret }, 201);
  }),
  del('/merchant/api-keys/:id', ({ request, params }) => {
    const m = myMerchant(authUser(request));
    const k = db().apiKeys.find((x) => x.id === params.id && x.merchantId === m.id);
    if (!k) fail(404, 'NOT_FOUND', 'API key not found');
    k!.revokedAt = nowIso();
    return noContent();
  }),
  get('/merchant/webhooks', ({ request }) => {
    const m = myMerchant(authUser(request));
    return json(
      db()
        .webhooks.filter((w) => w.merchantId === m.id)
        .map(({ merchantId: _m, ...w }) => w),
    );
  }),
  postR('/merchant/webhooks', async ({ request }) => {
    const m = myMerchant(authUser(request));
    const b = await readJson<{ url?: string; events?: string[] }>(request);
    if (!/^https:\/\/[^\s]+$/.test(str(b.url))) fail(400, 'WEBHOOK_URL_INVALID', 'Webhook URL must be https');
    if (!Array.isArray(b.events) || !b.events.length)
      fail(400, 'VALIDATION_FAILED', 'Validation failed', ['choose at least one event']);
    const signingSecret = `whsec_${randomToken(20)}`;
    const w = {
      id: uuid(),
      merchantId: m.id,
      url: str(b.url),
      events: b.events!,
      status: 'ENABLED' as const,
      secretPrefix: signingSecret.slice(0, 9),
      createdAt: nowIso(),
      lastDelivery: null,
    };
    db().webhooks.unshift(w);
    const { merchantId: _m, ...view } = w;
    return json({ ...view, signingSecret }, 201);
  }),
  patchR('/merchant/webhooks/:id', async ({ request, params }) => {
    const m = myMerchant(authUser(request));
    const w = db().webhooks.find((x) => x.id === params.id && x.merchantId === m.id);
    if (!w) fail(404, 'NOT_FOUND', 'Webhook not found');
    const b = await readJson<{ url?: string; events?: string[]; status?: 'ENABLED' | 'DISABLED' }>(request);
    if (b.url !== undefined && !/^https:\/\//.test(b.url))
      fail(400, 'WEBHOOK_URL_INVALID', 'Webhook URL must be https');
    Object.assign(w!, {
      ...(b.url ? { url: b.url } : {}),
      ...(b.events ? { events: b.events } : {}),
      ...(b.status ? { status: b.status } : {}),
    });
    const { merchantId: _m, ...view } = w!;
    return json(view);
  }),
  del('/merchant/webhooks/:id', ({ request, params }) => {
    const m = myMerchant(authUser(request));
    const i = db().webhooks.findIndex((x) => x.id === params.id && x.merchantId === m.id);
    if (i < 0) fail(404, 'NOT_FOUND', 'Webhook not found');
    db().webhooks.splice(i, 1);
    return noContent();
  }),
  postR('/merchant/webhooks/:id/test', ({ request, params }) => {
    const m = myMerchant(authUser(request));
    const w = db().webhooks.find((x) => x.id === params.id && x.merchantId === m.id);
    if (!w) fail(404, 'NOT_FOUND', 'Webhook not found');
    const ok = !w!.url.includes('fail');
    const d = {
      id: uuid(),
      webhookId: w!.id,
      event: 'payment.completed',
      statusCode: ok ? 200 : 500,
      ok,
      attempt: 1,
      durationMs: 142,
      createdAt: nowIso(),
    };
    db().deliveries.unshift(d);
    w!.lastDelivery = { at: d.createdAt, statusCode: d.statusCode, ok };
    return json({ deliveryId: d.id, statusCode: d.statusCode, ok, durationMs: d.durationMs });
  }),
  postR('/merchant/webhooks/:id/rotate-secret', ({ request, params }) => {
    const m = myMerchant(authUser(request));
    const w = db().webhooks.find((x) => x.id === params.id && x.merchantId === m.id);
    if (!w) fail(404, 'NOT_FOUND', 'Webhook not found');
    const signingSecret = `whsec_${randomToken(20)}`;
    w!.secretPrefix = signingSecret.slice(0, 9);
    return json({ signingSecret });
  }),
  get('/merchant/webhooks/:id/deliveries', ({ request, params, url }) => {
    const m = myMerchant(authUser(request));
    const w = db().webhooks.find((x) => x.id === params.id && x.merchantId === m.id);
    if (!w) fail(404, 'NOT_FOUND', 'Webhook not found');
    return json(
      paginate(
        db()
          .deliveries.filter((d) => d.webhookId === w!.id)
          .map(({ webhookId: _w, ...d }) => d),
        url,
      ),
    );
  }),

  /* --------------------------- Admin: merchants -------------------------- */
  get('/admin/merchants', ({ request, url }) => {
    requireRole(authUser(request), 'ADMIN');
    const status = url.searchParams.get('status');
    // [backend] paginated
    return json(
      paginate(
        db()
          .merchants.filter((m) => !status || m.status === status)
          .map(merchantView),
        url,
      ),
    );
  }),
  putR('/admin/merchants/:id/pricing', async ({ request, params }) => {
    const admin = authUser(request);
    requireRole(admin, 'ADMIN');
    const m = db().merchants.find((x) => x.id === params.id);
    if (!m) fail(404, 'NOT_FOUND', 'Merchant not found');
    const b = await readJson(request);
    const errs: string[] = [];
    if (!Number.isInteger(b.mdrBps) || Number(b.mdrBps) < 0 || Number(b.mdrBps) > 1000)
      errs.push('mdrBps must be 0..1000');
    if (
      !Number.isInteger(b.settlementDelayDays) ||
      Number(b.settlementDelayDays) < 0 ||
      Number(b.settlementDelayDays) > 30
    ) {
      errs.push('settlementDelayDays must be 0..30');
    }
    if (errs.length) fail(400, 'VALIDATION_FAILED', 'Validation failed', errs);
    const before = { mdrBps: m!.mdrBps, settlementDelayDays: m!.settlementDelayDays };
    m!.mdrBps = Number(b.mdrBps);
    m!.settlementDelayDays = Number(b.settlementDelayDays);
    audit(admin, 'MERCHANT_PRICING_UPDATED', 'MERCHANT', m!.id, {
      before,
      after: { mdrBps: m!.mdrBps, settlementDelayDays: m!.settlementDelayDays },
    });
    return json(merchantView(m!));
  }),
  postR('/admin/merchants/:id/approve', ({ request, params }) => {
    const admin = authUser(request);
    requireRole(admin, 'ADMIN');
    const m = db().merchants.find((x) => x.id === params.id);
    if (!m) fail(404, 'NOT_FOUND', 'Merchant not found');
    m!.status = 'ACTIVE';
    if (m!.kybTier === 'KYB_0') m!.kybTier = 'KYB_1';
    audit(admin, 'MERCHANT_APPROVED', 'MERCHANT', m!.id);
    return json(merchantView(m!));
  }),
  postR('/admin/merchants/:id/suspend', ({ request, params }) => {
    const admin = authUser(request);
    requireRole(admin, 'ADMIN');
    const m = db().merchants.find((x) => x.id === params.id);
    if (!m) fail(404, 'NOT_FOUND', 'Merchant not found');
    m!.status = 'SUSPENDED';
    audit(admin, 'MERCHANT_SUSPENDED', 'MERCHANT', m!.id);
    return json(merchantView(m!));
  }),
  // [backend] 200 { asOf, settlements } with only the settlements created by this run.
  postR('/admin/settlements/run', ({ request }) => {
    const admin = authUser(request);
    requireRole(admin, 'ADMIN');
    const asOf = nowIso();
    const created: MockDb['settlements'] = [];
    for (const m of db().merchants) {
      const unsettled = [...db().merchantPayments.values()].filter((mp) => mp.merchantId === m.id && !mp.settlementId);
      if (!unsettled.length) continue;
      const sid = uuid();
      const c = m.settlementCurrency;
      let gross = 0n;
      let mdr = 0n;
      let refunds = 0n;
      const lines: NonNullable<MockDb['settlements'][number]['lines']> = [];
      for (const mp of unsettled) {
        const p = db().payments.get(mp.paymentId)!;
        const g = BigInt(p.amount.amountMinor);
        gross += g;
        mdr += mp.mdr;
        refunds += mp.refunded;
        mp.settlementId = sid;
        lines.push({
          kind: 'PAYMENT',
          paymentId: p.id,
          refundId: null,
          gross: money(g, c),
          mdr: money(mp.mdr, c),
          net: money(g - mp.mdr, c),
          occurredAt: p.createdAt,
        });
      }
      const st = {
        id: sid,
        merchantId: m.id,
        currency: c,
        periodStart: isoAgo(DAY),
        periodEnd: asOf,
        gross: money(gross, c),
        mdr: money(mdr, c),
        refunds: money(refunds, c),
        net: money(gross - mdr - refunds, c),
        status: 'PENDING' as const,
        paidAt: null,
        bankReference: null,
        lines,
      };
      db().settlements.unshift(st);
      created.push(st);
    }
    audit(admin, 'SETTLEMENT_BATCH_RUN', 'SETTLEMENT', 'batch');
    return json({ asOf, settlements: created.map(({ merchantId: _m, ...st }) => st) });
  }),
];
