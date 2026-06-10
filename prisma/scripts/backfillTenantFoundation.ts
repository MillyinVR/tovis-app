// prisma/scripts/backfillTenantFoundation.ts
//
// Expand-phase tenant backfill (docs/architecture/tenant-model.md):
//   1. Ensure the reserved root tenant 'tovis-root' exists.
//   2. Point every row with a NULL tenant column at tovis-root:
//      ProfessionalProfile.homeTenantId, ClientProfile.homeTenantId,
//      Booking.proTenantId, Booking.clientHomeTenantId, NfcCard.tenantId.
//
// Idempotent and batched; dry run by default. Usage:
//   pnpm backfill:tenant-foundation              # dry run (counts only)
//   pnpm backfill:tenant-foundation --write      # apply
//   pnpm backfill:tenant-foundation --write --batch-size=250
//
// (npm-style `pnpm backfill:tenant-foundation -- --write` also works; the
// literal `--` separator is ignored.)

import { PrismaClient } from '@prisma/client'

import {
  TOVIS_ROOT_TENANT_NAME,
  TOVIS_ROOT_TENANT_SLUG,
} from '@/lib/tenant/constants'

const prisma = new PrismaClient()

const DEFAULT_BATCH_SIZE = 500
const MAX_BATCH_SIZE = 2000

type CliOptions = {
  write: boolean
  batchSize: number
}

type TargetStats = {
  label: string
  pending: number
  updated: number
}

