/**
 * Typed service functions, one per endpoint. Components never call fetch directly:
 * they use the React Query hooks in ./hooks, which call these.
 */
import { z } from 'zod';
import { api, authCall, call, callVoid, download } from './client';
import { idem } from './idempotency';
import type { Currency, PageQuery } from './contracts/common';
import * as P1 from './contracts/phase1';
import * as P2 from './contracts/phase2';
import * as F from './contracts/future';

/* ------------------------------ Auth (BFF) ------------------------------- */

export const SessionInfo = z.object({
  authenticated: z.boolean(),
  role: z.enum(['CONSUMER', 'MERCHANT', 'ADMIN']).nullable(),
  userId: z.string().nullable(),
  sessionId: z.string().nullable(),
});
export type SessionInfo = z.infer<typeof SessionInfo>;

export const auth = {
  login: (body: { phone: string; password: string; deviceId: string; deviceName?: string }) =>
    authCall(SessionInfo, 'login', body),
  register: (body: { phone: string; password: string; fullName: string; role?: 'CONSUMER' | 'MERCHANT' }) =>
    authCall(P1.RegisterResponse, 'register', body),
  verifyPhone: (body: { phone: string; code: string }) => authCall(P1.VerifyPhoneResponse, 'verify-phone', body),
  resendOtp: (body: { phone: string }) => authCall(P1.ResendOtpResponse, 'otp/resend', body),
  forgot: (body: { phone: string }) => authCall(P1.SentResponse, 'password/forgot', body),
  reset: (body: { phone: string; code: string; newPassword: string }) =>
    authCall(P1.ResetResponse, 'password/reset', body),
  logout: () => authCall(z.object({}).passthrough(), 'logout', {}),
  session: () => authCall(SessionInfo, 'session', undefined, 'GET'),
  sessions: () => call(P1.SessionList, api.GET('/v1/auth/sessions')),
  revokeSession: (id: string) => callVoid(api.DELETE('/v1/auth/sessions/{id}', { params: { path: { id } } })),
  setPin: (body: { password: string; pin: string }) => call(P1.PinSetResponse, api.POST('/v1/auth/pin', { body })),
  changePin: (body: { currentPin: string; newPin: string }) =>
    call(P1.PinSetResponse, api.PUT('/v1/auth/pin', { body })),
  verifyPin: (pin: string) => call(F.PinVerifyResponse, api.POST('/v1/auth/pin/verify', { body: { pin } })),
};

/* --------------------------------- Users --------------------------------- */

export const users = {
  me: () => call(P1.User, api.GET('/v1/users/me')),
  update: (body: { fullName?: string; username?: string }) => call(P1.User, api.PATCH('/v1/users/me', { body })),
  lookup: (q: string) => call(P2.UserLookup, api.GET('/v1/users/lookup', { params: { query: { q } } })),
  preferences: () => call(F.UserPreferences, api.GET('/v1/users/me/preferences')),
  updatePreferences: (body: F.UserPreferences) =>
    call(F.UserPreferences, api.PUT('/v1/users/me/preferences', { body })),
  notificationPrefs: () => call(F.NotificationPreferences, api.GET('/v1/notifications/preferences')),
  updateNotificationPrefs: (body: Omit<F.NotificationPreferences, 'locked'>) =>
    call(F.NotificationPreferences, api.PUT('/v1/notifications/preferences', { body })),
  recentContacts: () => call(F.RecentContactList, api.GET('/v1/contacts/recent')),
};

export const kyc = {
  me: () => call(P1.KycMe, api.GET('/v1/kyc/me')),
  tiers: () => call(P1.TierLimitList, api.GET('/v1/kyc/tiers')),
  submit: (body: P1.SubmitKycBody) => call(P1.KycSubmission, api.POST('/v1/kyc/submissions', { body })),
  createUpload: (body: z.input<typeof F.KycUploadBody>) => call(F.KycUpload, api.POST('/v1/kyc/documents', { body })),
};

/* -------------------------------- Wallets -------------------------------- */

export const wallets = {
  list: () => call(P1.WalletList, api.GET('/v1/wallets')),
  get: (id: string) => call(P1.Wallet, api.GET('/v1/wallets/{id}', { params: { path: { id } } })),
  create: (currency: Currency) => call(P1.Wallet, api.POST('/v1/wallets', { body: { currency } })),
};

