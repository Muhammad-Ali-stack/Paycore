/**
 * Phase 1 (implemented). Mirrors the generated DTOs in ../schema.d.ts
 * (Backend/openapi.json); ./drift.ts type-checks every schema here against them,
 * so a backend change that breaks us fails `tsc`. Zod adds runtime validation.
 */
import { z } from 'zod';
import { Currency, DecimalString, IsoDate, KycTier, MinorString, Money, RateString, Role, Uuid, page } from './common';

/* ---------------------------------- Auth --------------------------------- */

export const RegisterBody = z.object({
  phone: z.string(),
  password: z.string(),
  fullName: z.string().min(2).max(120),
  role: z.enum(['CONSUMER', 'MERCHANT']).optional(),
});
export const RegisterResponse = z.object({
  userId: Uuid,
  otpExpiresAt: IsoDate,
  devOtp: z.string().optional(),
});
export type RegisterResponse = z.infer<typeof RegisterResponse>;

export const VerifyPhoneResponse = z.object({ verified: z.boolean() });
export const ResendOtpResponse = z.object({
  sent: z.boolean(),
  otpExpiresAt: IsoDate.optional(),
  devOtp: z.string().optional(),
});

export const TokenPair = z.object({
  tokenType: z.string(),
  accessToken: z.string(),
  accessTokenExpiresIn: z.number(),
  refreshToken: z.string(),
  refreshTokenExpiresAt: IsoDate,
  sessionId: Uuid,
});
export type TokenPair = z.infer<typeof TokenPair>;

export const Session = z.object({
  id: Uuid,
  deviceId: z.string(),
  deviceName: z.string().nullable(),
  userAgent: z.string().nullable(),
  ipAddress: z.string().nullable(),
  createdAt: IsoDate,
  lastUsedAt: IsoDate,
  current: z.boolean(),
});
export type Session = z.infer<typeof Session>;
export const SessionList = z.array(Session);

export const SentResponse = z.object({ sent: z.boolean() });
export const ResetResponse = z.object({ reset: z.boolean() });
export const PinSetResponse = z.object({ pinSet: z.boolean() });

/* ---------------------------------- Users -------------------------------- */

export const UserStatus = z.enum(['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED']);
export type UserStatus = z.infer<typeof UserStatus>;
export const User = z.object({
  id: Uuid,
  phone: z.string(),
  fullName: z.string(),
  role: Role,
  status: UserStatus,
  kycTier: KycTier,
  phoneVerified: z.boolean(),
  pinSet: z.boolean(),
  createdAt: IsoDate,
  /** Phase 2 (null until set). */
  username: z.string().nullable(),
});
export type User = z.infer<typeof User>;

/* ----------------------------------- KYC --------------------------------- */

export const TierLimit = z.object({
  tier: KycTier,
  currency: Currency,
  permitted: z.boolean(),
  perTransaction: Money,
  daily: Money,
  monthly: Money,
  maxBalance: Money,
});
export type TierLimit = z.infer<typeof TierLimit>;
export const TierLimitList = z.array(TierLimit);

export const DocumentType = z.enum(['CNIC', 'PASSPORT', 'EMIRATES_ID', 'DRIVING_LICENSE', 'BUSINESS_REGISTRATION']);
export type DocumentType = z.infer<typeof DocumentType>;

export const KycSubmission = z.object({
  id: Uuid,
  userId: Uuid,
  targetTier: KycTier,
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
  documentType: DocumentType,
  /** The backend never returns the full document number. */
  documentNumberLast4: z.string(),
  documentRef: z.string().nullable(),
  businessName: z.string().nullable(),
  verificationResult: z.record(z.string(), z.unknown()).nullable(),
  reviewedById: z.string().nullable(),
  reviewedAt: IsoDate.nullable(),
  rejectionReason: z.string().nullable(),
  createdAt: IsoDate,
  /**
   * FUTURE (proposed in future.ts): admin queue enrichment so reviewers don't need
   * a second lookup per row. Optional so the phase-1 response still parses.
   */
  applicant: z.object({ fullName: z.string(), phoneMasked: z.string(), currentTier: KycTier }).optional(),
});
export type KycSubmission = z.infer<typeof KycSubmission>;
export const KycSubmissionList = z.array(KycSubmission);

