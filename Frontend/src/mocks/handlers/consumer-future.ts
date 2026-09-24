/** Future-phase consumer endpoints: cards, bills, analytics. */
import type { Currency } from '@/lib/api/contracts/common';
import { convert, customerRate, db, type MockDb } from '../db';
import { authUser, checkDebit, checkPin, idempotent, newPayment, ownWallet, post, userParty } from '../ledger';
import { DAY, fail, isoIn, json, money, noContent, nowIso, paginate, parseDecimal, readJson, uuid } from '../util';
import { del, get, patchR, postR, putR, str } from './route';

type MockCard = MockDb['cards'][number];

function cardView(c: MockCard) {
  const { userId: _u, pan: _p, cvv: _c, amountCap: _a, ...view } = c;
  return view;
}

function myCard(userId: string, id: unknown): MockCard {
  const c = db().cards.find((x) => x.id === id && x.userId === userId);
  if (!c) fail(404, 'NOT_FOUND', 'Card not found');
  return c!;
}

/* ------------------------------- Bills util ------------------------------ */

function fakeBill(billerId: string, reference: string) {
  // Deterministic amount per reference so the demo is repeatable.
  let h = 0;
  for (const ch of `${billerId}${reference}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const major = 1500 + (h % 14000);
  return {
    amountDue: BigInt(major) * 100n,
    customerName: ['AYESHA KHAN', 'M. IMRAN', 'SANA MALIK', 'KAMRAN ALI'][h % 4]!,
  };
}

export const consumerFutureHandlers = [
  /* -------------------------------- Cards -------------------------------- */
  get('/cards', ({ request }) => {
    const user = authUser(request);
    return json(
      db()
        .cards.filter((c) => c.userId === user.id && c.status !== 'TERMINATED')
        .map(cardView),
    );
  }),
  postR('/cards', async ({ request }) => {
    const user = authUser(request);
    const b = await readJson(request);
    return idempotent(request, user, b, () => {
      const w = ownWallet(user, b.walletId);
      const type = str(b.type) === 'SINGLE_USE' ? 'SINGLE_USE' : 'VIRTUAL';
      if (str(b.label).length < 1) fail(400, 'VALIDATION_FAILED', 'Validation failed', ['label is required']);
      const active = db().cards.filter(
        (c) => c.userId === user.id && c.type === 'VIRTUAL' && c.status !== 'TERMINATED',
      );
      if (type === 'VIRTUAL' && active.length >= 5)
        fail(422, 'LIMIT_EXCEEDED', 'You can have at most 5 virtual cards', { limit: 'PER_TRANSACTION' });
      const cap = b.amountCap ? parseDecimal(b.amountCap) : null;
      const last4 = String(1000 + Math.floor(Math.random() * 8999));
      const pan = `4000${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}${last4}`;
      const c = w.currency;
      const card: MockCard = {
        id: uuid(),
        userId: user.id,
        walletId: w.id,
        currency: c,
        type,
        status: 'ACTIVE',
        label: str(b.label),
        brand: 'VISA',
        last4,
        expiryMonth: type === 'SINGLE_USE' ? new Date().getMonth() + 1 : 9,
        expiryYear: type === 'SINGLE_USE' ? new Date().getFullYear() + 1 : 2030,
        cardholderName: user.fullName.toUpperCase(),
        limits: {
          perTransaction: money(cap ?? (c === 'PKR' ? 5_000_000n : 50_000n), c),
          daily: money(cap ?? (c === 'PKR' ? 10_000_000n : 100_000n), c),
          monthly: money(cap ?? (c === 'PKR' ? 30_000_000n : 300_000n), c),
          ecommerce: true,
          international: c !== 'PKR',
        },
        spentThisMonth: money(0n, c),
        createdAt: nowIso(),
        pan,
        cvv: String(100 + Math.floor(Math.random() * 899)),
        amountCap: cap,
      };
      db().cards.unshift(card);
      return { body: cardView(card) };
    });
  }),
  get('/cards/:id', ({ request, params }) => json(cardView(myCard(authUser(request).id, params.id)))),
  postR('/cards/:id/reveal', async ({ request, params }) => {
    const user = authUser(request);
    const b = await readJson(request);
    const c = myCard(user.id, params.id);
    checkPin(user, b.pin);
    if (c.status === 'TERMINATED') fail(422, 'CARD_NOT_ACTIVE', 'Card is terminated');
    const res = json({
      pan: c.pan,
      cvv: c.cvv,
      expiryMonth: c.expiryMonth,
      expiryYear: c.expiryYear,
      hideAt: isoIn(30_000),
    });
    res.headers.set('cache-control', 'no-store');
    return res;
  }),
  postR('/cards/:id/freeze', ({ request, params }) => {
    const c = myCard(authUser(request).id, params.id);
    if (c.status !== 'ACTIVE') fail(422, 'CARD_NOT_ACTIVE', 'Only active cards can be frozen');
    c.status = 'FROZEN';
    return json(cardView(c));
  }),
  postR('/cards/:id/unfreeze', ({ request, params }) => {
    const c = myCard(authUser(request).id, params.id);
    if (c.status !== 'FROZEN') fail(422, 'CARD_NOT_ACTIVE', 'Card is not frozen');
    c.status = 'ACTIVE';
    return json(cardView(c));
  }),
  putR('/cards/:id/limits', async ({ request, params }) => {
    const c = myCard(authUser(request).id, params.id);
    const b = await readJson(request);
    const per = parseDecimal(b.perTransaction);
    const daily = parseDecimal(b.daily);
    const monthly = parseDecimal(b.monthly);
    if (per === null || daily === null || monthly === null || per > daily || daily > monthly) {
      fail(422, 'CARD_LIMIT_INVALID', 'Limits must satisfy per-transaction <= daily <= monthly');
    }
    c.limits = {
      perTransaction: money(per!, c.currency),
      daily: money(daily!, c.currency),
      monthly: money(monthly!, c.currency),
      ecommerce: Boolean(b.ecommerce),
      international: Boolean(b.international),
    };
    return json(cardView(c));
  }),
  postR('/cards/:id/terminate', async ({ request, params }) => {
    const user = authUser(request);
    const b = await readJson(request);
    const c = myCard(user.id, params.id);
    checkPin(user, b.pin);
    c.status = 'TERMINATED';
    return json(cardView(c));
  }),
  get('/cards/:id/transactions', ({ request, params, url }) => {
    const c = myCard(authUser(request).id, params.id);
    return json(
      paginate(
        db()
          .cardTxns.filter((t) => t.cardId === c.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        url,
      ),
    );
  }),

  /* -------------------------------- Bills -------------------------------- */
  get('/bills/billers', ({ request, url }) => {
    authUser(request);
    const cat = url.searchParams.get('category');
    const q = url.searchParams.get('q')?.toLowerCase();
    return json(
      db().billers.filter(
        (b) => (!cat || b.category === cat) && (!q || `${b.name} ${b.shortName}`.toLowerCase().includes(q)),
      ),
    );
  }),
  postR('/bills/inquiries', async ({ request }) => {
    const user = authUser(request);
    const b = await readJson(request);
    const biller = db().billers.find((x) => x.id === b.billerId);
    if (!biller) fail(404, 'NOT_FOUND', 'Biller not found');
    const reference = str(b.reference).replace(/\s+/g, '');
    if (!new RegExp(biller!.referencePattern).test(reference)) {
      fail(400, 'VALIDATION_FAILED', 'Validation failed', [`${biller!.referenceLabel} format is invalid`]);
    }
    if (reference.endsWith('0000'))
      fail(503, 'BILLER_UNAVAILABLE', `${biller!.shortName} is not responding, try again shortly`);
    const { amountDue, customerName } = fakeBill(biller!.id, reference);
    const paid = db().billPayments.some(
      (p) =>
        p.userId === user.id &&
        p.biller.id === biller!.id &&
        p.reference === reference &&
        p.createdAt > new Date(Date.now() - 20 * DAY).toISOString(),
    );
    const inquiryId = uuid();
    const billingMonth = new Date().toISOString().slice(0, 7);
    const dueDate = isoIn(6 * DAY);
    db().billInquiries.set(inquiryId, {
      userId: user.id,
      billerId: biller!.id,
      reference,
      amountDue: paid ? 0n : amountDue,
      expiresAt: Date.now() + 10 * 60_000,
      customerName,
      billingMonth,
      dueDate,
    });
    return json({
      inquiryId,
      biller,
      reference,
      customerName,
      billingMonth,
      amountDue: money(paid ? 0n : amountDue, 'PKR'),
      amountAfterDue: money(paid ? 0n : amountDue + amountDue / 10n, 'PKR'),
      dueDate,
      status: paid ? 'PAID' : 'UNPAID',
      fee: money(0n, 'PKR'),
      expiresAt: isoIn(10 * 60_000),
    });
  }),
  postR('/bills/payments', async ({ request }) => {
    const user = authUser(request);
    const b = await readJson(request);
    return idempotent(request, user, b, () => {
      const inq = db().billInquiries.get(str(b.inquiryId));
      if (!inq || inq.userId !== user.id) fail(404, 'NOT_FOUND', 'Inquiry not found');
      if (inq!.expiresAt < Date.now()) fail(422, 'BILL_INQUIRY_EXPIRED', 'Bill details expired, fetch the bill again');
      if (inq!.amountDue === 0n) fail(409, 'BILL_ALREADY_PAID', 'This bill is already paid');
      const biller = db().billers.find((x) => x.id === inq!.billerId)!;
      const amount = b.amount && biller.allowsPartialPayment ? parseDecimal(b.amount) : inq!.amountDue;
      if (amount === null || amount <= 0n || amount > inq!.amountDue)
        fail(400, 'VALIDATION_FAILED', 'Validation failed', ['amount is invalid']);
      checkPin(user, b.pin);
      const w = ownWallet(user, b.fromWalletId);
      if (w.currency !== biller.currency)
        fail(422, 'CURRENCY_NOT_PERMITTED', `Pay from your ${biller.currency} wallet`);
      checkDebit(user, w, amount!);
      const payee = { type: 'MERCHANT' as const, displayName: biller.name };
      const payment = newPayment({
        type: 'QR_MERCHANT',
        status: 'COMPLETED',
        amount: money(amount!, w.currency),
        fee: money(0n, w.currency),
        totalDebit: money(amount!, w.currency),
        payer: userParty(user),
        payee,
        reference: inq!.reference,
      });
      post(w, {
        paymentId: payment.id,
        type: 'BILL',
        title: `${biller.shortName} bill`,
        counterparty: payee,
        direction: 'OUT',
        amount: amount!,
        fee: 0n,
        category: 'Utilities',
        merchantName: biller.shortName,
      });
      inq!.amountDue -= amount!;
      const bp = {
        id: uuid(),
        userId: user.id,
        paymentId: payment.id,
        biller: { id: biller.id, name: biller.name, category: biller.category },
        reference: inq!.reference,
        customerName: inq!.customerName,
        billingMonth: inq!.billingMonth,
        amount: money(amount!, w.currency),
        fee: money(0n, w.currency),
        status: 'PAID' as const,
        receiptNumber: `RCP${Math.floor(100000 + Math.random() * 899999)}`,
        failureReason: null,
        scheduleId: null,
        createdAt: nowIso(),
        paidAt: nowIso(),
      };
      db().billPayments.unshift(bp);
      const { userId: _u, ...view } = bp;
      return { body: view };
    });
  }),
  get('/bills/payments', ({ request, url }) => {
    const user = authUser(request);
    return json(
      paginate(
        db()
          .billPayments.filter((p) => p.userId === user.id)
          .map(({ userId: _u, ...p }) => p),
        url,
      ),
    );
  }),
  get('/bills/payments/:id', ({ request, params }) => {
    const user = authUser(request);
    const p = db().billPayments.find((x) => x.id === params.id && x.userId === user.id);
    if (!p) fail(404, 'NOT_FOUND', 'Bill payment not found');
    const { userId: _u, ...view } = p!;
    return json(view);
  }),
  get('/bills/schedules', ({ request }) => {
    const user = authUser(request);
    return json(
      db()
        .schedules.filter((s) => s.userId === user.id)
        .map(({ userId: _u, ...s }) => s),
    );
  }),
  postR('/bills/schedules', async ({ request }) => {
    const user = authUser(request);
    const b = await readJson(request);
    return idempotent(request, user, b, () => {
      const biller = db().billers.find((x) => x.id === b.billerId);
      if (!biller) fail(404, 'NOT_FOUND', 'Biller not found');
      checkPin(user, b.pin);
      const w = ownWallet(user, b.fromWalletId);
      const fixed = b.amountMode === 'FIXED' ? parseDecimal(b.fixedAmount) : null;
      if (b.amountMode === 'FIXED' && (fixed === null || fixed <= 0n))
        fail(400, 'VALIDATION_FAILED', 'Validation failed', ['fixedAmount is required']);
      const start = str(b.startDate);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start))
        fail(400, 'VALIDATION_FAILED', 'Validation failed', ['startDate must be YYYY-MM-DD']);
      const s = {
        id: uuid(),
        userId: user.id,
        biller: { id: biller!.id, name: biller!.name, category: biller!.category },
        reference: str(b.reference),
        nickname: str(b.nickname) || null,
        fromWalletId: w.id,
        amountMode: (b.amountMode === 'FIXED' ? 'FIXED' : 'FULL_DUE') as 'FIXED' | 'FULL_DUE',
        fixedAmount: fixed === null ? null : money(fixed, w.currency),
        frequency: (['ONCE', 'WEEKLY', 'MONTHLY'].includes(str(b.frequency)) ? str(b.frequency) : 'MONTHLY') as
          'ONCE' | 'WEEKLY' | 'MONTHLY',
        nextRunAt: new Date(`${start}T09:00:00.000Z`).toISOString(),
        status: 'ACTIVE' as const,
        lastRun: null,
        createdAt: nowIso(),
      };
      db().schedules.unshift(s);
      const { userId: _u, ...view } = s;
      return { body: view };
    });
  }),
  patchR('/bills/schedules/:id', async ({ request, params }) => {
    const user = authUser(request);
    const s = db().schedules.find((x) => x.id === params.id && x.userId === user.id);
    if (!s) fail(404, 'NOT_FOUND', 'Schedule not found');
    const b = await readJson(request);
    if (b.status === 'ACTIVE' || b.status === 'PAUSED') s!.status = b.status;
    if (b.nickname !== undefined) s!.nickname = str(b.nickname) || null;
    if (b.fixedAmount !== undefined) {
      const m = parseDecimal(b.fixedAmount);
      if (m !== null) s!.fixedAmount = money(m, 'PKR');
    }
    const { userId: _u, ...view } = s!;
    return json(view);
  }),
  del('/bills/schedules/:id', ({ request, params }) => {
    const user = authUser(request);
    const i = db().schedules.findIndex((x) => x.id === params.id && x.userId === user.id);
    if (i < 0) fail(404, 'NOT_FOUND', 'Schedule not found');
    db().schedules.splice(i, 1);
    return noContent();
  }),

  /* ------------------------------ Analytics ------------------------------ */
  get('/analytics/spending', ({ request, url }) => {
    const user = authUser(request);
    const currency = (url.searchParams.get('currency') ?? 'PKR') as Currency;
    const groupBy = url.searchParams.get('groupBy') === 'MERCHANT' ? 'MERCHANT' : 'CATEGORY';
    const from = url.searchParams.get('from') ?? new Date(Date.now() - 30 * DAY).toISOString();
    const to = url.searchParams.get('to') ?? nowIso();
    const walletIds = new Set(
      db()
        .wallets.filter((w) => w.userId === user.id && w.currency === currency)
        .map((w) => w.id),
    );
    const groups = new Map<string, { amount: bigint; count: number }>();
    let total = 0n;
    for (const p of db().postings) {
      if (!walletIds.has(p.walletId) || p.direction !== 'OUT' || p.createdAt < from || p.createdAt > to) continue;
      if (groupBy === 'MERCHANT' && !p.merchantName) continue;
      const key = groupBy === 'MERCHANT' ? p.merchantName! : p.category;
      const g = groups.get(key) ?? { amount: 0n, count: 0 };
      g.amount += p.amount;
      g.count += 1;
      groups.set(key, g);
      total += p.amount;
    }
    const list = [...groups.entries()]
      .sort((a, b) => (b[1].amount > a[1].amount ? 1 : -1))
      .map(([key, g]) => {
        const share = total === 0n ? 0n : (g.amount * 10000n) / total; // basis points
        return {
          key,
          label: key,
          amount: money(g.amount, currency),
          count: g.count,
          share: `0.${share.toString().padStart(4, '0')}`,
        };
      });
    return json({ currency, from, to, groupBy, total: money(total, currency), groups: list });
  }),
  get('/analytics/trend', ({ request, url }) => {
    const user = authUser(request);
    const currency = (url.searchParams.get('currency') ?? 'PKR') as Currency;
    const granularity = url.searchParams.get('granularity') === 'DAY' ? 'DAY' : 'MONTH';
    const periods = Math.min(
      24,
      Math.max(1, Number(url.searchParams.get('periods') ?? (granularity === 'DAY' ? 7 : 6))),
    );
    const walletIds = new Set(
      db()
        .wallets.filter((w) => w.userId === user.id && w.currency === currency)
        .map((w) => w.id),
    );
    const keys: string[] = [];
    const now = new Date();
    for (let i = periods - 1; i >= 0; i--) {
      if (granularity === 'DAY') keys.push(new Date(now.getTime() - i * DAY).toISOString().slice(0, 10));
      else keys.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
    }
    const len = granularity === 'DAY' ? 10 : 7;
    const points = keys.map((k) => {
      let inn = 0n;
      let out = 0n;
      for (const p of db().postings) {
        if (!walletIds.has(p.walletId) || p.createdAt.slice(0, len) !== k) continue;
        if (p.direction === 'IN') inn += p.amount;
        else out += p.amount + p.fee;
      }
      return { period: k, in: money(inn, currency), out: money(out, currency) };
    });
    return json({ currency, granularity, points });
  }),
  get('/analytics/currencies', ({ request }) => {
    const user = authUser(request);
    const pref = user.preferences.preferredCurrency;
    const ws = db().wallets.filter((w) => w.userId === user.id && w.status !== 'CLOSED');
    const items = ws.map((w) => ({
      currency: w.currency,
      balance: money(w.balance, w.currency),
      convertedMinor: convert(w.balance, customerRate(w.currency, pref)),
    }));
    const total = items.reduce((s, i) => s + i.convertedMinor, 0n);
    return json({
      preferredCurrency: pref,
      total: money(total, pref),
      rateAsOf: nowIso(),
      items: items.map((i) => {
        const share = total === 0n ? 0n : (i.convertedMinor * 10000n) / total;
        return {
          currency: i.currency,
          balance: i.balance,
          converted: money(i.convertedMinor, pref),
          share: share === 10000n ? '1.0000' : `0.${share.toString().padStart(4, '0')}`,
        };
      }),
    });
  }),
];
