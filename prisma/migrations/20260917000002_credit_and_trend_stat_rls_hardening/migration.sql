-- Follow-up to 20260917000000_client_look_trend_stat and
-- 20260917000001_client_credit_ledger: the launch-grade RLS hardening from
-- 20260901000000_enable_rls_and_pin_function_search_path only covers tables
-- that existed when it ran — a table added afterward doesn't inherit it, and
-- tests/integration/database-hardening.test.ts caught exactly that for
-- "ClientLookTrendStat"/"ClientCreditEntry" in a local database that had the
-- tables applied out-of-band before RLS statements landed in those files.
--
-- Same deny-all posture as every other table: RLS on, no policies. Safe for
-- the same reason the original migration documents — the app connects as
-- "postgres" (rolbypassrls = true), and nothing routes Prisma-backed table
-- reads through a non-bypassing Supabase role for these tables either.
-- Idempotent: ENABLE ROW LEVEL SECURITY is a no-op on a table that already
-- has it on.

ALTER TABLE "ClientCreditEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClientLookTrendStat" ENABLE ROW LEVEL SECURITY;
