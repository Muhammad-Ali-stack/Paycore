-- Ledger integrity guarantees enforced by PostgreSQL itself, so that no code path
-- (including ad-hoc SQL, bugs or future services) can corrupt the books.

-- 1. A posting can never be zero.
ALTER TABLE "postings" ADD CONSTRAINT "postings_amount_non_zero" CHECK ("amount" <> 0);

-- 2. Accounts that do not allow negative balances can never go negative (cached balance).
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_non_negative"
  CHECK ("allow_negative" OR "balance" >= 0);

-- 3. Money-bearing tables are append-only.
CREATE OR REPLACE FUNCTION paycore_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only (% forbidden)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER postings_append_only
  BEFORE UPDATE OR DELETE ON "postings"
  FOR EACH ROW EXECUTE FUNCTION paycore_forbid_mutation();
CREATE TRIGGER postings_no_truncate
  BEFORE TRUNCATE ON "postings"
  FOR EACH STATEMENT EXECUTE FUNCTION paycore_forbid_mutation();

CREATE TRIGGER journal_entries_append_only
  BEFORE UPDATE OR DELETE ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION paycore_forbid_mutation();
CREATE TRIGGER journal_entries_no_truncate
  BEFORE TRUNCATE ON "journal_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION paycore_forbid_mutation();

CREATE TRIGGER kyc_audit_logs_append_only
  BEFORE UPDATE OR DELETE ON "kyc_audit_logs"
  FOR EACH ROW EXECUTE FUNCTION paycore_forbid_mutation();

-- 4. Ledger accounts can't be deleted, and their identity (currency/type/side) is immutable.
CREATE TRIGGER ledger_accounts_no_delete
  BEFORE DELETE ON "ledger_accounts"
  FOR EACH ROW EXECUTE FUNCTION paycore_forbid_mutation();

CREATE OR REPLACE FUNCTION paycore_ledger_account_immutable_fields() RETURNS trigger AS $$
BEGIN
  IF NEW."currency" <> OLD."currency"
     OR NEW."type" <> OLD."type"
     OR NEW."normal_balance" <> OLD."normal_balance"
     OR NEW."owner_type" <> OLD."owner_type" THEN
    RAISE EXCEPTION 'Ledger account % identity fields are immutable', OLD."id" USING ERRCODE = 'P0001';
  END IF;
  IF NEW."version" <> OLD."version" + 1 AND NEW."balance" <> OLD."balance" THEN
    RAISE EXCEPTION 'Ledger account % balance changed without version bump', OLD."id" USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_accounts_immutable_fields
  BEFORE UPDATE ON "ledger_accounts"
  FOR EACH ROW EXECUTE FUNCTION paycore_ledger_account_immutable_fields();

-- 5. Posting currency must match its account currency.
CREATE OR REPLACE FUNCTION paycore_posting_currency_matches() RETURNS trigger AS $$
DECLARE
  acct_currency "Currency";
BEGIN
  SELECT "currency" INTO acct_currency FROM "ledger_accounts" WHERE "id" = NEW."account_id";
  IF acct_currency IS DISTINCT FROM NEW."currency" THEN
    RAISE EXCEPTION 'Posting currency % does not match account % currency %',
      NEW."currency", NEW."account_id", acct_currency USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER postings_currency_matches
  BEFORE INSERT ON "postings"
  FOR EACH ROW EXECUTE FUNCTION paycore_posting_currency_matches();

-- 6. Every journal entry balances to zero per currency and has >= 2 postings.
--    Checked at COMMIT (deferred) so all legs of an entry can be inserted first.
CREATE OR REPLACE FUNCTION paycore_check_entry_balanced() RETURNS trigger AS $$
DECLARE
  target_entry uuid;
  unbalanced record;
  leg_count int;
BEGIN
  IF TG_TABLE_NAME = 'postings' THEN
    target_entry := NEW."entry_id";
  ELSE
    target_entry := NEW."id";
  END IF;

  SELECT count(*) INTO leg_count FROM "postings" WHERE "entry_id" = target_entry;
  IF leg_count < 2 THEN
    RAISE EXCEPTION 'Journal entry % must have at least 2 postings (has %)', target_entry, leg_count
      USING ERRCODE = 'P0001';
  END IF;

  SELECT "currency", sum("amount") AS total INTO unbalanced
    FROM "postings" WHERE "entry_id" = target_entry
    GROUP BY "currency" HAVING sum("amount") <> 0 LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Journal entry % does not balance in %: net %', target_entry,
      unbalanced."currency", unbalanced.total USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER postings_entry_balanced
  AFTER INSERT ON "postings"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION paycore_check_entry_balanced();

CREATE CONSTRAINT TRIGGER journal_entries_have_postings
  AFTER INSERT ON "journal_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION paycore_check_entry_balanced();

-- 7. At most one KYC submission under review per user.
CREATE UNIQUE INDEX "kyc_submissions_one_pending_per_user"
  ON "kyc_submissions" ("user_id") WHERE "status" = 'PENDING';
