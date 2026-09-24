/**
 * FUTURE phases: proposed REST shapes (frontend-owned until the backend adopts them).
 *
 * Conventions follow docs/API_CONTRACT.md exactly:
 * - Base path `/v1`, JSON bodies, amounts in requests are decimal strings in major units,
 *   amounts in responses are `Money`.
 * - Lists use `?cursor&limit` and return `{ items, nextCursor }`.
 * - Errors use the standard envelope. New codes are listed in FUTURE_ERROR_CODES.
 * - Every POST that moves money (or authorises future money movement) requires `Idempotency-Key`.
 * - Money-out and secret-revealing actions take `pin` in the body.
 *
 * The FUTURE_ENDPOINTS table at the bottom is the human-readable index; the backend
 * team can lift it straight into the contract.
 */
import { z } from 'zod';
import { Currency, DecimalString, IsoDate, Money, Uuid, page } from './common';
import { AdminUser, WalletStatus } from './phase1';
import { Payment } from './phase2';

/* ================================== Cards ================================= */

export const CardType = z.enum(['VIRTUAL', 'SINGLE_USE']);
export type CardType = z.infer<typeof CardType>;
export const CardStatus = z.enum(['ACTIVE', 'FROZEN', 'TERMINATED', 'USED']);
export type CardStatus = z.infer<typeof CardStatus>;

export const CardLimits = z.object({
  perTransaction: Money,
  daily: Money,
  monthly: Money,
  ecommerce: z.boolean(),
  international: z.boolean(),
});
export type CardLimits = z.infer<typeof CardLimits>;

export const Card = z.object({
  id: Uuid,
  walletId: Uuid,
  currency: Currency,
  type: CardType,
  status: CardStatus,
  label: z.string(),
  brand: z.enum(['VISA', 'MASTERCARD']),
  last4: z.string().length(4),
  expiryMonth: z.number().int().min(1).max(12),
  expiryYear: z.number().int(),
  cardholderName: z.string(),
  limits: CardLimits,
  spentThisMonth: Money,
  createdAt: IsoDate,
});
export type Card = z.infer<typeof Card>;
export const CardList = z.array(Card);

export const CreateCardBody = z.object({
  walletId: Uuid,
  type: CardType,
  label: z.string().min(1).max(40),
  /** Single-use cards: optional spend cap in major units. */
  amountCap: DecimalString.optional(),
});
export type CreateCardBody = z.infer<typeof CreateCardBody>;

/** Returned once per reveal, never cached (Cache-Control: no-store). */
export const CardSecrets = z.object({
  pan: z.string().regex(/^\d{16}$/),
  cvv: z.string().regex(/^\d{3}$/),
  expiryMonth: z.number(),
  expiryYear: z.number(),
  /** Client must hide the secrets at this time (server hint, ~30s). */
  hideAt: IsoDate,
});
export type CardSecrets = z.infer<typeof CardSecrets>;

export const UpdateCardLimitsBody = z.object({
  perTransaction: DecimalString,
  daily: DecimalString,
  monthly: DecimalString,
  ecommerce: z.boolean(),
  international: z.boolean(),
});
export type UpdateCardLimitsBody = z.infer<typeof UpdateCardLimitsBody>;

export const CardTransaction = z.object({
  id: Uuid,
  cardId: Uuid,
  merchantName: z.string(),
  mcc: z.string(),
  category: z.string(),
  amount: Money,
  originalAmount: Money.nullable(),
  status: z.enum(['AUTHORIZED', 'SETTLED', 'DECLINED', 'REVERSED']),
  declineReason: z.string().nullable(),
  createdAt: IsoDate,
});
export type CardTransaction = z.infer<typeof CardTransaction>;
export const CardTransactionPage = page(CardTransaction);

/* ================================== Bills ================================= */

export const BillerCategory = z.enum([
  'ELECTRICITY',
  'GAS',
  'WATER',
  'INTERNET',
  'MOBILE',
  'TV',
  'EDUCATION',
  'GOVERNMENT',
]);
export type BillerCategory = z.infer<typeof BillerCategory>;

