-- Phase 2 reference data: new system ledger accounts and the fee schedule.
-- Changing fees later should be done with a new migration (auditable, reviewed).

-- FUNDS_IN_FLIGHT (LIABILITY, credit-normal): money that has left a wallet or a merchant payable
-- but has not yet been confirmed as paid out by the bank (pending withdrawals and settlement payouts).
INSERT INTO "ledger_accounts" ("id","code","name","type","normal_balance","owner_type","currency","allow_negative","balance","version","updated_at")
SELECT gen_random_uuid(), a.code || '.' || c.cur, a.name || ' (' || c.cur || ')', a.type::"AccountType",
       a.side::"NormalBalance", 'SYSTEM', c.cur::"Currency", true, 0, 0, now()
FROM (VALUES
  ('FUNDS_IN_FLIGHT', 'Funds in flight (pending payouts)', 'LIABILITY', 'CREDIT')
) AS a(code, name, type, side)
CROSS JOIN (VALUES ('PKR'), ('AED'), ('USD')) AS c(cur);

-- Fee schedule, minor units. fee = clamp(ceil(amount * bps / 10000) + fixed, min, max).
--   P2P / REQUEST / QR_P2P / QR_MERCHANT (payer side): free
--   P2P_FX: 0.25% of the send amount (the FX spread is priced into the rate separately)
--   TOPUP_BANK_TRANSFER: free; TOPUP_CARD: 1.5% (deducted from the credited amount)
--   WITHDRAWAL: 0.10%, min 10 PKR / 1 AED / 0.25 USD, max 500 PKR / 50 AED / 15 USD
INSERT INTO "fee_rules" ("product","currency","bps","fixed","min","max","updated_at")
SELECT p.product, c.cur::"Currency", p.bps, 0, 0, NULL, now()
FROM (VALUES
  ('P2P', 0), ('REQUEST', 0), ('QR_P2P', 0), ('QR_MERCHANT', 0),
  ('P2P_FX', 25), ('TOPUP_BANK_TRANSFER', 0), ('TOPUP_CARD', 150)
) AS p(product, bps)
CROSS JOIN (VALUES ('PKR'), ('AED'), ('USD')) AS c(cur);

INSERT INTO "fee_rules" ("product","currency","bps","fixed","min","max","updated_at") VALUES
  ('WITHDRAWAL', 'PKR', 10, 0, 1000, 50000, now()),
  ('WITHDRAWAL', 'AED', 10, 0,  100,  5000, now()),
  ('WITHDRAWAL', 'USD', 10, 0,   25,  1500, now());
