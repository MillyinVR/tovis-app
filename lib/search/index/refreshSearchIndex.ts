// P2.4a — Refresh helpers for the denormalized ProfessionalSearchIndex.
//
// Single source of truth for writes into ProfessionalSearchIndex. Called
// from mutation routes (locations, working-hours, offerings) right next
// to bumpScheduleConfigVersion. Invocation MUST be best-effort and MUST
// NOT block the underlying mutation — every public function wraps its
// own try/catch and logs failures. A stale row is recoverable on the
// next mutation; a backfill script is the post-launch safety net.
//
// All upserts use raw SQL because the `geom` column is a PostGIS
// `geography(Point, 4326)`, which Prisma models as Unsupported(...).
// Typed `prisma.professionalSearchIndex.create({ data })` would fail at
// runtime: Prisma omits `geom` from the input type and Postgres rejects
// the NOT NULL constraint.
//
// Until P2.4b lands, the routes (`/api/v1/search/pros`, `/api/v1/pros/nearby`)
// still query source tables. Stale or missing rows here have no
// observable production effect. P2.4b makes this table the read source.

import {
  Prisma,
  type ProfessionalLocationType,
  type ProfessionType,
  type VerificationStatus,
} from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { pickProfessionalPublicDisplayName } from '@/lib/privacy/professionalDisplayName'
import { summarizeDiscoveryOfferingsForProfessional } from '@/lib/discovery/nearby'
import { checkProReadinessWithDb } from '@/lib/pro/readiness/proReadiness'

export type RefreshSource =
  | 'location.create'
  | 'location.update'
  | 'location.delete'
  | 'workingHours.update'
  | 'offering.create'
  | 'offering.update'
  | 'offering.delete'
  | 'verification.status'
  | 'schedule.publish'
  | 'backfill'
  | 'manual'

type DbClient = Prisma.TransactionClient | typeof prisma

// Snapshot of the data needed to materialize one ProfessionalSearchIndex
// row. Internal — not exported.
interface IndexRow {
  locationId: string
  professionalId: string
  lat: number
  lng: number
  verificationStatus: VerificationStatus
  professionType: ProfessionType | null
  businessName: string | null
  displayName: string | null
  handle: string | null
  handleNormalized: string | null
  avatarUrl: string | null
  mobileRadiusMiles: number | null
  locationType: ProfessionalLocationType
  isPrimary: boolean
  isBookable: boolean
  city: string | null
  state: string | null
  formattedAddress: string | null
  timeZone: string | null
  workingHours: Prisma.JsonValue
  categoryIds: string[]
  serviceIds: string[]
  offersInSalon: boolean
  offersMobile: boolean
  minSalonPrice: number | null
  minMobilePrice: number | null
  minAnyPrice: number | null
  ratingAvg: number | null
  ratingCount: number
  refreshSource: RefreshSource
}

interface ProRollups {
  categoryIds: string[]
  serviceIds: string[]
  offersInSalon: boolean
  offersMobile: boolean
  minSalonPrice: number | null
  minMobilePrice: number | null
  minAnyPrice: number | null
  ratingAvg: number | null
  ratingCount: number
}

const PRO_FIELDS = {
  id: true,
  verificationStatus: true,
  professionType: true,
  businessName: true,
  firstName: true,
  lastName: true,
  nameDisplay: true,
  handle: true,
  handleNormalized: true,
  avatarUrl: true,
  mobileRadiusMiles: true,
} as const

const LOCATION_FIELDS = {
  id: true,
  professionalId: true,
  type: true,
  isPrimary: true,
  isBookable: true,
  city: true,
  state: true,
  formattedAddress: true,
  timeZone: true,
  lat: true,
  lng: true,
  workingHours: true,
} as const

function toFiniteNumber(value: Prisma.Decimal | number | null | undefined): number | null {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null

  // Prisma.Decimal — convert via toNumber, guard against NaN.
  const n = value.toNumber()
  return Number.isFinite(n) ? n : null
}

function logRefreshError(args: {
  scope: 'refreshLocation' | 'refreshProfessional' | 'deleteLocationFromIndex'
  identifier: string
  source: RefreshSource | null
  error: unknown
}): void {
  console.error('search index refresh error', {
    route: 'lib/search/index/refreshSearchIndex.ts',
    scope: args.scope,
    identifier: args.identifier,
    source: args.source,
    error:
      args.error instanceof Error
        ? { name: args.error.name, message: args.error.message }
        : args.error,
  })
}

