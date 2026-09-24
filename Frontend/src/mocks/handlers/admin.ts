/** Admin portal: users, KYC review, wallets, ledger, search, fraud, maker-checker, audit. */
import type { ApprovalRequest, FraudCase } from '@/lib/api/contracts/future';
import { db, type MockUser } from '../db';
import { audit, authUser, requireRole, toUser, toWallet } from '../ledger';
import { fail, isoIn, json, maskPhone, money, nowIso, paginate, readJson, uuid } from '../util';
import { get, postR, str } from './route';

function admin(request: Request): MockUser {
  const u = authUser(request);
  requireRole(u, 'ADMIN');
  return u;
}

function adminUserView(u: MockUser) {
  return {
    ...toUser(u),
    wallets: db()
      .wallets.filter((w) => w.userId === u.id)
      .map(toWallet),
    lastLoginAt: u.lastLoginAt,
  };
}

function walletSummary(w: ReturnType<typeof db>['wallets'][number]) {
  const owner = db().users.find((u) => u.id === w.userId)!;
  return {
    id: w.id,
    currency: w.currency,
    status: w.status,
    balance: money(w.balance, w.currency),
    owner: { id: owner.id, displayName: owner.fullName, phoneMasked: maskPhone(owner.phone) },
  };
}

function adminTx(id: string) {
  const p = db().payments.get(id)!;
  const postings = db().postings.filter((x) => x.paymentId === id);
  const ownerOf = (dir: 'IN' | 'OUT') => {
    const posting = postings.find((x) => x.direction === dir);
    return posting ? (db().wallets.find((w) => w.id === posting.walletId)?.userId ?? null) : null;
  };
  const amt = BigInt(p.amount.amountMinor);
  const riskScore =
    p.amount.currency === 'PKR' ? Math.min(99, Number(amt / 500_000n)) : Math.min(99, Number(amt / 2_000n));
  return { ...p, payerUserId: ownerOf('OUT'), payeeUserId: ownerOf('IN'), riskScore };
}

function applyApproval(a: ApprovalRequest, checker: MockUser) {
  if (a.targetType === 'WALLET') {
    const w = db().wallets.find((x) => x.id === a.targetId);
    if (!w) fail(404, 'NOT_FOUND', 'Wallet not found');
    const before = w!.status;
    w!.status = a.action === 'WALLET_FREEZE' ? 'FROZEN' : 'ACTIVE';
    audit(checker, a.action === 'WALLET_FREEZE' ? 'WALLET_FROZEN' : 'WALLET_UNFROZEN', 'WALLET', w!.id, {
      before: { status: before },
      after: { status: w!.status },
    });
  } else if (a.targetType === 'USER') {
    const u = db().users.find((x) => x.id === a.targetId);
    if (!u) fail(404, 'NOT_FOUND', 'User not found');
    const before = u!.status;
    u!.status = a.action === 'USER_SUSPEND' ? 'SUSPENDED' : 'ACTIVE';
    if (u!.status === 'SUSPENDED')
      db()
        .sessions.filter((s) => s.userId === u!.id)
        .forEach((s) => (s.revoked = true));
    audit(checker, a.action === 'USER_SUSPEND' ? 'USER_SUSPENDED' : 'USER_REACTIVATED', 'USER', u!.id, {
      before: { status: before },
      after: { status: u!.status },
    });
  } else if (a.targetType === 'MERCHANT' && a.action === 'MERCHANT_PRICING') {
    const m = db().merchants.find((x) => x.id === a.targetId);
    if (m) {
      const before = { mdrBps: m.mdrBps, settlementDelayDays: m.settlementDelayDays };
      Object.assign(m, a.payload);
      audit(checker, 'MERCHANT_PRICING_UPDATED', 'MERCHANT', m.id, { before, after: a.payload });
    }
  }
}

