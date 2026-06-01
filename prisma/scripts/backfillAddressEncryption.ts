// prisma/scripts/backfillAddressEncryption.ts

import { Prisma, PrismaClient } from '@prisma/client'

import {
  approximateCoordinateDecimalToFloat,
  buildAddressPrivacyWriteData,
  type AddressPrivacyInput,
} from '@/lib/security/addressEncryption'

const prisma = new PrismaClient()

const DEFAULT_BATCH_SIZE = 100
const MAX_BATCH_SIZE = 500

type BackfillTarget =
  | 'booking'
  | 'bookingHold'
  | 'clientAddress'
  | 'professionalLocation'
  | 'all'

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
  addressKeyVersion: string
  postalCodePrefix: string | null
  latApprox: Prisma.Decimal | null
  lngApprox: Prisma.Decimal | null
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
        rawTarget === 'clientAddress' ||
        rawTarget === 'professionalLocation' ||
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
  value: Prisma.JsonValue | null | undefined,
): LegacyAddressSnapshot | null {
  if (!isRecord(value)) return null
  return value
}

function buildLegacyAddressSnapshot(
  input: LegacyAddressSnapshot,
): LegacyAddressSnapshot {
  return {
    formattedAddress: input.formattedAddress,
    addressLine1: input.addressLine1,
    addressLine2: input.addressLine2,
    city: input.city,
    state: input.state,
    postalCode: input.postalCode,
    countryCode: input.countryCode,
    placeId: input.placeId,
    lat: input.lat,
    lng: input.lng,
  }
}

function buildAddressInput(
  args: AddressSnapshotBuildArgs,
): AddressPrivacyInput | null {
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
    addressKeyVersion: privacy.addressKeyVersion,
    postalCodePrefix: privacy.postalCodePrefix,
    latApprox: privacy.latApprox,
    lngApprox: privacy.lngApprox,
  }
}

function decimalToNullableNumber(value: Prisma.Decimal | null): number | null {
  if (value === null) return null

  const numberValue = value.toNumber()
  return Number.isFinite(numberValue) ? numberValue : null
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
  target: Exclude<BackfillTarget, 'all'>
  id: string
  fields: Record<string, boolean>
}) {
  console.log('backfillAddressEncryption dry-run eligible row', args)
}

