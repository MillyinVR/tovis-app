#!/usr/bin/env node
// scripts/postdeploy-verify-walkthrough.mjs
//
// READ-ONLY post-deploy verification for the W-series walkthrough payload.
// Asserts what the four migrations claim to have done, rather than assuming the
// build log's "successfully applied" means the objects are right.
//
//   node scripts/postdeploy-verify-walkthrough.mjs
//
// Exits non-zero if anything is not as expected, so it can gate a rollback
// decision instead of needing a human to read every line.

import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

const m = readFileSync('.env.local', 'utf8').match(/^DIRECT_URL="?([^"\n]+)"?$/m)
if (!m) throw new Error('No DIRECT_URL in .env.local')

const prisma = new PrismaClient({ datasources: { db: { url: m[1] } } })

const EXPECTED = [
  '20260826000000_offering_mode_default_off',
  '20260827000000_location_address_public',
  '20260828000000_waitlist_joined_event',
  '20260829000000_client_chart_share',
]

const failures = []

function check(label, actual, expected) {
  const ok = String(actual) === String(expected)
  console.log(`  ${ok ? '✅' : '🔴'} ${label}: ${actual}${ok ? '' : `  (expected ${expected})`}`)
  if (!ok) failures.push(label)
}

async function main() {
  console.log('\nPost-deploy verification — W-series walkthrough payload\n')

  // 1. Every expected migration applied and none rolled back.
  console.log('1. Migrations')
  const rows = await prisma.$queryRawUnsafe(`
    select migration_name, finished_at, rolled_back_at
    from _prisma_migrations
    where migration_name in (${EXPECTED.map((n) => `'${n}'`).join(', ')})
  `)
  check('applied', rows.length, EXPECTED.length)
  check('finished (none null)', rows.filter((r) => r.finished_at !== null).length, EXPECTED.length)
  check('rolled back', rows.filter((r) => r.rolled_back_at !== null).length, 0)

  const anyWedged = await prisma.$queryRawUnsafe(`
    select count(*)::int as n from _prisma_migrations
    where finished_at is null or rolled_back_at is not null
  `)
  check('wedged rows across the WHOLE table', anyWedged[0].n, 0)

  // 2. The objects each migration creates.
  console.log('\n2. Objects')
  const objs = await prisma.$queryRawUnsafe(`
    select
      (select count(*)::int from information_schema.tables where table_name='ClientChartShare') as t_share,
      (select count(*)::int from information_schema.columns
        where table_name='ProfessionalLocation' and column_name='isAddressPublic')             as c_addr,
      (select is_nullable from information_schema.columns
        where table_name='ProfessionalLocation' and column_name='isAddressPublic')             as c_addr_nullable,
      (select count(*)::int from pg_enum e join pg_type t on t.oid=e.enumtypid
        where t.typname='NotificationEventKey' and e.enumlabel='WAITLIST_JOINED')              as e_waitlist,
      (select count(*)::int from pg_enum e join pg_type t on t.oid=e.enumtypid
        where t.typname='ClientChartShareStatus')                                             as e_share_status,
      (select column_default from information_schema.columns
        where table_name='ProfessionalServiceOffering' and column_name='offersInSalon')        as d_salon
  `)
  const o = objs[0]
  check('ClientChartShare table', o.t_share, 1)
  check('ProfessionalLocation.isAddressPublic', o.c_addr, 1)
  check('  …NOT NULL', o.c_addr_nullable, 'NO')
  check('WAITLIST_JOINED enum value', o.e_waitlist, 1)
  check('ClientChartShareStatus values', o.e_share_status, 4)
  check('offersInSalon default', o.d_salon, 'false')

  // 3. Behaviour on live data: nothing should have been WRITTEN by a migration.
  //
  // Guarded on the table existing so this section REPORTS rather than throws
  // when run before the deploy (or after a rollback). A verifier that crashes
  // half way through tells you less than one that prints every line.
  console.log('\n3. Live data (migrations must not have written anything)')
  if (o.t_share !== 1) {
    console.log('  ⏭  skipped — ClientChartShare does not exist yet (see section 2)')
    report()
    return
  }

  const data = await prisma.$queryRawUnsafe(`
    select
      (select count(*)::int from "ClientChartShare")                                   as shares,
      (select count(*)::int from "ProfessionalLocation" where "isAddressPublic")       as published_addresses,
      (select count(*)::int from "ProfessionalServiceOffering" where "offersInSalon")  as offerings_claiming_salon
  `)
  const d = data[0]
  check('ClientChartShare rows', d.shares, 0)
  check('locations with a published address', d.published_addresses, 0)
  console.log(
    `  ℹ️  offerings still storing offersInSalon=true: ${d.offerings_claiming_salon}` +
      ` (expected — the backfill is a SEPARATE, approval-gated script; the read` +
      ` boundary narrows these at read time)`,
  )

  report()
}

function report() {
  console.log(
    failures.length
      ? `\n🔴 ${failures.length} CHECK(S) FAILED — consider rollback (vercel rollback)\n`
      : `\n✅ All post-deploy checks passed.\n`,
  )
  if (failures.length) process.exitCode = 1
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
