// lib/search/pros.ts
//
// P2.4b — searchPros reads from the denormalized ProfessionalSearchIndex
// (built in P2.4a) via raw SQL with PostGIS. Replaces the prior
// `professionalProfile.findMany({ take: 200 })` + JS haversine + JS
// open-now + JS sort pipeline. Each WHERE clause maps to an index:
//
//   - GIST(geom)                       — ST_DWithin radius prefilter
//   - BTREE(verificationStatus,
//           isBookable)                — pro-status + bookable prefilter
//   - GIN(categoryIds)                 — `${id} = ANY(categoryIds)` filter
//
// The query uses DISTINCT ON ("professionalId") so each pro appears as a
// single row (their closest location when an origin is given, otherwise
// their primary). The outer SELECT re-sorts by the requested sort mode.
//
// Open-now still runs in JS — TZ + workingHours JSON parsing is awkward
// in SQL and the prefilter has already cut the candidate set.
//
// Pagination keeps the existing id-based cursor: we materialize the full
// candidate list (capped at SEARCH_PROS_RAW_CANDIDATE_LIMIT) and slice via
// paginateByCursor. The SQL ordering is deterministic with professionalId
// as the final tiebreaker, so the cursor is stable across requests.
//
// Reads go through `prismaRead`. The index is updated by best-effort
// hooks; the 1-5s replica lag is in the same noise band as a hook
// failure-and-recovery cycle, so the read replica is the right default.

import { Prisma, type ProfessionType, type VerificationStatus } from '@prisma/client'

import {
  buildDiscoveryLocationLabel,
  inferProfessionTypesFromQuery,
  isOpenNowAtLocation,
  type DiscoveryLocationDto,
} from '@/lib/discovery/nearby'
import { coarsenPublicCoordinate } from '@/lib/discovery/publicCoordinates'
import { membershipEnforcementEnabled } from '@/lib/membership/enforcement'
import { entitledStatuses, planKeysGranting } from '@/lib/pro/entitlements'
import { prismaRead } from '@/lib/prisma'
import { formatProfessionalPublicDisplayName } from '@/lib/privacy/professionalDisplayName'
import { PUBLICLY_APPROVED_PRO_STATUSES } from '@/lib/proTrustState'
import { searchIndexVisibilitySql } from '@/lib/tenant'
import type { TenantContext } from '@/lib/tenant'
import {
  SearchRequestError,
  type SearchProItemDto,
  type SearchProLocationPreviewDto,
  type SearchProsResponseDto,
  clampInt,
  decodeIdCursor,
  normalizeOptionalId,
  paginateByCursor,
  parseBooleanParam,
  parseLimit,
  pickFiniteNumber,
  pickNonEmptyString,
} from './contracts'

export type SearchProsSort =
  | 'DISTANCE'
  | 'RATING'
  | 'PRICE'
  | 'NAME'

export type SearchProsParams = {
  q: string | null
  lat: number | null
  lng: number | null
  categoryId: string | null
  // Exact service-offering filter (GIN on psi."serviceIds"). Used by the
  // nearby surface; the search route leaves it null.
  serviceId: string | null
  // Excludes one pro from results (e.g. "other pros near this one"). Nearby-only.
  excludeProfessionalId: string | null
  radiusMiles: number
  mobileOnly: boolean
  openNowOnly: boolean
  minRating: number | null
  maxPrice: number | null
  sort: SearchProsSort
  cursorId: string | null
  limit: number
}

// Hard ceiling on candidates fetched from the index per request. Mirrors
// the prior `take: 200` cap. Open-now JS filter + cursor slicing operate
// over this slice. Any single request that exceeds this should narrow
// its filters or paginate.
const SEARCH_PROS_RAW_CANDIDATE_LIMIT = 200
const METERS_PER_MILE = 1609.344

function normalizeSearchProsSort(
  value: string | null,
): SearchProsSort {
  const normalized = (value ?? '').trim().toUpperCase()

  if (normalized === 'RATING') return 'RATING'
  if (normalized === 'PRICE') return 'PRICE'
  if (normalized === 'NAME') return 'NAME'

  return 'DISTANCE'
}