export const fx = {
  rates: () => call(P1.FxRates, api.GET('/v1/fx/rates')),
  quote: (body: { fromCurrency: Currency; toCurrency: Currency; sellAmount: string }) =>
    call(P1.FxQuote, api.POST('/v1/fx/quotes', { body })),
  convert: (body: { quoteId: string; pin: string }, key: string) =>
    call(P1.FxConversion, api.POST('/v1/fx/conversions', { params: idem(key), body })),
};

export const fees = { list: () => call(P2.FeeRuleList, api.GET('/v1/fees')) };

/* ------------------------------- Transfers ------------------------------- */

export const transfers = {
  quote: (body: P2.TransferQuoteBody) => call(P2.TransferQuote, api.POST('/v1/transfers/quotes', { body })),
  execute: (body: P2.ExecuteTransferBody, key: string) =>
    call(P2.Payment, api.POST('/v1/transfers', { params: idem(key), body })),
};

export const paymentRequests = {
  list: (query: PageQuery & { direction?: 'INCOMING' | 'OUTGOING'; status?: P2.PaymentRequest['status'] }) =>
    call(P2.PaymentRequestPage, api.GET('/v1/payment-requests', { params: { query } })),
  create: (body: z.input<typeof P2.CreatePaymentRequestBody>) =>
    call(P2.PaymentRequest, api.POST('/v1/payment-requests', { body })),
  accept: (id: string, body: { fromWalletId: string; pin: string }, key: string) =>
    call(
      P2.Payment,
      api.POST('/v1/payment-requests/{id}/accept', {
        params: { path: { id }, ...idem(key) },
        body,
      }),
    ),
  decline: (id: string) =>
    call(P2.PaymentRequest, api.POST('/v1/payment-requests/{id}/decline', { params: { path: { id } } })),
  cancel: (id: string) =>
    call(P2.PaymentRequest, api.POST('/v1/payment-requests/{id}/cancel', { params: { path: { id } } })),
};

export const payments = {
  get: (id: string) => call(P2.Payment, api.GET('/v1/payments/{id}', { params: { path: { id } } })),
};

export const activity = {
  list: (query: P2.ActivityQuery) => call(P2.ActivityPage, api.GET('/v1/transactions', { params: { query } })),
  statement: (query: { walletId?: string; from?: string; to?: string; format: 'csv' | 'pdf' }) =>
    download('/v1/transactions/statement', query),
};

/* ----------------------------------- QR ---------------------------------- */

export const qr = {
  receive: (body: { currency: Currency; amount?: string }) => call(P2.QrReceive, api.POST('/v1/qr/receive', { body })),
  resolve: (payload: string) => call(P2.QrPreview, api.POST('/v1/qr/resolve', { body: { payload } })),
  pay: (body: { previewToken: string; fromWalletId: string; amount?: string; pin: string }, key: string) =>
    call(P2.Payment, api.POST('/v1/qr/pay', { params: idem(key), body })),
};

/* -------------------------------- Funding -------------------------------- */

export const funding = {
  topup: (body: { walletId: string; amount: string; method: P2.FundingMethod }, key: string) =>
    call(P2.FundingTransaction, api.POST('/v1/funding/topups', { params: idem(key), body })),
  withdraw: (body: { walletId: string; amount: string; bankAccount: P2.BankAccount; pin: string }, key: string) =>
    call(P2.FundingTransaction, api.POST('/v1/funding/withdrawals', { params: idem(key), body })),
  list: (query: PageQuery & { status?: P2.FundingStatus }) =>
    call(P2.FundingPage, api.GET('/v1/funding/transactions', { params: { query } })),
  get: (id: string) =>
    call(P2.FundingTransaction, api.GET('/v1/funding/transactions/{id}', { params: { path: { id } } })),
  /** Non-production only (404 FEATURE_DISABLED otherwise). Exactly one of fundingId / settlementId. */
  simulate: (
    body:
      | { fundingId: string; outcome: 'SUCCEEDED' | 'FAILED' | 'REVERSED'; delayMs?: number }
      | { settlementId: string; outcome: 'SUCCEEDED' | 'FAILED' | 'REVERSED'; delayMs?: number },
  ) => call(P2.SimulationResult, api.POST('/v1/dev/bank/simulate', { body })),
};

/* --------------------------------- Cards --------------------------------- */

