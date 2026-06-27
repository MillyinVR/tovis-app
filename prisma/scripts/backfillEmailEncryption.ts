// prisma/scripts/backfillEmailEncryption.ts
//
// Expand-phase backfill for the encrypted-at-rest email envelope
// (User.emailEncrypted, ClientProfile.emailEncrypted). Run once after the
// migration that adds the columns AND after EMAIL_KEY_VERSION is present in
// PII_AEAD_KEYS_JSON. Safe to re-run: a row is eligible only when it has a
// non-blank plaintext email but no valid envelope yet, so completed rows are
// skipped.
//
// Usage:
//   pnpm backfill:email-encryption -- --dry-run                 # report only (default)
//   pnpm backfill:email-encryption -- --write                  # apply
//   pnpm backfill:email-encryption -- --write --target=user
//   pnpm backfill:email-encryption -- --write --batch-size=200
//
// Mirrors prisma/scripts/backfillContactHashV2.ts (cursor pagination, never
// holds the full table in memory).

import { Prisma, PrismaClient } from '@prisma/client'

import {
  buildEmailEnvelope,
  isEncryptedEmailEnvelopeV1,
} from '@/lib/security/emailEncryption'
import { toPrismaJson } from '@/lib/typed/prismaJson'

const prisma = new PrismaClient()

const DEFAULT_BATCH_SIZE = 100
const MAX_BATCH_SIZE = 500

type BackfillTarget = 'user' | 'clientProfile' | 'all'

type CliOptions = {
  dryRun: boolean
  batchSize: number
  target: BackfillTarget
}

type BackfillStats = {
  scanned: number
  eligible: number
  updated: number
  skipped: number
  failed: number
}

type SafeError = { name: string; message: string }

const EMAIL_SELECT = {
  id: true,
  email: true,
  emailEncrypted: true,
} satisfies Prisma.UserSelect & Prisma.ClientProfileSelect

type EmailRow = {
  id: string
  email: string | null
  emailEncrypted: Prisma.JsonValue
}

function parseOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: true,
    batchSize: DEFAULT_BATCH_SIZE,
    target: 'all',
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
    } else if (arg.startsWith('--target=')) {
      const raw = arg.slice('--target='.length)
      if (raw === 'user' || raw === 'clientProfile' || raw === 'all') {
        options.target = raw
      }
    }
  }

  return options
}

function safeError(error: unknown): SafeError {
  if (error instanceof Error) return { name: error.name, message: error.message }
  return { name: 'UnknownError', message: 'Unknown error' }
}

function emptyStats(): BackfillStats {
  return { scanned: 0, eligible: 0, updated: 0, skipped: 0, failed: 0 }
}

function addStats(a: BackfillStats, b: BackfillStats): BackfillStats {
  return {
    scanned: a.scanned + b.scanned,
    eligible: a.eligible + b.eligible,
    updated: a.updated + b.updated,
    skipped: a.skipped + b.skipped,
    failed: a.failed + b.failed,
  }
}

// Eligible: has a non-blank plaintext email but no valid envelope yet.
function needsEnvelope(row: EmailRow): boolean {
  if (!row.email || row.email.trim().length === 0) return false
  return !isEncryptedEmailEnvelopeV1(row.emailEncrypted)
}

async function backfillTable(
  label: Exclude<BackfillTarget, 'all'>,
  options: CliOptions,
): Promise<BackfillStats> {
  const stats = emptyStats()
  let cursor: string | undefined

  for (;;) {
    const rows: EmailRow[] =
      label === 'user'
        ? await prisma.user.findMany({
            orderBy: { id: 'asc' },
            take: options.batchSize,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            select: EMAIL_SELECT,
          })
        : await prisma.clientProfile.findMany({
            orderBy: { id: 'asc' },
            take: options.batchSize,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            select: EMAIL_SELECT,
          })

    if (rows.length === 0) break

    for (const row of rows) {
      stats.scanned += 1

      if (!needsEnvelope(row)) {
        stats.skipped += 1
        continue
      }

      stats.eligible += 1

      if (options.dryRun) {
        console.log('backfillEmailEncryption dry-run eligible row', {
          target: label,
          id: row.id,
        })
        continue
      }

      try {
        const envelope = buildEmailEnvelope(row.email)
        if (!envelope) {
          stats.skipped += 1
          continue
        }

        const data = { emailEncrypted: toPrismaJson(envelope) }

        if (label === 'user') {
          await prisma.user.update({
            where: { id: row.id },
            data,
            select: { id: true },
          })
        } else {
          await prisma.clientProfile.update({
            where: { id: row.id },
            data,
            select: { id: true },
          })
        }

        stats.updated += 1
      } catch (error) {
        stats.failed += 1
        console.error('email encryption backfill failed', {
          target: label,
          id: row.id,
          error: safeError(error),
        })
      }
    }

    cursor = rows.at(-1)?.id
    if (!cursor) break
  }

  console.log(`${label} email encryption backfill complete`, stats)
  return stats
}

async function main() {
  const options = parseOptions(process.argv.slice(2))

  console.log('backfillEmailEncryption starting', options)

  let total = emptyStats()

  if (options.target === 'user' || options.target === 'all') {
    total = addStats(total, await backfillTable('user', options))
  }

  if (options.target === 'clientProfile' || options.target === 'all') {
    total = addStats(total, await backfillTable('clientProfile', options))
  }

  console.log('backfillEmailEncryption complete', { dryRun: options.dryRun, total })

  if (total.failed > 0) process.exitCode = 1
}

main()
  .catch((error: unknown) => {
    console.error('backfillEmailEncryption fatal error', {
      error: safeError(error),
    })
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