export const Biller = z.object({
  id: Uuid,
  name: z.string(),
  shortName: z.string(),
  category: BillerCategory,
  currency: Currency,
  referenceLabel: z.string(),
  /** Regex source the client can use for early validation. */
  referencePattern: z.string(),
  supportsInquiry: z.boolean(),
  allowsPartialPayment: z.boolean(),
});
export type Biller = z.infer<typeof Biller>;
export const BillerList = z.array(Biller);

export const BillInquiryBody = z.object({ billerId: Uuid, reference: z.string().min(3).max(40) });
export const BillInquiry = z.object({
  inquiryId: Uuid,
  biller: Biller,
  reference: z.string(),
  customerName: z.string(),
  billingMonth: z.string(),
  amountDue: Money,
  amountAfterDue: Money.nullable(),
  dueDate: IsoDate,
  status: z.enum(['UNPAID', 'PAID', 'PARTIALLY_PAID']),
  fee: Money,
  expiresAt: IsoDate,
});
export type BillInquiry = z.infer<typeof BillInquiry>;

export const PayBillBody = z.object({
  inquiryId: Uuid,
  fromWalletId: Uuid,
  /** Only when the biller allows partial payment; defaults to amountDue. */
  amount: DecimalString.optional(),
  pin: z.string(),
});

export const BillPayment = z.object({
  id: Uuid,
  paymentId: Uuid.nullable(),
  biller: z.object({ id: Uuid, name: z.string(), category: BillerCategory }),
  reference: z.string(),
  customerName: z.string(),
  billingMonth: z.string(),
  amount: Money,
  fee: Money,
  status: z.enum(['PROCESSING', 'PAID', 'FAILED', 'REVERSED']),
  receiptNumber: z.string().nullable(),
  failureReason: z.string().nullable(),
  scheduleId: Uuid.nullable(),
  createdAt: IsoDate,
  paidAt: IsoDate.nullable(),
});
export type BillPayment = z.infer<typeof BillPayment>;
export const BillPaymentPage = page(BillPayment);

export const BillFrequency = z.enum(['ONCE', 'WEEKLY', 'MONTHLY']);
export const BillSchedule = z.object({
  id: Uuid,
  biller: z.object({ id: Uuid, name: z.string(), category: BillerCategory }),
  reference: z.string(),
  nickname: z.string().nullable(),
  fromWalletId: Uuid,
  amountMode: z.enum(['FULL_DUE', 'FIXED']),
  fixedAmount: Money.nullable(),
  frequency: BillFrequency,
  nextRunAt: IsoDate.nullable(),
  status: z.enum(['ACTIVE', 'PAUSED', 'COMPLETED']),
  lastRun: z.object({ at: IsoDate, status: z.enum(['PAID', 'FAILED']), paymentId: Uuid.nullable() }).nullable(),
  createdAt: IsoDate,
});
export type BillSchedule = z.infer<typeof BillSchedule>;
export const BillScheduleList = z.array(BillSchedule);

export const CreateBillScheduleBody = z.object({
  billerId: Uuid,
  reference: z.string(),
  nickname: z.string().max(40).optional(),
  fromWalletId: Uuid,
  amountMode: z.enum(['FULL_DUE', 'FIXED']),
  fixedAmount: DecimalString.optional(),
  frequency: BillFrequency,
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pin: z.string(),
});
export const UpdateBillScheduleBody = z.object({
  status: z.enum(['ACTIVE', 'PAUSED']).optional(),
  fixedAmount: DecimalString.optional(),
  nickname: z.string().max(40).optional(),
});

/* ================================ Analytics =============================== */

export const SpendingBreakdown = z.object({
  currency: Currency,
  from: IsoDate,
  to: IsoDate,
  groupBy: z.enum(['CATEGORY', 'MERCHANT']),
  total: Money,
  groups: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      amount: Money,
      count: z.number(),
      /** Decimal string 0..1, e.g. "0.2345". */
      share: z.string(),
    }),
  ),
});
export type SpendingBreakdown = z.infer<typeof SpendingBreakdown>;

