// prisma/scripts/backfillPhoneEncryption.ts
//
// Backfill AEAD envelopes for the at-rest phone columns (EXPAND phase).
// Idempotent + batched + dry-run by default, mirroring
// prisma/scripts/backfillNotesEncryption.ts.
//
// Targets:
//   - User.phoneEncrypted          (from User.phone)
//   - ClientProfile.phoneEncrypted (from ClientProfile.phone)
//
// Usage:
//   tsx prisma/scripts/backfillPhoneEncryption.ts                 # dry-run (default)
//   tsx prisma/scripts/backfillPhoneEncryption.ts --write         # apply
//   tsx prisma/scripts/backfillPhoneEncryption.ts --write --target=user
//
// Requires PII_AEAD_KEYS_JSON to contain the phone-aead-v1 key in the runtime env.
// See docs/security/ticket-encrypt-phone-at-rest.md.

import { Prisma, PrismaClient } from '@prisma/client'

import {
  buildPhoneEnvelope,
  isEncryptedPhoneEnvelopeV1,
  readPhoneEnvelope,
} from '@/lib/security/phoneEncryption'
import { toPrismaJson } from '@/lib/typed/prismaJson'

const prisma = new PrismaClient()

const DEFAULT_BATCH_SIZE = 200
const MAX_BATCH_SIZE = 1000

type BackfillTarget = 'user' | 'clientProfile' | 'all'

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
      if (raw === 'user' || raw === 'clientProfile' || raw === 'all') {
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
  const envelope = buildPhoneEnvelope(value)
  if (!envelope) {
    return { input: Prisma.DbNull, verified: false }
  }

  // Sample-verify every row (volume is small pre-launch): decrypt back and compare.
  if (!isEncryptedPhoneEnvelopeV1(envelope) || readPhoneEnvelope(envelope) !== value) {
    throw new Error('phone encryption round-trip verification failed')
  }

  return { input: toPrismaJson(envelope), verified: true }
}

async function backfillUsers(options: CliOptions): Promise<BackfillStats> {
  const stats = emptyStats()
  let cursor: string | undefined

  for (;;) {
    const rows = await prisma.user.findMany({
      // Only rows with a plaintext phone whose envelope is still missing.
      where: { phoneEncrypted: { equals: Prisma.DbNull }, phone: { not: null } },
      orderBy: { id: 'asc' },
      take: options.batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, phone: true },
    })

    if (rows.length === 0) break

    for (const row of rows) {
      stats.scanned += 1
      try {
        const phone = buildVerifiedField(row.phone)

        if (options.dryRun) {
          stats.updated += 1
          if (phone.verified) stats.verified += 1
          continue
        }

        await prisma.user.update({
          where: { id: row.id },
          data: { phoneEncrypted: phone.input },
          select: { id: true },
        })

        stats.updated += 1
        if (phone.verified) stats.verified += 1
      } catch (error) {
        stats.failed += 1
        console.error('user phone backfill failed', {
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

async function backfillClientProfiles(
  options: CliOptions,
): Promise<BackfillStats> {
  const stats = emptyStats()
  let cursor: string | undefined

  for (;;) {
    const rows = await prisma.clientProfile.findMany({
      where: { phoneEncrypted: { equals: Prisma.DbNull }, phone: { not: null } },
      orderBy: { id: 'asc' },
      take: options.batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, phone: true },
    })

    if (rows.length === 0) break

    for (const row of rows) {
      stats.scanned += 1
      try {
        const phone = buildVerifiedField(row.phone)

        if (options.dryRun) {
          stats.updated += 1
          if (phone.verified) stats.verified += 1
          continue
        }

        await prisma.clientProfile.update({
          where: { id: row.id },
          data: { phoneEncrypted: phone.input },
          select: { id: true },
        })

        stats.updated += 1
        if (phone.verified) stats.verified += 1
      } catch (error) {
        stats.failed += 1
        console.error('clientProfile phone backfill failed', {
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
  console.log('backfillPhoneEncryption starting', options)

  let total = emptyStats()

  if (options.target === 'user' || options.target === 'all') {
    const stats = await backfillUsers(options)
    console.log('user phone backfill complete', stats)
    total = addStats(total, stats)
  }

  if (options.target === 'clientProfile' || options.target === 'all') {
    const stats = await backfillClientProfiles(options)
    console.log('clientProfile phone backfill complete', stats)
    total = addStats(total, stats)
  }

  console.log('backfillPhoneEncryption complete', {
    dryRun: options.dryRun,
    total,
  })

  if (total.failed > 0) process.exitCode = 1
}

main()
  .catch((error: unknown) => {
    console.error('backfillPhoneEncryption fatal error', {
      error: safeError(error),
    })
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
