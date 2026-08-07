-- Follow-up to 20260905000000_ai_consult_session: the launch-grade RLS
-- hardening from 20260901000000_enable_rls_and_pin_function_search_path only
-- covers tables that existed when it ran — a table added afterward doesn't
-- inherit it, and tests/integration/database-hardening.test.ts caught exactly
-- that for "ConsultSession"/"ConsultPhoto" (both added same-day, after).
--
-- Same deny-all posture as every other table: RLS on, no policies. Safe for
-- the same reason the original migration documents — the app connects as
-- "postgres" (rolbypassrls = true), and nothing routes Prisma-backed table
-- reads through a non-bypassing Supabase role for these tables either.

ALTER TABLE "ConsultSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConsultPhoto" ENABLE ROW LEVEL SECURITY;
