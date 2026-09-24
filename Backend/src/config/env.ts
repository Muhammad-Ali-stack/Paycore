import { z } from 'zod';

const int = (def: number, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  z.coerce.number().int().min(min).max(max).default(def);

const bool = (def: boolean) =>
  z
    .enum(['true', 'false'])
    .default(def ? 'true' : 'false')
    .transform((v) => v === 'true');

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: int(3000, 1, 65535),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    /** Runtime connection. On Supabase: the transaction pooler (port 6543) with ?pgbouncer=true. */
    DATABASE_URL: z.string().url(),
    /** Direct / session connection (port 5432). Only Prisma migrate uses it; optional at runtime. */
    DIRECT_URL: z.string().url().optional(),
    /**
     * Isolation for ledger transactions. Correctness comes from row locks taken in a consistent
     * order; the snapshot isolation turns any lost-update race into a retryable 40001.
     */
    DB_TX_ISOLATION: z.enum(['RepeatableRead', 'Serializable']).default('RepeatableRead'),
    /** 40001/40P01 retries (safe: the whole callback re-runs). Hot rows (a wallet hammered by many
     *  concurrent payments, shared system accounts) need a budget that grows with contention. */
    DB_TX_MAX_RETRIES: int(20, 0, 50),

    /** Hosted Redis (e.g. Redis Cloud). Must be rediss:// (TLS) in production. */
    REDIS_URL: z.string().url(),
    BULLMQ_DRAIN_DELAY_SECONDS: int(30, 1, 600),
    BULLMQ_STALLED_INTERVAL_MS: int(60_000, 5_000),
    BULLMQ_WORKER_CONCURRENCY: int(2, 1, 50),

    JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
    JWT_ACCESS_TTL_SECONDS: int(900, 60, 3600),
    REFRESH_TOKEN_TTL_SECONDS: int(30 * 24 * 3600, 3600),

    LOGIN_MAX_FAILED_ATTEMPTS: int(5, 1, 100),
    LOGIN_LOCKOUT_SECONDS: int(900, 1),
    PIN_MAX_FAILED_ATTEMPTS: int(3, 1, 20),
    PIN_LOCKOUT_SECONDS: int(1800, 1),
    OTP_TTL_SECONDS: int(300, 30, 3600),
    OTP_MAX_ATTEMPTS: int(5, 1, 20),
    OTP_RESEND_COOLDOWN_SECONDS: int(30, 0, 3600),
    OTP_DEV_ECHO: bool(false),

    THROTTLE_TTL_SECONDS: int(60, 1),
    THROTTLE_LIMIT: int(120, 1),
    AUTH_THROTTLE_LIMIT: int(10, 1),

    IDEMPOTENCY_TTL_SECONDS: int(24 * 3600, 60),
    IDEMPOTENCY_LOCK_SECONDS: int(60, 5),

    FX_RATE_CACHE_TTL_SECONDS: int(60, 1),
    FX_QUOTE_TTL_SECONDS: int(30, 5, 600),
    FX_SPREAD_BPS: int(50, 0, 1000),
    FX_FEE_BPS: int(25, 0, 1000),

    TRANSFER_FEE_BPS: int(0, 0, 1000),
    WITHDRAWAL_FEE_BPS: int(10, 0, 1000),

    // ── Phase 2: queues and background jobs ──
    /** bullmq: jobs and domain events go through Redis to the worker process (npm run start:worker).
     *  inline: processed in-process without Redis (tests, local development without a worker). */
    QUEUE_DRIVER: z.enum(['bullmq', 'inline']).default('bullmq'),
    /** inline driver only: run the repeatable jobs on in-process timers (never in NODE_ENV=test). */
    INLINE_SCHEDULER_ENABLED: bool(true),
    OUTBOX_POLL_INTERVAL_MS: int(5_000, 500, 600_000),
    OUTBOX_BATCH_SIZE: int(100, 1, 1000),
    OUTBOX_MAX_ATTEMPTS: int(12, 1, 100),
    MAINTENANCE_INTERVAL_MS: int(60_000, 1_000, 3_600_000),
    SETTLEMENT_CRON: z.string().min(9).default('0 2 * * *'),
    RECONCILIATION_CRON: z.string().min(9).default('30 3 * * *'),

    // ── Payments / transfers ──
    TRANSFER_QUOTE_TTL_SECONDS: int(60, 5, 600),
    PAYMENT_PROCESSING_TIMEOUT_SECONDS: int(120, 5, 86_400),
    PAYMENT_REQUEST_DEFAULT_TTL_HOURS: int(72, 1, 168),
    LOOKUP_THROTTLE_LIMIT: int(30, 1),

    // ── QR ──
    /** HMAC-SHA256 key for QR payloads and preview tokens. Required (>= 32 chars) in production. */
    QR_SIGNING_SECRET: z.string().min(32, 'must be at least 32 characters').optional(),
    /** Key id stamped into new payloads (claims.kid), for rotation. */
    QR_SIGNING_KEY_ID: z.string().regex(/^[A-Za-z0-9_-]{1,16}$/).default('k1'),
    /** Verify-only keys for rotation: "kid:secret,kid2:secret2". */
    QR_SIGNING_PREVIOUS_KEYS: z.string().optional(),
    QR_PREVIEW_TTL_SECONDS: int(120, 10, 900),
    QR_P2P_TTL_SECONDS: int(900, 30, 86_400),

    // ── Funding / bank adapter ──
    BANK_ADAPTER: z.enum(['simulated']).default('simulated'),
    /** HMAC-SHA256 key shared with the bank for webhook signatures. Required in production. */
    BANK_WEBHOOK_SECRET: z.string().min(32, 'must be at least 32 characters').optional(),
    BANK_WEBHOOK_TOLERANCE_SECONDS: int(300, 30, 3600),
    /** Enables POST /v1/dev/bank/simulate. Rejected by validation in production. */
    BANK_SIM_ENABLED: bool(false),
    /** Where the simulated bank delivers webhooks. Unset = in-process delivery (same code path). */
    BANK_SIM_WEBHOOK_URL: z
      .union([z.string().url(), z.literal('')])
      .optional()
      .transform((v) => (v ? v : undefined)),
    TOPUP_PENDING_TIMEOUT_HOURS: int(24, 1, 720),
    WITHDRAWAL_PENDING_TIMEOUT_HOURS: int(72, 1, 720),
    SETTLEMENT_PAYOUT_TIMEOUT_HOURS: int(72, 1, 720),

    // ── Merchants ──
    MERCHANT_DEFAULT_MDR_BPS: int(150, 0, 1000),
    MERCHANT_DEFAULT_SETTLEMENT_DELAY_DAYS: int(1, 0, 30),
  })
  .superRefine((env, ctx) => {
    const db = new URL(env.DATABASE_URL);
    // Supabase's transaction pooler can't handle prepared statements; Prisma needs pgbouncer=true.
    if (db.port === '6543' && db.searchParams.get('pgbouncer') !== 'true') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: 'transaction-pooler URLs (port 6543) must include ?pgbouncer=true',
      });
    }
    if (env.NODE_ENV === 'production' && !env.REDIS_URL.startsWith('rediss://')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['REDIS_URL'], message: 'must use rediss:// (TLS) in production' });
    }
    if (env.NODE_ENV === 'production' && env.OTP_DEV_ECHO) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OTP_DEV_ECHO'],
        message: 'must be false in production',
      });
    }
    if (env.NODE_ENV === 'production') {
      // The bank simulator can mint webhook outcomes: it must never exist in production.
      if (env.BANK_SIM_ENABLED) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['BANK_SIM_ENABLED'], message: 'must be false in production' });
      }
      for (const key of ['QR_SIGNING_SECRET', 'BANK_WEBHOOK_SECRET'] as const) {
        if (!env[key]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: 'is required in production' });
      }
      if (env.QUEUE_DRIVER !== 'bullmq') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['QUEUE_DRIVER'], message: 'must be bullmq in production' });
      }
    }
    if (env.QR_SIGNING_PREVIOUS_KEYS) {
      try {
        parseKeyList(env.QR_SIGNING_PREVIOUS_KEYS);
      } catch (err) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['QR_SIGNING_PREVIOUS_KEYS'], message: (err as Error).message });
      }
    }
  })
  .transform((env) => ({
    ...env,
    // Development/test fallbacks only; production requires real secrets (checked above).
    QR_SIGNING_SECRET: env.QR_SIGNING_SECRET ?? DEV_ONLY_QR_SECRET,
    BANK_WEBHOOK_SECRET: env.BANK_WEBHOOK_SECRET ?? DEV_ONLY_WEBHOOK_SECRET,
  }));

const DEV_ONLY_QR_SECRET = 'dev-only-qr-signing-secret-do-not-use-in-production';
const DEV_ONLY_WEBHOOK_SECRET = 'dev-only-bank-webhook-secret-do-not-use-in-production';

/** Parse "kid:secret,kid2:secret2" (verify-only rotation keys). */
export function parseKeyList(raw: string): Array<{ kid: string; secret: string }> {
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const idx = part.indexOf(':');
      const kid = part.slice(0, idx);
      const secret = part.slice(idx + 1);
      if (idx <= 0 || !/^[A-Za-z0-9_-]{1,16}$/.test(kid) || secret.length < 32) {
        throw new Error('entries must look like kid:secret with a secret of at least 32 characters');
      }
      return { kid, secret };
    });
}

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
