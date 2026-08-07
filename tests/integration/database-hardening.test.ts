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
 */
const RLS_EXEMPT_TABLES = new Set(['spatial_ref_sys'])

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