export const cards = {
  list: () => call(F.CardList, api.GET('/v1/cards')),
  get: (id: string) => call(F.Card, api.GET('/v1/cards/{id}', { params: { path: { id } } })),
  create: (body: F.CreateCardBody, key: string) => call(F.Card, api.POST('/v1/cards', { params: idem(key), body })),
  reveal: (id: string, pin: string) =>
    call(
      F.CardSecrets,
      api.POST('/v1/cards/{id}/reveal', { params: { path: { id } }, body: { pin }, cache: 'no-store' }),
    ),
  freeze: (id: string) => call(F.Card, api.POST('/v1/cards/{id}/freeze', { params: { path: { id } } })),
  unfreeze: (id: string) => call(F.Card, api.POST('/v1/cards/{id}/unfreeze', { params: { path: { id } } })),
  updateLimits: (id: string, body: F.UpdateCardLimitsBody) =>
    call(F.Card, api.PUT('/v1/cards/{id}/limits', { params: { path: { id } }, body })),
  terminate: (id: string, pin: string) =>
    call(F.Card, api.POST('/v1/cards/{id}/terminate', { params: { path: { id } }, body: { pin } })),
  transactions: (id: string, query: PageQuery) =>
    call(F.CardTransactionPage, api.GET('/v1/cards/{id}/transactions', { params: { path: { id }, query } })),
};

/* --------------------------------- Bills --------------------------------- */

export const bills = {
  billers: (query: { category?: string; q?: string } = {}) =>
    call(F.BillerList, api.GET('/v1/bills/billers', { params: { query } })),
  inquire: (body: { billerId: string; reference: string }) =>
    call(F.BillInquiry, api.POST('/v1/bills/inquiries', { body })),
  pay: (body: { inquiryId: string; fromWalletId: string; amount?: string; pin: string }, key: string) =>
    call(F.BillPayment, api.POST('/v1/bills/payments', { params: idem(key), body })),
  payments: (query: PageQuery) => call(F.BillPaymentPage, api.GET('/v1/bills/payments', { params: { query } })),
  payment: (id: string) => call(F.BillPayment, api.GET('/v1/bills/payments/{id}', { params: { path: { id } } })),
  schedules: () => call(F.BillScheduleList, api.GET('/v1/bills/schedules')),
  createSchedule: (body: z.input<typeof F.CreateBillScheduleBody>, key: string) =>
    call(F.BillSchedule, api.POST('/v1/bills/schedules', { params: idem(key), body })),
  updateSchedule: (id: string, body: z.input<typeof F.UpdateBillScheduleBody>) =>
    call(F.BillSchedule, api.PATCH('/v1/bills/schedules/{id}', { params: { path: { id } }, body })),
  deleteSchedule: (id: string) => callVoid(api.DELETE('/v1/bills/schedules/{id}', { params: { path: { id } } })),
};

/* ------------------------------- Analytics ------------------------------- */

export const analytics = {
  spending: (query: { currency: Currency; from?: string; to?: string; groupBy: 'CATEGORY' | 'MERCHANT' }) =>
    call(F.SpendingBreakdown, api.GET('/v1/analytics/spending', { params: { query } })),
  trend: (query: { currency: Currency; granularity: 'DAY' | 'MONTH'; periods?: number }) =>
    call(F.Trend, api.GET('/v1/analytics/trend', { params: { query } })),
  currencies: () => call(F.CurrencyBreakdown, api.GET('/v1/analytics/currencies')),
};

/* ------------------------------- Merchant -------------------------------- */

