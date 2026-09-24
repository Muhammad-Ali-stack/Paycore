/**
 * Mock domain logic shared by the handlers: auth, PIN, limits, postings,
 * idempotency, async funding settlement, serializers.
 */
import type { Currency } from '@/lib/api/contracts/common';
import type { ActivityItem, Party, Payment } from '@/lib/api/contracts/phase2';
import type { Wallet, User } from '@/lib/api/contracts/phase1';
import { db, limitRow, partyOf, type MockPosting, type MockUser, type MockWallet } from './db';
import {
  apiError,
  displayNameOf,
  fail,
  fnv,
  isoAgo,
  json,
  maskPhone,
  MockHttpError,
  money,
  nowIso,
  uuid,
  verifyJwt,
} from './util';

export const PIN_MAX_ATTEMPTS = 5;
export const PIN_LOCK_MS = 15 * 60 * 1000;

/* --------------------------------- Auth ---------------------------------- */

export function authUser(request: Request): MockUser {
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const payload = token ? verifyJwt(token) : null;
  if (!payload) fail(401, 'UNAUTHORIZED', 'Missing or invalid access token');
  if (payload!.exp * 1000 < Date.now()) fail(401, 'UNAUTHORIZED', 'Access token expired');
  const session = db().sessions.find((s) => s.id === payload!.sid);
  if (!session || session.revoked) fail(401, 'UNAUTHORIZED', 'Session revoked');
  const user = db().users.find((u) => u.id === payload!.sub);
  if (!user) fail(401, 'UNAUTHORIZED', 'Unknown user');
  if (user!.status === 'SUSPENDED') fail(403, 'ACCOUNT_LOCKED', 'Account suspended');
  session!.lastUsedAt = nowIso();
  return user!;
}

export function requireRole(user: MockUser, ...roles: MockUser['role'][]) {
  if (!roles.includes(user.role)) fail(403, 'FORBIDDEN', 'Insufficient role');
}

/* ---------------------------------- PIN ---------------------------------- */

export function checkPin(user: MockUser, pin: unknown) {
  if (!user.pin) fail(422, 'PIN_NOT_SET', 'Set a PIN before moving money');
  if (user.pinLockedUntil && user.pinLockedUntil > Date.now()) {
    fail(423, 'PIN_LOCKED', 'Too many wrong PIN attempts', {
      lockedUntil: new Date(user.pinLockedUntil).toISOString(),
    });
  }
  if (typeof pin !== 'string' || pin !== user.pin) {
    user.pinAttempts += 1;
    const attemptsRemaining = Math.max(0, PIN_MAX_ATTEMPTS - user.pinAttempts);
    if (attemptsRemaining === 0) {
      user.pinLockedUntil = Date.now() + PIN_LOCK_MS;
      user.pinAttempts = 0;
      fail(423, 'PIN_LOCKED', 'Too many wrong PIN attempts', {
        lockedUntil: new Date(user.pinLockedUntil).toISOString(),
      });
    }
    fail(422, 'PIN_INVALID', 'Incorrect PIN', { attemptsRemaining });
  }
  user.pinAttempts = 0;
  user.pinLockedUntil = null;
}

/* -------------------------------- Wallets -------------------------------- */

export function ownWallet(user: MockUser, walletId: unknown): MockWallet {
  const w = db().wallets.find((x) => x.id === walletId && x.userId === user.id);
  if (!w) fail(404, 'NOT_FOUND', 'Wallet not found');
  return w!;
}

export function walletFor(userId: string, currency: Currency): MockWallet | undefined {
  return db().wallets.find((w) => w.userId === userId && w.currency === currency && w.status !== 'CLOSED');
}

export function assertActive(w: MockWallet) {
  if (w.status !== 'ACTIVE') fail(422, 'WALLET_NOT_ACTIVE', `Wallet is ${w.status.toLowerCase()}`);
}

function outToday(walletId: string): bigint {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const since = start.toISOString();
  return db()
    .postings.filter((p) => p.walletId === walletId && p.direction === 'OUT' && p.createdAt >= since)
    .reduce((s, p) => s + p.amount + p.fee, 0n);
}

/** Enforce tier limits for a debit of `amount` from `w`. */
export function checkDebit(user: MockUser, w: MockWallet, amount: bigint, fee = 0n) {
  assertActive(w);
  const l = limitRow(user.kycTier, w.currency);
  if (!l.permitted) fail(422, 'CURRENCY_NOT_PERMITTED', `${w.currency} is not permitted on your tier`);
  if (amount > l.perTx) {
    fail(422, 'LIMIT_EXCEEDED', 'Per-transaction limit exceeded', {
      limit: 'PER_TRANSACTION',
      max: money(l.perTx, w.currency),
    });
  }
  if (outToday(w.id) + amount + fee > l.daily) {
    fail(422, 'LIMIT_EXCEEDED', 'Daily limit exceeded', { limit: 'DAILY', max: money(l.daily, w.currency) });
  }
  if (w.balance < amount + fee) fail(422, 'INSUFFICIENT_FUNDS', 'Insufficient funds');
}