export const Trend = z.object({
  currency: Currency,
  granularity: z.enum(['DAY', 'MONTH']),
  points: z.array(z.object({ period: z.string(), in: Money, out: Money })),
});
export type Trend = z.infer<typeof Trend>;

export const CurrencyBreakdown = z.object({
  preferredCurrency: Currency,
  total: Money,
  rateAsOf: IsoDate,
  items: z.array(z.object({ currency: Currency, balance: Money, converted: Money, share: z.string() })),
});
export type CurrencyBreakdown = z.infer<typeof CurrencyBreakdown>;

/* ======================== Preferences & notifications ===================== */

export const UserPreferences = z.object({
  language: z.enum(['en', 'ur']),
  preferredCurrency: Currency,
  hideBalances: z.boolean(),
});
export type UserPreferences = z.infer<typeof UserPreferences>;

export const NotificationEvent = z.enum([
  'TRANSACTIONS',
  'REQUESTS',
  'SECURITY',
  'BILLS',
  'LOW_BALANCE',
  'PRODUCT_NEWS',
]);
export type NotificationEvent = z.infer<typeof NotificationEvent>;
export const NotificationPreferences = z.object({
  channels: z.object({ push: z.boolean(), sms: z.boolean(), email: z.boolean() }),
  events: z.record(NotificationEvent, z.boolean()),
  lowBalanceThreshold: Money.nullable(),
  /** SECURITY cannot be disabled (server enforces). */
  locked: z.array(NotificationEvent),
});
export type NotificationPreferences = z.infer<typeof NotificationPreferences>;

/**
 * POST /v1/kyc/documents: pre-signed upload for a KYC document image. The client PUTs
 * the file to `uploadUrl` (object storage) and sends `documentRef` in /kyc/submissions.
 */
export const KycUploadBody = z.object({
  contentType: z.enum(['image/jpeg', 'image/png', 'application/pdf']),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(5 * 1024 * 1024),
});
export const KycUpload = z.object({ documentRef: z.string(), uploadUrl: z.string(), expiresAt: IsoDate });
export type KycUpload = z.infer<typeof KycUpload>;

/** POST /v1/auth/pin/verify: unlock after inactivity (no money moves). */
export const PinVerifyResponse = z.object({ valid: z.literal(true) });

export const RecentContact = z.object({
  userId: Uuid,
  displayName: z.string(),
  username: z.string().nullable(),
  phoneMasked: z.string(),
  lastPaidAt: IsoDate,
});
export type RecentContact = z.infer<typeof RecentContact>;
export const RecentContactList = z.array(RecentContact);

/* ============================ Merchant developers ========================= */

export const ApiKey = z.object({
  id: Uuid,
  name: z.string(),
  prefix: z.string(),
  mode: z.enum(['TEST', 'LIVE']),
  scopes: z.array(z.string()),
  createdAt: IsoDate,
  lastUsedAt: IsoDate.nullable(),
  revokedAt: IsoDate.nullable(),
});
export type ApiKey = z.infer<typeof ApiKey>;
export const ApiKeyList = z.array(ApiKey);
/** The secret is returned exactly once, on creation. */
export const ApiKeyCreated = ApiKey.extend({ secret: z.string() });
export type ApiKeyCreated = z.infer<typeof ApiKeyCreated>;
export const API_KEY_SCOPES = [
  'payments:read',
  'payments:write',
  'refunds:write',
  'qr:write',
  'settlements:read',
] as const;

export const WEBHOOK_EVENTS = [
  'payment.completed',
  'payment.failed',
  'refund.completed',
  'settlement.paid',
  'qr.expired',
] as const;
export const WebhookEndpoint = z.object({
  id: Uuid,
  url: z.string(),
  events: z.array(z.string()),
  status: z.enum(['ENABLED', 'DISABLED']),
  secretPrefix: z.string(),
  createdAt: IsoDate,
  lastDelivery: z.object({ at: IsoDate, statusCode: z.number().nullable(), ok: z.boolean() }).nullable(),
});
export type WebhookEndpoint = z.infer<typeof WebhookEndpoint>;
export const WebhookEndpointList = z.array(WebhookEndpoint);
export const WebhookEndpointCreated = WebhookEndpoint.extend({ signingSecret: z.string() });
export const WebhookDelivery = z.object({
  id: Uuid,
  event: z.string(),
  statusCode: z.number().nullable(),
  ok: z.boolean(),
  attempt: z.number(),
  durationMs: z.number(),
  createdAt: IsoDate,
});
export type WebhookDelivery = z.infer<typeof WebhookDelivery>;
export const WebhookDeliveryPage = page(WebhookDelivery);
export const WebhookTestResult = z.object({
  deliveryId: Uuid,
  statusCode: z.number().nullable(),
  ok: z.boolean(),
  durationMs: z.number(),
});
export const SigningSecret = z.object({ signingSecret: z.string() });

