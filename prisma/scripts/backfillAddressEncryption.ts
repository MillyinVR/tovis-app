// prisma/scripts/backfillAddressEncryption.ts

import { Prisma, PrismaClient } from '@prisma/client'

import {
  buildAddressPrivacyWriteData,
  type AddressPrivacyInput,
} from '@/lib/security/addressEncryption'

const prisma = new PrismaClient()

const DEFAULT_BATCH_SIZE = 100
const MAX_BATCH_SIZE = 500

type BackfillTarget = 'booking' | 'bookingHold' | 'all'

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

type LegacyAddressSnapshot = {
  formattedAddress?: unknown
  addressLine1?: unknown
  addressLine2?: unknown
  city?: unknown
  state?: unknown
  postalCode?: unknown
  countryCode?: unknown
  placeId?: unknown
  lat?: unknown
  lng?: unknown
}

type SafeError = {
  name: string
  message: string
}

type AddressSnapshotBuildArgs = {
  snapshot: LegacyAddressSnapshot | null
  latSnapshot: Prisma.Decimal | number | string | null
  lngSnapshot: Prisma.Decimal | number | string | null
}

type AddressPrivacyWritePatch = {
  encryptedAddressJson: Prisma.InputJsonValue
  latApprox: number | null
  lngApprox: number | null
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
        rawTarget === 'booking' ||
        rawTarget === 'bookingHold' ||
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pickString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
}

