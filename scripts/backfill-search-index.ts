// scripts/backfill-search-index.ts
//
// One-shot backfill for `ProfessionalSearchIndex` (P2.4a foundation).
// Run once after the migration that creates the table; safe to re-run
// any time (the helper uses ON CONFLICT upserts).
//
// Usage:
//   pnpm backfill:search-index                              # all pros
//   pnpm backfill:search-index --dry-run                    # report only
//   pnpm backfill:search-index --professional-id <id>       # one pro
//   pnpm backfill:search-index --batch-size 50              # tune chunk size
//
// The script paginates by professional cursor (id) so it never holds the
// full pro list in memory and is safe against tables of any size.

import { prisma } from '@/lib/prisma'
import { refreshProfessional } from '@/lib/search/index/refreshSearchIndex'

interface CliArgs {
  dryRun: boolean
  professionalId: string | null
  batchSize: number
}

const DEFAULT_BATCH_SIZE = 100
const MAX_BATCH_SIZE = 500

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    dryRun: false,
    professionalId: null,
    batchSize: DEFAULT_BATCH_SIZE,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--dry-run') {
      args.dryRun = true
    } else if (arg === '--professional-id') {
      const next = argv[i + 1]
      if (!next) {
        throw new Error('--professional-id requires a value')
      }
      args.professionalId = next
      i += 1
    } else if (arg === '--batch-size') {
      const next = argv[i + 1]
      if (!next) {
        throw new Error('--batch-size requires a value')
      }
      const parsed = Number.parseInt(next, 10)
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_BATCH_SIZE) {
        throw new Error(
          `--batch-size must be a positive integer ≤ ${MAX_BATCH_SIZE}`,
        )
      }
      args.batchSize = parsed
      i += 1
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return args
}

async function refreshSinglePro(
  professionalId: string,
  dryRun: boolean,
): Promise<void> {
  if (dryRun) {
    const locationCount = await prisma.professionalLocation.count({
      where: {
        professionalId,
        isBookable: true,
        lat: { not: null },
        lng: { not: null },
      },
    })
    console.log(
      `[dry-run] pro=${professionalId} would refresh ${locationCount} location(s)`,
    )
    return
  }
  await refreshProfessional(professionalId, 'backfill')
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required')
  }

  console.log('search-index backfill starting', {
    dryRun: args.dryRun,
    professionalId: args.professionalId,
    batchSize: args.batchSize,
  })

  if (args.professionalId) {
    await refreshSinglePro(args.professionalId, args.dryRun)
    console.log('search-index backfill complete (single pro)')
    return
  }

  // Cursor-paginate through every pro. We don't filter by verification
  // status here because refreshProfessional itself handles deletion of
  // stale rows for pros that no longer qualify — keeping the script
  // dumb means re-running it always converges.
  let cursor: string | null = null
  let totalProcessed = 0

  for (;;) {
    const batch: { id: string }[] = await prisma.professionalProfile.findMany({
      take: args.batchSize,
      orderBy: { id: 'asc' },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true },
    })

    if (batch.length === 0) break

    for (const pro of batch) {
      await refreshSinglePro(pro.id, args.dryRun)
      totalProcessed += 1
      if (totalProcessed % 100 === 0) {
        console.log(`processed ${totalProcessed} pros…`)
      }
    }

    const lastRow = batch[batch.length - 1]
    if (lastRow === undefined) break

    cursor = lastRow.id
    if (batch.length < args.batchSize) break
  }

  console.log(`search-index backfill complete: ${totalProcessed} pros processed`)
}

main()
  .catch((error) => {
    console.error('search-index backfill failed', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