async function backfillBookingHolds(
  options: CliOptions,
): Promise<BackfillStats> {
  const stats = emptyStats()
  let cursor: string | undefined

  for (;;) {
    const rows = await prisma.bookingHold.findMany({
      where: {
        OR: [
          {
            addressSnapshotsEncryptedAt: null,
            OR: [
              { locationAddressSnapshot: { not: Prisma.JsonNull } },
              { clientAddressSnapshot: { not: Prisma.JsonNull } },
            ],
          },
          {
            locationAddressSnapshot: { not: Prisma.JsonNull },
            encryptedLocationAddressSnapshotJson: { equals: Prisma.DbNull },
          },
          {
            clientAddressSnapshot: { not: Prisma.JsonNull },
            encryptedClientAddressSnapshotJson: { equals: Prisma.DbNull },
          },
          {
            encryptedLocationAddressSnapshotJson: { not: Prisma.JsonNull },
            locationAddressSnapshotKeyVersion: null,
          },
          {
            encryptedClientAddressSnapshotJson: { not: Prisma.JsonNull },
            clientAddressSnapshotKeyVersion: null,
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
        encryptedLocationAddressSnapshotJson: true,
        encryptedClientAddressSnapshotJson: true,
        locationAddressSnapshotKeyVersion: true,
        clientAddressSnapshotKeyVersion: true,
        addressSnapshotsEncryptedAt: true,
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
            fields: {
              locationAddress: locationPatch !== null,
              clientAddress: clientPatch !== null,
            },
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
                  locationAddressSnapshotKeyVersion:
                    locationPatch.addressKeyVersion,
                  locationLatApprox: approximateCoordinateDecimalToFloat(locationPatch.latApprox),
                  locationLngApprox: approximateCoordinateDecimalToFloat(locationPatch.lngApprox),
                }
              : {}),
            ...(clientPatch
              ? {
                  encryptedClientAddressSnapshotJson:
                    clientPatch.encryptedAddressJson,
                  clientAddressSnapshotKeyVersion:
                    clientPatch.addressKeyVersion,
                  clientAddressLatApprox: decimalToNullableNumber(clientPatch.latApprox),
                  clientAddressLngApprox: decimalToNullableNumber(clientPatch.lngApprox),
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
        OR: [
          {
            addressSnapshotsEncryptedAt: null,
            OR: [
              { locationAddressSnapshot: { not: Prisma.JsonNull } },
              { clientAddressSnapshot: { not: Prisma.JsonNull } },
            ],
          },
          {
            locationAddressSnapshot: { not: Prisma.JsonNull },
            encryptedLocationAddressSnapshotJson: { equals: Prisma.DbNull },
          },
          {
            clientAddressSnapshot: { not: Prisma.JsonNull },
            encryptedClientAddressSnapshotJson: { equals: Prisma.DbNull },
          },
          {
            encryptedLocationAddressSnapshotJson: { not: Prisma.JsonNull },
            locationAddressSnapshotKeyVersion: null,
          },
          {
            encryptedClientAddressSnapshotJson: { not: Prisma.JsonNull },
            clientAddressSnapshotKeyVersion: null,
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
        encryptedLocationAddressSnapshotJson: true,
        encryptedClientAddressSnapshotJson: true,
        locationAddressSnapshotKeyVersion: true,
        clientAddressSnapshotKeyVersion: true,
        addressSnapshotsEncryptedAt: true,
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
            fields: {
              locationAddress: locationPatch !== null,
              clientAddress: clientPatch !== null,
            },
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
                  locationAddressSnapshotKeyVersion:
                    locationPatch.addressKeyVersion,
                  locationLatApprox: decimalToNullableNumber(locationPatch.latApprox),
                  locationLngApprox: decimalToNullableNumber(locationPatch.lngApprox),
                }
              : {}),
            ...(clientPatch
              ? {
                  encryptedClientAddressSnapshotJson:
                    clientPatch.encryptedAddressJson,
                  clientAddressSnapshotKeyVersion:
                    clientPatch.addressKeyVersion,
                  clientAddressLatApprox: decimalToNullableNumber(clientPatch.latApprox),
                  clientAddressLngApprox: decimalToNullableNumber(clientPatch.lngApprox),
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

async function backfillClientAddresses(
  options: CliOptions,
): Promise<BackfillStats> {
  const stats = emptyStats()
  let cursor: string | undefined

  for (;;) {
    const rows = await prisma.clientAddress.findMany({
      where: {
        OR: [
          { encryptedAddressJson: { equals: Prisma.DbNull } },
          { addressKeyVersion: null },
          { encryptedAt: null },
          {
            postalCode: { not: null },
            postalCodePrefix: null,
          },
        ],
      },
      orderBy: { id: 'asc' },
      take: options.batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        formattedAddress: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        state: true,
        postalCode: true,
        countryCode: true,
        placeId: true,
        lat: true,
        lng: true,
        encryptedAddressJson: true,
        addressKeyVersion: true,
        postalCodePrefix: true,
        encryptedAt: true,
      },
    })

    if (rows.length === 0) break

    for (const row of rows) {
      stats.scanned += 1

      try {
        const patch = buildPrivacyPatch(
          buildAddressInput({
            snapshot: buildLegacyAddressSnapshot(row),
            latSnapshot: row.lat,
            lngSnapshot: row.lng,
          }),
        )

        if (!patch) {
          stats.skipped += 1
          continue
        }

        stats.eligible += 1

        if (options.dryRun) {
          logDryRunRow({
            target: 'clientAddress',
            id: row.id,
            fields: {
              address: true,
            },
          })
          continue
        }

        const encryptedAt = new Date()

          await prisma.clientAddress.update({
            where: { id: row.id },
            data: {
              encryptedAddressJson: patch.encryptedAddressJson,
              addressKeyVersion: patch.addressKeyVersion,
              postalCodePrefix: patch.postalCodePrefix,
              latApprox: patch.latApprox,
              lngApprox: patch.lngApprox,
              encryptedAt,
            },
            select: { id: true },
          })

        stats.updated += 1
      } catch (error) {
        stats.failed += 1
        console.error('clientAddress address encryption backfill failed', {
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

async function backfillProfessionalLocations(
  options: CliOptions,
): Promise<BackfillStats> {
  const stats = emptyStats()
  let cursor: string | undefined

  for (;;) {
    const rows = await prisma.professionalLocation.findMany({
      where: {
        OR: [
          { encryptedAddressJson: { equals: Prisma.DbNull } },
          { addressKeyVersion: null },
          { encryptedAt: null },
          {
            postalCode: { not: null },
            postalCodePrefix: null,
          },
        ],
      },
      orderBy: { id: 'asc' },
      take: options.batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        formattedAddress: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        state: true,
        postalCode: true,
        countryCode: true,
        placeId: true,
        lat: true,
        lng: true,
        encryptedAddressJson: true,
        addressKeyVersion: true,
        postalCodePrefix: true,
        encryptedAt: true,
      },
    })

    if (rows.length === 0) break

    for (const row of rows) {
      stats.scanned += 1

      try {
        const patch = buildPrivacyPatch(
          buildAddressInput({
            snapshot: buildLegacyAddressSnapshot(row),
            latSnapshot: row.lat,
            lngSnapshot: row.lng,
          }),
        )

        if (!patch) {
          stats.skipped += 1
          continue
        }

        stats.eligible += 1

        if (options.dryRun) {
          logDryRunRow({
            target: 'professionalLocation',
            id: row.id,
            fields: {
              address: true,
            },
          })
          continue
        }

        const encryptedAt = new Date()

      await prisma.professionalLocation.update({
        where: { id: row.id },
        data: {
          encryptedAddressJson: patch.encryptedAddressJson,
          addressKeyVersion: patch.addressKeyVersion,
          postalCodePrefix: patch.postalCodePrefix,
          latApprox: patch.latApprox,
          lngApprox: patch.lngApprox,
          encryptedAt,
        },
        select: { id: true },
      })

        stats.updated += 1
      } catch (error) {
        stats.failed += 1
        console.error(
          'professionalLocation address encryption backfill failed',
          {
            id: row.id,
            error: safeError(error),
          },
        )
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
  console.log(`${label} backfill complete`, stats)
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
    total = addStats(
      total,
      await runTarget('bookingHold', backfillBookingHolds, options),
    )
  }

  if (options.target === 'booking' || options.target === 'all') {
    total = addStats(
      total,
      await runTarget('booking', backfillBookings, options),
    )
  }

  if (options.target === 'clientAddress' || options.target === 'all') {
    total = addStats(
      total,
      await runTarget('clientAddress', backfillClientAddresses, options),
    )
  }

  if (options.target === 'professionalLocation' || options.target === 'all') {
    total = addStats(
      total,
      await runTarget(
        'professionalLocation',
        backfillProfessionalLocations,
        options,
      ),
    )
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