async function loadProRollups(
  professionalId: string,
  client: DbClient,
): Promise<ProRollups> {
  const [offerings, ratings] = await Promise.all([
    client.professionalServiceOffering.findMany({
      where: {
        professionalId,
        isActive: true,
        service: { isActive: true },
      },
      select: {
        professionalId: true,
        offersInSalon: true,
        offersMobile: true,
        salonPriceStartingAt: true,
        mobilePriceStartingAt: true,
        service: {
          select: { id: true, categoryId: true },
        },
      },
    }),
    client.review.groupBy({
      by: ['professionalId'],
      where: { professionalId },
      _avg: { rating: true },
      _count: { _all: true },
    }),
  ])

  const summary = summarizeDiscoveryOfferingsForProfessional({
    professionalId,
    offerings: offerings.map((offering) => ({
      professionalId: offering.professionalId,
      offersInSalon: offering.offersInSalon,
      offersMobile: offering.offersMobile,
      salonPriceStartingAt: offering.salonPriceStartingAt,
      mobilePriceStartingAt: offering.mobilePriceStartingAt,
      categoryId: offering.service.categoryId,
    })),
  })

  // serviceIds: distinct, in insertion order, drawn only from active
  // offerings on active services (the same predicate the route uses).
  const serviceIds: string[] = []
  const seenServices = new Set<string>()
  for (const offering of offerings) {
    const id = offering.service.id
    if (!id || seenServices.has(id)) continue
    seenServices.add(id)
    serviceIds.push(id)
  }

  const ratingRow = ratings[0] ?? null
  const ratingAvgRaw = ratingRow?._avg.rating
  const ratingAvg =
    typeof ratingAvgRaw === 'number' && Number.isFinite(ratingAvgRaw)
      ? ratingAvgRaw
      : null

  return {
    categoryIds: summary.categoryIds.slice(),
    serviceIds,
    offersInSalon: summary.supportsSalon,
    offersMobile: summary.supportsMobile,
    minSalonPrice: summary.minSalon,
    minMobilePrice: summary.minMobile,
    minAnyPrice: summary.minAny,
    ratingAvg,
    ratingCount: ratingRow?._count._all ?? 0,
  }
}

async function upsertIndexRow(row: IndexRow, client: DbClient): Promise<void> {
  // Raw SQL upsert. The geography column is computed from lat/lng via
  // ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography — the canonical
  // form. ST_MakePoint takes (X, Y), where X = longitude and Y = latitude.
  await client.$executeRaw`
    INSERT INTO "ProfessionalSearchIndex" (
      "locationId",
      "professionalId",
      "geom",
      "lat",
      "lng",
      "verificationStatus",
      "professionType",
      "businessName",
      "displayName",
      "handle",
      "handleNormalized",
      "avatarUrl",
      "mobileRadiusMiles",
      "locationType",
      "isPrimary",
      "isBookable",
      "city",
      "state",
      "formattedAddress",
      "timeZone",
      "workingHours",
      "categoryIds",
      "serviceIds",
      "offersInSalon",
      "offersMobile",
      "minSalonPrice",
      "minMobilePrice",
      "minAnyPrice",
      "ratingAvg",
      "ratingCount",
      "refreshedAt",
      "refreshSource"
    )
    VALUES (
      ${row.locationId},
      ${row.professionalId},
      ST_SetSRID(ST_MakePoint(${row.lng}::double precision, ${row.lat}::double precision), 4326)::geography,
      ${row.lat}::decimal(10, 7),
      ${row.lng}::decimal(10, 7),
      ${row.verificationStatus}::"VerificationStatus",
      ${row.professionType}::"ProfessionType",
      ${row.businessName},
      ${row.displayName},
      ${row.handle},
      ${row.handleNormalized},
      ${row.avatarUrl},
      ${row.mobileRadiusMiles},
      ${row.locationType}::"ProfessionalLocationType",
      ${row.isPrimary},
      ${row.isBookable},
      ${row.city},
      ${row.state},
      ${row.formattedAddress},
      ${row.timeZone},
      ${JSON.stringify(row.workingHours)}::jsonb,
      ${row.categoryIds}::text[],
      ${row.serviceIds}::text[],
      ${row.offersInSalon},
      ${row.offersMobile},
      ${row.minSalonPrice},
      ${row.minMobilePrice},
      ${row.minAnyPrice},
      ${row.ratingAvg},
      ${row.ratingCount},
      CURRENT_TIMESTAMP,
      ${row.refreshSource}
    )
    ON CONFLICT ("locationId") DO UPDATE SET
      "professionalId"     = EXCLUDED."professionalId",
      "geom"               = EXCLUDED."geom",
      "lat"                = EXCLUDED."lat",
      "lng"                = EXCLUDED."lng",
      "verificationStatus" = EXCLUDED."verificationStatus",
      "professionType"     = EXCLUDED."professionType",
      "businessName"       = EXCLUDED."businessName",
      "displayName"        = EXCLUDED."displayName",
      "handle"             = EXCLUDED."handle",
      "handleNormalized"   = EXCLUDED."handleNormalized",
      "avatarUrl"          = EXCLUDED."avatarUrl",
      "mobileRadiusMiles"  = EXCLUDED."mobileRadiusMiles",
      "locationType"       = EXCLUDED."locationType",
      "isPrimary"          = EXCLUDED."isPrimary",
      "isBookable"         = EXCLUDED."isBookable",
      "city"               = EXCLUDED."city",
      "state"              = EXCLUDED."state",
      "formattedAddress"   = EXCLUDED."formattedAddress",
      "timeZone"           = EXCLUDED."timeZone",
      "workingHours"       = EXCLUDED."workingHours",
      "categoryIds"        = EXCLUDED."categoryIds",
      "serviceIds"         = EXCLUDED."serviceIds",
      "offersInSalon"      = EXCLUDED."offersInSalon",
      "offersMobile"       = EXCLUDED."offersMobile",
      "minSalonPrice"      = EXCLUDED."minSalonPrice",
      "minMobilePrice"     = EXCLUDED."minMobilePrice",
      "minAnyPrice"        = EXCLUDED."minAnyPrice",
      "ratingAvg"          = EXCLUDED."ratingAvg",
      "ratingCount"        = EXCLUDED."ratingCount",
      "refreshedAt"        = CURRENT_TIMESTAMP,
      "refreshSource"      = EXCLUDED."refreshSource"
  `
}

/**
 * Refresh the index row for a single location. If the location is missing,
 * not bookable, or has null lat/lng, the row is deleted instead — these are
 * the same predicates that gate visibility in `searchPros` / `loadNearbyPros`.
 *
 * Best-effort: errors are logged and swallowed. The caller's mutation must
 * not be reverted on a refresh failure.
 */
export async function refreshLocation(
  locationId: string,
  source: RefreshSource,
  client: DbClient = prisma,
): Promise<void> {
  try {
    const location = await client.professionalLocation.findUnique({
      where: { id: locationId },
      select: {
        ...LOCATION_FIELDS,
        professional: { select: PRO_FIELDS },
      },
    })

    if (!location) {
      // Location was hard-deleted between the mutation and this refresh.
      // Cascade FK already removed the index row; deleteMany is a no-op.
      await client.professionalSearchIndex.deleteMany({ where: { locationId } })
      return
    }

    const lat = toFiniteNumber(location.lat)
    const lng = toFiniteNumber(location.lng)

    if (!location.isBookable || lat == null || lng == null) {
      await client.professionalSearchIndex.deleteMany({ where: { locationId } })
      return
    }

    const readiness = await checkProReadinessWithDb({
      db: client,
      professionalId: location.professional.id,
    })

    if (!readiness.ok || !readiness.readyLocationIds.includes(location.id)) {
      await client.professionalSearchIndex.deleteMany({ where: { locationId } })
      return
    }

    const rollups = await loadProRollups(location.professional.id, client)

    await upsertIndexRow(
      {
        locationId: location.id,
        professionalId: location.professional.id,
        lat,
        lng,
        verificationStatus: location.professional.verificationStatus,
        professionType: location.professional.professionType,
        businessName: location.professional.businessName,
        displayName: pickProfessionalPublicDisplayName(location.professional),
        handle: location.professional.handle,
        handleNormalized: location.professional.handleNormalized,
        avatarUrl: location.professional.avatarUrl,
        mobileRadiusMiles: location.professional.mobileRadiusMiles,
        locationType: location.type,
        isPrimary: location.isPrimary,
        isBookable: location.isBookable,
        city: location.city,
        state: location.state,
        formattedAddress: location.formattedAddress,
        timeZone: location.timeZone,
        workingHours: location.workingHours,
        ...rollups,
        refreshSource: source,
      },
      client,
    )
  } catch (error) {
    logRefreshError({
      scope: 'refreshLocation',
      identifier: locationId,
      source,
      error,
    })
  }
}

