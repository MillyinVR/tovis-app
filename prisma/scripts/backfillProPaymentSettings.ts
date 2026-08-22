// prisma/scripts/backfillProPaymentSettings.ts
//
// Give every professional a ProfessionalPaymentSettings row.
//
// 🔴 Why this exists: a pro with NO row accepts no payment method at all —
// buildAcceptedPaymentMethods(null) and listPublicAcceptedMethods(null) both
// return an empty set — so the session wrap-up shows no "Mark as paid" control
// and the booking can never be closed out. Their own Payment settings screen
// meanwhile reads "Currently enabled: 1 · Cash", because the editor falls back
// to the same Prisma defaults this script writes. Registration now creates the
// row (app/api/v1/auth/register/route.ts); this covers pros who signed up
// before that.
//
// The row is created EMPTY, so every column takes its schema default — the
// exact state the editor has always displayed for these pros. Nothing is
// overwritten: a pro who already has a row is skipped, so this is safe to
// re-run.
//
//   pnpm backfill:pro-payment-settings              # dry run (default)
//   pnpm backfill:pro-payment-settings -- --write   # actually write

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const DEFAULT_BATCH_SIZE = 100
const MAX_BATCH_SIZE = 500

type CliOptions = {
  dryRun: boolean
  batchSize: number
}

type BackfillStats = {
  scanned: number
  created: number
  skipped: number
  failed: number
}

type SafeError = {
  name: string
  message: string
}

function safeError(error: unknown): SafeError {
  if (error instanceof Error) {
    return { name: error.name, message: error.message }
  }

  return { name: 'UnknownError', message: String(error) }
}

function parseOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: true,
    batchSize: DEFAULT_BATCH_SIZE,
  }

  for (const arg of argv) {
    if (arg === '--write') {
      options.dryRun = false
    } else if (arg === '--dry-run') {
      options.dryRun = true
    } else if (arg.startsWith('--batch-size=')) {
      const parsed = Number.parseInt(arg.slice('--batch-size='.length), 10)
      if (Number.isFinite(parsed)) {
        options.batchSize = Math.max(1, Math.min(MAX_BATCH_SIZE, parsed))
      }
    }
  }

  return options
}

async function backfill(options: CliOptions): Promise<BackfillStats> {
  const stats: BackfillStats = {
    scanned: 0,
    created: 0,
    skipped: 0,
    failed: 0,
  }

  let cursor: string | undefined

  for (;;) {
    const rows = await prisma.professionalProfile.findMany({
      take: options.batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: {
        id: true,
        paymentSettings: { select: { id: true } },
      },
    })

    if (rows.length === 0) break

    for (const row of rows) {
      stats.scanned += 1

      if (row.paymentSettings) {
        stats.skipped += 1
        continue
      }

      if (options.dryRun) {
        stats.created += 1
        console.log('would create payment settings', {
          professionalId: row.id,
        })
        continue
      }

      try {
        await prisma.professionalPaymentSettings.create({
          // Deliberately empty: every column takes its schema default.
          data: { professionalId: row.id },
          select: { id: true },
        })

        stats.created += 1
      } catch (error) {
        stats.failed += 1
        console.error('payment settings backfill failed', {
          professionalId: row.id,
          error: safeError(error),
        })
      }
    }

    cursor = rows.at(-1)?.id
    if (!cursor) break
  }

  return stats
}

async function main() {
  const options = parseOptions(process.argv.slice(2))
  console.log('backfillProPaymentSettings starting', options)

  const stats = await backfill(options)

  console.log('backfillProPaymentSettings complete', {
    dryRun: options.dryRun,
    stats,
  })

  if (stats.failed > 0) process.exitCode = 1
}

main()
  .catch((error: unknown) => {
    console.error('backfillProPaymentSettings fatal error', {
      error: safeError(error),
    })
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
