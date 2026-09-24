/**
 * Phase 2 (being built by the backend now). Shapes copied from
 * docs/API_CONTRACT.md "Phase 2" section. Keep in lockstep with that file.
 */
import { z } from 'zod';
import { Currency, DecimalString, IsoDate, Money, RateString, TimelineEntry, Uuid, page } from './common';

/* ------------------------------ Users / lookup --------------------------- */

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export const UserLookup = z.object({
  userId: Uuid,
  username: z.string().nullable(),
  displayName: z.string(),
  phoneMasked: z.string(),
  wallets: z.array(Currency),
});
export type UserLookup = z.infer<typeof UserLookup>;

export const RecipientRef = z
  .object({ phone: z.string().optional(), username: z.string().optional() })
  .refine((v) => Boolean(v.phone) !== Boolean(v.username), 'Provide exactly one of phone or username');
export type RecipientRef = { phone?: string; username?: string };

/* -------------------------------- Transfers ------------------------------ */

export const AmountSide = z.enum(['SEND', 'RECEIVE']);
export type AmountSide = z.infer<typeof AmountSide>;

export const TransferQuoteBody = z.object({
  fromWalletId: Uuid,
  to: RecipientRef,
  toCurrency: Currency,
  amount: DecimalString,
  amountSide: AmountSide,
});
export type TransferQuoteBody = z.infer<typeof TransferQuoteBody>;

export const TransferQuote = z.object({
  id: Uuid,
  send: Money,
  receive: Money,
  fee: Money,
  totalDebit: Money,
  fx: z.object({ midRate: RateString, customerRate: RateString }).nullable(),
  recipient: z.object({ displayName: z.string(), username: z.string().nullable() }),
  expiresAt: IsoDate,
});
export type TransferQuote = z.infer<typeof TransferQuote>;

export type ExecuteTransferBody =
  | { quoteId: string; pin: string; note?: string }
  | {
      fromWalletId: string;
      toPhone?: string;
      toUsername?: string;
      amount: string;
      pin: string;
      note?: string;
    };

export const FeeRule = z.object({
  product: z.string(),
  currency: Currency,
  bps: z.number(),
  fixed: Money,
  min: Money,
  max: Money.nullable(),
});
export type FeeRule = z.infer<typeof FeeRule>;
export const FeeRuleList = z.array(FeeRule);

/* -------------------------------- Payments ------------------------------- */

export const Party = z.object({
  type: z.enum(['USER', 'MERCHANT']),
  displayName: z.string(),
  username: z.string().nullable().optional(),
  merchantId: z.string().optional(),
  outletName: z.string().optional(),
});
export type Party = z.infer<typeof Party>;

export const PaymentType = z.enum(['P2P', 'P2P_FX', 'REQUEST', 'QR_MERCHANT', 'QR_P2P', 'REFUND']);
export type PaymentType = z.infer<typeof PaymentType>;
export const PaymentStatus = z.enum([
  'CREATED',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'REVERSED',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
]);
export type PaymentStatus = z.infer<typeof PaymentStatus>;

export const Payment = z.object({
  id: Uuid,
  type: PaymentType,
  status: PaymentStatus,
  amount: Money,
  fee: Money,
  totalDebit: Money,
  received: Money.optional(),
  payer: Party,
  payee: Party,
  reference: z.string().nullable(),
  failureReason: z.string().nullable(),
  journalEntryId: z.string().nullable(),
  createdAt: IsoDate,
  completedAt: IsoDate.nullable(),
  timeline: z.array(TimelineEntry),
});
export type Payment = z.infer<typeof Payment>;

/* ---------------------------- Payment requests --------------------------- */

export const PaymentRequestStatus = z.enum(['PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED']);
export const PaymentRequest = z.object({
  id: Uuid,
  requester: Party,
  payer: Party,
  amount: Money,
  note: z.string().nullable(),
  status: PaymentRequestStatus,
  expiresAt: IsoDate,
  paymentId: z.string().nullable(),
  createdAt: IsoDate,
});
export type PaymentRequest = z.infer<typeof PaymentRequest>;
export const PaymentRequestPage = page(PaymentRequest);

export const CreatePaymentRequestBody = z.object({
  to: RecipientRef,
  amount: DecimalString,
  currency: Currency,
  note: z.string().max(140).optional(),
  expiresInHours: z.number().int().min(1).max(168).optional(),
});

/* ------------------------- Activity feed / statements -------------------- */