export const MerchantRefundRow = z.object({
  id: Uuid,
  paymentId: Uuid,
  amount: Money,
  status: z.string(),
  reason: z.string(),
  createdAt: IsoDate,
  payerName: z.string(),
  paymentAmount: Money,
});
export type MerchantRefundRow = z.infer<typeof MerchantRefundRow>;
export const MerchantRefundPage = page(MerchantRefundRow);

/* ============================== Admin: fraud ============================== */

export const FraudSeverity = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export type FraudSeverity = z.infer<typeof FraudSeverity>;
export const FraudStatus = z.enum(['OPEN', 'INVESTIGATING', 'ESCALATED', 'CLOSED_FRAUD', 'CLOSED_LEGIT']);
export type FraudStatus = z.infer<typeof FraudStatus>;
export const FraudCase = z.object({
  id: Uuid,
  subject: z.object({ userId: Uuid, displayName: z.string(), phoneMasked: z.string() }),
  severity: FraudSeverity,
  status: FraudStatus,
  ruleCode: z.string(),
  score: z.number().min(0).max(100),
  summary: z.string(),
  amount: Money.nullable(),
  relatedPaymentIds: z.array(Uuid),
  assignee: z.object({ id: Uuid, displayName: z.string() }).nullable(),
  notes: z.array(z.object({ id: Uuid, author: z.string(), body: z.string(), at: IsoDate })),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type FraudCase = z.infer<typeof FraudCase>;
export const FraudCasePage = page(FraudCase);
export const ResolveFraudCaseBody = z.object({
  resolution: z.enum(['CLOSED_FRAUD', 'CLOSED_LEGIT']),
  note: z.string().min(5).max(1000),
  /** When CLOSED_FRAUD, opens a WALLET_FREEZE approval for each wallet of the subject. */
  freezeWallets: z.boolean().optional(),
});

/* ========================= Admin: maker-checker =========================== */

export const ApprovalAction = z.enum([
  'WALLET_FREEZE',
  'WALLET_UNFREEZE',
  'USER_SUSPEND',
  'USER_REACTIVATE',
  'LEDGER_REVERSAL',
  'MERCHANT_PRICING',
  'LIMIT_OVERRIDE',
]);
export type ApprovalAction = z.infer<typeof ApprovalAction>;
export const ApprovalStatus = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED']);
export const ApprovalRequest = z.object({
  id: Uuid,
  action: ApprovalAction,
  targetType: z.enum(['USER', 'WALLET', 'LEDGER_ENTRY', 'MERCHANT']),
  targetId: Uuid,
  targetLabel: z.string(),
  payload: z.record(z.string(), z.unknown()),
  reason: z.string(),
  status: ApprovalStatus,
  maker: z.object({ id: Uuid, displayName: z.string() }),
  checker: z.object({ id: Uuid, displayName: z.string() }).nullable(),
  decisionNote: z.string().nullable(),
  createdAt: IsoDate,
  decidedAt: IsoDate.nullable(),
  expiresAt: IsoDate,
});
export type ApprovalRequest = z.infer<typeof ApprovalRequest>;
export const ApprovalPage = page(ApprovalRequest);
export const CreateApprovalBody = z.object({
  action: ApprovalAction,
  targetType: z.enum(['USER', 'WALLET', 'LEDGER_ENTRY', 'MERCHANT']),
  targetId: Uuid,
  payload: z.record(z.string(), z.unknown()).optional(),
  reason: z.string().min(5).max(500),
});
export type CreateApprovalBody = z.infer<typeof CreateApprovalBody>;

/* ============================ Admin: audit log ============================ */

export const AuditEvent = z.object({
  id: Uuid,
  at: IsoDate,
  actor: z.object({ id: Uuid, displayName: z.string(), role: z.string() }),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string(),
  outcome: z.enum(['SUCCESS', 'DENIED', 'FAILED']),
  ipAddress: z.string().nullable(),
  correlationId: z.string(),
  changes: z.object({ before: z.unknown(), after: z.unknown() }).nullable(),
});
export type AuditEvent = z.infer<typeof AuditEvent>;
export const AuditEventPage = page(AuditEvent);

/* ============================== Admin: search ============================= */

export const AdminWalletSummary = z.object({
  id: Uuid,
  currency: Currency,
  status: WalletStatus,
  balance: Money,
  owner: z.object({ id: Uuid, displayName: z.string(), phoneMasked: z.string() }),
});
export type AdminWalletSummary = z.infer<typeof AdminWalletSummary>;
export const AdminTransaction = Payment.extend({
  payerUserId: Uuid.nullable(),
  payeeUserId: Uuid.nullable(),
  riskScore: z.number().nullable(),
});
export type AdminTransaction = z.infer<typeof AdminTransaction>;
export const AdminTransactionPage = page(AdminTransaction);
export const AdminSearchResult = z.object({
  users: z.array(AdminUser),
  wallets: z.array(AdminWalletSummary),
  transactions: z.array(AdminTransaction),
});
export type AdminSearchResult = z.infer<typeof AdminSearchResult>;

export const FUTURE_ERROR_CODES = [
  'CARD_NOT_ACTIVE',
  'CARD_LIMIT_INVALID',
  'BILL_INQUIRY_EXPIRED',
  'BILL_ALREADY_PAID',
  'BILLER_UNAVAILABLE',
  'SELF_APPROVAL_FORBIDDEN',
  'APPROVAL_NOT_PENDING',
  'WEBHOOK_URL_INVALID',
] as const;

/**
 * Human-readable endpoint index. "Idem" = requires Idempotency-Key, "PIN" = body.pin.
 */
export const FUTURE_ENDPOINTS = [
  // Cards
  ['GET', '/v1/cards', '', 'Card[]'],
  ['POST', '/v1/cards', 'CreateCardBody · Idem', 'Card'],
  ['GET', '/v1/cards/{id}', '', 'Card'],
  ['POST', '/v1/cards/{id}/reveal', '{pin} · PIN · no-store', 'CardSecrets'],
  ['POST', '/v1/cards/{id}/freeze', '', 'Card'],
  ['POST', '/v1/cards/{id}/unfreeze', '', 'Card'],
  ['PUT', '/v1/cards/{id}/limits', 'UpdateCardLimitsBody', 'Card'],
  ['POST', '/v1/cards/{id}/terminate', '{pin} · PIN', 'Card'],
  ['GET', '/v1/cards/{id}/transactions', '?cursor&limit', 'Page<CardTransaction>'],
  // Bills
  ['GET', '/v1/bills/billers', '?category&q', 'Biller[]'],
  ['POST', '/v1/bills/inquiries', '{billerId, reference}', 'BillInquiry'],
  ['POST', '/v1/bills/payments', '{inquiryId, fromWalletId, amount?, pin} · Idem · PIN', 'BillPayment'],
  ['GET', '/v1/bills/payments', '?cursor&limit', 'Page<BillPayment>'],
  ['GET', '/v1/bills/payments/{id}', '', 'BillPayment (receipt)'],
  ['GET', '/v1/bills/schedules', '', 'BillSchedule[]'],
  ['POST', '/v1/bills/schedules', 'CreateBillScheduleBody · Idem · PIN', 'BillSchedule'],
  ['PATCH', '/v1/bills/schedules/{id}', 'UpdateBillScheduleBody', 'BillSchedule'],
  ['DELETE', '/v1/bills/schedules/{id}', '', '204'],
  // Analytics
  ['GET', '/v1/analytics/spending', '?currency&from&to&groupBy=CATEGORY|MERCHANT', 'SpendingBreakdown'],
  ['GET', '/v1/analytics/trend', '?currency&granularity=DAY|MONTH&periods', 'Trend'],
  ['GET', '/v1/analytics/currencies', '', 'CurrencyBreakdown'],
  // Preferences, notifications, contacts, app lock
  ['POST', '/v1/auth/pin/verify', '{pin} (counts toward PIN attempts)', '{valid: true} | PIN_INVALID | PIN_LOCKED'],
  ['POST', '/v1/kyc/documents', '{contentType, sizeBytes}', 'KycUpload {documentRef, uploadUrl, expiresAt}'],
  ['GET', '/v1/users/me/preferences', '', 'UserPreferences'],
  ['PUT', '/v1/users/me/preferences', 'UserPreferences', 'UserPreferences'],
  ['GET', '/v1/notifications/preferences', '', 'NotificationPreferences'],
  ['PUT', '/v1/notifications/preferences', 'NotificationPreferences (minus locked)', 'NotificationPreferences'],
  ['GET', '/v1/contacts/recent', '', 'RecentContact[]'],
  // Statements
  ['GET', '/v1/transactions/statement', '?walletId&from&to&format=pdf', 'application/pdf'],
  // Merchant developers
  ['GET', '/v1/merchant/api-keys', '', 'ApiKey[]'],
  ['POST', '/v1/merchant/api-keys', '{name, mode, scopes}', 'ApiKeyCreated (secret shown once)'],
  ['DELETE', '/v1/merchant/api-keys/{id}', '', '204'],
  ['GET', '/v1/merchant/webhooks', '', 'WebhookEndpoint[]'],
  ['POST', '/v1/merchant/webhooks', '{url, events}', 'WebhookEndpointCreated'],
  ['PATCH', '/v1/merchant/webhooks/{id}', '{url?, events?, status?}', 'WebhookEndpoint'],
  ['DELETE', '/v1/merchant/webhooks/{id}', '', '204'],
  ['POST', '/v1/merchant/webhooks/{id}/test', '', 'WebhookTestResult'],
  ['POST', '/v1/merchant/webhooks/{id}/rotate-secret', '', '{signingSecret}'],
  ['GET', '/v1/merchant/webhooks/{id}/deliveries', '?cursor&limit', 'Page<WebhookDelivery>'],
  ['GET', '/v1/merchant/refunds', '?cursor&limit', 'Page<MerchantRefundRow>'],
  // Admin
  ['GET', '/v1/admin/search', '?q', 'AdminSearchResult'],
  ['GET', '/v1/admin/transactions', '?q&status&type&currency&from&to&cursor&limit', 'Page<AdminTransaction>'],
  ['GET', '/v1/admin/fraud/cases', '?status&severity&cursor&limit', 'Page<FraudCase>'],
  ['GET', '/v1/admin/fraud/cases/{id}', '', 'FraudCase'],
  ['POST', '/v1/admin/fraud/cases/{id}/assign', '{assigneeId?}', 'FraudCase'],
  ['POST', '/v1/admin/fraud/cases/{id}/notes', '{body}', 'FraudCase'],
  ['POST', '/v1/admin/fraud/cases/{id}/escalate', '{note}', 'FraudCase'],
  ['POST', '/v1/admin/fraud/cases/{id}/resolve', 'ResolveFraudCaseBody', 'FraudCase'],
  ['GET', '/v1/admin/approvals', '?status&action&cursor&limit', 'Page<ApprovalRequest>'],
  ['POST', '/v1/admin/approvals', 'CreateApprovalBody', 'ApprovalRequest'],
  ['POST', '/v1/admin/approvals/{id}/approve', '{note?} (checker ≠ maker)', 'ApprovalRequest'],
  ['POST', '/v1/admin/approvals/{id}/reject', '{note}', 'ApprovalRequest'],
  ['GET', '/v1/admin/audit', '?actorId&action&targetType&targetId&from&to&q&cursor&limit', 'Page<AuditEvent>'],
] as const;