export function parseSearchProsParams(
  searchParams: URLSearchParams,
): SearchProsParams {
  const rawCursor = pickNonEmptyString(searchParams.get('cursor'))
  const cursorId = rawCursor ? decodeIdCursor(rawCursor) : null

  if (rawCursor && !cursorId) {
    throw new SearchRequestError(400, 'Invalid pros search cursor.')
  }

  const radiusMiles = (() => {
    const parsed = pickFiniteNumber(searchParams.get('radiusMiles')) ?? 15
    return clampInt(parsed, 1, 100)
  })()

  return {
    q: pickNonEmptyString(searchParams.get('q')),
    lat: pickFiniteNumber(searchParams.get('lat')),
    lng: pickFiniteNumber(searchParams.get('lng')),
    categoryId: normalizeOptionalId(searchParams.get('categoryId')),
    // serviceId / excludeProfessionalId are nearby-surface inputs; the search
    // route does not expose them, so they stay null here.
    serviceId: null,
    excludeProfessionalId: null,
    radiusMiles,
    mobileOnly: parseBooleanParam(searchParams.get('mobile')),
    openNowOnly: parseBooleanParam(searchParams.get('openNow')),
    minRating: pickFiniteNumber(searchParams.get('minRating')),
    maxPrice: pickFiniteNumber(searchParams.get('maxPrice')),
    sort: normalizeSearchProsSort(searchParams.get('sort')),
    cursorId,
    limit: parseLimit(searchParams.get('limit'), {
      defaultValue: 50,
      max: 50,
    }),
  }
}

// `/api/v1/search/pros` is unauthenticated, so the location preview must be redacted
// to neighborhood precision — same posture as `/api/v1/pros/nearby`. The exact
// street address (formattedAddress/placeId) is stripped and coordinates coarsened;
// distanceMiles is computed in SQL from exact coords before this mapping, so the
// displayed distance stays accurate while the map pin is approximate.
function mapLocationPreview(
  location: DiscoveryLocationDto | null,
): SearchProLocationPreviewDto | null {
  if (!location) return null

  return {
    id: location.id,
    formattedAddress: null,
    city: location.city,
    state: location.state,
    timeZone: location.timeZone,
    placeId: null,
    lat: coarsenPublicCoordinate(location.lat),
    lng: coarsenPublicCoordinate(location.lng),
    isPrimary: location.isPrimary,
  }
}

// Raw row shape from the candidates query. All Decimal columns are CAST
// to float in SQL, so this maps cleanly to JS primitives.
type CandidateRow = {
  professionalId: string
  businessName: string | null
  displayName: string | null
  handle: string | null
  professionType: ProfessionType | null
  avatarUrl: string | null
  locationId: string
  formattedAddress: string | null
  city: string | null
  state: string | null
  timeZone: string | null
  placeId: string | null
  lat: number | null
  lng: number | null
  isPrimary: boolean
  workingHours: unknown
  ratingAvg: number | null
  ratingCount: number | bigint
  offersMobile: boolean
  minMobilePrice: number | null
  minAnyPrice: number | null
  distanceMiles: number | null
  /** Membership priority-discovery perk; constant FALSE while enforcement is off. */
  hasPriorityDiscovery: boolean
}

// Secondary lookup row for primaryLocation (the closest location may not
// be the primary one). Same shape as a DiscoveryLocationDto plus the
// professionalId for indexing into the result map.
type PrimaryLocationRow = {
  professionalId: string
  locationId: string
  formattedAddress: string | null
  city: string | null
  state: string | null
  timeZone: string | null
  placeId: string | null
  lat: number | null
  lng: number | null
  isPrimary: boolean
  workingHours: unknown
}

