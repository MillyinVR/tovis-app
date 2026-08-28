// tests/integration/database-hardening.test.ts
//
// Standing guard for the launch-grade database hardening applied by
// `20260901000000_enable_rls_and_pin_function_search_path`.
//
// The migration is a point-in-time act: it enables RLS on the tables that
// existed when it ran. Nothing stops the NEXT migration from adding a table
// without it, and a table with RLS off is invisible as a defect — it behaves
// exactly like every other table until the day something reaches it through a
// non-bypassing role. This file is what makes the omission fail loudly instead.
//
// Runs against the docker test database:
//   pnpm test:integration
//
// ⚠️ If a new table legitimately must not have RLS, add it to
// `RLS_EXEMPT_TABLES` with the reason — do not delete the assertion.

import { afterAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with: pnpm test:integration')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

/**
 * Tables in `public` that are deliberately left without RLS.
 *
 * `spatial_ref_sys` is PostGIS's static list of coordinate reference systems.
 * It is owned by `supabase_admin` and owned by the extension, so `ALTER TABLE`
 * would fail with "must be owner of table" and take the deploy down with it. It
 * holds no user data.
 *
 * Re-verified against production 2026-08-28 — see ACCEPTED SUPABASE ADVISOR
 * FINDINGS below, which records why this and two sibling advisories cannot be
 * "fixed" and what goes wrong if someone tries.
 */
const RLS_EXEMPT_TABLES = new Set(['spatial_ref_sys'])

/**
 * ── ACCEPTED SUPABASE ADVISOR FINDINGS (audited 2026-08-28, production) ─────
 *
 * The Supabase security advisor reports 10 non-INFO findings (1 ERROR + 9
 * WARN, alongside 157 INFO `rls_enabled_no_policy` rows that ARE the deny-all
 * posture working) which will never clear. All three underlying causes below
 * were probed directly against production as `postgres` — the role Prisma
 * migrates as; every "fix" is either rejected by Postgres outright or is a net
 * security REGRESSION. Do not re-litigate them without
 * re-running the probes — two of the three look trivially fixable and are not.
 *
 * 1. ERROR `rls_disabled_in_public` — `public.spatial_ref_sys`.
 *    UNFIXABLE. `ALTER TABLE public.spatial_ref_sys ENABLE ROW LEVEL SECURITY`
 *    fails with `must be owner of table spatial_ref_sys` (owner is
 *    `supabase_admin`; `pg_has_role(current_user, relowner, 'MEMBER')` = false).
 *    A migration containing it would abort the deploy.
 *    ⚠️ Enabling RLS here would ALSO need a permissive policy, which would
 *    break the "RLS on, no policies" deny-all invariant asserted below — the
 *    lock works precisely because `pg_policies` in `public` is empty.
 *    Residual exposure: the EPSG coordinate-reference registry (8500 rows of
 *    public reference data, no user data). Confirmed readable by `anon` on
 *    staging; on production `anon` lacks USAGE on schema `public`, so
 *    `GET /rest/v1/spatial_ref_sys` returns 401 "permission denied for schema
 *    public". App tables stay protected either way — on staging `anon` reads
 *    `Booking` as 0 rows, which is the deny-all lock doing its job.
 *
 * 2. WARN `extension_in_public` ×3 — `postgis`, `vector`, `btree_gist`.
 *    DELIBERATELY NOT FIXED; the advisor's advice is wrong for this database.
 *    • `postgis` cannot move at all: `ALTER EXTENSION postgis SET SCHEMA
 *      extensions` fails with `extension "postgis" does not support SET
 *      SCHEMA` (`extrelocatable` = false), so the WARN is permanent regardless.
 *    • `vector` and `btree_gist` DO relocate successfully — and doing so makes
 *      things WORSE. Supabase grants `anon`/`authenticated` USAGE on schema
 *      `extensions` (`nspacl` = `{...,anon=U/postgres,authenticated=U/postgres,...}`)
 *      but NOT on `public`. Probed on production: as `anon`,
 *      `vector_dims('[1,2,3]'::vector)` is "permission denied for schema
 *      public" before the move and returns `3` after it. Relocating hands the
 *      anonymous role a function surface it currently cannot reach.
 *    • Independently, it would break CI and local dev: the integration
 *      containers are vanilla `imresamu/postgis:16-3.4-bundle0`, whose
 *      `search_path` has no `extensions` entry (that is a Supabase-specific
 *      `ALTER ROLE postgres` setting), so `::vector` casts and the `<=>`
 *      operator in the embedding suites would stop resolving.
 *    This test asserts the three stay in `public` so a future migration that
 *    relocates them goes red here instead of shipping.
 *
 * 3. WARN `anon`/`authenticated`_`security_definer_function_executable` ×6 —
 *    `public.st_estimatedextent(text,text[,text[,boolean]])`, PostGIS's
 *    internal index-statistics helper, three overloads × two roles.
 *    UNFIXABLE AND UNNECESSARY.
 *    ⚠️ `REVOKE EXECUTE ... FROM PUBLIC/anon` is a SILENT NO-OP here: it runs
 *    without error (so a migration carrying it goes green) while
 *    `has_function_privilege('anon', ..., 'EXECUTE')` stays true, because
 *    `postgres` is not the grantor — the EXECUTE-to-PUBLIC grant is the
 *    function default from owner `supabase_admin`. Verified on production.
 *    It is also not reachable: `anon` gets "permission denied for schema
 *    public", and PostgREST cannot invoke it anyway — all three overloads have
 *    `proargnames` = NULL, so `POST /rest/v1/rpc/st_estimatedextent` returns
 *    PGRST202 ("no matches were found in the schema cache").
 *
 * Clearing 1 and 3 requires `supabase_admin`, which no migration in this repo
 * can assume. They are Tori's call to raise with Supabase support, not ours.
 */
const EXTENSIONS_PINNED_TO_PUBLIC = ['btree_gist', 'postgis', 'vector']

/** Our own functions — the ones whose `search_path` must stay pinned. */
const PINNED_FUNCTIONS = [
  'tovis_booking_overlap_range',
  'consent_form_version_is_append_only',
  'consult_session_scope_guard',
  'consult_immutable_row',
  'consult_acceptance_guard',
  'consult_intake_payload_guard',
  'consult_current_agreements_active',
  'consult_revision_requires_agreements',
  'consult_lifecycle_guard',
  'consult_upload_session_guard',
  'consult_capture_guard',
  'consult_upload_consumed_requires_capture',
  'consult_capture_requires_consumed_upload',
  'consult_capture_c3_contract_guard',
  'consult_booking_raw_purge_fence',
  'consult_capture_finalize_fence',
  'consult_raw_purge_fence',
  'consult_session_delete_requires_purge',
  'consult_capture_delete_requires_purge',
]

type TableRow = { tablename: string; rowsecurity: boolean }
type FnRow = { proname: string; proconfig: string[] | null }
type ConstraintRow = { conname: string; convalidated: boolean }

describe('database hardening', () => {
  it('has row level security enabled on every app table in public', async () => {
    // Extension-owned tables are excluded the same way the migration excludes
    // them, so the guard and the migration cannot disagree about the target set.
    const rows = await db.$queryRaw<TableRow[]>`
      SELECT c.relname AS tablename, c.relrowsecurity AS rowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND NOT EXISTS (
          SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e'
        )
      ORDER BY c.relname
    `

    // Sanity: the query must actually be looking at a real schema. Without this
    // an empty result would pass the assertion below while proving nothing.
    expect(rows.length).toBeGreaterThan(100)

    const unprotected = rows
      .filter((row) => !row.rowsecurity && !RLS_EXEMPT_TABLES.has(row.tablename))
      .map((row) => row.tablename)

    expect(
      unprotected,
      'These public tables have NO row level security.\n' +
        'A table added after 20260901000000 does not inherit it — enable it in\n' +
        'the migration that creates the table:\n' +
        unprotected.map((name) => `  ALTER TABLE "${name}" ENABLE ROW LEVEL SECURITY;`).join('\n'),
    ).toEqual([])
  })

  it('keeps the deny-all posture: RLS on, no policies', async () => {
    // The lock works precisely BECAUSE there are no policies — RLS with no
    // policy denies every non-bypassing role. A policy appearing here means
    // someone started building a per-row access model, which is a product
    // decision that changes what this migration means.
    const rows = await db.$queryRaw<{ count: bigint }[]>`
      SELECT count(*)::bigint AS count FROM pg_policies WHERE schemaname = 'public'
    `
    const count = rows[0] ? Number(rows[0].count) : -1

    expect(
      count,
      'A policy exists on a public table. RLS here is a deny-all lock; ' +
        'adding policies changes the security model and needs a deliberate decision.',
    ).toBe(0)
  })

  it('keeps postgis, vector and btree_gist in public', async () => {
    // Finding 2 in ACCEPTED SUPABASE ADVISOR FINDINGS above. The advisor asks
    // for these to move to a dedicated schema; on this project that is either
    // impossible (`postgis` is not relocatable) or a REGRESSION — `anon` holds
    // USAGE on `extensions` but not on `public`, so relocating `vector` /
    // `btree_gist` newly exposes their functions to the anonymous role, and
    // breaks `::vector` in CI where `extensions` is not on the search_path.
    //
    // This is the tripwire: a migration that relocates one of them fails here.
    const rows = await db.$queryRaw<{ extname: string; nspname: string }[]>`
      SELECT e.extname, n.nspname
      FROM pg_extension e
      JOIN pg_namespace n ON n.oid = e.extnamespace
      WHERE e.extname = ANY(${EXTENSIONS_PINNED_TO_PUBLIC})
      ORDER BY e.extname
    `

    // Each must actually be installed — otherwise "all in public" is vacuously
    // true against a database where they simply do not exist.
    expect(rows.map((row) => row.extname)).toEqual(EXTENSIONS_PINNED_TO_PUBLIC)

    const moved = rows.filter((row) => row.nspname !== 'public')

    expect(
      moved.map((row) => `${row.extname} -> ${row.nspname}`),
      'These extensions were moved out of `public`. That does not satisfy the\n' +
        'Supabase advisor safely — read ACCEPTED SUPABASE ADVISOR FINDINGS at the\n' +
        'top of this file before changing it.',
    ).toEqual([])
  })

  it('pins search_path on every function we define', async () => {
    // Scoped to OUR functions by name rather than sweeping every non-extension
    // function in `public`.
    //
    // The sweep was the first shape of this test and CI rejected it: the
    // Postgres image the integration job runs ships 17 loose `svg*` helpers
    // (svgdoc, svgrect, _svgattr, …) in `public` which are NOT extension-owned,
    // so `pg_depend deptype='e'` does not filter them out. Production has
    // exactly the two functions below and none of that; the local docker image
    // has neither. A guard that goes red because of what the CI base image
    // happens to contain is noise, not a finding.
    //
    // The cost is that this list is maintained by hand: **a migration that adds
    // a function must add it here too.** That is the same discipline as
    // RLS_EXEMPT_TABLES above — explicit, and visible in review.
    const rows = await db.$queryRaw<FnRow[]>`
      SELECT p.proname, p.proconfig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.prokind = 'f'
        AND p.proname = ANY(${PINNED_FUNCTIONS})
    `

    // Each one must actually be present — otherwise "all pinned" is vacuously
    // true against a database where they simply do not exist.
    expect(rows.map((row) => row.proname).sort()).toEqual(
      [...PINNED_FUNCTIONS].sort(),
    )

    // An unpinned function resolves unqualified names against the caller's
    // search_path, so a schema earlier in the path can shadow a builtin.
    const unpinned = rows
      .filter((row) => !(row.proconfig ?? []).some((c) => c.startsWith('search_path=')))
      .map((row) => row.proname)

    expect(
      unpinned,
      'These functions have no pinned search_path:\n' +
        unpinned.map((name) => `  ALTER FUNCTION public.${name}(...) SET search_path = '';`).join('\n'),
    ).toEqual([])
  })

  it('leaves the booking overlap exclusion constraints valid and enforcing', async () => {
    // tovis_booking_overlap_range backs the GiST exclusion constraints that make
    // no-double-booking durable. Adding a SET clause must not invalidate them.
    const rows = await db.$queryRaw<ConstraintRow[]>`
      SELECT conname, convalidated
      FROM pg_constraint
      WHERE contype = 'x' AND conname LIKE '%overlap%'
      ORDER BY conname
    `

    expect(rows.map((row) => row.conname)).toEqual([
      'BookingHold_no_active_professional_overlap',
      'Booking_no_active_professional_overlap',
    ])
    expect(rows.every((row) => row.convalidated)).toBe(true)
  })

  it('still computes the overlap range correctly through the pinned function', async () => {
    // search_path = '' would break the function if its body reached anything
    // outside pg_catalog. Evaluate it rather than trusting that it doesn't.
    const evaluated = await db.$queryRaw<
      { span: string; hit: boolean; miss: boolean }[]
    >`
      SELECT
        tovis_booking_overlap_range(TIMESTAMP '2026-09-01 10:00', 60, 15)::text AS span,
        tovis_booking_overlap_range(TIMESTAMP '2026-09-01 10:00', 60, 15)
          && tovis_booking_overlap_range(TIMESTAMP '2026-09-01 11:00', 60, 15) AS hit,
        tovis_booking_overlap_range(TIMESTAMP '2026-09-01 10:00', 60, 15)
          && tovis_booking_overlap_range(TIMESTAMP '2026-09-01 12:00', 60, 15) AS miss
    `

    const row = evaluated[0]
    expect(row).toBeDefined()

    // 10:00 + 60min service + 15min buffer → 11:15.
    expect(row?.span).toBe('["2026-09-01 10:00:00","2026-09-01 11:15:00")')
    expect(row?.hit).toBe(true)
    expect(row?.miss).toBe(false)
  })
})

afterAll(async () => {
  await db.$disconnect()
})