export const KycMe = z.object({
  tier: KycTier,
  limits: z.array(TierLimit),
  submissions: z.array(KycSubmission),
});
export type KycMe = z.infer<typeof KycMe>;

export const SubmitKycBody = z.object({
  targetTier: z.enum(['TIER_1', 'TIER_2', 'TIER_3']),
  documentType: DocumentType,
  documentNumber: z.string().min(5).max(40),
  documentRef: z.string().min(1).max(256).optional(),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  address: z.string().min(5).max(300).optional(),
  businessName: z.string().min(2).max(200).optional(),
});
export type SubmitKycBody = z.infer<typeof SubmitKycBody>;

export const KycAuditLog = z.object({
  id: Uuid,
  userId: Uuid,
  submissionId: z.string().nullable(),
  actorId: z.string().nullable(),
  action: z.string(),
  fromTier: KycTier.nullable(),
  toTier: KycTier.nullable(),
  details: z.record(z.string(), z.unknown()).nullable(),
  createdAt: IsoDate,
});
export type KycAuditLog = z.infer<typeof KycAuditLog>;

/* --------------------------------- Wallets ------------------------------- */

export const WalletStatus = z.enum(['ACTIVE', 'FROZEN', 'CLOSED']);
export type WalletStatus = z.infer<typeof WalletStatus>;
export const Wallet = z.object({
  id: Uuid,
  currency: Currency,
  status: WalletStatus,
  balance: Money,
  createdAt: IsoDate,
});
export type Wallet = z.infer<typeof Wallet>;
export const WalletList = z.array(Wallet);

export const Direction = z.enum(['IN', 'OUT']);
export type Direction = z.infer<typeof Direction>;

export const WalletPosting = z.object({
  postingId: Uuid,
  transactionId: Uuid,
  type: z.string(),
  description: z.string(),
  direction: Direction,
  currency: Currency,
  amount: DecimalString,
  amountMinor: MinorString,
  balanceAfter: DecimalString,
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: IsoDate,
});
export const WalletPostingPage = page(WalletPosting);

export const TransactionLeg = z.object({
  walletId: Uuid,
  direction: Direction,
  currency: Currency,
  amount: DecimalString,
  amountMinor: MinorString,
  balanceAfter: DecimalString,
});
export const Transaction = z.object({
  id: Uuid,
  type: z.string(),
  status: z.string(),
  description: z.string(),
  reversalOfId: Uuid.nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: IsoDate,
  legs: z.array(TransactionLeg),
});
export type Transaction = z.infer<typeof Transaction>;

/** GET /admin/wallets/:id */
export const AdminWallet = Wallet.extend({ userId: Uuid, ledgerAccountId: Uuid });
export type AdminWallet = z.infer<typeof AdminWallet>;

/* ------------------------------------ FX --------------------------------- */

export const FxPair = z.object({ from: Currency, to: Currency, midRate: RateString, customerRate: RateString });
export const FxRates = z.object({ pairs: z.array(FxPair), spreadBps: z.number(), feeBps: z.number() });
export type FxRates = z.infer<typeof FxRates>;

export const FxQuote = z.object({
  id: Uuid,
  fromCurrency: Currency,
  toCurrency: Currency,
  status: z.enum(['OPEN', 'EXECUTED', 'EXPIRED']),
  sell: Money,
  buy: Money,
  fee: Money,
  totalDebit: Money,
  midRate: RateString,
  customerRate: RateString,
  spreadBps: z.number(),
  feeBps: z.number(),
  journalEntryId: z.string().nullable(),
  expiresAt: IsoDate,
});
export type FxQuote = z.infer<typeof FxQuote>;
export const FxConversion = z.object({ quote: FxQuote, transaction: Transaction });

/* ---------------------------------- Admin -------------------------------- */

/**
 * Admin user view. Phase 1 GET /admin/users?phone= returns a plain User; the
 * optional fields are the FUTURE admin-search enrichment (future.ts).
 */
export const AdminUser = User.extend({
  wallets: z.array(Wallet).optional(),
  lastLoginAt: IsoDate.nullable().optional(),
});
export type AdminUser = z.infer<typeof AdminUser>;
export const AdminUserPage = page(AdminUser);

export const SetWalletStatusBody = z.object({
  status: WalletStatus,
  reason: z.string().min(5).max(500),
});
