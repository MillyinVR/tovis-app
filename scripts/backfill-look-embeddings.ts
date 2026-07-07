// scripts/backfill-look-embeddings.ts
//
// Catch-up sweep for the §6.0 visual-embedding pipeline. New looks embed at
// publish via the EMBED_LOOK_POST_IMAGE job, but everything published before
// the pipeline existed (or while VOYAGE_API_KEY was unset, or under an older
// embedding model) has no/stale vector. Run this after provisioning the key —
// and again after any provider-model change — to bring the corpus up to date.
// Idempotent: up-to-date looks are skipped by the shared processor, so
// re-running is always safe.
//
// Usage (against prod, layer envs like recompute:look-rank — see
// HANDOFF-personalization-algorithm):
//   pnpm backfill:look-embeddings              # embed everything missing/stale
//   pnpm backfill:look-embeddings --dry-run    # report what would embed
//   pnpm backfill:look-embeddings --batch-size 25
//
// Paginates by look id cursor so it never holds the corpus in memory.

import { LookPostStatus, ModerationStatus } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import {
  processEmbedLookPostImage,
  type EmbedLookPostImageStatus,
} from '@/lib/jobs/looksSocial/embedLookPostImage'
import { readLookEmbeddingConfig } from '@/lib/personalization/lookEmbedding'

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
  const now = new Date()

  if (!readLookEmbeddingConfig()) {
    throw new Error(
      'VOYAGE_API_KEY is not set — the backfill would skip every look. ' +
        'Provision the key (see lib/personalization/lookEmbedding.ts) first.',
    )
  }

  let cursor: string | null = null
  let scanned = 0
  const statusCounts = new Map<EmbedLookPostImageStatus, number>()

  for (;;) {
    const batch: Array<{ id: string }> = await prisma.lookPost.findMany({
      where: {
        status: LookPostStatus.PUBLISHED,
        moderationStatus: ModerationStatus.APPROVED,
      },
      orderBy: { id: 'asc' },
      take: args.batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true },
    })

    const last = batch.at(-1)
    if (!last) break
    cursor = last.id

    for (const look of batch) {
      scanned += 1
      const result = await processEmbedLookPostImage(prisma, {
        lookPostId: look.id,
        now,
        dryRun: args.dryRun,
      })
      statusCounts.set(
        result.status,
        (statusCounts.get(result.status) ?? 0) + 1,
      )

      if (result.status === 'EMBEDDED' || result.status === 'WOULD_EMBED') {
        console.log(`${result.status.toLowerCase()}: ${look.id}`)
      }
    }

    console.log(`…scanned ${scanned}`)
  }

  const summary = [...statusCounts.entries()]
    .map(([status, count]) => `${status}=${count}`)
    .join(' ')
  console.log(
    `${args.dryRun ? '[dry-run] ' : ''}done: ${scanned} published looks scanned. ${summary || 'nothing to do.'}`,
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