export const merchant = {
  register: (body: z.input<typeof P2.CreateMerchantBody>) => call(P2.Merchant, api.POST('/v1/merchants', { body })),
  me: () => call(P2.Merchant, api.GET('/v1/merchant/me')),
  dashboard: (currency?: Currency) =>
    call(P2.MerchantDashboard, api.GET('/v1/merchant/dashboard', { params: { query: { currency } } })),
  outlets: () => call(P2.OutletList, api.GET('/v1/merchant/outlets')),
  createOutlet: (body: { name: string; address?: string }) =>
    call(P2.Outlet, api.POST('/v1/merchant/outlets', { body })),
  terminals: (outletId: string) =>
    call(P2.TerminalList, api.GET('/v1/merchant/outlets/{id}/terminals', { params: { path: { id: outletId } } })),
  createTerminal: (outletId: string, label: string) =>
    call(
      P2.Terminal,
      api.POST('/v1/merchant/outlets/{id}/terminals', { params: { path: { id: outletId } }, body: { label } }),
    ),
  createDynamicQr: (body: {
    amount: string;
    currency: Currency;
    outletId?: string;
    terminalId?: string;
    reference?: string;
    expiresInSeconds: number;
  }) => call(P2.DynamicQr, api.POST('/v1/merchant/qr/dynamic', { body })),
  qrStatus: (qrId: string) => call(P2.DynamicQr, api.GET('/v1/merchant/qr/{qrId}', { params: { path: { qrId } } })),
  payments: (query: PageQuery & { status?: P2.PaymentStatus; from?: string; to?: string; q?: string }) =>
    call(P2.MerchantPaymentPage, api.GET('/v1/merchant/payments', { params: { query } })),
  payment: (id: string) =>
    call(P2.MerchantPayment, api.GET('/v1/merchant/payments/{id}', { params: { path: { id } } })),
  refund: (id: string, body: { amount?: string; reason: string }, key: string) =>
    call(
      P2.Refund,
      api.POST('/v1/merchant/payments/{id}/refunds', {
        params: { path: { id }, ...idem(key) },
        body,
      }),
    ),
  refunds: (query: PageQuery) => call(F.MerchantRefundPage, api.GET('/v1/merchant/refunds', { params: { query } })),
  settlements: (query: PageQuery) =>
    call(P2.SettlementPage, api.GET('/v1/merchant/settlements', { params: { query } })),
  settlement: (id: string) =>
    call(P2.Settlement, api.GET('/v1/merchant/settlements/{id}', { params: { path: { id } } })),
  settlementReport: (id: string) => download(`/v1/merchant/settlements/${encodeURIComponent(id)}/report.csv`, {}),
  apiKeys: () => call(F.ApiKeyList, api.GET('/v1/merchant/api-keys')),
  createApiKey: (body: { name: string; mode: 'TEST' | 'LIVE'; scopes: string[] }) =>
    call(F.ApiKeyCreated, api.POST('/v1/merchant/api-keys', { body })),
  revokeApiKey: (id: string) => callVoid(api.DELETE('/v1/merchant/api-keys/{id}', { params: { path: { id } } })),
  webhooks: () => call(F.WebhookEndpointList, api.GET('/v1/merchant/webhooks')),
  createWebhook: (body: { url: string; events: string[] }) =>
    call(F.WebhookEndpointCreated, api.POST('/v1/merchant/webhooks', { body })),
  updateWebhook: (id: string, body: { url?: string; events?: string[]; status?: 'ENABLED' | 'DISABLED' }) =>
    call(F.WebhookEndpoint, api.PATCH('/v1/merchant/webhooks/{id}', { params: { path: { id } }, body })),
  deleteWebhook: (id: string) => callVoid(api.DELETE('/v1/merchant/webhooks/{id}', { params: { path: { id } } })),
  testWebhook: (id: string) =>
    call(F.WebhookTestResult, api.POST('/v1/merchant/webhooks/{id}/test', { params: { path: { id } } })),
  rotateWebhookSecret: (id: string) =>
    call(F.SigningSecret, api.POST('/v1/merchant/webhooks/{id}/rotate-secret', { params: { path: { id } } })),
  webhookDeliveries: (id: string, query: PageQuery) =>
    call(F.WebhookDeliveryPage, api.GET('/v1/merchant/webhooks/{id}/deliveries', { params: { path: { id }, query } })),
};

/* --------------------------------- Admin --------------------------------- */