export function checkCredit(owner: MockUser, w: MockWallet, amount: bigint) {
  const l = limitRow(owner.kycTier, w.currency);
  if (w.balance + amount > l.max && owner.role === 'CONSUMER') {
    fail(422, 'LIMIT_EXCEEDED', 'Recipient balance limit exceeded', {
      limit: 'MAX_BALANCE',
      reason: 'RECIPIENT_LIMIT',
    });
  }
}

export function post(
  w: MockWallet,
  p: Omit<MockPosting, 'id' | 'walletId' | 'balanceAfter' | 'transactionId' | 'createdAt' | 'status'> & {
    status?: string;
    transactionId?: string;
  },
): MockPosting {
  w.balance = p.direction === 'IN' ? w.balance + p.amount : w.balance - p.amount - p.fee;
  const posting: MockPosting = {
    id: uuid(),
    walletId: w.id,
    transactionId: p.transactionId ?? uuid(),
    createdAt: nowIso(),
    status: p.status ?? 'COMPLETED',
    balanceAfter: w.balance,
    ...p,
  };
  db().postings.unshift(posting);
  return posting;
}

/* ------------------------------ Serializers ------------------------------ */

export function toUser(u: MockUser): User {
  return {
    id: u.id,
    phone: u.phone,
    fullName: u.fullName,
    role: u.role,
    status: u.status,
    kycTier: u.kycTier,
    phoneVerified: u.phoneVerified,
    pinSet: Boolean(u.pin),
    createdAt: u.createdAt,
    username: u.username,
  };
}

export function toWallet(w: MockWallet): Wallet {
  return {
    id: w.id,
    currency: w.currency,
    status: w.status,
    balance: money(w.balance, w.currency),
    createdAt: w.createdAt,
  };
}

export function toActivity(p: MockPosting): ActivityItem {
  const w = db().wallets.find((x) => x.id === p.walletId)!;
  return {
    id: p.id,
    paymentId: p.paymentId,
    transactionId: p.transactionId,
    type: p.type,
    title: p.title,
    counterparty: p.counterparty,
    direction: p.direction,
    amount: money(p.amount, w.currency),
    fee: p.fee > 0n ? money(p.fee, w.currency) : null,
    balanceAfter: money(p.balanceAfter, w.currency),
    status: p.status,
    createdAt: p.createdAt,
  };
}

export function userParty(u: MockUser): Party {
  return partyOf(u);
}

export function lookupView(u: MockUser) {
  return {
    userId: u.id,
    username: u.username,
    displayName: displayNameOf(u.fullName),
    phoneMasked: maskPhone(u.phone),
    wallets: db()
      .wallets.filter((w) => w.userId === u.id && w.status !== 'CLOSED')
      .map((w) => w.currency),
  };
}

export function findUserByRef(ref: { phone?: unknown; username?: unknown }): MockUser | undefined {
  const phone = typeof ref.phone === 'string' ? ref.phone.replace(/\s+/g, '') : null;
  const username = typeof ref.username === 'string' ? ref.username.replace(/^@/, '').toLowerCase() : null;
  return db().users.find((u) => (phone && u.phone === phone) || (username && u.username?.toLowerCase() === username));
}

export function newPayment(
  p: Omit<Payment, 'id' | 'createdAt' | 'completedAt' | 'timeline' | 'journalEntryId' | 'failureReason'> & {
    failureReason?: string | null;
  },
): Payment {
  const at = nowIso();
  const payment: Payment = {
    id: uuid(),
    createdAt: at,
    completedAt: p.status === 'COMPLETED' ? at : null,
    journalEntryId: p.status === 'COMPLETED' ? uuid() : null,
    timeline: [
      { status: 'CREATED', at },
      { status: 'PROCESSING', at },
      { status: p.status, at },
    ],
    failureReason: null,
    ...p,
  };
  db().payments.set(payment.id, payment);
  return payment;
}

/* ------------------------------ Idempotency ------------------------------ */

const KEY_RE = /^[A-Za-z0-9_.:-]{8,128}$/;

/**
 * Contract idempotency: same key + same body replays (Idempotent-Replayed: true),
 * different body -> 422 IDEMPOTENCY_KEY_REUSED, in flight -> 409 IDEMPOTENCY_IN_PROGRESS.
 */
