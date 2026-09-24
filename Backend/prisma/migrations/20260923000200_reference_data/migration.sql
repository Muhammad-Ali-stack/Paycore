-- Reference data that every environment must have: system ledger accounts and KYC tier limits.
-- Changing limits later should be done with a new migration (auditable, reviewed).

-- System accounts: 4 per currency.
INSERT INTO "ledger_accounts" ("id","code","name","type","normal_balance","owner_type","currency","allow_negative","balance","version","updated_at")
SELECT gen_random_uuid(), a.code || '.' || c.cur, a.name || ' (' || c.cur || ')', a.type::"AccountType",
       a.side::"NormalBalance", 'SYSTEM', c.cur::"Currency", true, 0, 0, now()
FROM (VALUES
  ('BANK_CLEARING', 'Bank clearing',        'ASSET',     'DEBIT'),
  ('FEE_REVENUE',   'Fee revenue',          'REVENUE',   'CREDIT'),
  ('SETTLEMENT',    'Settlement / FX position', 'ASSET', 'DEBIT'),
  ('SUSPENSE',      'Suspense',             'LIABILITY', 'CREDIT')
) AS a(code, name, type, side)
CROSS JOIN (VALUES ('PKR'), ('AED'), ('USD')) AS c(cur);

-- Tier limits in minor units (all three currencies have 2 decimal places).
-- 0 = currency not permitted at this tier.
INSERT INTO "tier_limits" ("tier","currency","per_txn_max","daily_max","monthly_max","max_balance","updated_at") VALUES
  ('TIER_0','PKR',      500000,     1000000,      5000000,      2000000, now()),
  ('TIER_0','AED',           0,           0,            0,            0, now()),
  ('TIER_0','USD',           0,           0,            0,            0, now()),
  ('TIER_1','PKR',     2500000,     5000000,     20000000,     20000000, now()),
  ('TIER_1','AED',      100000,      200000,      1000000,      1000000, now()),
  ('TIER_1','USD',       25000,       50000,       250000,       250000, now()),
  ('TIER_2','PKR',    50000000,   100000000,    400000000,    500000000, now()),
  ('TIER_2','AED',     2000000,     4000000,     15000000,     20000000, now()),
  ('TIER_2','USD',      500000,     1000000,      4000000,      5000000, now()),
  ('TIER_3','PKR',   500000000,  2000000000,  10000000000,  20000000000, now()),
  ('TIER_3','AED',    20000000,    80000000,    400000000,    800000000, now()),
  ('TIER_3','USD',     5000000,    20000000,    100000000,    200000000, now());
