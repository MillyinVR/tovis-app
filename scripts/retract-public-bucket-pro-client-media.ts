// scripts/retract-public-bucket-pro-client-media.ts
//
// Remediation for the 3 production MediaAsset rows that sit in the world-readable
// `media-public` bucket while nothing shows them — the residue of the retract
// paths closed in #1057, which stamped a label without moving the bytes.
//
// It runs the SAME code path the product now uses (`retractMediaAssetToPrivate`),
// deliberately: a hand-written UPDATE here would be a fourth copy of the rule,
// and the whole defect was rules that had drifted apart. If this script is
// correct, the route is correct.
//
//   npx tsx scripts/retract-public-bucket-pro-client-media.ts            # DRY RUN
//   npx tsx scripts/retract-public-bucket-pro-client-media.ts --write    # execute
//
// ⚠️ `--write` DELETES OBJECTS FROM PRODUCTION STORAGE and production has no
// restorable backup. It therefore also requires:
//
//   I_UNDERSTAND_THIS_DELETES_PRODUCTION_OBJECTS=1
//
// The repo's `requireSafeScriptRun({ destructive: true })` is deliberately NOT
// used: it refuses to run against a production-looking host, and production is
// exactly where this has to run. The explicit env gate above replaces it rather
// than quietly bypassing it.
//
// Safety properties:
//   - dry run by default, and prints the DB host + every candidate first;
//   - selects only rows in the public bucket that NOTHING shows — the same
//     `isShownOnPublicSurfaces` predicate the routes use, so review media and
//     featured/Looks-eligible work can never be selected;
//   - each row is copied and VERIFIED before its public original is deleted;
//   - re-runnable: a row already in the private bucket is skipped.

import { loadEnvConfig } from '@next/env'

loadEnvConfig(process.cwd(), true)

import { PrismaClient } from '@prisma/client'

import { isShownOnPublicSurfaces } from '@/lib/media/mediaVisibility'
import { retractMediaAssetToPrivate } from '@/lib/media/retractToPrivateBucket'
import { BUCKETS } from '@/lib/storageBuckets'

const WRITE = process.argv.includes('--write')
const ACK = process.env.I_UNDERSTAND_THIS_DELETES_PRODUCTION_OBJECTS === '1'

function describeHost(): string {
  const raw = process.env.DATABASE_URL
  if (!raw) return '(unset)'
  try {
    return new URL(raw).hostname
  } catch {
    return '(unparseable)'
  }
}

async function main() {
  const prisma = new PrismaClient()

  try {
    console.log(`DB host:  ${describeHost()}`)
    console.log(`Mode:     ${WRITE ? 'WRITE (deletes production objects)' : 'DRY RUN'}`)
    console.log('')

    // Every public-bucket row, narrowed in JS by the shared predicate so this
    // script and the routes cannot disagree about what "shown" means.
    const publicBucketRows = await prisma.mediaAsset.findMany({
      where: { storageBucket: BUCKETS.mediaPublic },
      select: {
        id: true,
        professionalId: true,
        storageBucket: true,
        storagePath: true,
        thumbBucket: true,
        thumbPath: true,
        isFeaturedInPortfolio: true,
        isEligibleForLooks: true,
        reviewId: true,
        visibility: true,
        retractedFromPublicAt: true,
      },
      orderBy: { createdAt: 'asc' },
    })

    const candidates = publicBucketRows.filter(
      (row) => !isShownOnPublicSurfaces(row),
    )

    console.log(
      `${publicBucketRows.length} row(s) in ${BUCKETS.mediaPublic}; ${candidates.length} shown by nothing.`,
    )
    console.log('')

    if (candidates.length === 0) {
      console.log('Nothing to retract.')
      return
    }

    for (const row of candidates) {
      console.log(`  ${row.id}`)
      console.log(`    visibility : ${row.visibility}`)
      console.log(`    bucket     : ${row.storageBucket}`)
      console.log(`    path       : ${row.storagePath}`)
      console.log(`    thumb      : ${row.thumbBucket ?? '(none)'} ${row.thumbPath ?? ''}`)
    }
    console.log('')

    if (!WRITE) {
      console.log('DRY RUN — nothing written. Re-run with --write to retract.')
      return
    }

    if (!ACK) {
      throw new Error(
        'Refusing to write: set I_UNDERSTAND_THIS_DELETES_PRODUCTION_OBJECTS=1 to confirm.',
      )
    }

    let retracted = 0
    const orphans: Array<{ mediaAssetId: string; bucket: string; path: string; reason: string }> = []
    const purgeFailures: Array<{ mediaAssetId: string; bucket: string; path: string; reason: string }> = []

    for (const row of candidates) {
      process.stdout.write(`  retracting ${row.id} … `)

      const outcome = await retractMediaAssetToPrivate(prisma, row)

      if (outcome.status === 'ALREADY_PRIVATE') {
        console.log('already private, skipped')
        continue
      }

      retracted += 1
      console.log(`→ ${outcome.storageBucket}/${outcome.storagePath}`)

      for (const orphan of outcome.orphanedPublicObjects) {
        orphans.push({ mediaAssetId: row.id, ...orphan })
      }

      for (const failure of outcome.cdnPurgeFailures) {
        purgeFailures.push({ mediaAssetId: row.id, ...failure })
      }
    }

    console.log('')
    console.log(`Retracted ${retracted} row(s).`)

    if (orphans.length > 0) {
      console.log('')
      console.log(
        '🔴 The rows are correct, but these PUBLIC objects could NOT be deleted and are STILL world-readable:',
      )
      for (const orphan of orphans) {
        console.log(`  ${orphan.bucket}/${orphan.path} — ${orphan.reason}`)
      }
      process.exitCode = 1
    }

    if (purgeFailures.length > 0) {
      console.log('')
      console.log(
        '🟡 The bytes are gone, but the CDN copy of these objects was not purged.',
      )
      console.log(
        '   The edge invalidates itself within about a minute, so this is a delay,',
      )
      console.log('   not a permanent exposure — but verify before reporting done:')
      for (const failure of purgeFailures) {
        console.log(`  ${failure.bucket}/${failure.path} — ${failure.reason}`)
      }
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
