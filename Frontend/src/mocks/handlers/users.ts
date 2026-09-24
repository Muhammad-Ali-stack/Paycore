import { db, tierLimits, type Tier } from '../db';
import { authUser, findUserByRef, lookupView, toUser } from '../ledger';
import { fail, json, maskPhone, nowIso, readJson, uuid } from '../util';
import { get, patchR, postR, putR, str } from './route';
import type { KycSubmission } from '@/lib/api/contracts/phase1';

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const TIERS: Tier[] = ['TIER_0', 'TIER_1', 'TIER_2', 'TIER_3'];

export const userHandlers = [
  patchR('/users/me', async ({ request }) => {
    const user = authUser(request);
    const b = await readJson(request);
    const errs: string[] = [];
    if (b.fullName !== undefined && str(b.fullName).trim().length < 2)
      errs.push('fullName must be at least 2 characters');
    if (b.username !== undefined) {
      const u = str(b.username).toLowerCase();
      if (!USERNAME_RE.test(u)) errs.push('username must match ^[a-z0-9_]{3,20}$');
      else if (db().users.some((x) => x.id !== user.id && x.username?.toLowerCase() === u)) {
        fail(409, 'USERNAME_TAKEN', 'Username is taken');
      }
    }
    if (errs.length) fail(400, 'VALIDATION_FAILED', 'Validation failed', errs);
    if (b.fullName !== undefined) user.fullName = str(b.fullName).trim();
    if (b.username !== undefined) user.username = str(b.username).toLowerCase();
    return json(toUser(user));
  }),

  get('/users/lookup', ({ request, url }) => {
    const me = authUser(request);
    const q = (url.searchParams.get('q') ?? '').trim();
    if (!q) fail(400, 'VALIDATION_FAILED', 'Validation failed', ['q is required']);
    const target =
      q.startsWith('@') || !q.startsWith('+') ? findUserByRef({ username: q }) : findUserByRef({ phone: q });
    if (!target || target.role === 'ADMIN' || target.id === me.id) fail(404, 'NOT_FOUND', 'No PayCore user found');
    return json(lookupView(target!));
  }),

  get('/users/me/preferences', ({ request }) => json(authUser(request).preferences)),
  putR('/users/me/preferences', async ({ request }) => {
    const user = authUser(request);
    const b = await readJson(request);
    if (!['en', 'ur'].includes(str(b.language)) || !['PKR', 'AED', 'USD'].includes(str(b.preferredCurrency))) {
      fail(400, 'VALIDATION_FAILED', 'Validation failed', [
        'language must be en|ur',
        'preferredCurrency must be PKR|AED|USD',
      ]);
    }
    user.preferences = {
      language: b.language as 'en' | 'ur',
      preferredCurrency: b.preferredCurrency as 'PKR',
      hideBalances: Boolean(b.hideBalances),
    };
    return json(user.preferences);
  }),

  get('/notifications/preferences', ({ request }) => json(authUser(request).notifications)),
  putR('/notifications/preferences', async ({ request }) => {
    const user = authUser(request);
    const b = await readJson<{
      channels?: Record<string, boolean>;
      events?: Record<string, boolean>;
      lowBalanceThreshold?: unknown;
    }>(request);
    const prev = user.notifications;
    user.notifications = {
      channels: { ...prev.channels, ...(b.channels ?? {}) },
      events: { ...prev.events, ...(b.events ?? {}), SECURITY: true },
      lowBalanceThreshold: (b.lowBalanceThreshold as typeof prev.lowBalanceThreshold) ?? null,
      locked: prev.locked,
    };
    return json(user.notifications);
  }),

  get('/contacts/recent', ({ request }) => {
    const user = authUser(request);
    const myWallets = new Set(
      db()
        .wallets.filter((w) => w.userId === user.id)
        .map((w) => w.id),
    );
    const seen = new Map<string, string>();
    for (const p of db().postings) {
      if (!myWallets.has(p.walletId) || p.counterparty?.type !== 'USER' || !p.counterparty.username) continue;
      if (!seen.has(p.counterparty.username)) seen.set(p.counterparty.username, p.createdAt);
    }
    const out = [...seen.entries()]
      .map(([username, at]) => {
        const u = db().users.find((x) => x.username === username);
        return u
          ? {
              userId: u.id,
              displayName: lookupView(u).displayName,
              username: u.username,
              phoneMasked: maskPhone(u.phone),
              lastPaidAt: at,
            }
          : null;
      })
      .filter(Boolean)
      .slice(0, 8);
    return json(out);
  }),

  /* --------------------------------- KYC --------------------------------- */

  get('/kyc/me', ({ request }) => {
    const user = authUser(request);
    return json({
      tier: user.kycTier,
      limits: tierLimits(user.kycTier),
      submissions: db()
        .kyc.filter((k) => k.userId === user.id)
        .map(({ applicant: _a, ...k }) => k),
    });
  }),

  get('/kyc/tiers', () => json(TIERS.flatMap((t) => tierLimits(t)))),

  postR('/kyc/documents', async ({ request }) => {
    const user = authUser(request);
    const b = await readJson(request);
    if (!['image/jpeg', 'image/png', 'application/pdf'].includes(str(b.contentType))) {
      fail(400, 'VALIDATION_FAILED', 'Validation failed', [
        'contentType must be image/jpeg, image/png or application/pdf',
      ]);
    }
    if (typeof b.sizeBytes !== 'number' || b.sizeBytes <= 0 || b.sizeBytes > 5 * 1024 * 1024) {
      fail(400, 'VALIDATION_FAILED', 'Validation failed', ['sizeBytes must be at most 5 MB']);
    }
    const ref = `kyc-docs/${user.id}/${uuid()}`;
    // Mock: no real object storage; the client skips the PUT for mock:// URLs.
    return json(
      { documentRef: ref, uploadUrl: `mock://upload/${ref}`, expiresAt: new Date(Date.now() + 600_000).toISOString() },
      201,
    );
  }),

  postR('/kyc/submissions', async ({ request }) => {
    const user = authUser(request);
    const b = await readJson(request);
    const errs: string[] = [];
    if (!['TIER_1', 'TIER_2', 'TIER_3'].includes(str(b.targetTier)))
      errs.push('targetTier must be TIER_1|TIER_2|TIER_3');
    if (
      !['CNIC', 'PASSPORT', 'EMIRATES_ID', 'DRIVING_LICENSE', 'BUSINESS_REGISTRATION'].includes(str(b.documentType))
    ) {
      errs.push('documentType is invalid');
    }
    if (str(b.documentNumber).length < 5) errs.push('documentNumber must be at least 5 characters');
    if (b.dateOfBirth !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(str(b.dateOfBirth)))
      errs.push('dateOfBirth must be YYYY-MM-DD');
    if (errs.length) fail(400, 'VALIDATION_FAILED', 'Validation failed', errs);
    if (TIERS.indexOf(str(b.targetTier) as Tier) <= TIERS.indexOf(user.kycTier)) {
      fail(422, 'VALIDATION_FAILED', 'Validation failed', ['targetTier must be above your current tier']);
    }
    if (db().kyc.some((k) => k.userId === user.id && k.status === 'PENDING')) {
      fail(409, 'CONFLICT', 'You already have a submission under review');
    }
    const sub: KycSubmission = {
      id: uuid(),
      userId: user.id,
      targetTier: b.targetTier as KycSubmission['targetTier'],
      documentType: b.documentType as KycSubmission['documentType'],
      // Like the backend: only the last 4 characters of the document number are kept visible.
      documentNumberLast4: str(b.documentNumber)
        .replace(/[^A-Za-z0-9]/g, '')
        .slice(-4),
      status: 'PENDING',
      documentRef: str(b.documentRef) || null,
      businessName: str(b.businessName) || null,
      verificationResult: null,
      reviewedById: null,
      rejectionReason: null,
      createdAt: nowIso(),
      reviewedAt: null,
      applicant: { fullName: user.fullName, phoneMasked: maskPhone(user.phone), currentTier: user.kycTier },
    };
    db().kyc.unshift(sub);
    const { applicant: _a, ...rest } = sub;
    return json(rest, 201);
  }),
];
