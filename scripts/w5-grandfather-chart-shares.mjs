#!/usr/bin/env node
// scripts/w5-grandfather-chart-shares.mjs
//
// W5 — the OPT-IN half of the grandfathering decision.
//
// Migration `20260829000000_client_chart_share` creates an EMPTY table, so the
// default on deploy is REVOKE: a pro whose only link to a client is a message
// thread loses chart access the moment the code ships. That is the correct
// default for a consent feature and it is what the audit recommends.
//
// If Tori decides the other way, this inserts a GRANTED row for every existing
// thread-only pair, so nobody loses access they have today.
//
//   node scripts/w5-grandfather-chart-shares.mjs           # dry run (default)
//   node scripts/w5-grandfather-chart-shares.mjs --apply   # writes
//
// ⚠️ Read this before running it. It records CONSENT THAT NOBODY GAVE. Every row
// it writes says "this client agreed to share their medical record with this
// professional", and no client ever did — the app simply behaved as if they had.
// It is defensible ONLY as continuity for relationships that already exist, and
// only because the client can revoke every one of them from /client/settings.
//
// It is deliberately not a migration: a deploy must not grant consent
// unattended, and this needs a human to have read the paragraph above.
//
// Pairs with a real BOOKING are never touched — they do not need a row, because
// a booking grants access on its own.

import { PrismaClient } from '@prisma/client'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const urlArg = args.find((a) => a.startsWith('--url='))
const url = urlArg ? urlArg.slice('--url='.length) : process.env.DIRECT_URL

if (!url) {
  console.error('No database URL. Set DIRECT_URL or pass --url=postgresql://…')
  process.exit(1)
}

function hostOf(connectionString) {
  try {
    return new URL(connectionString).host
  } catch {
    return '(unparseable)'
  }
}

const prisma = new PrismaClient({ datasources: { db: { url } } })

async function main() {
  console.log(`\nW5 chart-share grandfathering`)
  console.log(`  host : ${hostOf(url)}`)
  console.log(`  mode : ${APPLY ? '🔴 APPLY (writes)' : 'dry run (no writes)'}\n`)

  // Thread-only pairs: a MessageThread exists, no non-cancelled booking does,
  // and there is no share row yet. Mirrors `getProClientVisibility`'s ordering —
  // booking first, then share, then thread.
  const pairs = await prisma.$queryRawUnsafe(`
    select distinct t."clientId", t."professionalId"
    from "MessageThread" t
    where not exists (
      select 1 from "Booking" b
      where b."clientId" = t."clientId"
        and b."professionalId" = t."professionalId"
        and b.status <> 'CANCELLED'
    )
    and not exists (
      select 1 from "ClientChartShare" s
      where s."clientId" = t."clientId"
        and s."professionalId" = t."professionalId"
    )
    order by t."professionalId", t."clientId"
  `)

  const pros = new Set(pairs.map((row) => row.professionalId))
  const clients = new Set(pairs.map((row) => row.clientId))

  console.log(`Thread-only pairs that would be granted:`)
  console.log(`  pairs         : ${pairs.length}`)
  console.log(`  professionals : ${pros.size}`)
  console.log(`  clients       : ${clients.size}`)
  console.log(
    `\n  Without this, those ${pairs.length} pro↔client pairs lose chart access on deploy.`,
  )
  console.log(
    `  Every pair with a real booking is unaffected either way and is NOT counted here.\n`,
  )

  if (pairs.length > 0) {
    console.log(`  First 20:`)
    for (const row of pairs.slice(0, 20)) {
      console.log(`    pro=${row.professionalId}  client=${row.clientId}`)
    }
    if (pairs.length > 20) console.log(`    …and ${pairs.length - 20} more`)
  }

  if (!APPLY) {
    console.log(`\nDry run — nothing written. Re-run with --apply to commit.`)
    console.log(
      `Doing nothing is the DEFAULT and the recommended choice: it means no pro\n` +
        `keeps access a client never consented to.\n`,
    )
    return
  }

  if (pairs.length === 0) {
    console.log(`\nNothing to do.\n`)
    return
  }

  const now = new Date()
  const result = await prisma.clientChartShare.createMany({
    data: pairs.map((row) => ({
      clientId: row.clientId,
      professionalId: row.professionalId,
      status: 'GRANTED',
      // No requestedAt: nobody asked. respondedAt records WHEN the grant was
      // created, and it is this script, not the client — which is exactly why
      // the caveat at the top of this file matters.
      respondedAt: now,
    })),
    // The unique index is the backstop if this is run twice.
    skipDuplicates: true,
  })

  console.log(`\n✅ Applied.`)
  console.log(`   shares granted : ${result.count}`)
  console.log(`   skipped (existing rows) : ${pairs.length - result.count}`)
  console.log(
    `\n   Clients can revoke any of these from /client/settings. Tell them.\n`,
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
