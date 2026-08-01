#!/usr/bin/env node
// scripts/preflight-prod-migration-state.mjs
//
// READ-ONLY deploy pre-flight. Reconciles what the production database actually
// has against what this checkout is about to apply.
//
// Runs no DDL and no writes — only SELECTs against `_prisma_migrations` and the
// catalog. Safe to run at any time.
//
//   node scripts/preflight-prod-migration-state.mjs
//
// Reports:
//   1. any UNFINISHED or ROLLED-BACK migration row (a wedged migrate state must
//      be reconciled BEFORE another deploy, per the deploy runbook),
//   2. which of this checkout's migrations prod is missing,
//   3. whether the objects those migrations create already exist (which would
//      mean someone applied them out of band).

import { readdirSync, readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

const raw = readFileSync('.env.local', 'utf8')
const m = raw.match(/^DIRECT_URL="?([^"\n]+)"?$/m)
if (!m) {
  console.error('No DIRECT_URL in .env.local')
  process.exit(1)
}

const url = m[1]
const prisma = new PrismaClient({ datasources: { db: { url } } })

function host() {
  try {
    return new URL(url).host
  } catch {
    return '(unparseable)'
  }
}

const local = readdirSync('prisma/migrations', { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort()

async function main() {
  console.log(`\nProd migration pre-flight`)
  console.log(`  host: ${host()}`)
  console.log(`  local migrations in this checkout: ${local.length}\n`)

  const rows = await prisma.$queryRawUnsafe(`
    select migration_name, finished_at, rolled_back_at, applied_steps_count
    from _prisma_migrations
    order by migration_name
  `)

  const applied = new Map(rows.map((r) => [r.migration_name, r]))

  const wedged = rows.filter((r) => r.finished_at === null || r.rolled_back_at !== null)
  console.log(`1. Migrate state health`)
  console.log(`   rows on prod          : ${rows.length}`)
  console.log(`   UNFINISHED/ROLLED-BACK: ${wedged.length}`)
  if (wedged.length) {
    console.log(`   🔴 RECONCILE BEFORE DEPLOYING:`)
    for (const r of wedged) {
      console.log(
        `      ${r.migration_name}  finished_at=${r.finished_at}  rolled_back_at=${r.rolled_back_at}`,
      )
    }
  } else {
    console.log(`   ✅ every prod migration finished cleanly, none rolled back`)
  }

  const pending = local.filter((name) => !applied.has(name))
  console.log(`\n2. Migrations this deploy would APPLY`)
  console.log(`   count: ${pending.length}`)
  for (const name of pending) console.log(`     + ${name}`)

  const orphans = rows
    .map((r) => r.migration_name)
    .filter((name) => !local.includes(name))
  if (orphans.length) {
    console.log(`\n   ⚠️ on prod but NOT in this checkout (${orphans.length}):`)
    for (const name of orphans) console.log(`     ? ${name}`)
  }

  // 3. Do the new objects already exist? (out-of-band application)
  const objects = await prisma.$queryRawUnsafe(`
    select
      (select count(*)::int from information_schema.tables
        where table_name = 'ClientChartShare')                             as chart_share_table,
      (select count(*)::int from information_schema.columns
        where table_name = 'ProfessionalLocation' and column_name = 'isAddressPublic') as addr_public_col,
      (select count(*)::int from pg_enum e join pg_type t on t.oid = e.enumtypid
        where t.typname = 'NotificationEventKey' and e.enumlabel = 'WAITLIST_JOINED')  as waitlist_enum,
      (select column_default from information_schema.columns
        where table_name = 'ProfessionalServiceOffering' and column_name = 'offersInSalon') as offers_in_salon_default
  `)

  console.log(`\n3. Target objects, as prod stands RIGHT NOW`)
  console.log(`   ClientChartShare table          : ${objects[0].chart_share_table} (expect 0 pre-deploy)`)
  console.log(`   ProfessionalLocation.isAddressPublic: ${objects[0].addr_public_col} (expect 0 pre-deploy)`)
  console.log(`   WAITLIST_JOINED enum value      : ${objects[0].waitlist_enum} (expect 0 pre-deploy)`)
  console.log(`   offersInSalon default           : ${objects[0].offers_in_salon_default} (expect true pre-deploy)`)

  // 4. Blast radius of the W5 revoke, so the number is known BEFORE it happens.
  const w5 = await prisma.$queryRawUnsafe(`
    select count(*)::int as thread_only_pairs from (
      select distinct t."clientId", t."professionalId"
      from "MessageThread" t
      where not exists (
        select 1 from "Booking" b
        where b."clientId" = t."clientId"
          and b."professionalId" = t."professionalId"
          and b.status <> 'CANCELLED'
      )
    ) x
  `)

  console.log(`\n4. 🔴 W5 blast radius — pro↔client pairs that LOSE chart access`)
  console.log(`   thread-only pairs: ${w5[0].thread_only_pairs}`)
  console.log(
    `   (each is a pro whose only link to that client is a message thread;\n` +
      `    pairs with any non-cancelled booking are unaffected)\n`,
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
