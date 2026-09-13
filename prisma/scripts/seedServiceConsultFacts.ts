// prisma/scripts/seedServiceConsultFacts.ts
//
// Fills each Service's DIAGNOSTIC facts — what the work can and cannot achieve
// — from prisma/data/service-consult-facts.sql.
//
//   pnpm seed:service-facts                  # dry run against $DATABASE_URL
//   pnpm seed:service-facts -- --write       # apply
//
// 🔴 THE ADMIN OWNS THESE VALUES (Tori, 2026-09-13). The SQL fills a fact only
// where nobody has set one yet — `COALESCE` on the text and number columns, OR
// on the booleans — so a value changed in the admin dashboard survives every
// future run of this script and every deploy. It is a starting point, never an
// overwrite.
//
// Safe to run before OR after `pnpm seed:service-catalog`: a service named in
// the data file that does not exist yet is simply skipped, so run it again
// after seeding new services to fill them in.
//
// ENV. `DATABASE_URL` must already be in the environment — this script loads no
// .env file on purpose, because `.env.local` in this repo is PRODUCTION and an
// env loader picking it up silently is how scripts have reached prod before
// (memory: env-source-order-can-point-at-prod). Point it explicitly.

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PrismaClient } from '@prisma/client'

const require = createRequire(import.meta.url)
const { requireSafeScriptRun, describeDatabaseHost, databaseLooksProduction } =
  require('../../scripts/_safe-script-guard.cjs') as {
    requireSafeScriptRun: (options: { scriptName: string; destructive: boolean }) => void
    describeDatabaseHost: () => string
    databaseLooksProduction: () => boolean
  }

const SCRIPT_NAME = 'prisma/scripts/seedServiceConsultFacts.ts'
const KNOWN_FLAGS = new Set(['--write', '--dry-run', '--i-mean-production'])

type Row = {
  name: string
  consultSummary: string | null
  maxLiftLevels: number | null
  depositsTone: boolean
  isChemical: boolean
  changesShape: boolean
  addsLength: boolean
  limitations: string | null
}

async function main(): Promise<void> {
  // pnpm inserts a bare `--` when flags are forwarded through a nested script.
  const args = process.argv.slice(2).filter((flag) => flag !== '--')
  const unknown = args.filter((flag) => !KNOWN_FLAGS.has(flag))
  if (unknown.length > 0) {
    throw new Error(`Unknown flag(s): ${unknown.join(', ')}`)
  }
  const write = args.includes('--write') && !args.includes('--dry-run')

  requireSafeScriptRun({ scriptName: SCRIPT_NAME, destructive: false })
  if (write && databaseLooksProduction() && !args.includes('--i-mean-production')) {
    throw new Error(
      `Refusing to --write against ${describeDatabaseHost()} without --i-mean-production.`,
    )
  }

  const sql = readFileSync(
    join(process.cwd(), 'prisma', 'data', 'service-consult-facts.sql'),
    'utf8',
  )

  const prisma = new PrismaClient()
  try {
    const before = await prisma.$queryRaw<Row[]>`
      SELECT name, "consultSummary", "maxLiftLevels", "depositsTone",
             "isChemical", "changesShape", "addsLength", "limitations"
      FROM "Service" ORDER BY name`
    const unset = before.filter((row) => row.consultSummary === null)

    console.log(`database: ${describeDatabaseHost()}`)
    console.log(`services present: ${before.length}`)
    console.log(`without a consult summary (would be filled): ${unset.length}`)
    for (const row of unset) console.log(`  + ${row.name}`)
    const kept = before.length - unset.length
    if (kept > 0) {
      console.log(`already set (left exactly as they are): ${kept}`)
    }

    if (!write) {
      console.log('\nDRY RUN — nothing written. Re-run with -- --write to apply.')
      return
    }

    // One statement, inside a transaction, so a partial fill is impossible.
    await prisma.$transaction(async (tx) => { await tx.$executeRawUnsafe(sql) })

    const after = await prisma.$queryRaw<Row[]>`
      SELECT name, "consultSummary", "maxLiftLevels", "depositsTone",
             "isChemical", "changesShape", "addsLength", "limitations"
      FROM "Service" ORDER BY name`
    const filled = after.filter((row) => row.consultSummary !== null).length
    console.log(`\nWrote. Services carrying diagnostic facts: ${filled}/${after.length}`)
    const stillEmpty = after.filter((row) => row.consultSummary === null)
    if (stillEmpty.length > 0) {
      console.log(
        `Still without facts (not named in the data file — set them in the admin dashboard): ${stillEmpty
          .map((row) => row.name)
          .join(', ')}`,
      )
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