export const admin = {
  search: (q: string) => call(F.AdminSearchResult, api.GET('/v1/admin/search', { params: { query: { q } } })),
  /** Phase 1: exact lookup by phone (free-text search is the future /admin/search). */
  userByPhone: (phone: string) => call(P1.User, api.GET('/v1/admin/users', { params: { query: { phone } } })),
  user: (id: string) => call(P1.User, api.GET('/v1/admin/users/{id}', { params: { path: { id } } })),
  wallet: (id: string) => call(P1.AdminWallet, api.GET('/v1/admin/wallets/{id}', { params: { path: { id } } })),
  kycAudit: (userId: string) =>
    call(z.array(P1.KycAuditLog), api.GET('/v1/admin/kyc/users/{userId}/audit', { params: { path: { userId } } })),
  transactions: (query: PageQuery & { q?: string; status?: string; type?: string; currency?: string }) =>
    call(F.AdminTransactionPage, api.GET('/v1/admin/transactions', { params: { query } })),
  kycQueue: (status: P1.KycSubmission['status'] = 'PENDING') =>
    call(P1.KycSubmissionList, api.GET('/v1/admin/kyc/submissions', { params: { query: { status } } })),
  approveKyc: (id: string, note?: string) =>
    call(
      P1.KycSubmission,
      api.POST('/v1/admin/kyc/submissions/{id}/approve', { params: { path: { id } }, body: { note } }),
    ),
  rejectKyc: (id: string, reason: string) =>
    call(
      P1.KycSubmission,
      api.POST('/v1/admin/kyc/submissions/{id}/reject', { params: { path: { id } }, body: { reason } }),
    ),
  fraudCases: (query: PageQuery & { status?: string; severity?: string }) =>
    call(F.FraudCasePage, api.GET('/v1/admin/fraud/cases', { params: { query } })),
  fraudCase: (id: string) => call(F.FraudCase, api.GET('/v1/admin/fraud/cases/{id}', { params: { path: { id } } })),
  assignFraudCase: (id: string) =>
    call(F.FraudCase, api.POST('/v1/admin/fraud/cases/{id}/assign', { params: { path: { id } }, body: {} })),
  addFraudNote: (id: string, body: string) =>
    call(F.FraudCase, api.POST('/v1/admin/fraud/cases/{id}/notes', { params: { path: { id } }, body: { body } })),
  escalateFraudCase: (id: string, note: string) =>
    call(F.FraudCase, api.POST('/v1/admin/fraud/cases/{id}/escalate', { params: { path: { id } }, body: { note } })),
  resolveFraudCase: (id: string, body: z.input<typeof F.ResolveFraudCaseBody>) =>
    call(F.FraudCase, api.POST('/v1/admin/fraud/cases/{id}/resolve', { params: { path: { id } }, body })),
  approvals: (query: PageQuery & { status?: string; action?: string }) =>
    call(F.ApprovalPage, api.GET('/v1/admin/approvals', { params: { query } })),
  requestApproval: (body: F.CreateApprovalBody) => call(F.ApprovalRequest, api.POST('/v1/admin/approvals', { body })),
  approve: (id: string, note?: string) =>
    call(F.ApprovalRequest, api.POST('/v1/admin/approvals/{id}/approve', { params: { path: { id } }, body: { note } })),
  reject: (id: string, note: string) =>
    call(F.ApprovalRequest, api.POST('/v1/admin/approvals/{id}/reject', { params: { path: { id } }, body: { note } })),
  audit: (query: PageQuery & { q?: string; action?: string; targetType?: string; targetId?: string }) =>
    call(F.AuditEventPage, api.GET('/v1/admin/audit', { params: { query } })),
  /** [backend] paginated. */
  merchants: (query: PageQuery & { status?: P2.Merchant['status'] } = {}) =>
    call(P2.MerchantPage, api.GET('/v1/admin/merchants', { params: { query } })),
  setMerchantPricing: (id: string, body: { mdrBps: number; settlementDelayDays: number }) =>
    call(P2.Merchant, api.PUT('/v1/admin/merchants/{id}/pricing', { params: { path: { id } }, body })),
  /** Runs the T+N batch "now" (RunSettlementDto has no typed fields yet; asOf defaults server-side). */
  runSettlements: () => call(P2.SettlementRun, api.POST('/v1/admin/settlements/run', { body: {} })),
  approveMerchant: (id: string) =>
    call(P2.Merchant, api.POST('/v1/admin/merchants/{id}/approve', { params: { path: { id } } })),
  suspendMerchant: (id: string) =>
    call(P2.Merchant, api.POST('/v1/admin/merchants/{id}/suspend', { params: { path: { id } } })),
  reconciliationRuns: (query: PageQuery = {}) =>
    call(P2.ReconciliationRunPage, api.GET('/v1/admin/reconciliation/runs', { params: { query } })),
  runReconciliation: (date?: string) =>
    call(P2.ReconciliationRun, api.POST('/v1/admin/reconciliation/runs', { body: { date } })),
};