function parseCliOptions(argv: string[]): CliOptions {
  let write = false
  let batchSize = DEFAULT_BATCH_SIZE

  for (const arg of argv) {
    // pnpm forwards the npm-style `--` separator to the script verbatim.
    if (arg === '--') {
      continue
    }

    if (arg === '--write') {
      write = true
      continue
    }

    const sizeMatch = arg.match(/^--batch-size=(\d+)$/)
    if (sizeMatch?.[1]) {
      const parsed = Number.parseInt(sizeMatch[1], 10)
      if (Number.isFinite(parsed) && parsed > 0) {
        batchSize = Math.min(parsed, MAX_BATCH_SIZE)
      }
      continue
    }

    if (arg === '--dry-run') {
      write = false
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  return { write, batchSize }
}

type BackfillTarget = {
  label: string
  countPending: () => Promise<number>
  findPendingIds: (take: number) => Promise<string[]>
  updateByIds: (ids: string[], rootTenantId: string) => Promise<number>
}

function buildTargets(): BackfillTarget[] {
  return [
    {
      label: 'ProfessionalProfile.homeTenantId',
      countPending: () =>
        prisma.professionalProfile.count({ where: { homeTenantId: null } }),
      findPendingIds: async (take) =>
        (
          await prisma.professionalProfile.findMany({
            where: { homeTenantId: null },
            select: { id: true },
            take,
          })
        ).map((row) => row.id),
      updateByIds: async (ids, rootTenantId) =>
        (
          await prisma.professionalProfile.updateMany({
            where: { id: { in: ids }, homeTenantId: null },
            data: { homeTenantId: rootTenantId },
          })
        ).count,
    },
    {
      label: 'ClientProfile.homeTenantId',
      countPending: () =>
        prisma.clientProfile.count({ where: { homeTenantId: null } }),
      findPendingIds: async (take) =>
        (
          await prisma.clientProfile.findMany({
            where: { homeTenantId: null },
            select: { id: true },
            take,
          })
        ).map((row) => row.id),
      updateByIds: async (ids, rootTenantId) =>
        (
          await prisma.clientProfile.updateMany({
            where: { id: { in: ids }, homeTenantId: null },
            data: { homeTenantId: rootTenantId },
          })
        ).count,
    },
    {
      label: 'Booking.proTenantId',
      countPending: () =>
        prisma.booking.count({ where: { proTenantId: null } }),
      findPendingIds: async (take) =>
        (
          await prisma.booking.findMany({
            where: { proTenantId: null },
            select: { id: true },
            take,
          })
        ).map((row) => row.id),
      updateByIds: async (ids, rootTenantId) =>
        (
          await prisma.booking.updateMany({
            where: { id: { in: ids }, proTenantId: null },
            data: { proTenantId: rootTenantId },
          })
        ).count,
    },
    {
      label: 'Booking.clientHomeTenantId',
      countPending: () =>
        prisma.booking.count({ where: { clientHomeTenantId: null } }),
      findPendingIds: async (take) =>
        (
          await prisma.booking.findMany({
            where: { clientHomeTenantId: null },
            select: { id: true },
            take,
          })
        ).map((row) => row.id),
      updateByIds: async (ids, rootTenantId) =>
        (
          await prisma.booking.updateMany({
            where: { id: { in: ids }, clientHomeTenantId: null },
            data: { clientHomeTenantId: rootTenantId },
          })
        ).count,
    },
    {
      label: 'NfcCard.tenantId',
      countPending: () => prisma.nfcCard.count({ where: { tenantId: null } }),
      findPendingIds: async (take) =>
        (
          await prisma.nfcCard.findMany({
            where: { tenantId: null },
            select: { id: true },
            take,
          })
        ).map((row) => row.id),
      updateByIds: async (ids, rootTenantId) =>
        (
          await prisma.nfcCard.updateMany({
            where: { id: { in: ids }, tenantId: null },
            data: { tenantId: rootTenantId },
          })
        ).count,
    },
  ]
}

async function backfillTarget(
  target: BackfillTarget,
  options: CliOptions,
  rootTenantId: string | null,
): Promise<TargetStats> {
  const pending = await target.countPending()

  if (!options.write || pending === 0 || rootTenantId === null) {
    return { label: target.label, pending, updated: 0 }
  }

  let updated = 0

  for (;;) {
    const ids = await target.findPendingIds(options.batchSize)
    if (ids.length === 0) break

    updated += await target.updateByIds(ids, rootTenantId)
  }

  return { label: target.label, pending, updated }
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2))

  console.log(
    `tenant-foundation backfill — mode: ${options.write ? 'WRITE' : 'DRY RUN'}, batch size: ${options.batchSize}`,
  )

  const existingRoot = await prisma.tenant.findUnique({
    where: { slug: TOVIS_ROOT_TENANT_SLUG },
    select: { id: true },
  })

  let rootTenantId: string | null = existingRoot?.id ?? null

  if (options.write && rootTenantId === null) {
    const created = await prisma.tenant.create({
      data: {
        slug: TOVIS_ROOT_TENANT_SLUG,
        name: TOVIS_ROOT_TENANT_NAME,
        isActive: true,
      },
      select: { id: true },
    })
    rootTenantId = created.id
    console.log(`created root tenant '${TOVIS_ROOT_TENANT_SLUG}' (${rootTenantId})`)
  } else {
    console.log(
      rootTenantId
        ? `root tenant '${TOVIS_ROOT_TENANT_SLUG}' exists (${rootTenantId})`
        : `root tenant '${TOVIS_ROOT_TENANT_SLUG}' MISSING — would be created on --write`,
    )
  }

  const stats: TargetStats[] = []
  for (const target of buildTargets()) {
    stats.push(await backfillTarget(target, options, rootTenantId))
  }

  let remainingTotal = 0
  for (const stat of stats) {
    const remaining = options.write ? stat.pending - stat.updated : stat.pending
    remainingTotal += remaining
    console.log(
      `${stat.label}: pending=${stat.pending} updated=${stat.updated} remaining=${remaining}`,
    )
  }

  if (options.write && remainingTotal !== 0) {
    throw new Error(
      `tenant-foundation backfill finished with ${remainingTotal} rows still NULL — investigate before the contract migration`,
    )
  }

  console.log(
    options.write
      ? 'tenant-foundation backfill complete: all tenant columns populated'
      : 'dry run complete: re-run with --write to apply',
  )
}

main()
  .catch((error) => {
    console.error(
      'tenant-foundation backfill failed:',
      error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error',
    )
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
