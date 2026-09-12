// prisma/scripts/seedServiceCatalog.ts
//
// Seeds the canonical service catalog (lib/services/catalog) into a database:
// categories, services and their licence permissions. Idempotent — a second
// run is a no-op — and dry-run by default. The plan is printed either way.
//
//   pnpm seed:service-catalog                     # dry run against $DATABASE_URL
//   pnpm seed:service-catalog -- --write          # apply
//   pnpm seed:service-catalog -- --write --activate
//                                                 # ...and make NEW categories live
//   pnpm seed:service-catalog:test                # docker test DB, --write --activate
//
// Flags the plan explains when it needs them:
//   --activate              new categories start active (default: inactive, so a
//                           freshly seeded category is reviewed before pros see it)
//   --allow-family-change   apply a consult-family change on an existing category
//   --force                 apply a floor change, a category move or a parent change
//   --i-mean-production     required to --write against a hosted (Supabase) host
//
// Never deletes, never deactivates, never lowers or raises a floor on its own.
// See lib/services/catalog/seedPlan.ts for exactly what is held back and why.
//
// ENV. `DATABASE_URL` must be in the environment already — this script loads no
// .env file on purpose: `.env.local` in this repo is PRODUCTION, and an env
// loader picking it up silently is how scripts have ended up on prod before
// (memory: env-source-order-can-point-at-prod). Point it explicitly:
//   DATABASE_URL=postgresql://... pnpm seed:service-catalog
// or use the :test / :dev package scripts, which set it.

import { createRequire } from 'node:module'

import { PrismaClient } from '@prisma/client'

import { SERVICE_CATALOG } from '@/lib/services/catalog'
import {
  applyServiceCatalogSeed,
  formatServiceCatalogSeedPlan,
  planServiceCatalogSeed,
  summarizeServiceCatalogSeedPlan,
  type ServiceCatalogSeedPlan,
} from '@/lib/services/catalog/seedPlan'

const require = createRequire(import.meta.url)
const {
  requireSafeScriptRun,
  describeDatabaseHost,
  databaseLooksProduction,
} = require('../../scripts/_safe-script-guard.cjs') as {
  requireSafeScriptRun: (options: { scriptName: string; destructive: boolean }) => void
  describeDatabaseHost: () => string
  databaseLooksProduction: () => boolean
}

const SCRIPT_NAME = 'prisma/scripts/seedServiceCatalog.ts'

const KNOWN_FLAGS = new Set([
  '--write',
  '--dry-run',
  '--activate',
  '--allow-family-change',
  '--force',
  '--i-mean-production',
])

type CliOptions = {
  write: boolean
  activate: boolean
  allowFamilyChange: boolean
  force: boolean
  iMeanProduction: boolean
}

function parseCliOptions(rawArgv: readonly string[]): CliOptions {
  // `pnpm seed:service-catalog -- --write` forwards the bare `--` separator too.
  const argv = rawArgv.filter((arg) => arg !== '--')
  const unknown = argv.filter((arg) => !KNOWN_FLAGS.has(arg))
  if (unknown.length) {
    throw new Error(`unknown argument(s): ${unknown.join(' ')} — known: ${[...KNOWN_FLAGS].join(' ')}`)
  }
  const has = (flag: string) => argv.includes(flag)
  return {
    write: has('--write') && !has('--dry-run'),
    activate: has('--activate'),
    allowFamilyChange: has('--allow-family-change'),
    force: has('--force'),
    iMeanProduction: has('--i-mean-production'),
  }
}

function printPlan(plan: ServiceCatalogSeedPlan): void {
  for (const line of formatServiceCatalogSeedPlan(plan)) console.log(line)
  const s = summarizeServiceCatalogSeedPlan(plan)
  console.log('')
  console.log(
    `categories: +${s.categories.create} ~${s.categories.update} =${s.categories.skip} | ` +
      `services: +${s.services.create} ~${s.services.update} =${s.services.skip} | ` +
      `permissions: +${s.permissions} | held back: ${s.heldBack} | refused: ${s.refusals}`,
  )
}

async function main(): Promise<number> {
  const options = parseCliOptions(process.argv.slice(2))

  // NODE_ENV=production and a missing DATABASE_URL are refused here, the same
  // way every other script in this folder refuses them.
  requireSafeScriptRun({ scriptName: SCRIPT_NAME, destructive: false })

  const host = describeDatabaseHost()
  console.log(`[${SCRIPT_NAME}] ${options.write ? 'WRITE' : 'DRY RUN'} against ${host}`)
  console.log(
    `  flags: activate=${options.activate} allowFamilyChange=${options.allowFamilyChange} force=${options.force}`,
  )

  if (options.write && databaseLooksProduction() && !options.iMeanProduction) {
    console.error(
      `[${SCRIPT_NAME}] ${host} looks like a hosted/production database. ` +
        'Re-run with --i-mean-production if that is intended (production needs Tori’s explicit go-ahead).',
    )
    return 2
  }

  const prisma = new PrismaClient()
  try {
    const plan = await prisma.$transaction(
      async (tx) => {
        const planned = await planServiceCatalogSeed(tx, SERVICE_CATALOG, {
          allowFamilyChange: options.allowFamilyChange,
          force: options.force,
        })
        if (options.write && planned.refusals.length === 0) {
          const result = await applyServiceCatalogSeed(tx, planned, { activate: options.activate })
          console.log(
            `[${SCRIPT_NAME}] wrote: categories +${result.categoriesCreated} ~${result.categoriesUpdated}, ` +
              `services +${result.servicesCreated} ~${result.servicesUpdated}, permissions +${result.permissionsCreated}`,
          )
        }
        return planned
      },
      { timeout: 60_000 },
    )

    printPlan(plan)

    if (plan.refusals.length) {
      console.error(`[${SCRIPT_NAME}] refused — nothing was written.`)
      return 1
    }
    if (!options.write) console.log(`[${SCRIPT_NAME}] dry run — nothing was written. Add --write to apply.`)
    return 0
  } finally {
    await prisma.$disconnect()
  }
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    console.error(`[${SCRIPT_NAME}] failed:`, error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