function buildSortClause(sort: SearchProsSort, prioritize: boolean): Prisma.Sql {
  // Membership perk (priority_discovery): members win TIES — same rating,
  // same price, same mile of distance — they never leapfrog relevance
  // outright. NAME stays purely alphabetical.
  const priorityTiebreak = prioritize
    ? Prisma.sql`t."hasPriorityDiscovery" DESC, `
    : Prisma.empty

  if (sort === 'NAME') {
    return Prisma.sql`LOWER(t."businessName") ASC NULLS LAST, t."professionalId" ASC`
  }

  if (sort === 'RATING') {
    return Prisma.sql`t."ratingAvg" DESC NULLS LAST, ${priorityTiebreak}t."ratingCount" DESC, LOWER(t."businessName") ASC NULLS LAST, t."professionalId" ASC`
  }

  if (sort === 'PRICE') {
    return Prisma.sql`COALESCE(t."minMobilePrice", t."minAnyPrice") ASC NULLS LAST, ${priorityTiebreak}LOWER(t."businessName") ASC NULLS LAST, t."professionalId" ASC`
  }

  // DISTANCE — null distances sort last (matches prior JS behavior of
  // pushing missing distances to +Infinity). Rating breaks distance ties so
  // equally-near pros surface by quality instead of name.
  if (prioritize) {
    // Priority applies within a whole-mile bucket: members lead their mile,
    // then exact distance and rating order the rest. NULL distances land in a
    // far sentinel bucket, preserving the NULLS LAST behavior.
    return Prisma.sql`FLOOR(COALESCE(t."distanceMiles", 1000000)) ASC, t."hasPriorityDiscovery" DESC, t."distanceMiles" ASC NULLS LAST, t."ratingAvg" DESC NULLS LAST, LOWER(t."businessName") ASC NULLS LAST, t."professionalId" ASC`
  }
  return Prisma.sql`t."distanceMiles" ASC NULLS LAST, t."ratingAvg" DESC NULLS LAST, LOWER(t."businessName") ASC NULLS LAST, t."professionalId" ASC`
}

function toFiniteCount(value: number | bigint): number {
  if (typeof value === 'bigint') {
    const n = Number(value)
    return Number.isFinite(n) ? n : 0
  }
  return Number.isFinite(value) ? value : 0
}

// One pro's candidate row plus its resolved closest + primary locations (full
// DiscoveryLocationDtos, including workingHours). Both discovery surfaces — the
// paginated search list and the distance-ranked nearby cards — build their own
// response DTOs from this, so the geo/index query lives in exactly one place.
export type ProSearchCandidate = {
  row: CandidateRow
  closest: DiscoveryLocationDto
  primary: DiscoveryLocationDto | null
}

