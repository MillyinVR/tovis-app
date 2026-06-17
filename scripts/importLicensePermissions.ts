// scripts/importLicensePermissions.ts
//
// Seeds the ServicePermission allow-list from the license-scope tables
// (lib/migration/licenseScope.ts) so a pro only sees/manages catalog services
// their license permits in their state. Idempotent — re-running only creates
// rows that don't already exist.
//
// Usage:
//   pnpm import:license-permissions               # DRY RUN — report only (default)
//   pnpm import:license-permissions --write        # apply: create missing rows
//
// Dry run is the default precisely because this writes to whatever DATABASE_URL
// points at; you must opt in with --write to mutate. The report lists rows to
// create, unmatched service names (catalog gaps), and professions with no
// resolvable services so nothing is silently dropped.

import type { Prisma } from '@prisma/client'

import {
  planLicensePermissionsImport,
  type ExistingPermission,
} from '@/lib/migration/licensePermissionsImport'
import { prisma } from '@/lib/prisma'

interface CliArgs {
  write: boolean
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { write: false }
  for (const arg of argv) {
    if (arg === '--write') args.write = true
    else if (arg === '--dry-run') args.write = false
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return args
}

const CREATE_CHUNK = 500

async function main(): Promise<void> {
  const { write } = parseArgs(process.argv.slice(2))

  const [catalog, existing] = await Promise.all([
    prisma.service.findMany({ select: { id: true, name: true }, take: 5000 }),
    prisma.servicePermission.findMany({
      select: { serviceId: true, professionType: true, stateCode: true },
      take: 100000,
    }),
  ])

  const plan = planLicensePermissionsImport({
    catalog,
    existing: existing as ExistingPermission[],
  })

  console.log('── license-permissions import ' + (write ? '(WRITE)' : '(DRY RUN)') + ' ──')
  console.log(`catalog services:        ${catalog.length}`)
  console.log(`scope specs expanded:    ${plan.totalSpecs}`)
  console.log(`already present:         ${plan.alreadyPresent}`)
  console.log(`rows to create:          ${plan.toCreate.length}`)

  if (plan.unmatchedServiceNames.length > 0) {
    console.warn(
      `\n⚠️  ${plan.unmatchedServiceNames.length} scope service name(s) not in catalog (no rows created for these):`,
    )
    for (const name of plan.unmatchedServiceNames) console.warn(`   • ${name}`)
  }

  if (plan.professionsWithNoServices.length > 0) {
    console.warn(
      `\n⚠️  ${plan.professionsWithNoServices.length} profession(s) resolved to ZERO catalog services:`,
    )
    for (const p of plan.professionsWithNoServices) console.warn(`   • ${p}`)
  }

  if (!write) {
    console.log('\nDry run — no rows written. Re-run with --write to apply.')
    return
  }

  let created = 0
  for (let i = 0; i < plan.toCreate.length; i += CREATE_CHUNK) {
    const chunk = plan.toCreate.slice(i, i + CREATE_CHUNK)
    const data: Prisma.ServicePermissionCreateManyInput[] = chunk.map((row) => ({
      serviceId: row.serviceId,
      professionType: row.professionType,
      stateCode: row.stateCode,
    }))
    const res = await prisma.servicePermission.createMany({ data, skipDuplicates: true })
    created += res.count
    console.log(`created ${created}/${plan.toCreate.length}…`)
  }

  console.log(`\n✅ license-permissions import complete: ${created} row(s) created`)
}

main()
  .catch((error) => {
    console.error('license-permissions import failed', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
