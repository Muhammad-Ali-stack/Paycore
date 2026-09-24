/** QR (receive / resolve / pay) and funding (top-ups, withdrawals, dev simulate). */
import type { Currency } from '@/lib/api/contracts/common';
import { db, fundingDelayMs, makeQrPayload, verifyQrPayload, type MockFunding } from '../db';
import {
  authUser,
  checkDebit,
  checkPin,
  idempotent,
  newPayment,
  ownWallet,
  post,
  requireRole,
  userParty,
  walletFor,
} from '../ledger';
import { bps, fail, isoIn, json, money, nowIso, paginate, parseDecimal, readJson, uuid } from '../util';
import { get, postR, str } from './route';

const PREVIEW_TTL = 120_000;

export const qrHandlers = [
  postR('/qr/receive', async ({ request }) => {
    const user = authUser(request);
    const b = await readJson(request);
    const currency = str(b.currency) as Currency;
    if (!walletFor(user.id, currency)) fail(422, 'WALLET_NOT_ACTIVE', `Open a ${currency} wallet first`);
    const amount = b.amount === undefined || b.amount === '' ? null : parseDecimal(b.amount);
    if (amount !== null && amount <= 0n)
      fail(400, 'VALIDATION_FAILED', 'Validation failed', ['amount must be positive']);
    const qrId = uuid();
    // Amount QRs expire after 15 minutes; open-amount QRs don't expire.
    const expiresAt = amount !== null ? Date.now() + 15 * 60_000 : null;
    const payload = makeQrPayload({ qid: qrId, k: 'P' });
    db().qrs.set(qrId, {
      qrId,
      payload,
      kind: 'P2P_RECEIVE',
      merchantId: null,
      outletId: null,
      userId: user.id,
      currency,
      amount,
      reference: null,
      expiresAt,
      status: 'ACTIVE',
      paymentId: null,
    });
    return json({ qrId, payload, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null }, 201);
  }),

  postR('/qr/resolve', async ({ request }) => {
    const user = authUser(request);
    const b = await readJson(request);
    const claims = verifyQrPayload(str(b.payload));
    if (!claims) fail(400, 'QR_INVALID', 'This QR code is not a valid PayCore code');
    const qr = db().qrs.get(claims!.qrId);
    if (!qr) fail(400, 'QR_INVALID', 'This QR code is not a valid PayCore code');
    if (qr!.expiresAt && qr!.expiresAt < Date.now()) {
      qr!.status = qr!.status === 'ACTIVE' ? 'EXPIRED' : qr!.status;
      fail(422, 'QR_EXPIRED', 'This QR code has expired');
    }
    if (qr!.status === 'PAID') fail(409, 'QR_ALREADY_PAID', 'This QR code has already been paid');
    if (qr!.userId === user.id)
      fail(422, 'VALIDATION_FAILED', 'Validation failed', ['You cannot pay your own QR code']);
    let payee;
    if (qr!.merchantId) {
      const m = db().merchants.find((x) => x.id === qr!.merchantId)!;
      if (m.status !== 'ACTIVE') fail(422, 'MERCHANT_NOT_ACTIVE', 'Merchant is not accepting payments');
      const outlet = db().outlets.find((o) => o.id === qr!.outletId);
      payee = { type: 'MERCHANT' as const, displayName: m.businessName, merchantId: m.id, outletName: outlet?.name };
    } else {
      payee = userParty(db().users.find((u) => u.id === qr!.userId)!);
    }
    const token = `pv_${uuid()}`;
    db().previews.set(token, { token, qrId: qr!.qrId, userId: user.id, expiresAt: Date.now() + PREVIEW_TTL });
    return json({
      previewToken: token,
      kind: qr!.kind,
      payee,
      amount: qr!.amount === null ? null : money(qr!.amount, qr!.currency),
      currency: qr!.currency,
      fee: money(0n, qr!.currency),
      expiresAt: qr!.expiresAt ? new Date(qr!.expiresAt).toISOString() : null,
      previewExpiresAt: isoIn(PREVIEW_TTL),
    });
  }),

  postR('/qr/pay', async ({ request }) => {
    const user = authUser(request);
    const b = await readJson(request);
    return idempotent(request, user, b, () => {
      const pv = db().previews.get(str(b.previewToken));
      if (!pv || pv.userId !== user.id) fail(400, 'QR_PREVIEW_INVALID', 'Preview not found, scan again');
      if (pv!.used) fail(409, 'QR_PREVIEW_USED', 'Preview already used, scan again');
      if (pv!.expiresAt < Date.now()) fail(422, 'QR_PREVIEW_EXPIRED', 'Preview expired, scan again');
      const qr = db().qrs.get(pv!.qrId)!;
      if (qr.status === 'PAID') fail(409, 'QR_ALREADY_PAID', 'This QR code has already been paid');
      if (qr.expiresAt && qr.expiresAt < Date.now()) fail(422, 'QR_EXPIRED', 'This QR code has expired');
      const amount = qr.amount ?? parseDecimal(b.amount);
      if (amount === null || amount <= 0n)
        fail(400, 'VALIDATION_FAILED', 'Validation failed', ['amount is required for this QR']);
      checkPin(user, b.pin);
      const from = ownWallet(user, b.fromWalletId);
      if (from.currency !== qr.currency) fail(422, 'CURRENCY_MISMATCH', `Pay from your ${qr.currency} wallet`);
      checkDebit(user, from, amount!);

      const isMerchant = Boolean(qr.merchantId);
      const merchant = isMerchant ? db().merchants.find((m) => m.id === qr.merchantId)! : null;
      const outlet = db().outlets.find((o) => o.id === qr.outletId);
      const payeeUser = !isMerchant ? db().users.find((u) => u.id === qr.userId)! : null;
      const payee = merchant
        ? {
            type: 'MERCHANT' as const,
            displayName: merchant.businessName,
            merchantId: merchant.id,
            outletName: outlet?.name,
          }
        : userParty(payeeUser!);
      const m = money(amount!, qr.currency);
      const payment = newPayment({
        type: isMerchant ? 'QR_MERCHANT' : 'QR_P2P',
        status: 'COMPLETED',
        amount: m,
        fee: money(0n, qr.currency),
        totalDebit: m,
        payer: userParty(user),
        payee,
        reference: qr.reference,
      });
      post(from, {
        paymentId: payment.id,
        type: payment.type,
        title: payee.displayName,
        counterparty: payee,
        direction: 'OUT',
        amount: amount!,
        fee: 0n,
        category: isMerchant ? 'Dining' : 'Transfers',
        merchantName: merchant?.businessName ?? null,
      });
      if (merchant) {
        db().merchantPayments.set(payment.id, {
          paymentId: payment.id,
          merchantId: merchant.id,
          outletId: qr.outletId,
          mdr: bps(amount!, merchant.mdrBps),
          refunded: 0n,
          settlementId: null,
        });
      } else {
        const to = walletFor(payeeUser!.id, qr.currency)!;
        post(to, {
          paymentId: payment.id,
          type: 'QR_P2P',
          title: `From ${payment.payer.displayName}`,
          counterparty: payment.payer,
          direction: 'IN',
          amount: amount!,
          fee: 0n,
          category: 'Transfers',
          merchantName: null,
        });
      }
      if (qr.kind !== 'STATIC_MERCHANT' && (qr.kind === 'DYNAMIC_MERCHANT' || qr.amount !== null)) {
        qr.status = 'PAID';
        qr.paymentId = payment.id;
      }
      pv!.used = true;
      return { body: payment };
    });
  }),
];

/* -------------------------------- Funding -------------------------------- */

function fundingView(f: MockFunding) {
  const { userId: _u, settleAt: _s, outcome: _o, amountMinor: _a, feeMinor: _f, bankAccount: _b, ...view } = f;
  return view;
}

/** Simulated bank outcome: amounts ending in .13 fail, everything else succeeds. */
function outcomeFor(amount: bigint): 'SUCCEEDED' | 'FAILED' {
  return amount % 100n === 13n ? 'FAILED' : 'SUCCEEDED';
}

export const fundingHandlers = [
  postR('/funding/topups', async ({ request }) => {
    const user = authUser(request);
    const b = await readJson(request);
    return idempotent(request, user, b, () => {
      const w = ownWallet(user, b.walletId);
      if (w.status !== 'ACTIVE') fail(422, 'WALLET_NOT_ACTIVE', 'Wallet is not active');
      const amount = parseDecimal(b.amount);
      if (amount === null || amount <= 0n)
        fail(400, 'VALIDATION_FAILED', 'Validation failed', ['amount must be positive']);
      const method = str(b.method) === 'CARD' ? 'CARD' : 'BANK_TRANSFER';
      const fee = method === 'CARD' ? bps(amount!, 150) : 0n;
      const at = nowIso();
      const f: MockFunding = {
        id: uuid(),
        userId: user.id,
        direction: 'TOPUP',
        method,
        status: 'PENDING',
        walletId: w.id,
        amount: money(amount!, w.currency),
        fee: money(fee, w.currency),
        bankReference: null,
        instructions:
          method === 'BANK_TRANSFER'
            ? {
                bankName: 'PayCore Settlement · Meezan Bank',
                iban: 'PK36MEZN0001234567890123',
                accountTitle: 'PayCore Pvt Ltd - Client Funds',
                reference: `PC-${uuid().slice(0, 8).toUpperCase()}`,
              }
            : null,
        failureReason: null,
        createdAt: at,
        updatedAt: at,
        timeline: [{ status: 'PENDING', at }],
        settleAt: Date.now() + fundingDelayMs(),
        outcome: outcomeFor(amount!),
        amountMinor: amount!,
        feeMinor: fee,
        bankAccount: null,
      };
      db().funding.unshift(f);
      return { body: fundingView(f) };
    });
  }),

  postR('/funding/withdrawals', async ({ request }) => {
    const user = authUser(request);
    const b = await readJson<{
      walletId?: string;
      amount?: string;
      pin?: string;
      bankAccount?: { iban?: string; accountTitle?: string; bankName?: string };
    }>(request);
    return idempotent(request, user, b, () => {
      const errs: string[] = [];
      const iban = str(b.bankAccount?.iban).replace(/\s+/g, '').toUpperCase();
      if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) errs.push('bankAccount.iban is invalid');
      if (str(b.bankAccount?.accountTitle).length < 2) errs.push('bankAccount.accountTitle is required');
      if (str(b.bankAccount?.bankName).length < 2) errs.push('bankAccount.bankName is required');
      const amount = parseDecimal(b.amount);
      if (amount === null || amount <= 0n) errs.push('amount must be positive');
      if (errs.length) fail(400, 'VALIDATION_FAILED', 'Validation failed', errs);
      checkPin(user, b.pin);
      const w = ownWallet(user, b.walletId);
      const fee = ({ PKR: 2500n, AED: 100n, USD: 25n } as const)[w.currency];
      checkDebit(user, w, amount!, fee);
      // Hold funds immediately.
      post(w, {
        paymentId: null,
        type: 'WITHDRAWAL',
        title: `Withdrawal to ${str(b.bankAccount?.bankName)}`,
        counterparty: null,
        direction: 'OUT',
        amount: amount!,
        fee,
        category: 'Withdrawals',
        merchantName: null,
        status: 'PENDING',
      });
      const at = nowIso();
      const f: MockFunding = {
        id: uuid(),
        userId: user.id,
        direction: 'WITHDRAWAL',
        method: 'BANK_TRANSFER',
        status: 'PENDING',
        walletId: w.id,
        amount: money(amount!, w.currency),
        fee: money(fee, w.currency),
        bankReference: null,
        instructions: null,
        failureReason: null,
        createdAt: at,
        updatedAt: at,
        timeline: [{ status: 'PENDING', at }],
        settleAt: Date.now() + fundingDelayMs(),
        outcome: outcomeFor(amount!),
        amountMinor: amount!,
        feeMinor: fee,
        bankAccount: { iban, accountTitle: str(b.bankAccount?.accountTitle), bankName: str(b.bankAccount?.bankName) },
      };
      db().funding.unshift(f);
      return { body: fundingView(f) };
    });
  }),

  get('/funding/transactions', ({ request, url }) => {
    const user = authUser(request);
    const status = url.searchParams.get('status');
    return json(
      paginate(
        db()
          .funding.filter((f) => f.userId === user.id && (!status || f.status === status))
          .map(fundingView),
        url,
      ),
    );
  }),

  get('/funding/transactions/:id', ({ request, params }) => {
    const user = authUser(request);
    const f = db().funding.find((x) => x.id === params.id && (x.userId === user.id || user.role === 'ADMIN'));
    if (!f) fail(404, 'NOT_FOUND', 'Funding transaction not found');
    return json(fundingView(f!));
  }),

  // Non-production only: lets demos drive the outcome. [backend] exactly one of
  // fundingId / settlementId; caller must own it (or be ADMIN); 404 FEATURE_DISABLED when off.
  postR('/dev/bank/simulate', async ({ request }) => {
    if (process.env.MOCK_DEV_BANK === 'disabled') fail(404, 'FEATURE_DISABLED', 'Bank simulator is disabled');
    const user = authUser(request);
    const b = await readJson(request);
    const outcome = str(b.outcome);
    const errs: string[] = [];
    if (!['SUCCEEDED', 'FAILED', 'REVERSED'].includes(outcome)) errs.push('outcome must be SUCCEEDED|FAILED|REVERSED');
    if (Boolean(b.fundingId) === Boolean(b.settlementId)) errs.push('provide exactly one of fundingId or settlementId');
    if (errs.length) fail(400, 'VALIDATION_FAILED', 'Validation failed', errs);
    const delayMs = Math.max(0, Number(b.delayMs ?? 0));
    const eventId = `evt_${uuid().slice(0, 12)}`;
    if (b.settlementId) {
      const merchant = db().merchants.find((m) => m.ownerId === user.id);
      const st = db().settlements.find(
        (x) => x.id === b.settlementId && (user.role === 'ADMIN' || x.merchantId === merchant?.id),
      );
      if (!st) fail(404, 'NOT_FOUND', 'Settlement not found');
      if (outcome === 'SUCCEEDED') {
        st!.status = 'PAID';
        st!.paidAt = nowIso();
        st!.bankReference = `SIM${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
      } else if (outcome === 'FAILED') st!.status = 'FAILED';
      return json({
        reference: st!.id,
        outcome,
        eventId,
        delivered: true,
        scheduledFor: null,
        receipt: { received: true, duplicate: false, outcome: 'APPLIED' },
      });
    }
    const f = db().funding.find((x) => x.id === b.fundingId && (x.userId === user.id || user.role === 'ADMIN'));
    if (!f) fail(404, 'NOT_FOUND', 'Funding transaction not found');
    if (f!.status !== 'PENDING') {
      return json({
        reference: f!.id,
        outcome,
        eventId,
        delivered: true,
        scheduledFor: null,
        receipt: { received: true, duplicate: true, outcome: 'IGNORED' },
      });
    }
    f!.outcome = outcome === 'SUCCEEDED' ? 'SUCCEEDED' : 'FAILED';
    f!.settleAt = Date.now() + delayMs;
    const delivered = delayMs === 0;
    return json({
      reference: f!.instructions?.reference ?? f!.id,
      outcome,
      eventId,
      delivered,
      scheduledFor: delivered ? null : new Date(f!.settleAt).toISOString(),
      ...(delivered ? { receipt: { received: true, duplicate: false, outcome: 'APPLIED' } } : {}),
    });
  }),

  get('/admin/reconciliation/runs', ({ request, url }) => {
    requireRole(authUser(request), 'ADMIN');
    return json(paginate(db().reconRuns, url));
  }),
  get('/admin/reconciliation/runs/:id', ({ request, params }) => {
    requireRole(authUser(request), 'ADMIN');
    const r = db().reconRuns.find((x) => x.id === params.id);
    if (!r) fail(404, 'NOT_FOUND', 'Run not found');
    return json(r);
  }),
  postR('/admin/reconciliation/runs', async ({ request }) => {
    requireRole(authUser(request), 'ADMIN');
    const b = await readJson(request);
    // Default: yesterday (UTC).
    const date = str(b.date) || new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      fail(400, 'VALIDATION_FAILED', 'Validation failed', ['date must be YYYY-MM-DD']);
    const matched = db().funding.filter((f) => f.createdAt.startsWith(date) && f.status === 'SUCCEEDED').length;
    const at = nowIso();
    const run = {
      id: uuid(),
      date,
      status: 'COMPLETED' as const,
      matched,
      missingInLedger: 0,
      missingInBank: 0,
      amountMismatches: 0,
      items: [],
      createdAt: at,
      completedAt: at,
    };
    db().reconRuns.unshift(run);
    return json(run, 201);
  }),
];