function toNullableNumber(value: unknown): number | null {
  if (value instanceof Prisma.Decimal) return value.toNumber()

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function parseLegacyAddressSnapshot(
  value: Prisma.JsonValue | null,
): LegacyAddressSnapshot | null {
  if (!isRecord(value)) return null
  return value
}

function buildAddressInput(args: AddressSnapshotBuildArgs): AddressPrivacyInput | null {
  const formattedAddress = pickString(args.snapshot?.formattedAddress)
  const addressLine1 = pickString(args.snapshot?.addressLine1)
  const addressLine2 = pickString(args.snapshot?.addressLine2)
  const city = pickString(args.snapshot?.city)
  const state = pickString(args.snapshot?.state)
  const postalCode = pickString(args.snapshot?.postalCode)
  const countryCode = pickString(args.snapshot?.countryCode)
  const placeId = pickString(args.snapshot?.placeId)

  const lat =
    toNullableNumber(args.latSnapshot) ?? toNullableNumber(args.snapshot?.lat)
  const lng =
    toNullableNumber(args.lngSnapshot) ?? toNullableNumber(args.snapshot?.lng)

  if (
    !formattedAddress &&
    !addressLine1 &&
    !city &&
    !state &&
    !postalCode &&
    !countryCode &&
    !placeId &&
    lat === null &&
    lng === null
  ) {
    return null
  }

  return {
    formattedAddress,
    addressLine1,
    addressLine2,
    city,
    state,
    postalCode,
    countryCode,
    placeId,
    lat,
    lng,
  }
}

function buildPrivacyPatch(
  input: AddressPrivacyInput | null,
): AddressPrivacyWritePatch | null {
  if (!input) return null

  const privacy = buildAddressPrivacyWriteData(input)

  return {
    encryptedAddressJson: privacy.encryptedAddressJson,
    latApprox: toNullableNumber(privacy.latApprox),
    lngApprox: toNullableNumber(privacy.lngApprox),
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

function logDryRunRow(args: {
  target: 'booking' | 'bookingHold'
  id: string
  hasLocationSnapshot: boolean
  hasClientSnapshot: boolean
}) {
  console.log('backfillAddressEncryption dry-run eligible row', args)
}

async function backfillBookingHolds(options: CliOptions): Promise<BackfillStats> {
  const stats = emptyStats()
  let cursor: string | undefined

  for (;;) {
    const rows = await prisma.bookingHold.findMany({
      where: {
        addressSnapshotsEncryptedAt: null,
        OR: [
          {
            locationAddressSnapshot: {
              not: Prisma.JsonNull,
            },
          },
          {
            clientAddressSnapshot: {
              not: Prisma.JsonNull,
            },
          },
        ],
      },
      orderBy: { id: 'asc' },
      take: options.batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        locationAddressSnapshot: true,
        locationLatSnapshot: true,
        locationLngSnapshot: true,
        clientAddressSnapshot: true,
        clientAddressLatSnapshot: true,
        clientAddressLngSnapshot: true,
      },
    })

    if (rows.length === 0) break

    for (const row of rows) {
      stats.scanned += 1

      try {
        const locationPatch = buildPrivacyPatch(
          buildAddressInput({
            snapshot: parseLegacyAddressSnapshot(row.locationAddressSnapshot),
            latSnapshot: row.locationLatSnapshot,
            lngSnapshot: row.locationLngSnapshot,
          }),
        )

        const clientPatch = buildPrivacyPatch(
          buildAddressInput({
            snapshot: parseLegacyAddressSnapshot(row.clientAddressSnapshot),
            latSnapshot: row.clientAddressLatSnapshot,
            lngSnapshot: row.clientAddressLngSnapshot,
          }),
        )

        if (!locationPatch && !clientPatch) {
          stats.skipped += 1
          continue
        }

        stats.eligible += 1

        if (options.dryRun) {
          logDryRunRow({
            target: 'bookingHold',
            id: row.id,
            hasLocationSnapshot: locationPatch !== null,
            hasClientSnapshot: clientPatch !== null,
          })
          continue
        }

        const encryptedAt = new Date()

        await prisma.bookingHold.update({
          where: { id: row.id },
          data: {
            ...(locationPatch
              ? {
                  encryptedLocationAddressSnapshotJson:
                    locationPatch.encryptedAddressJson,
                  locationLatApprox: locationPatch.latApprox,
                  locationLngApprox: locationPatch.lngApprox,
                }
              : {}),
            ...(clientPatch
              ? {
                  encryptedClientAddressSnapshotJson:
                    clientPatch.encryptedAddressJson,
                  clientAddressLatApprox: clientPatch.latApprox,
                  clientAddressLngApprox: clientPatch.lngApprox,
                }
              : {}),
            addressSnapshotsEncryptedAt: encryptedAt,
          },
          select: { id: true },
        })

        stats.updated += 1
      } catch (error) {
        stats.failed += 1
        console.error('bookingHold address encryption backfill failed', {
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

async function backfillBookings(options: CliOptions): Promise<BackfillStats> {
  const stats = emptyStats()
  let cursor: string | undefined

  for (;;) {
    const rows = await prisma.booking.findMany({
      where: {
        addressSnapshotsEncryptedAt: null,
        OR: [
          {
            locationAddressSnapshot: {
              not: Prisma.JsonNull,
            },
          },
          {
            clientAddressSnapshot: {
              not: Prisma.JsonNull,
            },
          },
        ],
      },
      orderBy: { id: 'asc' },
      take: options.batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        locationAddressSnapshot: true,
        locationLatSnapshot: true,
        locationLngSnapshot: true,
        clientAddressSnapshot: true,
        clientAddressLatSnapshot: true,
        clientAddressLngSnapshot: true,
      },
    })

    if (rows.length === 0) break

    for (const row of rows) {
      stats.scanned += 1

      try {
        const locationPatch = buildPrivacyPatch(
          buildAddressInput({
            snapshot: parseLegacyAddressSnapshot(row.locationAddressSnapshot),
            latSnapshot: row.locationLatSnapshot,
            lngSnapshot: row.locationLngSnapshot,
          }),
        )

        const clientPatch = buildPrivacyPatch(
          buildAddressInput({
            snapshot: parseLegacyAddressSnapshot(row.clientAddressSnapshot),
            latSnapshot: row.clientAddressLatSnapshot,
            lngSnapshot: row.clientAddressLngSnapshot,
          }),
        )

        if (!locationPatch && !clientPatch) {
          stats.skipped += 1
          continue
        }

        stats.eligible += 1

        if (options.dryRun) {
          logDryRunRow({
            target: 'booking',
            id: row.id,
            hasLocationSnapshot: locationPatch !== null,
            hasClientSnapshot: clientPatch !== null,
          })
          continue
        }

        const encryptedAt = new Date()

        await prisma.booking.update({
          where: { id: row.id },
          data: {
            ...(locationPatch
              ? {
                  encryptedLocationAddressSnapshotJson:
                    locationPatch.encryptedAddressJson,
                  locationLatApprox: locationPatch.latApprox,
                  locationLngApprox: locationPatch.lngApprox,
                }
              : {}),
            ...(clientPatch
              ? {
                  encryptedClientAddressSnapshotJson:
                    clientPatch.encryptedAddressJson,
                  clientAddressLatApprox: clientPatch.latApprox,
                  clientAddressLngApprox: clientPatch.lngApprox,
                }
              : {}),
            addressSnapshotsEncryptedAt: encryptedAt,
          },
          select: { id: true },
        })

        stats.updated += 1
      } catch (error) {
        stats.failed += 1
        console.error('booking address encryption backfill failed', {
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

  console.log('backfillAddressEncryption starting', {
    dryRun: options.dryRun,
    batchSize: options.batchSize,
    target: options.target,
  })

  let total = emptyStats()

  if (options.target === 'bookingHold' || options.target === 'all') {
    const bookingHoldStats = await backfillBookingHolds(options)
    total = addStats(total, bookingHoldStats)

    console.log('bookingHold backfill complete', bookingHoldStats)
  }

  if (options.target === 'booking' || options.target === 'all') {
    const bookingStats = await backfillBookings(options)
    total = addStats(total, bookingStats)

    console.log('booking backfill complete', bookingStats)
  }

  console.log('backfillAddressEncryption complete', {
    dryRun: options.dryRun,
    total,
  })

  if (total.failed > 0) {
    process.exitCode = 1
  }
}

main()
  .catch((error: unknown) => {
    console.error('backfillAddressEncryption fatal error', {
      error: safeError(error),
    })
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })