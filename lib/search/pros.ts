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
import { prismaRead } from '@/lib/prisma'
import { PUBLICLY_APPROVED_PRO_STATUSES } from '@/lib/proTrustState'
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

function mapLocationPreview(
  location: DiscoveryLocationDto | null,
): SearchProLocationPreviewDto | null {
  if (!location) return null

  return {
    id: location.id,
    formattedAddress: location.formattedAddress,
    city: location.city,
    state: location.state,
    timeZone: location.timeZone,
    placeId: location.placeId,
    lat: location.lat,
    lng: location.lng,
    isPrimary: location.isPrimary,
  }
}

// Raw row shape from the candidates query. All Decimal columns are CAST
// to float in SQL, so this maps cleanly to JS primitives.
type CandidateRow = {
  professionalId: string
  businessName: string | null
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

function buildSortClause(sort: SearchProsSort): Prisma.Sql {
  if (sort === 'NAME') {
    return Prisma.sql`LOWER(t."businessName") ASC NULLS LAST, t."professionalId" ASC`
  }

  if (sort === 'RATING') {
    return Prisma.sql`t."ratingAvg" DESC NULLS LAST, t."ratingCount" DESC, LOWER(t."businessName") ASC NULLS LAST, t."professionalId" ASC`
  }

  if (sort === 'PRICE') {
    return Prisma.sql`COALESCE(t."minMobilePrice", t."minAnyPrice") ASC NULLS LAST, LOWER(t."businessName") ASC NULLS LAST, t."professionalId" ASC`
  }

  // DISTANCE — null distances sort last (matches prior JS behavior of
  // pushing missing distances to +Infinity).
  return Prisma.sql`t."distanceMiles" ASC NULLS LAST, LOWER(t."businessName") ASC NULLS LAST, t."professionalId" ASC`
}

function toFiniteCount(value: number | bigint): number {
  if (typeof value === 'bigint') {
    const n = Number(value)
    return Number.isFinite(n) ? n : 0
  }
  return Number.isFinite(value) ? value : 0
}

export async function searchPros(
  params: SearchProsParams,
): Promise<SearchProsResponseDto> {
  const hasOrigin = params.lat != null && params.lng != null

  const filters: Prisma.Sql[] = []

  filters.push(
    Prisma.sql`psi."verificationStatus" = ANY(${[...PUBLICLY_APPROVED_PRO_STATUSES] as VerificationStatus[]}::"VerificationStatus"[])`,
  )
  filters.push(Prisma.sql`psi."isBookable" = TRUE`)

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

  const sortClause = buildSortClause(params.sort)

  // Note: replica-lag awareness — index hooks fire best-effort after
  // each mutation; reads go through prismaRead. A 1-5s lag is acceptable
  // because the index itself is reconciled by `pnpm backfill:search-index`
  // and the sort/cursor are deterministic regardless of staleness.
  const candidates = await prismaRead.$queryRaw<CandidateRow[]>`
    SELECT * FROM (
      SELECT DISTINCT ON (psi."professionalId")
        psi."professionalId",
        psi."businessName",
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
        ${distanceExpr} AS "distanceMiles"
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

  type Materialized = {
    row: CandidateRow
    closest: DiscoveryLocationDto
    primary: DiscoveryLocationDto | null
  }

  let materialized: Materialized[] = candidates.map((row) => {
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

  const items: SearchProItemDto[] = materialized.map((entry) => ({
    id: entry.row.professionalId,
    businessName: entry.row.businessName,
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