export async function idempotent(
  request: Request,
  user: MockUser,
  body: unknown,
  run: () => Promise<{ status?: number; body: unknown }> | { status?: number; body: unknown },
): Promise<Response> {
  const key = request.headers.get('idempotency-key');
  if (!key || !KEY_RE.test(key)) {
    return apiError(400, 'VALIDATION_FAILED', 'Idempotency-Key header is required', [
      'Idempotency-Key must be 8-128 chars [A-Za-z0-9_.:-]',
    ]);
  }
  const store = db().idempotency;
  const scoped = `${user.id}:${new URL(request.url).pathname}:${key}`;
  const bodyHash = fnv(JSON.stringify(body ?? null));
  const existing = store.get(scoped);
  if (existing) {
    if (existing.bodyHash !== bodyHash) {
      return apiError(422, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was used with a different request body');
    }
    if (existing.state === 'IN_PROGRESS') {
      return apiError(409, 'IDEMPOTENCY_IN_PROGRESS', 'A request with this Idempotency-Key is still processing');
    }
    return json(existing.body, existing.status, { 'Idempotent-Replayed': 'true' });
  }
  store.set(scoped, { bodyHash, state: 'IN_PROGRESS', status: 0, body: null, createdAt: Date.now() });
  try {
    const result = await run();
    const status = result.status ?? 201;
    store.set(scoped, { bodyHash, state: 'DONE', status, body: result.body, createdAt: Date.now() });
    return json(result.body, status);
  } catch (e) {
    if (e instanceof MockHttpError) {
      // [backend] Business failures (funds, limits, QR already paid, request not pending...)
      // are FINAL per key: a retry with the same key replays the same error.
      // PIN errors are checked before anything is recorded, so the same key can be
      // retried after a PIN error; plain validation errors are not recorded either.
      const recorded =
        (e.status === 409 || e.status === 422) &&
        !['PIN_INVALID', 'PIN_LOCKED', 'PIN_NOT_SET', 'QUOTE_EXPIRED', 'VALIDATION_FAILED'].includes(e.code);
      if (recorded) {
        const errBody = {
          error: {
            code: e.code,
            message: e.message,
            ...(e.details === undefined ? {} : { details: e.details }),
            correlationId: 'replay',
          },
        };
        store.set(scoped, { bodyHash, state: 'DONE', status: e.status, body: errBody, createdAt: Date.now() });
      } else {
        store.delete(scoped);
      }
      throw e;
    }
    store.delete(scoped);
    throw e;
  }
}

/* -------------------------------- Funding -------------------------------- */

/** Lazily settle any PENDING funding whose settle time has passed. */
export function tickFunding() {
  const now = Date.now();
  for (const f of db().funding) {
    if (f.status !== 'PENDING' || f.settleAt > now) continue;
    const at = nowIso();
    const w = db().wallets.find((x) => x.id === f.walletId)!;
    f.status = f.outcome;
    f.updatedAt = at;
    if (f.direction === 'TOPUP') {
      if (f.outcome === 'SUCCEEDED') {
        f.bankReference = `SIM${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
        post(w, {
          paymentId: null,
          type: 'TOPUP',
          title: f.method === 'CARD' ? 'Card top-up' : 'Bank top-up',
          counterparty: null,
          direction: 'IN',
          amount: f.amountMinor - f.feeMinor,
          fee: 0n,
          category: 'Top-ups',
          merchantName: null,
        });
      } else {
        f.failureReason = 'Bank declined the transfer (simulated)';
      }
    } else {
      // Withdrawal: funds were held at creation; release (credit back) on failure.
      if (f.outcome === 'SUCCEEDED') {
        f.bankReference = `SIM${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
      } else {
        f.failureReason = 'Beneficiary bank rejected the transfer (simulated)';
        post(w, {
          paymentId: null,
          type: 'REVERSAL',
          title: 'Withdrawal returned',
          counterparty: null,
          direction: 'IN',
          amount: f.amountMinor + f.feeMinor,
          fee: 0n,
          category: 'Withdrawals',
          merchantName: null,
        });
      }
    }
    f.timeline.push({ status: f.status, at, reason: f.failureReason });
  }
}

/* ---------------------------------- Audit -------------------------------- */

export function audit(
  actor: MockUser,
  action: string,
  targetType: string,
  targetId: string,
  changes: { before: unknown; after: unknown } | null = null,
  outcome: 'SUCCESS' | 'DENIED' | 'FAILED' = 'SUCCESS',
) {
  db().audit.unshift({
    id: uuid(),
    at: nowIso(),
    actor: { id: actor.id, displayName: actor.fullName, role: actor.role },
    action,
    targetType,
    targetId,
    outcome,
    ipAddress: '127.0.0.1',
    correlationId: `c-${uuid().slice(0, 8)}`,
    changes,
  });
}

export { isoAgo };
