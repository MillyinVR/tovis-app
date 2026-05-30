// prisma/scripts/backfillContactHashV2.ts

import { Prisma, PrismaClient } from '@prisma/client'

import {
  buildClientProfileContactLookupData,
  buildUserContactLookupData,
} from '@/lib/security/contactLookup'

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

type SafeError = {
  name: string
  message: string
}

type ContactHashV2State = {
  emailHashV2: string | null
  emailHashKeyVersion: number | null
  phoneHashV2: string | null
  phoneHashKeyVersion: number | null
}

type ContactHashV2Patch = {
  emailHashV2?: string | null
  emailHashKeyVersion?: number | null
  phoneHashV2?: string | null
  phoneHashKeyVersion?: number | null
}

const USER_CONTACT_SELECT = {
  id: true,
  email: true,
  phone: true,
  emailHashV2: true,
  emailHashKeyVersion: true,
  phoneHashV2: true,
  phoneHashKeyVersion: true,
} satisfies Prisma.UserSelect

type UserContactRow = Prisma.UserGetPayload<{
  select: typeof USER_CONTACT_SELECT
}>

const CLIENT_PROFILE_CONTACT_SELECT = {
  id: true,
  email: true,
  phone: true,
  emailHashV2: true,
  emailHashKeyVersion: true,
  phoneHashV2: true,
  phoneHashKeyVersion: true,
} satisfies Prisma.ClientProfileSelect

type ClientProfileContactRow = Prisma.ClientProfileGetPayload<{
  select: typeof CLIENT_PROFILE_CONTACT_SELECT
}>

function parseOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: true,
    batchSize: DEFAULT_BATCH_SIZE,
    target: 'all',
  }

  for (const arg of argv) {
    if (arg === '--write') {
      options.dryRun = false
      continue
    }

    if (arg === '--dry-run') {
      options.dryRun = true
      continue
    }

    if (arg.startsWith('--batch-size=')) {
      const raw = arg.slice('--batch-size='.length)
      const parsed = Number.parseInt(raw, 10)

      if (Number.isFinite(parsed)) {
        options.batchSize = Math.max(1, Math.min(MAX_BATCH_SIZE, parsed))
      }

      continue
    }

    if (arg.startsWith('--target=')) {
      const rawTarget = arg.slice('--target='.length)

      if (
        rawTarget === 'user' ||
        rawTarget === 'clientProfile' ||
        rawTarget === 'all'
      ) {
        options.target = rawTarget
      }

      continue
    }
  }

  return options
}

function safeError(error: unknown): SafeError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    }
  }

  return {
    name: 'UnknownError',
    message: 'Unknown error',
  }
}

function emptyStats(): BackfillStats {
  return {
    scanned: 0,
    eligible: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
  }
}

function addStats(left: BackfillStats, right: BackfillStats): BackfillStats {
  return {
    scanned: left.scanned + right.scanned,
    eligible: left.eligible + right.eligible,
    updated: left.updated + right.updated,
    skipped: left.skipped + right.skipped,
    failed: left.failed + right.failed,
  }
}

function desiredUserContactHashV2(row: UserContactRow): ContactHashV2State {
  const lookupData = buildUserContactLookupData({
    email: row.email,
    phone: row.phone,
  })

  return {
    emailHashV2: lookupData.emailHashV2 ?? null,
    emailHashKeyVersion: lookupData.emailHashKeyVersion ?? null,
    phoneHashV2: lookupData.phoneHashV2 ?? null,
    phoneHashKeyVersion: lookupData.phoneHashKeyVersion ?? null,
  }
}

function desiredClientProfileContactHashV2(
  row: ClientProfileContactRow,
): ContactHashV2State {
  const lookupData = buildClientProfileContactLookupData({
    email: row.email,
    phone: row.phone,
  })

  return {
    emailHashV2: lookupData.emailHashV2 ?? null,
    emailHashKeyVersion: lookupData.emailHashKeyVersion ?? null,
    phoneHashV2: lookupData.phoneHashV2 ?? null,
    phoneHashKeyVersion: lookupData.phoneHashKeyVersion ?? null,
  }
}

function currentContactHashV2(
  row: UserContactRow | ClientProfileContactRow,
): ContactHashV2State {
  return {
    emailHashV2: row.emailHashV2,
    emailHashKeyVersion: row.emailHashKeyVersion,
    phoneHashV2: row.phoneHashV2,
    phoneHashKeyVersion: row.phoneHashKeyVersion,
  }
}

function buildPatch(args: {
  current: ContactHashV2State
  desired: ContactHashV2State
}): ContactHashV2Patch | null {
  const patch: ContactHashV2Patch = {}

  if (args.current.emailHashV2 !== args.desired.emailHashV2) {
    patch.emailHashV2 = args.desired.emailHashV2
  }

  if (args.current.emailHashKeyVersion !== args.desired.emailHashKeyVersion) {
    patch.emailHashKeyVersion = args.desired.emailHashKeyVersion
  }

  if (args.current.phoneHashV2 !== args.desired.phoneHashV2) {
    patch.phoneHashV2 = args.desired.phoneHashV2
  }

  if (args.current.phoneHashKeyVersion !== args.desired.phoneHashKeyVersion) {
    patch.phoneHashKeyVersion = args.desired.phoneHashKeyVersion
  }

  return hasPatch(patch) ? patch : null
}

function hasPatch(patch: ContactHashV2Patch): boolean {
  return (
    'emailHashV2' in patch ||
    'emailHashKeyVersion' in patch ||
    'phoneHashV2' in patch ||
    'phoneHashKeyVersion' in patch
  )
}

function getPatchedFields(patch: ContactHashV2Patch): {
  email: boolean
  phone: boolean
} {
  return {
    email: 'emailHashV2' in patch || 'emailHashKeyVersion' in patch,
    phone: 'phoneHashV2' in patch || 'phoneHashKeyVersion' in patch,
  }
}

function logDryRunRow(args: {
  target: Exclude<BackfillTarget, 'all'>
  id: string
  fields: {
    email: boolean
    phone: boolean
  }
}) {
  console.log('backfillContactHashV2 dry-run eligible row', args)
}

async function backfillUsers(options: CliOptions): Promise<BackfillStats> {
  const stats = emptyStats()
  let cursor: string | undefined

  for (;;) {
    const rows = await prisma.user.findMany({
      orderBy: { id: 'asc' },
      take: options.batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: USER_CONTACT_SELECT,
    })

    if (rows.length === 0) break

    for (const row of rows) {
      stats.scanned += 1

      try {
        const patch = buildPatch({
          current: currentContactHashV2(row),
          desired: desiredUserContactHashV2(row),
        })

        if (!patch) {
          stats.skipped += 1
          continue
        }

        stats.eligible += 1

        if (options.dryRun) {
          logDryRunRow({
            target: 'user',
            id: row.id,
            fields: getPatchedFields(patch),
          })
          continue
        }

        await prisma.user.update({
          where: { id: row.id },
          data: patch,
          select: { id: true },
        })

        stats.updated += 1
      } catch (error) {
        stats.failed += 1
        console.error('user contact hash v2 backfill failed', {
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
      orderBy: { id: 'asc' },
      take: options.batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: CLIENT_PROFILE_CONTACT_SELECT,
    })

    if (rows.length === 0) break

    for (const row of rows) {
      stats.scanned += 1

      try {
        const patch = buildPatch({
          current: currentContactHashV2(row),
          desired: desiredClientProfileContactHashV2(row),
        })

        if (!patch) {
          stats.skipped += 1
          continue
        }

        stats.eligible += 1

        if (options.dryRun) {
          logDryRunRow({
            target: 'clientProfile',
            id: row.id,
            fields: getPatchedFields(patch),
          })
          continue
        }

        await prisma.clientProfile.update({
          where: { id: row.id },
          data: patch,
          select: { id: true },
        })

        stats.updated += 1
      } catch (error) {
        stats.failed += 1
        console.error('clientProfile contact hash v2 backfill failed', {
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

async function runTarget(
  label: Exclude<BackfillTarget, 'all'>,
  runner: (options: CliOptions) => Promise<BackfillStats>,
  options: CliOptions,
): Promise<BackfillStats> {
  const stats = await runner(options)
  console.log(`${label} contact hash v2 backfill complete`, stats)
  return stats
}

async function main() {
  const options = parseOptions(process.argv.slice(2))

  console.log('backfillContactHashV2 starting', {
    dryRun: options.dryRun,
    batchSize: options.batchSize,
    target: options.target,
  })

  let total = emptyStats()

  if (options.target === 'user' || options.target === 'all') {
    total = addStats(total, await runTarget('user', backfillUsers, options))
  }

  if (options.target === 'clientProfile' || options.target === 'all') {
    total = addStats(
      total,
      await runTarget('clientProfile', backfillClientProfiles, options),
    )
  }

  console.log('backfillContactHashV2 complete', {
    dryRun: options.dryRun,
    total,
  })

  if (total.failed > 0) {
    process.exitCode = 1
  }
}

main()
  .catch((error: unknown) => {
    console.error('backfillContactHashV2 fatal error', {
      error: safeError(error),
    })
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })