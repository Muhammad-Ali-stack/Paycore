-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('P2P', 'P2P_FX', 'REQUEST', 'QR_MERCHANT', 'QR_P2P', 'REFUND');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'PROCESSING', 'COMPLETED', 'FAILED', 'REVERSED', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AmountSide" AS ENUM ('SEND', 'RECEIVE');

-- CreateEnum
CREATE TYPE "FundingDirection" AS ENUM ('TOPUP', 'WITHDRAWAL');

-- CreateEnum
CREATE TYPE "FundingMethod" AS ENUM ('BANK_TRANSFER', 'CARD');

-- CreateEnum
CREATE TYPE "FundingStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "WebhookEventOutcome" AS ENUM ('APPLIED', 'DEFERRED', 'FLAGGED', 'IGNORED', 'UNMATCHED');

-- CreateEnum
CREATE TYPE "MerchantStatus" AS ENUM ('PENDING_REVIEW', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "KybTier" AS ENUM ('KYB_0', 'KYB_1', 'KYB_2');

-- CreateEnum
CREATE TYPE "ResourceStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "QrKind" AS ENUM ('STATIC_MERCHANT', 'DYNAMIC_MERCHANT', 'P2P_RECEIVE');

-- CreateEnum
CREATE TYPE "QrStatus" AS ENUM ('ACTIVE', 'PAID', 'EXPIRED', 'DISABLED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'PAID', 'FAILED');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReconciliationItemType" AS ENUM ('MISSING_IN_LEDGER', 'MISSING_IN_BANK', 'AMOUNT_MISMATCH');

-- CreateEnum
CREATE TYPE "SimBankTxnKind" AS ENUM ('TOPUP', 'PAYOUT');

-- AlterEnum
ALTER TYPE "AccountOwnerType" ADD VALUE 'MERCHANT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EntryType" ADD VALUE 'PAYMENT';
ALTER TYPE "EntryType" ADD VALUE 'REFUND';
ALTER TYPE "EntryType" ADD VALUE 'TOPUP';
ALTER TYPE "EntryType" ADD VALUE 'WITHDRAWAL_HOLD';
ALTER TYPE "EntryType" ADD VALUE 'WITHDRAWAL_PAYOUT';
ALTER TYPE "EntryType" ADD VALUE 'SETTLEMENT';
ALTER TYPE "EntryType" ADD VALUE 'SETTLEMENT_PAYOUT';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "username" TEXT;

-- CreateTable
CREATE TABLE "fee_rules" (
    "product" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "bps" INTEGER NOT NULL,
    "fixed" BIGINT NOT NULL DEFAULT 0,
    "min" BIGINT NOT NULL DEFAULT 0,
    "max" BIGINT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_rules_pkey" PRIMARY KEY ("product","currency")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "type" "PaymentType" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "payer_user_id" UUID,
    "payer_wallet_id" UUID,
    "payee_user_id" UUID,
    "payee_wallet_id" UUID,
    "merchant_id" UUID,
    "outlet_id" UUID,
    "terminal_id" UUID,
    "qr_code_id" UUID,
    "payment_request_id" UUID,
    "transfer_quote_id" UUID,
    "original_payment_id" UUID,
    "currency" "Currency" NOT NULL,
    "amount" BIGINT NOT NULL,
    "fee" BIGINT NOT NULL DEFAULT 0,
    "total_debit" BIGINT NOT NULL,
    "received_currency" "Currency",
    "received_amount" BIGINT,
    "mdr_fee" BIGINT NOT NULL DEFAULT 0,
    "refunded_amount" BIGINT NOT NULL DEFAULT 0,
    "reference" TEXT,
    "failure_code" TEXT,
    "failure_reason" TEXT,
    "failure_details" JSONB,
    "journal_entry_id" UUID,
    "reversal_entry_id" UUID,
    "external_ref" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "preview_jti" TEXT,
    "single_use_qr_id" UUID,
    "settlement_id" UUID,
    "timeline" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_quotes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "from_wallet_id" UUID NOT NULL,
    "to_user_id" UUID NOT NULL,
    "to_wallet_id" UUID NOT NULL,
    "from_currency" "Currency" NOT NULL,
    "to_currency" "Currency" NOT NULL,
    "amount_side" "AmountSide" NOT NULL,
    "send_amount" BIGINT NOT NULL,
    "receive_amount" BIGINT NOT NULL,
    "fee" BIGINT NOT NULL,
    "fee_product" TEXT NOT NULL,
    "mid_rate" BIGINT,
    "customer_rate" BIGINT,
    "status" "FxQuoteStatus" NOT NULL DEFAULT 'OPEN',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "payment_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfer_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_requests" (
    "id" UUID NOT NULL,
    "requester_id" UUID NOT NULL,
    "payer_id" UUID NOT NULL,
    "currency" "Currency" NOT NULL,
    "amount" BIGINT NOT NULL,
    "note" TEXT,
    "status" "PaymentRequestStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "payment_id" UUID,
    "timeline" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qr_codes" (
    "id" UUID NOT NULL,
    "kind" "QrKind" NOT NULL,
    "status" "QrStatus" NOT NULL DEFAULT 'ACTIVE',
    "merchant_id" UUID,
    "outlet_id" UUID,
    "terminal_id" UUID,
    "user_id" UUID,
    "currency" "Currency" NOT NULL,
    "amount" BIGINT,
    "reference" TEXT,
    "single_use" BOOLEAN NOT NULL DEFAULT false,
    "key_id" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "payment_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qr_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchants" (
    "id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "business_name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "registration_number" TEXT NOT NULL,
    "website" TEXT,
    "status" "MerchantStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "kyb_tier" "KybTier" NOT NULL DEFAULT 'KYB_0',
    "settlement_currency" "Currency" NOT NULL,
    "settlement_bank" JSONB NOT NULL,
    "settlement_delay_days" INTEGER NOT NULL,
    "mdr_bps" INTEGER NOT NULL,
    "ledger_account_id" UUID NOT NULL,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_outlets" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "status" "ResourceStatus" NOT NULL DEFAULT 'ACTIVE',
    "static_qr_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_outlets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_terminals" (
    "id" UUID NOT NULL,
    "outlet_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "status" "ResourceStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_terminals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "currency" "Currency" NOT NULL,
    "amount" BIGINT NOT NULL,
    "mdr_refund" BIGINT NOT NULL DEFAULT 0,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "failure_code" TEXT,
    "failure_reason" TEXT,
    "refund_payment_id" UUID,
    "journal_entry_id" UUID,
    "external_ref" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "settlement_id" UUID,
    "timeline" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlements" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "currency" "Currency" NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "gross" BIGINT NOT NULL,
    "mdr" BIGINT NOT NULL,
    "refunds" BIGINT NOT NULL,
    "net" BIGINT NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'PENDING',
    "bank_reference" TEXT NOT NULL,
    "journal_entry_id" UUID,
    "payout_entry_id" UUID,
    "reversal_entry_id" UUID,
    "failure_reason" TEXT,
    "paid_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "timeline" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_lines" (
    "id" UUID NOT NULL,
    "settlement_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "payment_id" UUID,
    "refund_id" UUID,
    "gross" BIGINT NOT NULL,
    "mdr" BIGINT NOT NULL,
    "net" BIGINT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funding_transactions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "direction" "FundingDirection" NOT NULL,
    "method" "FundingMethod" NOT NULL,
    "status" "FundingStatus" NOT NULL DEFAULT 'PENDING',
    "currency" "Currency" NOT NULL,
    "amount" BIGINT NOT NULL,
    "fee" BIGINT NOT NULL DEFAULT 0,
    "bank_reference" TEXT NOT NULL,
    "bank_account" JSONB,
    "instructions" JSONB,
    "failure_reason" TEXT,
    "hold_entry_id" UUID,
    "settle_entry_id" UUID,
    "submitted_at" TIMESTAMP(3),
    "needs_review" BOOLEAN NOT NULL DEFAULT false,
    "review_reason" TEXT,
    "external_ref" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "timeline" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funding_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_webhook_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "bank_reference" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "outcome" "WebhookEventOutcome" NOT NULL,
    "note" TEXT,
    "signed_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_at" TIMESTAMP(3),

    CONSTRAINT "bank_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_runs" (
    "id" UUID NOT NULL,
    "date" TEXT NOT NULL,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'RUNNING',
    "matched" INTEGER NOT NULL DEFAULT 0,
    "missing_in_ledger" INTEGER NOT NULL DEFAULT 0,
    "missing_in_bank" INTEGER NOT NULL DEFAULT 0,
    "amount_mismatches" INTEGER NOT NULL DEFAULT 0,
    "triggered_by" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "reconciliation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_items" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "type" "ReconciliationItemType" NOT NULL,
    "bank_reference" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "bank_amount" BIGINT,
    "ledger_amount" BIGINT,
    "funding_id" UUID,
    "settlement_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sim_bank_transactions" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "kind" "SimBankTxnKind" NOT NULL,
    "currency" "Currency" NOT NULL,
    "amount" BIGINT NOT NULL,
    "status" "FundingStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sim_bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sim_bank_statement_lines" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "amount" BIGINT NOT NULL,
    "value_date" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sim_bank_statement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_journal_entry_id_key" ON "payments"("journal_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_reversal_entry_id_key" ON "payments"("reversal_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_external_ref_key" ON "payments"("external_ref");

-- CreateIndex
CREATE UNIQUE INDEX "payments_single_use_qr_id_key" ON "payments"("single_use_qr_id");

-- CreateIndex
CREATE INDEX "payments_payer_user_id_created_at_idx" ON "payments"("payer_user_id", "created_at");

-- CreateIndex
CREATE INDEX "payments_payee_user_id_created_at_idx" ON "payments"("payee_user_id", "created_at");

-- CreateIndex
CREATE INDEX "payments_merchant_id_status_completed_at_idx" ON "payments"("merchant_id", "status", "completed_at");

-- CreateIndex
CREATE INDEX "payments_status_updated_at_idx" ON "payments"("status", "updated_at");

-- CreateIndex
CREATE INDEX "payments_settlement_id_idx" ON "payments"("settlement_id");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_quotes_payment_id_key" ON "transfer_quotes"("payment_id");

-- CreateIndex
CREATE INDEX "transfer_quotes_user_id_created_at_idx" ON "transfer_quotes"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "transfer_quotes_status_expires_at_idx" ON "transfer_quotes"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_requests_payment_id_key" ON "payment_requests"("payment_id");

-- CreateIndex
CREATE INDEX "payment_requests_requester_id_created_at_idx" ON "payment_requests"("requester_id", "created_at");

-- CreateIndex
CREATE INDEX "payment_requests_payer_id_created_at_idx" ON "payment_requests"("payer_id", "created_at");

-- CreateIndex
CREATE INDEX "payment_requests_status_expires_at_idx" ON "payment_requests"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "qr_codes_payment_id_key" ON "qr_codes"("payment_id");

-- CreateIndex
CREATE INDEX "qr_codes_merchant_id_created_at_idx" ON "qr_codes"("merchant_id", "created_at");

-- CreateIndex
CREATE INDEX "qr_codes_user_id_created_at_idx" ON "qr_codes"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "qr_codes_status_expires_at_idx" ON "qr_codes"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "merchants_owner_user_id_key" ON "merchants"("owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "merchants_ledger_account_id_key" ON "merchants"("ledger_account_id");

-- CreateIndex
CREATE INDEX "merchants_status_created_at_idx" ON "merchants"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_outlets_static_qr_id_key" ON "merchant_outlets"("static_qr_id");

-- CreateIndex
CREATE INDEX "merchant_outlets_merchant_id_created_at_idx" ON "merchant_outlets"("merchant_id", "created_at");

-- CreateIndex
CREATE INDEX "merchant_terminals_outlet_id_created_at_idx" ON "merchant_terminals"("outlet_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_refund_payment_id_key" ON "refunds"("refund_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_journal_entry_id_key" ON "refunds"("journal_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_external_ref_key" ON "refunds"("external_ref");

-- CreateIndex
CREATE INDEX "refunds_payment_id_idx" ON "refunds"("payment_id");

-- CreateIndex
CREATE INDEX "refunds_merchant_id_status_completed_at_idx" ON "refunds"("merchant_id", "status", "completed_at");

-- CreateIndex
CREATE INDEX "refunds_settlement_id_idx" ON "refunds"("settlement_id");

-- CreateIndex
CREATE UNIQUE INDEX "settlements_bank_reference_key" ON "settlements"("bank_reference");

-- CreateIndex
CREATE UNIQUE INDEX "settlements_journal_entry_id_key" ON "settlements"("journal_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "settlements_payout_entry_id_key" ON "settlements"("payout_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "settlements_reversal_entry_id_key" ON "settlements"("reversal_entry_id");

-- CreateIndex
CREATE INDEX "settlements_merchant_id_created_at_idx" ON "settlements"("merchant_id", "created_at");

-- CreateIndex
CREATE INDEX "settlements_status_created_at_idx" ON "settlements"("status", "created_at");

-- CreateIndex
CREATE INDEX "settlement_lines_settlement_id_idx" ON "settlement_lines"("settlement_id");

-- CreateIndex
CREATE UNIQUE INDEX "funding_transactions_bank_reference_key" ON "funding_transactions"("bank_reference");

-- CreateIndex
CREATE UNIQUE INDEX "funding_transactions_hold_entry_id_key" ON "funding_transactions"("hold_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "funding_transactions_settle_entry_id_key" ON "funding_transactions"("settle_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "funding_transactions_external_ref_key" ON "funding_transactions"("external_ref");

-- CreateIndex
CREATE INDEX "funding_transactions_user_id_created_at_idx" ON "funding_transactions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "funding_transactions_status_created_at_idx" ON "funding_transactions"("status", "created_at");

-- CreateIndex
CREATE INDEX "bank_webhook_events_bank_reference_received_at_idx" ON "bank_webhook_events"("bank_reference", "received_at");

-- CreateIndex
CREATE INDEX "reconciliation_runs_date_created_at_idx" ON "reconciliation_runs"("date", "created_at");

-- CreateIndex
CREATE INDEX "reconciliation_items_run_id_idx" ON "reconciliation_items"("run_id");

-- CreateIndex
CREATE INDEX "outbox_events_published_at_available_at_idx" ON "outbox_events"("published_at", "available_at");

-- CreateIndex
CREATE INDEX "outbox_events_aggregate_type_aggregate_id_idx" ON "outbox_events"("aggregate_type", "aggregate_id");

-- CreateIndex
CREATE UNIQUE INDEX "sim_bank_transactions_reference_key" ON "sim_bank_transactions"("reference");

-- CreateIndex
CREATE INDEX "sim_bank_statement_lines_value_date_idx" ON "sim_bank_statement_lines"("value_date");

-- CreateIndex
CREATE INDEX "sim_bank_statement_lines_reference_idx" ON "sim_bank_statement_lines"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- AddForeignKey
ALTER TABLE "merchant_outlets" ADD CONSTRAINT "merchant_outlets_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_terminals" ADD CONSTRAINT "merchant_terminals_outlet_id_fkey" FOREIGN KEY ("outlet_id") REFERENCES "merchant_outlets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_items" ADD CONSTRAINT "reconciliation_items_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "reconciliation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ───────────── Hand-written: integrity constraints (phase 2) ─────────────

-- Usernames are stored lower-case and must match the public format.
ALTER TABLE "users" ADD CONSTRAINT "users_username_format"
  CHECK ("username" IS NULL OR "username" ~ '^[a-z0-9_]{3,20}$');

-- Money columns: positive amounts, non-negative fees, refunds never exceed the original.
ALTER TABLE "payments" ADD CONSTRAINT "payments_amounts_valid"
  CHECK ("amount" > 0 AND "fee" >= 0 AND "mdr_fee" >= 0 AND "mdr_fee" <= "amount"
         AND "total_debit" = "amount" + "fee"
         AND "refunded_amount" >= 0 AND "refunded_amount" <= "amount"
         AND ("received_amount" IS NULL OR "received_amount" > 0));
ALTER TABLE "transfer_quotes" ADD CONSTRAINT "transfer_quotes_amounts_valid"
  CHECK ("send_amount" > 0 AND "receive_amount" > 0 AND "fee" >= 0);
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_amount_positive" CHECK ("amount" IS NULL OR "amount" > 0);
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_amounts_valid"
  CHECK ("amount" > 0 AND "mdr_refund" >= 0 AND "mdr_refund" <= "amount");
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_amounts_valid"
  CHECK ("net" > 0 AND "net" = "gross" - "mdr" - "refunds");
ALTER TABLE "funding_transactions" ADD CONSTRAINT "funding_amounts_valid"
  CHECK ("amount" > 0 AND "fee" >= 0 AND "fee" < "amount");
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_pricing_valid"
  CHECK ("mdr_bps" >= 0 AND "mdr_bps" <= 1000 AND "settlement_delay_days" >= 0 AND "settlement_delay_days" <= 30
         AND "category" ~ '^[0-9]{4}$');

-- A QR preview token can back at most one live (non-failed) payment: replaying a preview token
-- with a new Idempotency-Key is rejected by the database, not just by application code.
CREATE UNIQUE INDEX "payments_preview_jti_live"
  ON "payments" ("preview_jti") WHERE "preview_jti" IS NOT NULL AND "status" <> 'FAILED';

-- A payment and a refund can be settled at most once while their settlement is live
-- (settlement_id is cleared again only if the payout fails).
CREATE INDEX "payments_unsettled_merchant" ON "payments" ("merchant_id", "completed_at")
  WHERE "settlement_id" IS NULL AND "type" = 'QR_MERCHANT';

-- Settlement history is append-only once written.
CREATE TRIGGER settlement_lines_append_only
  BEFORE UPDATE OR DELETE ON "settlement_lines"
  FOR EACH ROW EXECUTE FUNCTION paycore_forbid_mutation();

-- ───────────── Supabase lockdown: RLS on every new table (no policies) ─────────────
ALTER TABLE "fee_rules"                ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payments"                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE "transfer_quotes"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_requests"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "qr_codes"                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE "merchants"                ENABLE ROW LEVEL SECURITY;
ALTER TABLE "merchant_outlets"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "merchant_terminals"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "refunds"                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "settlements"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "settlement_lines"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "funding_transactions"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bank_webhook_events"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reconciliation_runs"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reconciliation_items"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outbox_events"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sim_bank_transactions"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sim_bank_statement_lines" ENABLE ROW LEVEL SECURITY;