// Core index read shared by searchPros and loadNearbyPros. Applies the
// status/bookable/tenant/geo/category/service/price/rating/text filters,
// resolves each pro to a single row (closest location given an origin, else
// primary), backfills the primary location, and runs the open-now JS filter.
// Mapping to a surface-specific DTO + pagination/slicing is the caller's job.
export async function fetchProSearchCandidates(
  params: SearchProsParams,
  tenantContext: TenantContext,
): Promise<ProSearchCandidate[]> {
  const hasOrigin = params.lat != null && params.lng != null

  const filters: Prisma.Sql[] = []

  filters.push(
    Prisma.sql`psi."verificationStatus" = ANY(${[...PUBLICLY_APPROVED_PRO_STATUSES] as VerificationStatus[]}::"VerificationStatus"[])`,
  )
  filters.push(Prisma.sql`psi."isBookable" = TRUE`)
  // Asymmetric tenant visibility — white-label contexts only see their own
  // tenant's pros; tovis-root sees all. See docs/architecture/tenant-model.md.
  filters.push(searchIndexVisibilitySql(tenantContext))

  if (hasOrigin) {
    const radiusMeters = params.radiusMiles * METERS_PER_MILE

    filters.push(
      Prisma.sql`ST_DWithin(
        psi."geom",
        ST_SetSRID(ST_MakePoint(${params.lng}::double precision, ${params.lat}::double precision), 4326)::geography,
        ${radiusMeters}::double precision
      )`,
    )
  }

  if (params.categoryId) {
    filters.push(
      Prisma.sql`${params.categoryId}::text = ANY(psi."categoryIds")`,
    )
  }

  // Exact offering match via GIN(serviceIds). Nearby uses this; search omits it.
  if (params.serviceId) {
    filters.push(
      Prisma.sql`${params.serviceId}::text = ANY(psi."serviceIds")`,
    )
  }

  // Exclude one pro (e.g. "other pros near this one").
  if (params.excludeProfessionalId) {
    filters.push(
      Prisma.sql`psi."professionalId" <> ${params.excludeProfessionalId}`,
    )
  }

  if (params.mobileOnly) {
    filters.push(Prisma.sql`psi."offersMobile" = TRUE`)
  }

  if (params.maxPrice != null) {
    if (params.mobileOnly) {
      filters.push(
        Prisma.sql`psi."minMobilePrice" IS NOT NULL AND psi."minMobilePrice" <= ${params.maxPrice}::decimal(10, 2)`,
      )
    } else {
      filters.push(
        Prisma.sql`COALESCE(psi."minMobilePrice", psi."minAnyPrice") IS NOT NULL AND COALESCE(psi."minMobilePrice", psi."minAnyPrice") <= ${params.maxPrice}::decimal(10, 2)`,
      )
    }
  }

  if (params.minRating != null) {
    filters.push(
      Prisma.sql`psi."ratingAvg" IS NOT NULL AND psi."ratingAvg" >= ${params.minRating}::float`,
    )
  }

  if (params.q) {
    const pattern = `%${params.q}%`
    const matchedProfessions = inferProfessionTypesFromQuery(params.q)

    const textParts: Prisma.Sql[] = [
      Prisma.sql`psi."businessName" ILIKE ${pattern}`,
      Prisma.sql`psi."handleNormalized" ILIKE ${pattern}`,
      Prisma.sql`psi."city" ILIKE ${pattern}`,
      Prisma.sql`psi."state" ILIKE ${pattern}`,
      Prisma.sql`psi."formattedAddress" ILIKE ${pattern}`,
    ]

    if (matchedProfessions.length > 0) {
      textParts.push(
        Prisma.sql`psi."professionType" = ANY(${matchedProfessions as ProfessionType[]}::"ProfessionType"[])`,
      )
    }

    filters.push(Prisma.sql`(${Prisma.join(textParts, ' OR ')})`)
  }

  const whereClause = Prisma.join(filters, ' AND ')

  // Distance expression — meters from origin, converted to miles. NULL
  // when no origin (DISTANCE sort still works; nulls sort last).
  const distanceExpr = hasOrigin
    ? Prisma.sql`ST_Distance(
        psi."geom",
        ST_SetSRID(ST_MakePoint(${params.lng}::double precision, ${params.lat}::double precision), 4326)::geography
      ) / ${METERS_PER_MILE}::double precision`
    : Prisma.sql`NULL::double precision`

  // DISTINCT ON tie-breaker for which location represents each pro:
  //   - with origin → closest location (then isPrimary as final tiebreaker)
  //   - no origin   → primary location (then locationId for determinism)
  const innerOrder = hasOrigin
    ? Prisma.sql`psi."professionalId", ${distanceExpr} ASC NULLS LAST, psi."isPrimary" DESC, psi."locationId" ASC`
    : Prisma.sql`psi."professionalId", psi."isPrimary" DESC, psi."locationId" ASC`

  // Priority-discovery membership perk — only computed (and only paid for as
  // a per-row EXISTS) while membership enforcement is on. Plan keys and
  // entitled statuses come from the entitlement matrix so SQL can't drift
  // from lib/pro/entitlements.
  const prioritize = membershipEnforcementEnabled()
  const priorityColumn = prioritize
    ? Prisma.sql`EXISTS (
        SELECT 1
        FROM "ProfessionalSubscription" ps
        WHERE ps."professionalId" = psi."professionalId"
          AND (
            (ps."status"::text IN (${Prisma.join(entitledStatuses().map(String))})
              AND ps."planKey" IN (${Prisma.join(planKeysGranting('priority_discovery'))}))
            OR (ps."compUntil" > NOW()
              AND ps."compPlanKey" IN (${Prisma.join(planKeysGranting('priority_discovery'))}))
          )
      )`
    : Prisma.sql`FALSE`

  const sortClause = buildSortClause(params.sort, prioritize)

  // Note: replica-lag awareness — index hooks fire best-effort after
  // each mutation; reads go through prismaRead. A 1-5s lag is acceptable
  // because the index itself is reconciled by `pnpm backfill:search-index`
  // and the sort/cursor are deterministic regardless of staleness.
  const candidates = await prismaRead.$queryRaw<CandidateRow[]>`
    SELECT * FROM (
      SELECT DISTINCT ON (psi."professionalId")
        psi."professionalId",
        psi."businessName",
        psi."displayName",
        psi."handle",
        psi."professionType",
        psi."avatarUrl",
        psi."locationId",
        psi."formattedAddress",
        psi."city",
        psi."state",
        psi."timeZone",
        pl."placeId",
        psi."lat"::float AS "lat",
        psi."lng"::float AS "lng",
        psi."isPrimary",
        psi."workingHours",
        psi."ratingAvg",
        psi."ratingCount",
        psi."offersMobile",
        psi."minMobilePrice"::float AS "minMobilePrice",
        psi."minAnyPrice"::float AS "minAnyPrice",
        ${distanceExpr} AS "distanceMiles",
        ${priorityColumn} AS "hasPriorityDiscovery"
      FROM "ProfessionalSearchIndex" psi
      JOIN "ProfessionalLocation" pl ON pl."id" = psi."locationId"
      WHERE ${whereClause}
      ORDER BY ${innerOrder}
    ) t
    ORDER BY ${sortClause}
    LIMIT ${SEARCH_PROS_RAW_CANDIDATE_LIMIT}
  `

  const proIds = candidates.map((row) => row.professionalId)

  // Secondary lookup: primary locations for each pro hit. The candidates
  // query gives us the *closest* (or first-by-isPrimary) location; the
  // response shape requires both `closestLocation` and `primaryLocation`.
  // Uses BTREE("professionalId") + the predicate `isPrimary = true`.
  const primaryRows =
    proIds.length === 0
      ? []
      : await prismaRead.$queryRaw<PrimaryLocationRow[]>`
          SELECT
            psi."professionalId",
            psi."locationId",
            psi."formattedAddress",
            psi."city",
            psi."state",
            psi."timeZone",
            pl."placeId",
            psi."lat"::float AS "lat",
            psi."lng"::float AS "lng",
            psi."isPrimary",
            psi."workingHours"
          FROM "ProfessionalSearchIndex" psi
          JOIN "ProfessionalLocation" pl ON pl."id" = psi."locationId"
          WHERE psi."professionalId" = ANY(${proIds}::text[])
            AND psi."isPrimary" = TRUE
        `

  const primaryByPro = new Map<string, DiscoveryLocationDto>()
  for (const row of primaryRows) {
    primaryByPro.set(row.professionalId, {
      id: row.locationId,
      formattedAddress: row.formattedAddress,
      city: row.city,
      state: row.state,
      timeZone: row.timeZone,
      placeId: row.placeId,
      lat: row.lat,
      lng: row.lng,
      isPrimary: row.isPrimary,
      workingHours: row.workingHours,
    })
  }

  let materialized: ProSearchCandidate[] = candidates.map((row) => {
    const closest: DiscoveryLocationDto = {
      id: row.locationId,
      formattedAddress: row.formattedAddress,
      city: row.city,
      state: row.state,
      timeZone: row.timeZone,
      placeId: row.placeId,
      lat: row.lat,
      lng: row.lng,
      isPrimary: row.isPrimary,
      workingHours: row.workingHours,
    }

    return {
      row,
      closest,
      primary: primaryByPro.get(row.professionalId) ?? closest,
    }
  })

  if (params.openNowOnly) {
    materialized = materialized.filter((entry) =>
      isOpenNowAtLocation({
        timeZone: entry.closest.timeZone,
        workingHours: entry.closest.workingHours,
      }),
    )
  }

  return materialized
}

