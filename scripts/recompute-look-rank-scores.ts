// scripts/recompute-look-rank-scores.ts
//
// One-shot cutover sweep for the rate-based rank scoring (personalization-algo
// foundation, spec §4.1). Persisted rankScores written by the old count-based
// formula live on a different scale (hundreds–thousands) than rate-based
// scores (typically < 200); the RANKED feed compares them directly, so stale
// scores dominate until each look happens to be recomputed by an engagement or
// view event. Run this once after deploying the rate-based scoring so the
// whole corpus cuts over at once. Idempotent; safe to re-run any time.
//
// Usage:
//   pnpm recompute:look-rank                 # recompute all published looks
//   pnpm recompute:look-rank --dry-run       # report score drift only
//   pnpm recompute:look-rank --batch-size 50 # tune chunk size
//
// Paginates by look id cursor so it never holds the full corpus in memory.

import { LookPostStatus, ModerationStatus, Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import {
  computeLookPostRankScore,
  recomputeLookPostScores,
} from '@/lib/looks/counters'

const sweepSelect = Prisma.validator<Prisma.LookPostSelect>()({
  id: true,
  status: true,
  moderationStatus: true,
  publishedAt: true,
  likeCount: true,
  commentCount: true,
  saveCount: true,
  shareCount: true,
  viewCount: true,
  rankScore: true,
})

type SweepRow = Prisma.LookPostGetPayload<{ select: typeof sweepSelect }>

interface CliArgs {
  dryRun: boolean
  batchSize: number
}

const DEFAULT_BATCH_SIZE = 100
const MAX_BATCH_SIZE = 500

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
  const now = new Date()

  let cursor: string | null = null
  let scanned = 0
  let changed = 0

  for (;;) {
    const batch: SweepRow[] = await prisma.lookPost.findMany({
      where: {
        status: LookPostStatus.PUBLISHED,
        moderationStatus: ModerationStatus.APPROVED,
      },
      orderBy: { id: 'asc' },
      take: args.batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: sweepSelect,
    })

    const last = batch.at(-1)
    if (!last) break
    cursor = last.id

    for (const look of batch) {
      scanned += 1
      const next = computeLookPostRankScore(look, { now })
      if (next === look.rankScore) continue

      changed += 1
      if (args.dryRun) {
        console.log(
          `[dry-run] ${look.id}: rankScore ${look.rankScore} → ${next}`,
        )
        continue
      }

      await recomputeLookPostScores(prisma, look.id, { now })
    }

    console.log(`…scanned ${scanned} (drifted so far: ${changed})`)
  }

  console.log(
    `${args.dryRun ? '[dry-run] ' : ''}done: ${scanned} published looks scanned, ${changed} rankScores ${args.dryRun ? 'would change' : 'recomputed'}.`,
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