export const ActivityItem = z.object({
  id: Uuid,
  paymentId: z.string().nullable(),
  transactionId: z.string().nullable(),
  type: z.string(),
  title: z.string(),
  counterparty: Party.nullable(),
  direction: z.enum(['IN', 'OUT']),
  amount: Money,
  fee: Money.nullable(),
  balanceAfter: Money,
  status: z.string(),
  createdAt: IsoDate,
});
export type ActivityItem = z.infer<typeof ActivityItem>;
export const ActivityPage = page(ActivityItem);

/** Feed `type` filter values the backend accepts. */
export const ACTIVITY_TYPES = [
  'P2P',
  'P2P_FX',
  'REQUEST',
  'QR_MERCHANT',
  'QR_P2P',
  'REFUND',
  'TOPUP',
  'WITHDRAWAL',
  'DEPOSIT',
  'TRANSFER',
  'FX_CONVERSION',
  'REVERSAL',
  'ADJUSTMENT',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export type ActivityQuery = {
  walletId?: string;
  currency?: Currency;
  type?: ActivityType;
  direction?: 'IN' | 'OUT';
  from?: string;
  to?: string;
  q?: string;
  cursor?: string;
  limit?: number;
};

/* ------------------------------------ QR --------------------------------- */

export const QrReceive = z.object({
  qrId: Uuid,
  payload: z.string(),
  expiresAt: IsoDate.nullable(),
});
export type QrReceive = z.infer<typeof QrReceive>;

export const QrKind = z.enum(['STATIC_MERCHANT', 'DYNAMIC_MERCHANT', 'P2P_RECEIVE']);
export const QrPreview = z.object({
  previewToken: z.string(),
  kind: QrKind,
  payee: Party,
  amount: Money.nullable(),
  currency: Currency,
  fee: Money.nullable(),
  expiresAt: IsoDate.nullable(),
  previewExpiresAt: IsoDate,
});
export type QrPreview = z.infer<typeof QrPreview>;

/* --------------------------------- Funding ------------------------------- */

export const FundingStatus = z.enum(['PENDING', 'SUCCEEDED', 'FAILED', 'REVERSED']);
export type FundingStatus = z.infer<typeof FundingStatus>;
export const FundingMethod = z.enum(['BANK_TRANSFER', 'CARD']);
export type FundingMethod = z.infer<typeof FundingMethod>;

export const BankAccount = z.object({
  iban: z.string(),
  accountTitle: z.string(),
  bankName: z.string(),
});
export type BankAccount = z.infer<typeof BankAccount>;

export const FundingTransaction = z.object({
  id: Uuid,
  direction: z.enum(['TOPUP', 'WITHDRAWAL']),
  method: FundingMethod,
  status: FundingStatus,
  walletId: Uuid,
  amount: Money,
  fee: Money,
  bankReference: z.string().nullable(),
  instructions: z
    .object({
      bankName: z.string(),
      iban: z.string(),
      accountTitle: z.string(),
      reference: z.string(),
    })
    .nullable(),
  failureReason: z.string().nullable(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
  timeline: z.array(TimelineEntry),
});
export type FundingTransaction = z.infer<typeof FundingTransaction>;
export const FundingPage = page(FundingTransaction);

/** POST /dev/bank/simulate (non-production). [backend] result shape. */
export const SimulationResult = z.object({
  reference: z.string(),
  outcome: z.enum(['SUCCEEDED', 'FAILED', 'REVERSED']),
  eventId: z.string(),
  delivered: z.boolean(),
  scheduledFor: IsoDate.nullable(),
  receipt: z
    .object({
      received: z.boolean(),
      duplicate: z.boolean(),
      outcome: z.enum(['APPLIED', 'DEFERRED', 'FLAGGED', 'IGNORED', 'UNMATCHED', 'DUPLICATE']),
    })
    .optional(),
});
export type SimulationResult = z.infer<typeof SimulationResult>;

export const ReconciliationItem = z.object({
  type: z.enum(['MISSING_IN_LEDGER', 'MISSING_IN_BANK', 'AMOUNT_MISMATCH']),
  bankReference: z.string(),
  currency: Currency,
  /** Signed: + into PayCore's bank account, - out. */
  bankAmount: Money.nullable(),
  ledgerAmount: Money.nullable(),
  fundingId: z.string().nullable(),
  settlementId: z.string().nullable(),
});
export const ReconciliationRun = z.object({
  id: Uuid,
  date: z.string(),
  status: z.enum(['RUNNING', 'COMPLETED', 'FAILED']),
  matched: z.number(),
  missingInLedger: z.number(),
  missingInBank: z.number(),
  amountMismatches: z.number(),
  items: z.array(ReconciliationItem),
  createdAt: IsoDate,
  completedAt: IsoDate.nullable(),
});
export type ReconciliationRun = z.infer<typeof ReconciliationRun>;
export const ReconciliationRunPage = page(ReconciliationRun);

/* -------------------------------- Merchants ------------------------------ */

export const MerchantStatus = z.enum(['PENDING_REVIEW', 'ACTIVE', 'SUSPENDED']);
export const Merchant = z.object({
  id: Uuid,
  businessName: z.string(),
  category: z.string(),
  status: MerchantStatus,
  kybTier: z.string(),
  settlementCurrency: Currency,
  settlementDelayDays: z.number(),
  mdrBps: z.number(),
  createdAt: IsoDate,
});
export type Merchant = z.infer<typeof Merchant>;
export const MerchantList = z.array(Merchant);
/** [backend] GET /admin/merchants is paginated. */
export const MerchantPage = page(Merchant);

export const CreateMerchantBody = z.object({
  businessName: z.string().min(2).max(200),
  category: z.string().regex(/^\d{4}$/),
  registrationNumber: z.string().min(3).max(60),
  settlementCurrency: Currency,
  settlementBank: BankAccount,
  website: z.string().url().optional(),
});

/** One settlement line per settled payment or refund (refunds carry negative gross/net). */
export const SettlementLine = z.object({
  kind: z.enum(['PAYMENT', 'REFUND']),
  paymentId: z.string().nullable(),
  refundId: z.string().nullable(),
  gross: Money,
  mdr: Money,
  net: Money,
  occurredAt: IsoDate,
});
export type SettlementLine = z.infer<typeof SettlementLine>;

export const Settlement = z.object({
  id: Uuid,
  currency: Currency,
  periodStart: IsoDate,
  periodEnd: IsoDate,
  gross: Money,
  mdr: Money,
  refunds: Money,
  net: Money,
  status: z.enum(['PENDING', 'PAID', 'FAILED']),
  paidAt: IsoDate.nullable(),
  bankReference: z.string().nullable(),
  lines: z.array(SettlementLine).optional(),
});
export type Settlement = z.infer<typeof Settlement>;
export const SettlementPage = page(Settlement);
/** [backend] POST /admin/settlements/run -> only the settlements created by this run. */
export const SettlementRun = z.object({ asOf: IsoDate, settlements: z.array(Settlement) });

export const MerchantDashboard = z.object({
  today: z.object({ volume: Money, count: z.number(), refunds: Money }),
  pendingSettlement: Money,
  lastSettlement: Settlement.nullable(),
  series: z.array(z.object({ date: z.string(), volume: Money, count: z.number() })),
});
export type MerchantDashboard = z.infer<typeof MerchantDashboard>;

export const Outlet = z.object({
  id: Uuid,
  name: z.string(),
  address: z.string().nullable(),
  status: z.string(),
  staticQr: z.object({ qrId: Uuid, payload: z.string() }),
  createdAt: IsoDate,
});
export type Outlet = z.infer<typeof Outlet>;
export const OutletList = z.array(Outlet);

export const Terminal = z.object({
  id: Uuid,
  label: z.string(),
  status: z.string(),
  createdAt: IsoDate,
});
export type Terminal = z.infer<typeof Terminal>;
export const TerminalList = z.array(Terminal);

export const DynamicQr = z.object({
  qrId: Uuid,
  payload: z.string(),
  amount: Money,
  expiresAt: IsoDate,
  status: z.enum(['ACTIVE', 'PAID', 'EXPIRED']),
  /** [backend] set once paid. */
  paymentId: z.string().nullable().optional(),
  reference: z.string().nullable().optional(),
});
export type DynamicQr = z.infer<typeof DynamicQr>;

export const MerchantPayment = Payment.extend({
  mdrFee: Money,
  net: Money,
  refundedAmount: Money,
});
export type MerchantPayment = z.infer<typeof MerchantPayment>;
export const MerchantPaymentPage = page(MerchantPayment);

export const Refund = z.object({
  id: Uuid,
  paymentId: Uuid,
  amount: Money,
  status: z.enum(['PENDING', 'COMPLETED', 'FAILED']),
  reason: z.string(),
  failureReason: z.string().nullable().optional(),
  createdAt: IsoDate,
});
export type Refund = z.infer<typeof Refund>;
