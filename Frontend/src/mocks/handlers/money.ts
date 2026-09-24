/** Wallets, FX, fees, transfers, payment requests, payments, activity, statements. */
import type { Currency } from '@/lib/api/contracts/common';
import { convert, customerRate, db, FX_SPREAD_BPS, limitRow, midRate, partyOf, type MockUser } from '../db';
import {
  authUser,
  checkCredit,
  checkDebit,
  checkPin,
  findUserByRef,
  idempotent,
  newPayment,
  ownWallet,
  post,
  toActivity,
  toWallet,
  userParty,
  walletFor,
} from '../ledger';
import { DAY, fail, isoIn, json, money, nowIso, paginate, parseDecimal, rateToString, readJson, uuid } from '../util';
import { get, postR, str } from './route';

const CURRENCIES: Currency[] = ['PKR', 'AED', 'USD'];
const QUOTE_TTL_MS = () => Number(process.env.MOCK_QUOTE_TTL_MS ?? 30_000);

/** Fixed fee for cross-currency transfers, per SEND currency. */
const FX_FIXED_FEE: Record<Currency, bigint> = { PKR: 5000n, AED: 200n, USD: 50n };
const FEE_RULES = [
  { product: 'P2P', bps: 0, fixed: 0n, min: 0n, max: null },
  { product: 'P2P_FX', bps: 0, fixedBy: FX_FIXED_FEE, min: 0n, max: null },
  { product: 'QR_MERCHANT', bps: 0, fixed: 0n, min: 0n, max: null },
  { product: 'REQUEST', bps: 0, fixed: 0n, min: 0n, max: null },
  { product: 'QR_P2P', bps: 0, fixed: 0n, min: 0n, max: null },
  { product: 'TOPUP_CARD', bps: 150, fixed: 0n, min: 0n, max: null },
  { product: 'TOPUP_BANK_TRANSFER', bps: 0, fixed: 0n, min: 0n, max: null },
  {
    product: 'WITHDRAWAL',
    bps: 0,
    fixedBy: { PKR: 2500n, AED: 100n, USD: 25n } as Record<Currency, bigint>,
    min: 0n,
    max: null,
  },
];

function amountOrFail(v: unknown): bigint {
  const m = parseDecimal(v);
  if (m === null || m <= 0n)
    fail(400, 'VALIDATION_FAILED', 'Validation failed', [
      'amount must be a positive decimal string with at most 2 decimals',
    ]);
  return m!;
}

function wireTransfer(opts: {
  payer: MockUser;
  fromWalletId: string;
  payee: MockUser;
  toCurrency: Currency;
  send: bigint;
  receive: bigint;
  fee: bigint;
  note: string | null;
  type: 'P2P' | 'P2P_FX' | 'REQUEST';
}) {
  const from = ownWallet(opts.payer, opts.fromWalletId);
  checkDebit(opts.payer, from, opts.send, opts.fee);
  let to = walletFor(opts.payee.id, opts.toCurrency);
  if (!to) {
    // Auto-open the recipient wallet if their tier permits the currency.
    if (!limitRow(opts.payee.kycTier, opts.toCurrency).permitted) {
      fail(422, 'CURRENCY_NOT_PERMITTED', `Recipient cannot receive ${opts.toCurrency}`);
    }
    to = {
      id: uuid(),
      userId: opts.payee.id,
      currency: opts.toCurrency,
      status: 'ACTIVE',
      balance: 0n,
      createdAt: nowIso(),
    };
    db().wallets.push(to);
  }
  if (to.status !== 'ACTIVE') fail(422, 'WALLET_NOT_ACTIVE', 'Recipient wallet is not active');
  checkCredit(opts.payee, to, opts.receive);

  const payment = newPayment({
    type: opts.type,
    status: 'COMPLETED',
    amount: money(opts.send, from.currency),
    fee: money(opts.fee, from.currency),
    totalDebit: money(opts.send + opts.fee, from.currency),
    received: money(opts.receive, to.currency),
    payer: userParty(opts.payer),
    payee: userParty(opts.payee),
    reference: opts.note,
  });
  const txId = uuid();
  post(from, {
    paymentId: payment.id,
    transactionId: txId,
    type: opts.type,
    title: `To ${payment.payee.displayName}`,
    counterparty: payment.payee,
    direction: 'OUT',
    amount: opts.send,
    fee: opts.fee,
    category: 'Transfers',
    merchantName: null,
  });
  post(to, {
    paymentId: payment.id,
    transactionId: txId,
    type: opts.type,
    title: `From ${payment.payer.displayName}`,
    counterparty: payment.payer,
    direction: 'IN',
    amount: opts.receive,
    fee: 0n,
    category: 'Transfers',
    merchantName: null,
  });
  return payment;
}

export const moneyHandlers = [
  /* ------------------------------- Wallets ------------------------------- */
  get('/wallets', ({ request }) => {
    const user = authUser(request);
    return json(
      db()
        .wallets.filter((w) => w.userId === user.id && w.status !== 'CLOSED')
        .map(toWallet),
    );
  }),
  postR('/wallets', async ({ request }) => {
    const user = authUser(request);
    const b = await readJson(request);
    const currency = str(b.currency) as Currency;
    if (!CURRENCIES.includes(currency))
      fail(400, 'VALIDATION_FAILED', 'Validation failed', ['currency must be PKR|AED|USD']);
    if (!limitRow(user.kycTier, currency).permitted)
      fail(422, 'CURRENCY_NOT_PERMITTED', `${currency} requires a higher KYC tier`);
    if (walletFor(user.id, currency)) fail(409, 'CONFLICT', `You already have a ${currency} wallet`);
    const w = { id: uuid(), userId: user.id, currency, status: 'ACTIVE' as const, balance: 0n, createdAt: nowIso() };
    db().wallets.push(w);
    return json(toWallet(w), 201);
  }),
  get('/wallets/:id', ({ request, params }) => json(toWallet(ownWallet(authUser(request), params.id)))),
  get('/wallets/:id/transactions', ({ request, params, url }) => {
    const w = ownWallet(authUser(request), params.id);
    const rows = db()
      .postings.filter((p) => p.walletId === w.id)
      .map((p) => ({
        postingId: p.id,
        transactionId: p.transactionId,
        type: p.type,
        description: p.title,
        direction: p.direction,
        currency: w.currency,
        amount: money(p.amount, w.currency).amount,
        amountMinor: p.amount.toString(),
        balanceAfter: money(p.balanceAfter, w.currency).amount,
        metadata: null,
        createdAt: p.createdAt,
      }));
    return json(paginate(rows, url));
  }),
  // Phase-1 synchronous sandbox rail (superseded by /funding in phase 2).
  postR('/wallets/:id/deposits', async ({ request, params }) => {
    const user = authUser(request);
    const b = await readJson(request);
    return idempotent(request, user, b, () => {
      const w = ownWallet(user, params.id);
      const amt = amountOrFail(b.amount);
      const p = post(w, {
        paymentId: null,
        type: 'DEPOSIT',
        title: 'Sandbox deposit',
        counterparty: null,
        direction: 'IN',
        amount: amt,
        fee: 0n,
        category: 'Top-ups',
        merchantName: null,
      });
      return { body: legacyTx(p.transactionId, 'DEPOSIT', w.id, 'IN', w.currency, amt, w.balance) };
    });
  }),
  postR('/wallets/:id/withdrawals', async ({ request, params }) => {
    const user = authUser(request);
    const b = await readJson(request);
    return idempotent(request, user, b, () => {
      checkPin(user, b.pin);
      const w = ownWallet(user, params.id);
      const amt = amountOrFail(b.amount);
      checkDebit(user, w, amt);
      const p = post(w, {
        paymentId: null,
        type: 'WITHDRAWAL',
        title: 'Sandbox withdrawal',
        counterparty: null,
        direction: 'OUT',
        amount: amt,
        fee: 0n,
        category: 'Withdrawals',
        merchantName: null,
      });
      return { body: legacyTx(p.transactionId, 'WITHDRAWAL', w.id, 'OUT', w.currency, amt, w.balance) };
    });
  }),

  /* ---------------------------------- FX --------------------------------- */
  get('/fx/rates', () => {
    const rates = [];
    for (const from of CURRENCIES)
      for (const to of CURRENCIES)
        if (from !== to)
          rates.push({
            from,
            to,
            midRate: rateToString(midRate(from, to)),
            customerRate: rateToString(customerRate(from, to)),
          });
    return json({ pairs: rates, spreadBps: Number(FX_SPREAD_BPS), feeBps: 0 });
  }),
  postR('/fx/quotes', async ({ request }) => {
    const user = authUser(request);
    const b = await readJson(request);
    const from = str(b.fromCurrency) as Currency;
    const to = str(b.toCurrency) as Currency;
    if (!CURRENCIES.includes(from) || !CURRENCIES.includes(to) || from === to) {
      fail(400, 'VALIDATION_FAILED', 'Validation failed', ['fromCurrency and toCurrency must differ']);
    }
    const sell = amountOrFail(b.sellAmount);
    const rate = customerRate(from, to);
    const q = {
      id: uuid(),
      userId: user.id,
      from,
      to,
      sell,
      buy: convert(sell, rate),
      fee: FX_FIXED_FEE[from],
      midRate: midRate(from, to),
      customerRate: rate,
      expiresAt: Date.now() + QUOTE_TTL_MS(),
      used: false,
    };
    db().fxQuotes.set(q.id, q);
    return json(fxQuoteView(q), 201);
  }),
  postR('/fx/conversions', async ({ request }) => {
    const user = authUser(request);
    const b = await readJson(request);
    return idempotent(request, user, b, () => {
      const q = db().fxQuotes.get(str(b.quoteId));
      if (!q || q.userId !== user.id) fail(404, 'NOT_FOUND', 'Quote not found');
      if (q!.used || q!.expiresAt < Date.now()) fail(422, 'QUOTE_EXPIRED', 'Quote expired, request a new one');
      checkPin(user, b.pin);
      const fromW = walletFor(user.id, q!.from);
      const toW = walletFor(user.id, q!.to);
      if (!fromW || !toW) fail(422, 'WALLET_NOT_ACTIVE', 'Open both wallets first');
      checkDebit(user, fromW!, q!.sell, q!.fee);
      q!.used = true;
      const txId = uuid();
      post(fromW!, {
        paymentId: null,
        transactionId: txId,
        type: 'FX_CONVERSION',
        title: `Converted to ${q!.to}`,
        counterparty: null,
        direction: 'OUT',
        amount: q!.sell,
        fee: q!.fee,
        category: 'Conversions',
        merchantName: null,
      });
      post(toW!, {
        paymentId: null,
        transactionId: txId,
        type: 'FX_CONVERSION',
        title: `Converted from ${q!.from}`,
        counterparty: null,
        direction: 'IN',
        amount: q!.buy,
        fee: 0n,
        category: 'Conversions',
        merchantName: null,
      });
      return {
        body: {
          quote: fxQuoteView(q!),
          transaction: {
            id: txId,
            type: 'FX_CONVERSION',
            status: 'COMPLETED',
            description: `${q!.from} to ${q!.to}`,
            reversalOfId: null,
            metadata: null,
            createdAt: nowIso(),
            legs: [
              leg(fromW!.id, 'OUT', q!.from, q!.sell + q!.fee, fromW!.balance),
              leg(toW!.id, 'IN', q!.to, q!.buy, toW!.balance),
            ],
          },
        },
      };
    });
  }),

  get('/fees', () =>
    json(
      FEE_RULES.flatMap((r) =>
        CURRENCIES.map((c) => ({
          product: r.product,
          currency: c,
          bps: r.bps,
          fixed: money('fixedBy' in r && r.fixedBy ? r.fixedBy[c] : (r as { fixed: bigint }).fixed, c),
          min: money(r.min, c),
          max: r.max,
        })),
      ),
    ),
  ),

  /* ------------------------------- Transfers ----------------------------- */
  postR('/transfers/quotes', async ({ request }) => {
    const user = authUser(request);
    const b = await readJson<{
      fromWalletId?: string;
      to?: { phone?: string; username?: string };
      toCurrency?: string;
      amount?: string;
      amountSide?: string;
    }>(request);
    const from = ownWallet(user, b.fromWalletId);
    const toCurrency = str(b.toCurrency) as Currency;
    if (!CURRENCIES.includes(toCurrency))
      fail(400, 'VALIDATION_FAILED', 'Validation failed', ['toCurrency is invalid']);
    if (b.amountSide !== 'SEND' && b.amountSide !== 'RECEIVE')
      fail(400, 'VALIDATION_FAILED', 'Validation failed', ['amountSide must be SEND|RECEIVE']);
    const payee = findUserByRef(b.to ?? {});
    if (!payee || payee.role === 'ADMIN') fail(404, 'NOT_FOUND', 'Recipient not found');
    if (payee!.id === user.id)
      fail(422, 'VALIDATION_FAILED', 'Validation failed', ['You cannot send money to yourself']);
    const amount = amountOrFail(b.amount);
    const sameCurrency = from.currency === toCurrency;
    const rate = customerRate(from.currency, toCurrency);
    let send: bigint;
    let receive: bigint;
    if (b.amountSide === 'SEND') {
      send = amount;
      receive = sameCurrency ? amount : convert(amount, rate);
    } else {
      receive = amount;
      // ceil(receive / rate) so the recipient gets at least the requested amount
      send = sameCurrency ? amount : (amount * 100_000_000n + rate - 1n) / rate;
    }
    const fee = sameCurrency ? 0n : FX_FIXED_FEE[from.currency];
    if (send <= 0n || receive <= 0n) fail(422, 'VALIDATION_FAILED', 'Validation failed', ['amount is too small']);
    const q = {
      id: uuid(),
      userId: user.id,
      fromWalletId: from.id,
      toUserId: payee!.id,
      toCurrency,
      send,
      sendCurrency: from.currency,
      receive,
      fee,
      midRate: sameCurrency ? null : midRate(from.currency, toCurrency),
      customerRate: sameCurrency ? null : rate,
      expiresAt: Date.now() + QUOTE_TTL_MS(),
      used: false,
    };
    db().quotes.set(q.id, q);
    return json(
      {
        id: q.id,
        send: money(send, from.currency),
        receive: money(receive, toCurrency),
        fee: money(fee, from.currency),
        totalDebit: money(send + fee, from.currency),
        fx: sameCurrency ? null : { midRate: rateToString(q.midRate!), customerRate: rateToString(rate) },
        recipient: { displayName: userParty(payee!).displayName, username: payee!.username },
        expiresAt: new Date(q.expiresAt).toISOString(),
      },
      201,
    );
  }),

  postR('/transfers', async ({ request }) => {
    const user = authUser(request);
    const b = await readJson(request);
    return idempotent(request, user, b, () => {
      if (b.quoteId) {
        const q = db().quotes.get(str(b.quoteId));
        if (!q || q.userId !== user.id) fail(404, 'NOT_FOUND', 'Quote not found');
        if (q!.used || q!.expiresAt < Date.now()) fail(422, 'QUOTE_EXPIRED', 'Quote expired, request a new one');
        checkPin(user, b.pin);
        const payee = db().users.find((u) => u.id === q!.toUserId)!;
        const payment = wireTransfer({
          payer: user,
          fromWalletId: q!.fromWalletId,
          payee,
          toCurrency: q!.toCurrency,
          send: q!.send,
          receive: q!.receive,
          fee: q!.fee,
          note: str(b.note) || null,
          type: q!.sendCurrency === q!.toCurrency ? 'P2P' : 'P2P_FX',
        });
        q!.used = true;
        return { body: payment };
      }
      // Phase-1 body (same currency).
      checkPin(user, b.pin);
      const payee = findUserByRef({ phone: b.toPhone, username: b.toUsername });
      if (!payee) fail(404, 'NOT_FOUND', 'Recipient not found');
      const from = ownWallet(user, b.fromWalletId);
      const amt = amountOrFail(b.amount);
      return {
        body: wireTransfer({
          payer: user,
          fromWalletId: from.id,
          payee: payee!,
          toCurrency: from.currency,
          send: amt,
          receive: amt,
          fee: 0n,
          note: str(b.note) || null,
          type: 'P2P',
        }),
      };
    });
  }),

  /* --------------------------- Payment requests -------------------------- */
  get('/payment-requests', ({ request, url }) => {
    const user = authUser(request);
    const direction = url.searchParams.get('direction');
    const status = url.searchParams.get('status');
    for (const r of db().paymentRequests) if (r.status === 'PENDING' && r.expiresAt < nowIso()) r.status = 'EXPIRED';
    const rows = db()
      .paymentRequests.filter((r) =>
        direction === 'INCOMING'
          ? r.payerId === user.id
          : direction === 'OUTGOING'
            ? r.requesterId === user.id
            : r.payerId === user.id || r.requesterId === user.id,
      )
      .filter((r) => !status || r.status === status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(({ requesterId: _r, payerId: _p, ...r }) => r);
    return json(paginate(rows, url));
  }),
  postR('/payment-requests', async ({ request }) => {
    const user = authUser(request);
    const b = await readJson<{
      to?: { phone?: string; username?: string };
      amount?: string;
      currency?: string;
      note?: string;
      expiresInHours?: number;
    }>(request);
    const payer = findUserByRef(b.to ?? {});
    if (!payer || payer.id === user.id) fail(404, 'NOT_FOUND', 'Recipient not found');
    const currency = str(b.currency) as Currency;
    if (!CURRENCIES.includes(currency)) fail(400, 'VALIDATION_FAILED', 'Validation failed', ['currency is invalid']);
    const amt = amountOrFail(b.amount);
    const hours = Math.min(168, Math.max(1, Number(b.expiresInHours ?? 72)));
    const r = {
      id: uuid(),
      requesterId: user.id,
      payerId: payer!.id,
      requester: partyOf(user),
      payer: partyOf(payer!),
      amount: money(amt, currency),
      note: str(b.note) || null,
      status: 'PENDING' as const,
      expiresAt: isoIn(hours * 3600_000),
      paymentId: null,
      createdAt: nowIso(),
    };
    db().paymentRequests.unshift(r);
    const { requesterId: _r, payerId: _p, ...view } = r;
    return json(view, 201);
  }),
  postR('/payment-requests/:id/accept', async ({ request, params }) => {
    const user = authUser(request);
    const b = await readJson(request);
    return idempotent(request, user, b, () => {
      const r = db().paymentRequests.find((x) => x.id === params.id && x.payerId === user.id);
      if (!r) fail(404, 'NOT_FOUND', 'Request not found');
      if (r!.status === 'PENDING' && r!.expiresAt < nowIso()) r!.status = 'EXPIRED';
      if (r!.status === 'EXPIRED') fail(422, 'PAYMENT_REQUEST_EXPIRED', 'This request has expired');
      if (r!.status !== 'PENDING') fail(409, 'PAYMENT_REQUEST_NOT_PENDING', `Request is ${r!.status.toLowerCase()}`);
      checkPin(user, b.pin);
      const from = ownWallet(user, b.fromWalletId);
      if (from.currency !== r!.amount.currency)
        fail(422, 'CURRENCY_MISMATCH', `Pay from your ${r!.amount.currency} wallet`);
      const requester = db().users.find((u) => u.id === r!.requesterId)!;
      const amt = BigInt(r!.amount.amountMinor);
      const payment = wireTransfer({
        payer: user,
        fromWalletId: from.id,
        payee: requester,
        toCurrency: from.currency,
        send: amt,
        receive: amt,
        fee: 0n,
        note: r!.note,
        type: 'REQUEST',
      });
      r!.status = 'ACCEPTED';
      r!.paymentId = payment.id;
      return { body: payment };
    });
  }),
  postR('/payment-requests/:id/decline', ({ request, params }) => {
    const user = authUser(request);
    const r = db().paymentRequests.find((x) => x.id === params.id && x.payerId === user.id);
    if (!r) fail(404, 'NOT_FOUND', 'Request not found');
    if (r!.status !== 'PENDING') fail(409, 'PAYMENT_REQUEST_NOT_PENDING', `Request is ${r!.status.toLowerCase()}`);
    r!.status = 'DECLINED';
    const { requesterId: _r, payerId: _p, ...view } = r!;
    return json(view);
  }),
  postR('/payment-requests/:id/cancel', ({ request, params }) => {
    const user = authUser(request);
    const r = db().paymentRequests.find((x) => x.id === params.id && x.requesterId === user.id);
    if (!r) fail(404, 'NOT_FOUND', 'Request not found');
    if (r!.status !== 'PENDING') fail(409, 'PAYMENT_REQUEST_NOT_PENDING', `Request is ${r!.status.toLowerCase()}`);
    r!.status = 'CANCELLED';
    const { requesterId: _r, payerId: _p, ...view } = r!;
    return json(view);
  }),

  /* ------------------------------- Payments ------------------------------ */
  get('/payments/:id', ({ request, params }) => {
    const user = authUser(request);
    const p = db().payments.get(String(params.id));
    const mine = db()
      .wallets.filter((w) => w.userId === user.id)
      .map((w) => w.id);
    const involved =
      p &&
      (db().postings.some((x) => x.paymentId === p.id && mine.includes(x.walletId)) ||
        user.role === 'ADMIN' ||
        (user.role === 'MERCHANT' &&
          db().merchantPayments.get(p.id)?.merchantId === db().merchants.find((m) => m.ownerId === user.id)?.id));
    if (!p || !involved) fail(404, 'NOT_FOUND', 'Payment not found');
    return json(p);
  }),

  /* ------------------------------- Activity ------------------------------ */
  get('/transactions/statement', ({ request, url }) => {
    const user = authUser(request);
    const rows = activityFor(user, url);
    const format = url.searchParams.get('format') ?? 'csv';
    if (format === 'pdf') {
      return new Response(minimalPdf(user, rows.map(toActivity)), {
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': 'attachment; filename="paycore-statement.pdf"',
        },
      });
    }
    // [backend] columns, oldest first, max 10 000 rows
    const header =
      'date,transaction_id,payment_id,type,title,counterparty,direction,currency,amount,fee,balance_after,status';
    const lines = [...rows]
      .reverse()
      .slice(0, 10_000)
      .map((p) => {
        const a = toActivity(p);
        const cells = [
          a.createdAt,
          a.transactionId ?? '',
          a.paymentId ?? '',
          a.type,
          a.title,
          a.counterparty?.displayName ?? '',
          a.direction,
          a.amount.currency,
          a.amount.amount,
          a.fee?.amount ?? '0',
          a.balanceAfter.amount,
          a.status,
        ];
        return cells.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',');
      });
    return new Response([header, ...lines].join('\n'), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="paycore-statement.csv"',
      },
    });
  }),
  get('/transactions', ({ request, url }) => {
    const user = authUser(request);
    return json(paginate(activityFor(user, url).map(toActivity), url));
  }),
];

function activityFor(user: MockUser, url: URL) {
  const sp = url.searchParams;
  const wallets = db().wallets.filter((w) => w.userId === user.id);
  const byId = new Map(wallets.map((w) => [w.id, w]));
  const q = sp.get('q')?.toLowerCase().trim();
  const from = sp.get('from');
  const to = sp.get('to');
  return db().postings.filter((p) => {
    const w = byId.get(p.walletId);
    if (!w) return false;
    if (sp.get('walletId') && p.walletId !== sp.get('walletId')) return false;
    if (sp.get('currency') && w.currency !== sp.get('currency')) return false;
    if (sp.get('type') && p.type !== sp.get('type')) return false;
    if (sp.get('direction') && p.direction !== sp.get('direction')) return false;
    if (from && p.createdAt < from) return false;
    // 'to' is exclusive (date-only values mean the start of that UTC day).
    if (to && p.createdAt >= (to.length === 10 ? `${to}T00:00:00.000Z` : to)) return false;
    if (q && !`${p.title} ${p.counterparty?.displayName ?? ''} ${p.type}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

function leg(walletId: string, direction: 'IN' | 'OUT', currency: Currency, amount: bigint, balance: bigint) {
  const m = money(amount, currency);
  return {
    walletId,
    direction,
    currency,
    amount: m.amount,
    amountMinor: m.amountMinor,
    balanceAfter: money(balance, currency).amount,
  };
}

function legacyTx(
  id: string,
  type: string,
  walletId: string,
  direction: 'IN' | 'OUT',
  currency: Currency,
  amount: bigint,
  balance: bigint,
) {
  return {
    id,
    type,
    status: 'COMPLETED',
    description: type,
    reversalOfId: null,
    metadata: null,
    createdAt: nowIso(),
    legs: [leg(walletId, direction, currency, amount, balance)],
  };
}

function fxQuoteView(q: {
  id: string;
  from: Currency;
  to: Currency;
  sell: bigint;
  buy: bigint;
  fee: bigint;
  midRate: bigint;
  customerRate: bigint;
  expiresAt: number;
  used: boolean;
}) {
  return {
    id: q.id,
    fromCurrency: q.from,
    toCurrency: q.to,
    status: q.used ? 'EXECUTED' : q.expiresAt < Date.now() ? 'EXPIRED' : 'OPEN',
    sell: money(q.sell, q.from),
    buy: money(q.buy, q.to),
    fee: money(q.fee, q.from),
    totalDebit: money(q.sell + q.fee, q.from),
    spreadBps: Number(FX_SPREAD_BPS),
    feeBps: 0,
    journalEntryId: q.used ? uuid() : null,
    midRate: rateToString(q.midRate),
    customerRate: rateToString(q.customerRate),
    expiresAt: new Date(q.expiresAt).toISOString(),
  };
}

/** A tiny valid single-page PDF (Helvetica text). Future endpoint: format=pdf. */
function minimalPdf(user: MockUser, items: ReturnType<typeof toActivity>[]): string {
  const esc = (s: string) => s.replace(/[()\\]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, '?');
  const lines = [
    'PayCore account statement',
    `Account holder: ${user.fullName}`,
    `Generated: ${new Date().toISOString().slice(0, 10)}`,
    ' ',
    ...items
      .slice(0, 40)
      .map(
        (a) =>
          `${a.createdAt.slice(0, 10)}  ${a.direction === 'IN' ? '+' : '-'}${a.amount.amount} ${a.amount.currency}  ${a.title}`,
      ),
  ];
  const text = lines.map((l, i) => `BT /F1 ${i === 0 ? 14 : 9} Tf 40 ${800 - i * 16} Td (${esc(l)}) Tj ET`).join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return out; // ASCII only, so string length == byte offsets
}

export { DAY };
