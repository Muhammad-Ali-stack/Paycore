/**
 * The typed path map used by openapi-fetch.
 *
 *   ApiPaths = generated `paths` (schema.d.ts, `npm run gen:api` from Backend/openapi.json)
 *              + ContractPaths (FUTURE routes only, typed from contracts/future.ts)
 *
 * Phase 1 and phase 2 are fully typed by the generated file: request bodies, params
 * and responses. Our Zod contracts still validate responses at runtime, and
 * contracts/drift.ts proves at compile time that they match the generated DTOs.
 *
 * When the backend ships a future route: `npm run gen:api`, delete its entry below,
 * add its DTO to drift.ts. That is the whole upgrade.
 */
import type { z } from 'zod';
import type { paths as GeneratedPaths } from './schema';
import type * as C from './contracts/common';
import type * as F from './contracts/future';

type I<T extends z.ZodType> = z.infer<T>;

type Json<T> = { content: { 'application/json': T } };
type Headers = { 'Idempotency-Key'?: string; 'x-correlation-id'?: string };

type Params<Path, Query> = {
  header?: Headers;
  cookie?: never;
} & (Path extends object ? { path: Path } : { path?: never }) &
  (Query extends object ? { query?: Query } : { query?: never });

/** One operation: response R, optional path params, query, and JSON body. */
type Op<R, O extends { path?: object; query?: object; body?: unknown } = object> = {
  parameters: Params<O['path'], O['query']>;
  responses: {
    200: { headers: Record<string, unknown> } & Json<R>;
    default: { headers: Record<string, unknown> } & Json<C.ApiErrorBody>;
  };
} & (O extends { body: infer B } ? { requestBody: Json<B> } : { requestBody?: never });

type Id = { id: string };
type PQ = C.PageQuery;
type Empty = Record<string, never>;

export interface ContractPaths {
  // Phase 1 + phase 2 routes are fully typed by the generated schema.d.ts now
  // (checked against our Zod contracts in contracts/drift.ts). Only FUTURE routes live here.

