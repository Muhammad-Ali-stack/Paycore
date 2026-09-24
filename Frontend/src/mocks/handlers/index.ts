import { http } from 'msw';
import { adminHandlers } from './admin';
import { authHandlers } from './auth';
import { consumerFutureHandlers } from './consumer-future';
import { merchantHandlers } from './merchant';
import { moneyHandlers } from './money';
import { fundingHandlers, qrHandlers } from './qr-funding';
import { get, postR } from './route';
import { userHandlers } from './users';
import { authUser, requireRole } from '../ledger';
import { fail, json, uuid } from '../util';

/** Ledger admin endpoints from phase 1 (read-mostly in the UI). */
const ledgerHandlers = [
  get('/admin/ledger/accounts/:id', ({ request, params }) => {
    requireRole(authUser(request), 'ADMIN');
    return json({ id: params.id, type: 'WALLET', entries: [] });
  }),
  get('/admin/ledger/entries/:id', ({ request, params }) => {
    requireRole(authUser(request), 'ADMIN');
    return json({ id: params.id, postings: [], createdAt: new Date().toISOString() });
  }),
  postR('/admin/ledger/entries/:id/reversals', ({ request }) => {
    requireRole(authUser(request), 'ADMIN');
    if (!request.headers.get('idempotency-key')) fail(400, 'VALIDATION_FAILED', 'Idempotency-Key header is required');
    return json({ id: uuid(), status: 'REVERSED' }, 201);
  }),
];

/**
 * Every backend endpoint: phase 1, phase 2 and future. Order matters only where
 * paths overlap (static segments before params), which each group handles itself.
 */
export const handlers = [
  http.get('*/health', () => json({ status: 'ok', mock: true })),
  ...authHandlers,
  ...userHandlers,
  ...moneyHandlers,
  ...qrHandlers,
  ...fundingHandlers,
  ...merchantHandlers,
  ...consumerFutureHandlers,
  ...adminHandlers,
  ...ledgerHandlers,
];