/**
 * Refresh every index row for a professional. Used when a change affects
 * all of the pro's locations at once (offering create/update/delete,
 * working-hours bulk update, verification-status flip).
 *
 * Strategy: load all currently-bookable, geo-valid locations, recompute
 * the pro-level rollups once, upsert each location's row, and delete any
 * stale index rows for locations that no longer satisfy the predicate.
 *
 * Best-effort: errors are logged and swallowed.
 */
export async function refreshProfessional(
  professionalId: string,
  source: RefreshSource,
  client: DbClient = prisma,
): Promise<void> {
  try {
    const locations = await client.professionalLocation.findMany({
      where: {
        professionalId,
        isBookable: true,
        lat: { not: null },
        lng: { not: null },
      },
      select: {
        ...LOCATION_FIELDS,
        professional: { select: PRO_FIELDS },
      },
    })

    if (locations.length === 0) {
      // No qualifying locations — purge any stale index rows for this pro.
      await client.professionalSearchIndex.deleteMany({
        where: { professionalId },
      })
      return
    }

    const readiness = await checkProReadinessWithDb({
      db: client,
      professionalId,
    })

    if (!readiness.ok) {
      await client.professionalSearchIndex.deleteMany({
        where: { professionalId },
      })
      return
    }

    const readyLocationIdSet = new Set(readiness.readyLocationIds)
    const readyLocations = locations.filter((location) =>
      readyLocationIdSet.has(location.id),
    )

    if (readyLocations.length === 0) {
      await client.professionalSearchIndex.deleteMany({
        where: { professionalId },
      })
      return
    }

    const rollups = await loadProRollups(professionalId, client)

    const currentLocationIds = readyLocations.map((location) => location.id)

    // Drop any stale rows (locations that lost isBookable, lost lat/lng,
    // or were deleted) before re-upserting current ones. Prevents the
    // index from accumulating ghost rows.
    await client.professionalSearchIndex.deleteMany({
      where: {
        professionalId,
        locationId: { notIn: currentLocationIds },
      },
    })

    for (const location of readyLocations) {
      const lat = toFiniteNumber(location.lat)
      const lng = toFiniteNumber(location.lng)
      if (lat == null || lng == null) continue

      await upsertIndexRow(
        {
          locationId: location.id,
          professionalId: location.professional.id,
          lat,
          lng,
          verificationStatus: location.professional.verificationStatus,
          professionType: location.professional.professionType,
          businessName: location.professional.businessName,
          displayName: pickProfessionalPublicDisplayName(location.professional),
          handle: location.professional.handle,
          handleNormalized: location.professional.handleNormalized,
          avatarUrl: location.professional.avatarUrl,
          mobileRadiusMiles: location.professional.mobileRadiusMiles,
          locationType: location.type,
          isPrimary: location.isPrimary,
          isBookable: location.isBookable,
          city: location.city,
          state: location.state,
          formattedAddress: location.formattedAddress,
          timeZone: location.timeZone,
          workingHours: location.workingHours,
          ...rollups,
          refreshSource: source,
        },
        client,
      )
    }
  } catch (error) {
    logRefreshError({
      scope: 'refreshProfessional',
      identifier: professionalId,
      source,
      error,
    })
  }
}

/**
 * Remove a location's index row. Safe to call even if the row doesn't
 * exist — uses deleteMany which returns count: 0 instead of throwing.
 *
 * The FK has ON DELETE CASCADE so a hard `prisma.professionalLocation.delete()`
 * also removes the index row, but call sites should invoke this explicitly
 * for clarity and to keep the audit trail (refreshSource).
 */
export async function deleteLocationFromIndex(
  locationId: string,
  client: DbClient = prisma,
): Promise<void> {
  try {
    await client.professionalSearchIndex.deleteMany({ where: { locationId } })
  } catch (error) {
    logRefreshError({
      scope: 'deleteLocationFromIndex',
      identifier: locationId,
      source: null,
      error,
    })
  }
}
