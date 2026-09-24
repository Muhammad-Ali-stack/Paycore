/**
 * Shared conventions from docs/API_CONTRACT.md ("Conventions (all phases)").
 * Every response schema in phase1/phase2/future builds on these.
 */
import { z } from 'zod';

export const CURRENCIES = ['PKR', 'AED', 'USD'] as const;
export const Currency = z.enum(CURRENCIES);
export type Currency = z.infer<typeof Currency>;

/** Decimal string in major units, e.g. "1250.50". Never a float. */
export const DecimalString = z.string().regex(/^-?\d+(\.\d+)?$/, 'Expected a decimal string');
/** Integer string in minor units, e.g. "125050". */
export const MinorString = z.string().regex(/^-?\d+$/, 'Expected an integer string');
/** FX rate, a decimal string with 8 dp, e.g. "277.10750000". */
export const RateString = z.string().regex(/^\d+(\.\d+)?$/);

export const Money = z.object({
  currency: Currency,
  amount: DecimalString,
  amountMinor: MinorString,
});
export type Money = z.infer<typeof Money>;

export const IsoDate = z.string().min(10);
export const Uuid = z.string().min(1);

/** `?cursor=<opaque>&limit=<1..100>` returns `{ items, nextCursor }`. */
export const page = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    // Some backend pages mark nextCursor optional; normalise to string | null.
    nextCursor: z
      .string()
      .nullable()
      .optional()
      .transform((v) => v ?? null),
  });
export type Page<T> = { items: T[]; nextCursor: string | null };
export type PageQuery = { cursor?: string; limit?: number };

/** Error envelope: `{ error: { code, message, details?, correlationId } }`. */
export const ApiErrorBody = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    correlationId: z.string().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

/** Codes the UI handles explicitly (subset of Backend domain-error.ts plus phase 2). */
export const ERROR_CODES = [
  'INSUFFICIENT_FUNDS',
  'LIMIT_EXCEEDED',
  'CURRENCY_NOT_PERMITTED',
  'PIN_INVALID',
  'PIN_LOCKED',
  'PIN_NOT_SET',
  'QUOTE_EXPIRED',
  'WALLET_NOT_ACTIVE',
  'ACCOUNT_LOCKED',
  'RATE_LIMITED',
  'VALIDATION_FAILED',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'IDEMPOTENCY_IN_PROGRESS',
  'IDEMPOTENCY_KEY_REUSED',
  'QR_INVALID',
  'QR_EXPIRED',
  'QR_ALREADY_PAID',
  // Phase 2 backend codes
  'USERNAME_TAKEN',
  'CURRENCY_MISMATCH',
  'INVALID_STATE_TRANSITION',
  'PAYMENT_REQUEST_NOT_PENDING',
  'PAYMENT_REQUEST_EXPIRED',
  'QR_NOT_ACTIVE',
  'QR_PREVIEW_INVALID',
  'QR_PREVIEW_EXPIRED',
  'QR_PREVIEW_USED',
  'MERCHANT_EXISTS',
  'MERCHANT_NOT_ACTIVE',
  'PAYMENT_NOT_REFUNDABLE',
  'REFUND_EXCEEDS_PAYMENT',
  'WEBHOOK_SIGNATURE_INVALID',
  'FEATURE_DISABLED',
  'PAYMENT_FAILED',
  'INVALID_CREDENTIALS',
  'OTP_INVALID',
  'OTP_EXPIRED',
  'PHONE_NOT_VERIFIED',
  'CONFLICT',
  'NETWORK_ERROR',
  'CONTRACT_MISMATCH',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number] | (string & {});

export const LimitKind = z.enum(['PER_TRANSACTION', 'DAILY', 'MONTHLY', 'MAX_BALANCE']);
export type LimitKind = z.infer<typeof LimitKind>;

/** Idempotency-Key: 8–128 chars `[A-Za-z0-9_.:-]`. */
export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_.:-]{8,128}$/;

/** Money-out PIN: 4–6 digits. */
export const Pin = z.string().regex(/^\d{4,6}$/);

export const Role = z.enum(['CONSUMER', 'MERCHANT', 'ADMIN']);
export type Role = z.infer<typeof Role>;

export const KycTier = z.enum(['TIER_0', 'TIER_1', 'TIER_2', 'TIER_3']);
export type KycTier = z.infer<typeof KycTier>;

export const TimelineEntry = z.object({
  status: z.string(),
  at: IsoDate,
  reason: z.string().optional().nullable(),
});
export type TimelineEntry = z.infer<typeof TimelineEntry>;
