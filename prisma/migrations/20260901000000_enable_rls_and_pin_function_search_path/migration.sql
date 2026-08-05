-- Launch-grade database hardening: RLS everywhere in `public`, and a pinned
-- `search_path` on both of our own functions.
--
-- ── Why this is safe (verified against production, reads only, 2026-08-04) ──
--
-- Enabling RLS with NO policies is a deny-all for every role that does not
-- bypass it. That is only a "cheap lock" and not an outage if literally nothing
-- reaches these tables except a bypassing role. Verified:
--
--   • The app connects as `postgres`, which has **rolbypassrls = true** (it is
--     NOT a superuser — Supabase removed that — but BYPASSRLS is set). Prisma is
--     therefore unaffected: `DATABASE_URL` (pooler :6543) and `DIRECT_URL`
--     (session pooler :5432) both authenticate as that role.
--   • `service_role` also has rolbypassrls = true.
--   • `anon` / `authenticated` do NOT bypass — but nothing routes table reads
--     through them. Every non-Prisma Supabase path in either repo was checked:
--       – web `useLiveChannels` and iOS `SupabaseRealtime` use Realtime
--         **broadcast** only (`.on('broadcast')` / phx_join with
--         `config.broadcast`). Broadcast never touches Postgres, so RLS cannot
--         affect it. Neither repo contains a single `postgres_changes`.
--       – web `uploadWithProgress`, iOS `SupabaseSignedUpload` and every
--         `getSupabaseAdmin()` call site use the **Storage** API
--         (`admin.storage.from(bucket)`, `/storage/v1/object/...`). Storage
--         authorizes against `storage.objects`, a different schema this
--         migration does not touch.
--       – `broadcastLive` posts to `/realtime/v1/api/broadcast` with the
--         service-role key.
--       – There is no PostgREST table access anywhere: zero `.from('<table>')`
--         and zero `.rpc(` against a Supabase client.
--   • `anon` does not even hold USAGE on schema `public`, and holds SELECT on
--     exactly one table — `spatial_ref_sys`, PostGIS's static reference data,
--     owned by `supabase_admin`. It carries no user data and is excluded below.
--
-- So this is defence in depth rather than the closing of an open hole: today
-- there is no reachable path for a non-bypassing role. It means that if a
-- PostgREST/anon path is ever introduced, it fails CLOSED (visibly, at once)
-- instead of quietly exposing 137 tables.

-- ── 1. RLS on every app table in `public` ───────────────────────────────────
--
-- Dynamic rather than 136 hand-written statements, because the list is exactly
-- "what is in the schema", and a hand-written list is stale the day it lands.
--
-- Two exclusions, both load-bearing:
--   • extension-owned tables (`pg_depend.deptype = 'e'`) — PostGIS's
--     `spatial_ref_sys` is owned by `supabase_admin`, so ALTER TABLE would fail
--     with "must be owner of table" and take the whole deploy down with it.
--   • anything this role does not own, for the same reason.
--
-- `relkind IN ('r','p')` covers ordinary and partitioned tables. Views are
-- deliberately absent: RLS does not apply to them; they inherit from the tables
-- underneath.
DO $$
DECLARE
  target record;
  enabled_count integer := 0;
BEGIN
  FOR target IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND NOT c.relrowsecurity
      AND pg_has_role(current_user, c.relowner, 'MEMBER')
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.objid = c.oid AND d.deptype = 'e'
      )
    ORDER BY c.relname
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',
      target.relname
    );
    enabled_count := enabled_count + 1;
  END LOOP;

  RAISE NOTICE 'RLS enabled on % public table(s)', enabled_count;
END $$;

-- ── 2. Pin `search_path` on our own functions ───────────────────────────────
--
-- An unpinned SECURITY-relevant function resolves unqualified names against
-- whatever the caller's `search_path` happens to be, so a schema earlier in the
-- path can shadow a builtin and change what the function does.
--
-- `search_path = ''` is the strictest form and is correct for both of these:
-- `pg_catalog` is always searched regardless, and neither body references
-- anything outside it (no app tables, no non-builtin functions).
--
-- ⚠️ `tovis_booking_overlap_range` is used inside the GiST EXCLUSION
-- CONSTRAINTS on "Booking" and "BookingHold" that make no-double-booking
-- durable. Adding a SET clause does not alter the body, the declared IMMUTABLE
-- volatility, or the values returned — so the existing indexes stay valid and
-- no REINDEX is required. The migration test re-proves the constraint still
-- refuses an overlapping booking after this runs.
ALTER FUNCTION public.tovis_booking_overlap_range(timestamp, integer, integer)
  SET search_path = '';

-- Same warning, same one-line fix. A trigger function that only RAISEs, so it
-- has nothing to resolve either.
ALTER FUNCTION public.consent_form_version_is_append_only()
  SET search_path = '';
