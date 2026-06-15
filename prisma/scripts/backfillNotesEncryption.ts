// prisma/scripts/backfillNotesEncryption.ts
//
// Backfill AEAD envelopes for the Tier-3 health-adjacent free-text note fields
// (EXPAND phase). Idempotent + batched + dry-run by default, mirroring
// prisma/scripts/backfillAddressEncryption.ts.
//
// Slice 1 targets:
//   - ClientAllergy        (label, description)
//   - ClientProfessionalNote (title, body)
//
// Usage:
//   tsx prisma/scripts/backfillNotesEncryption.ts                 # dry-run (default)
//   tsx prisma/scripts/backfillNotesEncryption.ts --write         # apply
//   tsx prisma/scripts/backfillNotesEncryption.ts --write --target=clientAllergy
//
// Requires PII_AEAD_KEYS_JSON to contain the notes-aead-v1 key in the runtime env.
// See docs/security/ticket-encrypt-tier3-health-notes.md.

import { Prisma, PrismaClient } from '@prisma/client'

import {
  buildNotesEnvelope,
  isEncryptedNotesEnvelopeV1,
  readNotesEnvelope,
} from '@/lib/security/notesEncryption'
import { toPrismaJson } from '@/lib/typed/prismaJson'

const prisma = new PrismaClient()

const DEFAULT_BATCH_SIZE = 200
const MAX_BATCH_SIZE = 1000

type BackfillTarget = 'clientAllergy' | 'clientProfessionalNote' | 'all'

type CliOptions = {
  dryRun: boolean
  batchSize: number
  target: BackfillTarget
}

type BackfillStats = {
  scanned: number
  updated: number
  skipped: number
  failed: number
  verified: number
}

type SafeError = { name: string; message: string }

function safeError(error: unknown): SafeError {
  if (error instanceof Error) return { name: error.name, message: error.message }
  return { name: 'UnknownError', message: 'Unknown error' }
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
      if (
        raw === 'clientAllergy' ||
        raw === 'clientProfessionalNote' ||
        raw === 'all'
      ) {
        options.target = raw
      }
    }
  }

  return options
}

function emptyStats(): BackfillStats {
  return { scanned: 0, updated: 0, skipped: 0, failed: 0, verified: 0 }
}

function addStats(a: BackfillStats, b: BackfillStats): BackfillStats {
  return {
    scanned: a.scanned + b.scanned,
    updated: a.updated + b.updated,
    skipped: a.skipped + b.skipped,
    failed: a.failed + b.failed,
    verified: a.verified + b.verified,
  }
}

/**
 * Encrypt `value`, then immediately decrypt and assert it round-trips back to
 * the source plaintext. Returns the Prisma Json input (envelope or DbNull) and
 * whether a non-null envelope was produced + verified.
 */
function buildVerifiedField(value: string | null): {
  input: Prisma.InputJsonValue | typeof Prisma.DbNull
  verified: boolean
} {
  const envelope = buildNotesEnvelope(value)
  if (!envelope) {
    return { input: Prisma.DbNull, verified: false }
  }

  // Sample-verify every row (volume is small pre-launch): decrypt back and compare.
  if (!isEncryptedNotesEnvelopeV1(envelope) || readNotesEnvelope(envelope) !== value) {
    throw new Error('notes encryption round-trip verification failed')
  }

  return { input: toPrismaJson(envelope), verified: true }
}

async function backfillClientAllergy(options: CliOptions): Promise<BackfillStats> {
  const stats = emptyStats()
  let cursor: string | undefined

  for (;;) {
    const rows = await prisma.clientAllergy.findMany({
      // Idempotent: only rows whose label envelope is still missing.
      where: { labelEncrypted: { equals: Prisma.DbNull } },
      orderBy: { id: 'asc' },
      take: options.batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, label: true, description: true },
    })

    if (rows.length === 0) break

    for (const row of rows) {
      stats.scanned += 1
      try {
        const label = buildVerifiedField(row.label)
        const description = buildVerifiedField(row.description)

        if (options.dryRun) {
          stats.updated += 1
          if (label.verified) stats.verified += 1
          if (description.verified) stats.verified += 1
          continue
        }

        await prisma.clientAllergy.update({
          where: { id: row.id },
          data: {
            labelEncrypted: label.input,
            descriptionEncrypted: description.input,
          },
          select: { id: true },
        })

        stats.updated += 1
        if (label.verified) stats.verified += 1
        if (description.verified) stats.verified += 1
      } catch (error) {
        stats.failed += 1
        console.error('clientAllergy notes backfill failed', {
          id: row.id,
          error: safeError(error),
        })
      }
    }

    cursor = rows.at(-1)?.id
    if (!cursor) break
  }

  return stats
}

async function backfillClientProfessionalNote(
  options: CliOptions,
): Promise<BackfillStats> {
  const stats = emptyStats()
  let cursor: string | undefined

  for (;;) {
    const rows = await prisma.clientProfessionalNote.findMany({
      // body is required, so its envelope is the canonical "needs backfill" marker.
      where: { bodyEncrypted: { equals: Prisma.DbNull } },
      orderBy: { id: 'asc' },
      take: options.batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, title: true, body: true },
    })

    if (rows.length === 0) break

    for (const row of rows) {
      stats.scanned += 1
      try {
        const title = buildVerifiedField(row.title)
        const body = buildVerifiedField(row.body)

        if (options.dryRun) {
          stats.updated += 1
          if (title.verified) stats.verified += 1
          if (body.verified) stats.verified += 1
          continue
        }

        await prisma.clientProfessionalNote.update({
          where: { id: row.id },
          data: {
            titleEncrypted: title.input,
            bodyEncrypted: body.input,
          },
          select: { id: true },
        })

        stats.updated += 1
        if (title.verified) stats.verified += 1
        if (body.verified) stats.verified += 1
      } catch (error) {
        stats.failed += 1
        console.error('clientProfessionalNote notes backfill failed', {
          id: row.id,
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
  console.log('backfillNotesEncryption starting', options)

  let total = emptyStats()

  if (options.target === 'clientAllergy' || options.target === 'all') {
    const stats = await backfillClientAllergy(options)
    console.log('clientAllergy backfill complete', stats)
    total = addStats(total, stats)
  }

  if (options.target === 'clientProfessionalNote' || options.target === 'all') {
    const stats = await backfillClientProfessionalNote(options)
    console.log('clientProfessionalNote backfill complete', stats)
    total = addStats(total, stats)
  }

  console.log('backfillNotesEncryption complete', {
    dryRun: options.dryRun,
    total,
  })

  if (total.failed > 0) process.exitCode = 1
}

main()
  .catch((error: unknown) => {
    console.error('backfillNotesEncryption fatal error', {
      error: safeError(error),
    })
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
