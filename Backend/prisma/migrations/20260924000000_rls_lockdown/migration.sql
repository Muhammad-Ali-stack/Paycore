-- Lock the database down so it is reachable ONLY through the PayCore backend.
--
-- On Supabase, the auto-generated Data API (PostgREST) exposes the public schema to the
-- `anon` and `authenticated` roles. PayCore doesn't use Supabase Auth, Storage, Realtime or
-- the Data API, so:
--   1. RLS is enabled on every table with NO policies => anon/authenticated see nothing;
--   2. all privileges are revoked from anon/authenticated, now and for future tables;
--   3. the Data API should also be disabled in the dashboard (see README).
-- The backend connects as the table owner (postgres), which bypasses RLS because RLS is
-- ENABLED but not FORCED. New tables added by later migrations MUST enable RLS too; the
-- integration test "every table has RLS enabled" enforces this.

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;

-- Supabase-specific roles only exist on Supabase; skip them elsewhere (local/test clusters).
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', r);
    END IF;
  END LOOP;
END $$;
