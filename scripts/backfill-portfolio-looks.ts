// scripts/backfill-portfolio-looks.ts
//
// §19a — social-first media unification backfill. Featuring a MediaAsset to the
// portfolio never created a LookPost, so featured work never reached the looks
// feed/search/boards. The unified model makes LookPost the single public-content
// atom; this sweep catches up existing data by publishing a pro-authored
// LookPost for every featured, public MediaAsset that doesn't have one yet
// (marking the asset Looks-eligible in the process — see
// lib/looks/publication/backfillPortfolioLook.ts for the per-asset gates).
//
// Idempotent: assets that already have a LookPost are excluded by the query, and
// the per-asset processor re-checks every gate, so re-running is always safe.
//
// Usage (against prod, layer envs like recompute:look-rank — see
// HANDOFF-personalization-algorithm):
//   pnpm backfill:portfolio-looks              # publish looks for featured media
//   pnpm backfill:portfolio-looks --dry-run    # report what would publish
//   pnpm backfill:portfolio-looks --batch-size 25
//
// Paginates by media id cursor so it never holds the corpus in memory.

import { MediaVisibility } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import {
  processBackfillPortfolioLook,
  type BackfillPortfolioLookStatus,
} from '@/lib/looks/publication/backfillPortfolioLook'

interface CliArgs {
  dryRun: boolean
  batchSize: number
}

const DEFAULT_BATCH_SIZE = 50
const MAX_BATCH_SIZE = 200

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    dryRun: false,
    batchSize: DEFAULT_BATCH_SIZE,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--dry-run') {
      args.dryRun = true
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  let cursor: string | null = null
  let scanned = 0
  const statusCounts = new Map<BackfillPortfolioLookStatus, number>()

  for (;;) {
    // Only featured, public media without a LookPost — the processor re-checks
    // each gate, but scoping the scan here keeps the sweep proportional to the
    // remaining backlog rather than the whole media table.
    const batch: Array<{ id: string }> = await prisma.mediaAsset.findMany({
      where: {
        isFeaturedInPortfolio: true,
        visibility: MediaVisibility.PUBLIC,
        lookPostPrimaryFor: { none: {} },
      },
      orderBy: { id: 'asc' },
      take: args.batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true },
    })

    const last = batch.at(-1)
    if (!last) break
    cursor = last.id

    for (const media of batch) {
      scanned += 1
      const result = await processBackfillPortfolioLook(prisma, {
        mediaAssetId: media.id,
        dryRun: args.dryRun,
      })
      statusCounts.set(
        result.status,
        (statusCounts.get(result.status) ?? 0) + 1,
      )

      if (result.status === 'CREATED' || result.status === 'WOULD_CREATE') {
        console.log(`${result.status.toLowerCase()}: ${media.id} (service ${result.serviceId})`)
      } else if (result.status === 'FAILED') {
        console.error(`failed: ${media.id} — ${result.error}`)
      }
    }

    console.log(`…scanned ${scanned}`)
  }

  const summary = [...statusCounts.entries()]
    .map(([status, count]) => `${status}=${count}`)
    .join(' ')
  console.log(
    `${args.dryRun ? '[dry-run] ' : ''}done: ${scanned} featured media scanned. ${summary || 'nothing to do.'}`,
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