  /* ------------------------------- Future ------------------------------ */
  '/v1/cards': { get: Op<F.Card[]>; post: Op<F.Card, { body: F.CreateCardBody }> };
  '/v1/cards/{id}': { get: Op<F.Card, { path: Id }> };
  '/v1/cards/{id}/reveal': { post: Op<F.CardSecrets, { path: Id; body: { pin: string } }> };
  '/v1/cards/{id}/freeze': { post: Op<F.Card, { path: Id }> };
  '/v1/cards/{id}/unfreeze': { post: Op<F.Card, { path: Id }> };
  '/v1/cards/{id}/limits': { put: Op<F.Card, { path: Id; body: F.UpdateCardLimitsBody }> };
  '/v1/cards/{id}/terminate': { post: Op<F.Card, { path: Id; body: { pin: string } }> };
  '/v1/cards/{id}/transactions': {
    get: Op<I<typeof F.CardTransactionPage>, { path: Id; query: PQ }>;
  };
  '/v1/bills/billers': { get: Op<F.Biller[], { query: { category?: string; q?: string } }> };
  '/v1/bills/inquiries': { post: Op<F.BillInquiry, { body: z.input<typeof F.BillInquiryBody> }> };
  '/v1/bills/payments': {
    get: Op<I<typeof F.BillPaymentPage>, { query: PQ }>;
    post: Op<F.BillPayment, { body: z.input<typeof F.PayBillBody> }>;
  };
  '/v1/bills/payments/{id}': { get: Op<F.BillPayment, { path: Id }> };
  '/v1/bills/schedules': {
    get: Op<F.BillSchedule[]>;
    post: Op<F.BillSchedule, { body: z.input<typeof F.CreateBillScheduleBody> }>;
  };
  '/v1/bills/schedules/{id}': {
    patch: Op<F.BillSchedule, { path: Id; body: z.input<typeof F.UpdateBillScheduleBody> }>;
    delete: Op<Empty, { path: Id }>;
  };
  '/v1/analytics/spending': {
    get: Op<
      F.SpendingBreakdown,
      { query: { currency: C.Currency; from?: string; to?: string; groupBy: 'CATEGORY' | 'MERCHANT' } }
    >;
  };
  '/v1/analytics/trend': {
    get: Op<F.Trend, { query: { currency: C.Currency; granularity: 'DAY' | 'MONTH'; periods?: number } }>;
  };
  '/v1/analytics/currencies': { get: Op<F.CurrencyBreakdown> };
  '/v1/users/me/preferences': {
    get: Op<F.UserPreferences>;
    put: Op<F.UserPreferences, { body: F.UserPreferences }>;
  };
  '/v1/notifications/preferences': {
    get: Op<F.NotificationPreferences>;
    put: Op<F.NotificationPreferences, { body: Omit<F.NotificationPreferences, 'locked'> }>;
  };
  '/v1/contacts/recent': { get: Op<F.RecentContact[]> };
  '/v1/kyc/documents': { post: Op<F.KycUpload, { body: z.input<typeof F.KycUploadBody> }> };
  '/v1/auth/pin/verify': { post: Op<I<typeof F.PinVerifyResponse>, { body: { pin: string } }> };
  '/v1/merchant/api-keys': {
    get: Op<F.ApiKey[]>;
    post: Op<F.ApiKeyCreated, { body: { name: string; mode: 'TEST' | 'LIVE'; scopes: string[] } }>;
  };
  '/v1/merchant/api-keys/{id}': { delete: Op<Empty, { path: Id }> };
  '/v1/merchant/webhooks': {
    get: Op<F.WebhookEndpoint[]>;
    post: Op<I<typeof F.WebhookEndpointCreated>, { body: { url: string; events: string[] } }>;
  };
  '/v1/merchant/webhooks/{id}': {
    patch: Op<
      F.WebhookEndpoint,
      { path: Id; body: { url?: string; events?: string[]; status?: 'ENABLED' | 'DISABLED' } }
    >;
    delete: Op<Empty, { path: Id }>;
  };
  '/v1/merchant/webhooks/{id}/test': { post: Op<I<typeof F.WebhookTestResult>, { path: Id }> };
  '/v1/merchant/webhooks/{id}/rotate-secret': { post: Op<I<typeof F.SigningSecret>, { path: Id }> };
  '/v1/merchant/webhooks/{id}/deliveries': {
    get: Op<I<typeof F.WebhookDeliveryPage>, { path: Id; query: PQ }>;
  };
  '/v1/merchant/refunds': { get: Op<I<typeof F.MerchantRefundPage>, { query: PQ }> };
  '/v1/admin/search': { get: Op<F.AdminSearchResult, { query: { q: string } }> };
  '/v1/admin/transactions': {
    get: Op<
      I<typeof F.AdminTransactionPage>,
      {
        query: PQ & {
          q?: string;
          status?: string;
          type?: string;
          currency?: string;
          from?: string;
          to?: string;
        };
      }
    >;
  };
  '/v1/admin/fraud/cases': {
    get: Op<I<typeof F.FraudCasePage>, { query: PQ & { status?: string; severity?: string } }>;
  };
  '/v1/admin/fraud/cases/{id}': { get: Op<F.FraudCase, { path: Id }> };
  '/v1/admin/fraud/cases/{id}/assign': {
    post: Op<F.FraudCase, { path: Id; body: { assigneeId?: string } }>;
  };
  '/v1/admin/fraud/cases/{id}/notes': { post: Op<F.FraudCase, { path: Id; body: { body: string } }> };
  '/v1/admin/fraud/cases/{id}/escalate': {
    post: Op<F.FraudCase, { path: Id; body: { note: string } }>;
  };
  '/v1/admin/fraud/cases/{id}/resolve': {
    post: Op<F.FraudCase, { path: Id; body: z.input<typeof F.ResolveFraudCaseBody> }>;
  };
  '/v1/admin/approvals': {
    get: Op<I<typeof F.ApprovalPage>, { query: PQ & { status?: string; action?: string } }>;
    post: Op<F.ApprovalRequest, { body: F.CreateApprovalBody }>;
  };
  '/v1/admin/approvals/{id}/approve': {
    post: Op<F.ApprovalRequest, { path: Id; body: { note?: string } }>;
  };
  '/v1/admin/approvals/{id}/reject': {
    post: Op<F.ApprovalRequest, { path: Id; body: { note: string } }>;
  };
  '/v1/admin/audit': {
    get: Op<
      I<typeof F.AuditEventPage>,
      {
        query: PQ & {
          actorId?: string;
          action?: string;
          targetType?: string;
          targetId?: string;
          from?: string;
          to?: string;
          q?: string;
        };
      }
    >;
  };
}

type PathItemBase = {
  parameters: { query?: never; header?: never; path?: never; cookie?: never };
};

/** Per-method merge: contract methods win, generated methods fill the rest. */
export type ApiPaths = {
  [P in keyof GeneratedPaths | keyof ContractPaths]: P extends keyof ContractPaths
    ? P extends keyof GeneratedPaths
      ? Omit<GeneratedPaths[P], keyof ContractPaths[P]> & ContractPaths[P]
      : PathItemBase & ContractPaths[P]
    : P extends keyof GeneratedPaths
      ? GeneratedPaths[P]
      : never;
};