export const adminHandlers = [
  // Phase 1: exact lookup by phone -> UserDto (search is the future /admin/search).
  get('/admin/users', ({ request, url }) => {
    admin(request);
    const phone = (url.searchParams.get('phone') ?? '').replace(/\s+/g, '');
    if (!phone) fail(400, 'VALIDATION_FAILED', 'Validation failed', ['phone is required']);
    const u = db().users.find((x) => x.phone === phone);
    if (!u) fail(404, 'NOT_FOUND', 'User not found');
    return json(toUser(u!));
  }),
  get('/admin/users/:id', ({ request, params }) => {
    admin(request);
    const u = db().users.find((x) => x.id === params.id);
    if (!u) fail(404, 'NOT_FOUND', 'User not found');
    return json(adminUserView(u!));
  }),
  postR('/admin/users/:id/suspend', async ({ request, params }) => {
    const a = admin(request);
    const u = db().users.find((x) => x.id === params.id);
    if (!u) fail(404, 'NOT_FOUND', 'User not found');
    u!.status = 'SUSPENDED';
    audit(a, 'USER_SUSPENDED', 'USER', u!.id);
    return json(toUser(u!), 201);
  }),
  postR('/admin/users/:id/reactivate', ({ request, params }) => {
    const a = admin(request);
    const u = db().users.find((x) => x.id === params.id);
    if (!u) fail(404, 'NOT_FOUND', 'User not found');
    u!.status = 'ACTIVE';
    audit(a, 'USER_REACTIVATED', 'USER', u!.id);
    return json(toUser(u!), 201);
  }),

  get('/admin/kyc/submissions', ({ request, url }) => {
    admin(request);
    const status = url.searchParams.get('status');
    return json(db().kyc.filter((k) => !status || k.status === status));
  }),
  postR('/admin/kyc/submissions/:id/approve', async ({ request, params }) => {
    const a = admin(request);
    const b = await readJson(request);
    const k = db().kyc.find((x) => x.id === params.id);
    if (!k) fail(404, 'NOT_FOUND', 'Submission not found');
    if (k!.status !== 'PENDING') fail(409, 'CONFLICT', 'Submission already reviewed');
    k!.status = 'APPROVED';
    k!.reviewedById = a.id;
    k!.verificationResult = { reviewerNote: str(b.note) || null };
    k!.reviewedAt = nowIso();
    const u = db().users.find((x) => x.id === k!.userId);
    if (u) u.kycTier = k!.targetTier;
    audit(a, 'KYC_APPROVED', 'KYC_SUBMISSION', k!.id, {
      before: { tier: k!.applicant?.currentTier },
      after: { tier: k!.targetTier },
    });
    return json(k);
  }),
  postR('/admin/kyc/submissions/:id/reject', async ({ request, params }) => {
    const a = admin(request);
    const b = await readJson(request);
    if (str(b.reason).length < 5)
      fail(400, 'VALIDATION_FAILED', 'Validation failed', ['reason must be at least 5 characters']);
    const k = db().kyc.find((x) => x.id === params.id);
    if (!k) fail(404, 'NOT_FOUND', 'Submission not found');
    if (k!.status !== 'PENDING') fail(409, 'CONFLICT', 'Submission already reviewed');
    k!.status = 'REJECTED';
    k!.reviewedById = a.id;
    k!.rejectionReason = str(b.reason);
    k!.reviewedAt = nowIso();
    audit(a, 'KYC_REJECTED', 'KYC_SUBMISSION', k!.id);
    return json(k);
  }),
  get('/admin/kyc/users/:userId/audit', ({ request, params }) => {
    admin(request);
    // KycAuditLogDto[]
    return json(
      db()
        .kyc.filter((k) => k.userId === params.userId && k.reviewedAt)
        .map((k) => ({
          id: `al-${k.id}`,
          userId: k.userId,
          submissionId: k.id,
          actorId: k.reviewedById,
          action: k.status === 'APPROVED' ? 'KYC_APPROVED' : 'KYC_REJECTED',
          fromTier: null,
          toTier: k.status === 'APPROVED' ? k.targetTier : null,
          details: k.rejectionReason ? { reason: k.rejectionReason } : null,
          createdAt: k.reviewedAt!,
        })),
    );
  }),

  get('/admin/wallets/:id', ({ request, params }) => {
    admin(request);
    const w = db().wallets.find((x) => x.id === params.id);
    if (!w) fail(404, 'NOT_FOUND', 'Wallet not found');
    return json({ ...toWallet(w!), userId: w!.userId, ledgerAccountId: `la-${w!.id}` });
  }),
  postR('/admin/wallets/:id/status', async ({ request, params }) => {
    const a = admin(request);
    const b = await readJson(request);
    const w = db().wallets.find((x) => x.id === params.id);
    if (!w) fail(404, 'NOT_FOUND', 'Wallet not found');
    if (str(b.reason).length < 5)
      fail(400, 'VALIDATION_FAILED', 'Validation failed', ['reason must be at least 5 characters']);
    const before = w!.status;
    w!.status = b.status as 'ACTIVE' | 'FROZEN' | 'CLOSED';
    audit(a, 'WALLET_STATUS_CHANGED', 'WALLET', w!.id, { before: { status: before }, after: { status: w!.status } });
    return json(toWallet(w!));
  }),

  get('/admin/ledger/system-accounts', ({ request }) => {
    admin(request);
    return json(
      ['PKR', 'AED', 'USD'].map((c) => ({
        id: uuid(),
        code: `SYS_SETTLEMENT_${c}`,
        currency: c,
        balance: money(987_654_321n, c as 'PKR'),
      })),
    );
  }),
  get('/admin/ledger/integrity', ({ request }) => {
    admin(request);
    return json({ balanced: true, checkedAt: nowIso(), entries: db().postings.length });
  }),

  get('/admin/search', ({ request, url }) => {
    admin(request);
    const q = (url.searchParams.get('q') ?? '').toLowerCase().trim();
    if (q.length < 2) return json({ users: [], wallets: [], transactions: [] });
    const users = db()
      .users.filter((u) => `${u.fullName} ${u.phone} ${u.username ?? ''} ${u.id}`.toLowerCase().includes(q))
      .slice(0, 10);
    const wallets = db()
      .wallets.filter((w) => w.id.toLowerCase().includes(q) || users.some((u) => u.id === w.userId))
      .slice(0, 10)
      .map(walletSummary);
    const transactions = [...db().payments.values()]
      .filter((p) =>
        `${p.id} ${p.payer.displayName} ${p.payee.displayName} ${p.reference ?? ''}`.toLowerCase().includes(q),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 10)
      .map((p) => adminTx(p.id));
    audit(admin(request), 'ADMIN_SEARCH', 'SEARCH', q.slice(0, 40));
    return json({ users: users.map(adminUserView), wallets, transactions });
  }),
  get('/admin/transactions', ({ request, url }) => {
    admin(request);
    const sp = url.searchParams;
    const q = sp.get('q')?.toLowerCase();
    const rows = [...db().payments.values()]
      .filter(
        (p) =>
          (!sp.get('status') || p.status === sp.get('status')) &&
          (!sp.get('type') || p.type === sp.get('type')) &&
          (!sp.get('currency') || p.amount.currency === sp.get('currency')),
      )
      .filter(
        (p) =>
          !q || `${p.id} ${p.payer.displayName} ${p.payee.displayName} ${p.reference ?? ''}`.toLowerCase().includes(q),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((p) => adminTx(p.id));
    return json(paginate(rows, url));
  }),

  /* -------------------------------- Fraud -------------------------------- */
  get('/admin/fraud/cases', ({ request, url }) => {
    admin(request);
    const status = url.searchParams.get('status');
    const severity = url.searchParams.get('severity');
    const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    const rows = db()
      .fraudCases.filter(
        (c) =>
          (!status || (status === 'ACTIVE' ? !c.status.startsWith('CLOSED') : c.status === status)) &&
          (!severity || c.severity === severity),
      )
      .sort((a, b) => order[a.severity] - order[b.severity] || b.createdAt.localeCompare(a.createdAt));
    return json(paginate(rows, url));
  }),
  get('/admin/fraud/cases/:id', ({ request, params }) => {
    admin(request);
    const c = db().fraudCases.find((x) => x.id === params.id);
    if (!c) fail(404, 'NOT_FOUND', 'Case not found');
    return json(c);
  }),
  postR('/admin/fraud/cases/:id/assign', ({ request, params }) => {
    const a = admin(request);
    const c = db().fraudCases.find((x) => x.id === params.id);
    if (!c) fail(404, 'NOT_FOUND', 'Case not found');
    c!.assignee = { id: a.id, displayName: a.fullName };
    if (c!.status === 'OPEN') c!.status = 'INVESTIGATING';
    c!.updatedAt = nowIso();
    audit(a, 'FRAUD_CASE_ASSIGNED', 'FRAUD_CASE', c!.id);
    return json(c);
  }),
  postR('/admin/fraud/cases/:id/notes', async ({ request, params }) => {
    const a = admin(request);
    const b = await readJson(request);
    const c = db().fraudCases.find((x) => x.id === params.id);
    if (!c) fail(404, 'NOT_FOUND', 'Case not found');
    if (str(b.body).trim().length < 2) fail(400, 'VALIDATION_FAILED', 'Validation failed', ['note is required']);
    c!.notes.push({ id: uuid(), author: a.fullName, body: str(b.body).trim(), at: nowIso() });
    c!.updatedAt = nowIso();
    return json(c);
  }),
  postR('/admin/fraud/cases/:id/escalate', async ({ request, params }) => {
    const a = admin(request);
    const b = await readJson(request);
    const c = db().fraudCases.find((x) => x.id === params.id);
    if (!c) fail(404, 'NOT_FOUND', 'Case not found');
    c!.status = 'ESCALATED';
    c!.notes.push({ id: uuid(), author: a.fullName, body: `Escalated: ${str(b.note)}`, at: nowIso() });
    c!.updatedAt = nowIso();
    audit(a, 'FRAUD_CASE_ESCALATED', 'FRAUD_CASE', c!.id);
    return json(c);
  }),
  postR('/admin/fraud/cases/:id/resolve', async ({ request, params }) => {
    const a = admin(request);
    const b = await readJson(request);
    const c = db().fraudCases.find((x) => x.id === params.id);
    if (!c) fail(404, 'NOT_FOUND', 'Case not found');
    if (c!.status.startsWith('CLOSED')) fail(409, 'CONFLICT', 'Case already closed');
    if (str(b.note).length < 5)
      fail(400, 'VALIDATION_FAILED', 'Validation failed', ['note must be at least 5 characters']);
    const resolution = b.resolution === 'CLOSED_FRAUD' ? 'CLOSED_FRAUD' : 'CLOSED_LEGIT';
    c!.status = resolution as FraudCase['status'];
    c!.notes.push({ id: uuid(), author: a.fullName, body: `Resolved (${resolution}): ${str(b.note)}`, at: nowIso() });
    c!.updatedAt = nowIso();
    if (resolution === 'CLOSED_FRAUD' && b.freezeWallets) {
      for (const w of db().wallets.filter((x) => x.userId === c!.subject.userId && x.status === 'ACTIVE')) {
        db().approvals.unshift(
          newApproval(a, {
            action: 'WALLET_FREEZE',
            targetType: 'WALLET',
            targetId: w.id,
            targetLabel: `${c!.subject.displayName} · ${w.currency} wallet`,
            payload: { status: 'FROZEN', fraudCaseId: c!.id },
            reason: `Fraud case ${c!.ruleCode} closed as fraud`,
          }),
        );
      }
    }
    audit(a, 'FRAUD_CASE_RESOLVED', 'FRAUD_CASE', c!.id, { before: null, after: { status: resolution } });
    return json(c);
  }),

  /* ---------------------------- Maker-checker ---------------------------- */
  get('/admin/approvals', ({ request, url }) => {
    admin(request);
    const status = url.searchParams.get('status');
    const action = url.searchParams.get('action');
    for (const a of db().approvals) if (a.status === 'PENDING' && a.expiresAt < nowIso()) a.status = 'EXPIRED';
    return json(
      paginate(
        db().approvals.filter((a) => (!status || a.status === status) && (!action || a.action === action)),
        url,
      ),
    );
  }),
  postR('/admin/approvals', async ({ request }) => {
    const a = admin(request);
    const b = await readJson<Record<string, unknown>>(request);
    const errs: string[] = [];
    if (str(b.reason).length < 5) errs.push('reason must be at least 5 characters');
    if (
      ![
        'WALLET_FREEZE',
        'WALLET_UNFREEZE',
        'USER_SUSPEND',
        'USER_REACTIVATE',
        'LEDGER_REVERSAL',
        'MERCHANT_PRICING',
        'LIMIT_OVERRIDE',
      ].includes(str(b.action))
    )
      errs.push('action is invalid');
    if (errs.length) fail(400, 'VALIDATION_FAILED', 'Validation failed', errs);
    if (db().approvals.some((x) => x.status === 'PENDING' && x.targetId === b.targetId && x.action === b.action)) {
      fail(409, 'CONFLICT', 'An identical request is already pending');
    }
    let label = str(b.targetId);
    if (b.targetType === 'WALLET') {
      const w = db().wallets.find((x) => x.id === b.targetId);
      if (!w) fail(404, 'NOT_FOUND', 'Wallet not found');
      label = `${db().users.find((u) => u.id === w!.userId)?.fullName} · ${w!.currency} wallet`;
    } else if (b.targetType === 'USER') {
      const u = db().users.find((x) => x.id === b.targetId);
      if (!u) fail(404, 'NOT_FOUND', 'User not found');
      label = u!.fullName;
    }
    const req = newApproval(a, {
      action: b.action as ApprovalRequest['action'],
      targetType: b.targetType as ApprovalRequest['targetType'],
      targetId: str(b.targetId),
      targetLabel: label,
      payload: (b.payload as Record<string, unknown>) ?? {},
      reason: str(b.reason),
    });
    db().approvals.unshift(req);
    audit(a, 'APPROVAL_REQUESTED', 'APPROVAL', req.id, {
      before: null,
      after: { action: req.action, targetId: req.targetId },
    });
    return json(req, 201);
  }),
  postR('/admin/approvals/:id/approve', async ({ request, params }) => {
    const a = admin(request);
    const b = await readJson(request);
    const req = db().approvals.find((x) => x.id === params.id);
    if (!req) fail(404, 'NOT_FOUND', 'Approval not found');
    if (req!.status !== 'PENDING') fail(409, 'APPROVAL_NOT_PENDING', `Request is ${req!.status.toLowerCase()}`);
    if (req!.maker.id === a.id) {
      audit(a, 'APPROVAL_SELF_APPROVE_BLOCKED', 'APPROVAL', req!.id, null, 'DENIED');
      fail(403, 'SELF_APPROVAL_FORBIDDEN', 'The maker of a request cannot approve it');
    }
    applyApproval(req!, a);
    req!.status = 'APPROVED';
    req!.checker = { id: a.id, displayName: a.fullName };
    req!.decisionNote = str(b.note) || null;
    req!.decidedAt = nowIso();
    audit(a, 'APPROVAL_APPROVED', 'APPROVAL', req!.id);
    return json(req);
  }),
  postR('/admin/approvals/:id/reject', async ({ request, params }) => {
    const a = admin(request);
    const b = await readJson(request);
    const req = db().approvals.find((x) => x.id === params.id);
    if (!req) fail(404, 'NOT_FOUND', 'Approval not found');
    if (req!.status !== 'PENDING') fail(409, 'APPROVAL_NOT_PENDING', `Request is ${req!.status.toLowerCase()}`);
    if (str(b.note).length < 3) fail(400, 'VALIDATION_FAILED', 'Validation failed', ['note is required']);
    req!.status = 'REJECTED';
    req!.checker = { id: a.id, displayName: a.fullName };
    req!.decisionNote = str(b.note);
    req!.decidedAt = nowIso();
    audit(a, 'APPROVAL_REJECTED', 'APPROVAL', req!.id);
    return json(req);
  }),

  get('/admin/audit', ({ request, url }) => {
    admin(request);
    const sp = url.searchParams;
    const q = sp.get('q')?.toLowerCase();
    const rows = db().audit.filter(
      (e) =>
        (!sp.get('action') || e.action === sp.get('action')) &&
        (!sp.get('targetType') || e.targetType === sp.get('targetType')) &&
        (!sp.get('targetId') || e.targetId === sp.get('targetId')) &&
        (!sp.get('actorId') || e.actor.id === sp.get('actorId')) &&
        (!q ||
          `${e.action} ${e.actor.displayName} ${e.targetType} ${e.targetId} ${e.correlationId}`
            .toLowerCase()
            .includes(q)),
    );
    return json(paginate(rows, url, 25));
  }),
];

function newApproval(
  maker: MockUser,
  p: Pick<ApprovalRequest, 'action' | 'targetType' | 'targetId' | 'targetLabel' | 'payload' | 'reason'>,
): ApprovalRequest {
  return {
    id: uuid(),
    ...p,
    status: 'PENDING',
    maker: { id: maker.id, displayName: maker.fullName },
    checker: null,
    decisionNote: null,
    createdAt: nowIso(),
    decidedAt: null,
    expiresAt: isoIn(24 * 3600_000),
  };
}