export async function searchPros(
  params: SearchProsParams,
  tenantContext: TenantContext,
): Promise<SearchProsResponseDto> {
  const materialized = await fetchProSearchCandidates(params, tenantContext)

  const items: SearchProItemDto[] = materialized.map((entry) => ({
    id: entry.row.professionalId,
    businessName: entry.row.businessName,
    // Index rows are backfilled, but fall back to the helper for any not-yet-
    // refreshed row so the DTO's displayName is always a usable label.
    displayName:
      entry.row.displayName ??
      formatProfessionalPublicDisplayName({
        businessName: entry.row.businessName,
      }),
    handle: entry.row.handle,
    professionType: entry.row.professionType,
    avatarUrl: entry.row.avatarUrl,
    locationLabel: buildDiscoveryLocationLabel({
      location: entry.closest,
    }),
    distanceMiles: entry.row.distanceMiles,
    ratingAvg: entry.row.ratingAvg,
    ratingCount: toFiniteCount(entry.row.ratingCount),
    minPrice: params.mobileOnly
      ? entry.row.minMobilePrice
      : entry.row.minAnyPrice,
    supportsMobile: entry.row.offersMobile,
    closestLocation: mapLocationPreview(entry.closest),
    primaryLocation: mapLocationPreview(entry.primary),
  }))

  return paginateByCursor(items, {
    cursorId: params.cursorId,
    limit: params.limit,
  })
}
