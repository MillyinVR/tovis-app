// lib/lastMinute/audience/buildTier3DiscoveryAudience.ts
import {
  ClientAddressKind,
  ClientIntentType,
  LastMinuteTier,
  Prisma,
  ProfessionalFavorite,
  ServiceFavorite,
  ServiceLocationType,
} from '@prisma/client'
import {
  mergeAndDedupeRecipients,
  type LastMinuteAudienceCandidate,
  type LastMinuteDbClient,
} from './mergeAndDedupeRecipients'

export type Tier3DiscoveryCandidate = LastMinuteAudienceCandidate

const DISCOVERY_LOOKBACK_DAYS = 90

const openingForTier3Select = {
  id: true,
  professionalId: true,
  timeZone: true,
  locationType: true,
  professional: {
    select: {
      id: true,
      mobileRadiusMiles: true,
    },
  },
  location: {
    select: {
      lat: true,
      lng: true,
    },
  },
  services: {
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: {
      serviceId: true,
      offeringId: true,
    },
  },
} satisfies Prisma.LastMinuteOpeningSelect

export type OpeningForTier3 = Prisma.LastMinuteOpeningGetPayload<{
  select: typeof openingForTier3Select
}>

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000)
}

function decimalToNumber(value: Prisma.Decimal | null | undefined): number | null {
  if (!value) return null
  const n = Number(value.toString())
  return Number.isFinite(n) ? n : null
}

function haversineMiles(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 3958.7613
  const toRad = (d: number) => (d * Math.PI) / 180

  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)

  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)

  const h =
    sinLat * sinLat +
    Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng

  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

function toClientIdSetFromProfiles(
  rows: Array<{ id: string }>,
): Set<string> {
  return new Set(rows.map((row) => row.id).filter(isNonEmptyString))
}

async function mapUserIdsToClientIds(args: {
  tx: LastMinuteDbClient
  userIds: string[]
}): Promise<Set<string>> {
  if (args.userIds.length === 0) {
    return new Set<string>()
  }

  const profiles = await args.tx.clientProfile.findMany({
    where: {
      userId: { in: args.userIds },
    },
    select: {
      id: true,
    },
    take: 5000,
  })

  return toClientIdSetFromProfiles(profiles)
}

async function loadExcludedProFavoriteClientIds(args: {
  tx: LastMinuteDbClient
  professionalId: string
}): Promise<Set<string>> {
  const proFavorites: Pick<ProfessionalFavorite, 'userId'>[] =
    await args.tx.professionalFavorite.findMany({
      where: {
        professionalId: args.professionalId,
      },
      select: {
        userId: true,
      },
      take: 5000,
    })

  const userIds = proFavorites
    .map((row) => row.userId)
    .filter(isNonEmptyString)

  return mapUserIdsToClientIds({
    tx: args.tx,
    userIds,
  })
}

async function loadServiceFavoriteClientIds(args: {
  tx: LastMinuteDbClient
  serviceIds: string[]
}): Promise<Set<string>> {
  if (args.serviceIds.length === 0) {
    return new Set<string>()
  }

  const favorites: Pick<ServiceFavorite, 'userId'>[] =
    await args.tx.serviceFavorite.findMany({
      where: {
        serviceId: { in: args.serviceIds },
      },
      select: {
        userId: true,
      },
      take: 5000,
    })

  const userIds = favorites
    .map((row) => row.userId)
    .filter(isNonEmptyString)

  return mapUserIdsToClientIds({
    tx: args.tx,
    userIds,
  })
}

async function loadIntentClientIds(args: {
  tx: LastMinuteDbClient
  professionalId: string
  serviceIds: string[]
  offeringIds: string[]
  since: Date
}): Promise<Set<string>> {
  const conditions: Prisma.ClientIntentEventWhereInput[] = [
    {
      type: ClientIntentType.VIEW_PRO,
      professionalId: args.professionalId,
    },
  ]

  if (args.serviceIds.length > 0) {
    conditions.push({
      type: ClientIntentType.VIEW_SERVICE,
      serviceId: { in: args.serviceIds },
    })
  }

  if (args.offeringIds.length > 0) {
    conditions.push({
      type: ClientIntentType.VIEW_OFFERING,
      offeringId: { in: args.offeringIds },
    })
  }

  if (conditions.length === 0) {
    return new Set<string>()
  }

  const intentRows = await args.tx.clientIntentEvent.findMany({
    where: {
      createdAt: { gte: args.since },
      OR: conditions,
    },
    select: {
      clientId: true,
    },
    take: 10000,
  })

  return new Set(
    intentRows.map((row) => row.clientId).filter(isNonEmptyString),
  )
}

async function loadSearchAreasByClientId(args: {
  tx: LastMinuteDbClient
  clientIds: string[]
}): Promise<Map<string, Array<{ lat: number; lng: number; radiusMiles: number }>>> {
  const map = new Map<string, Array<{ lat: number; lng: number; radiusMiles: number }>>()

  if (args.clientIds.length === 0) {
    return map
  }

  const rows = await args.tx.clientAddress.findMany({
    where: {
      clientId: { in: args.clientIds },
      kind: ClientAddressKind.SEARCH_AREA,
      lat: { not: null },
      lng: { not: null },
      radiusMiles: { not: null },
    },
    select: {
      clientId: true,
      lat: true,
      lng: true,
      radiusMiles: true,
      isDefault: true,
    },
    orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }, { createdAt: 'desc' }],
    take: 10000,
  })

  for (const row of rows) {
    const lat = decimalToNumber(row.lat)
    const lng = decimalToNumber(row.lng)
    const radiusMiles = row.radiusMiles

    if (
      lat == null ||
      lng == null ||
      typeof radiusMiles !== 'number' ||
      !Number.isFinite(radiusMiles) ||
      radiusMiles <= 0
    ) {
      continue
    }

    const existing = map.get(row.clientId) ?? []
    existing.push({ lat, lng, radiusMiles })
    map.set(row.clientId, existing)
  }

  return map
}

function matchesSalonRadius(args: {
  openingLat: number
  openingLng: number
  searchAreas: Array<{ lat: number; lng: number; radiusMiles: number }>
}): boolean {
  return args.searchAreas.some((area) => {
    const distance = haversineMiles(
      { lat: area.lat, lng: area.lng },
      { lat: args.openingLat, lng: args.openingLng },
    )
    return distance <= area.radiusMiles
  })
}

function matchesMobileRadius(args: {
  openingLat: number
  openingLng: number
  proMobileRadiusMiles: number
  searchAreas: Array<{ lat: number; lng: number; radiusMiles: number }>
}): boolean {
  return args.searchAreas.some((area) => {
    const distance = haversineMiles(
      { lat: area.lat, lng: area.lng },
      { lat: args.openingLat, lng: args.openingLng },
    )
    return distance <= args.proMobileRadiusMiles
  })
}

/**
 * Builds the Tier 3 discovery audience for a last-minute opening.
 *
 * Current repo-grounded rules:
 * - includes clients who recently viewed this pro, one of this opening's services,
 *   or one of this opening's offerings
 * - includes clients who favorited one of this opening's services
 * - excludes clients who favorited this pro directly (they belong to Tier 2)
 * - for SALON openings: requires the opening location to fall inside the client's SEARCH_AREA radius
 * - for MOBILE openings: requires the client SEARCH_AREA center to be inside the pro mobile radius
 *   from the opening location / mobile base
 * - then hands final cleanup to mergeAndDedupeRecipients()
 */
export async function buildTier3DiscoveryAudience(args: {
  tx: LastMinuteDbClient
  opening: OpeningForTier3
  now: Date
}): Promise<Tier3DiscoveryCandidate[]> {
  const { tx, opening, now } = args

  const openingLat = decimalToNumber(opening.location.lat)
  const openingLng = decimalToNumber(opening.location.lng)

  if (openingLat == null || openingLng == null) {
    return []
  }

  if (
    opening.locationType === ServiceLocationType.MOBILE &&
    (
      typeof opening.professional.mobileRadiusMiles !== 'number' ||
      !Number.isFinite(opening.professional.mobileRadiusMiles) ||
      opening.professional.mobileRadiusMiles <= 0
    )
  ) {
    return []
  }

  const serviceIds = Array.from(
    new Set(
      opening.services
        .map((row) => row.serviceId)
        .filter(isNonEmptyString),
    ),
  )

  const offeringIds = Array.from(
    new Set(
      opening.services
        .map((row) => row.offeringId)
        .filter(isNonEmptyString),
    ),
  )

  if (serviceIds.length === 0 && offeringIds.length === 0) {
    return []
  }

  const since = daysAgo(DISCOVERY_LOOKBACK_DAYS)

  const [
    intentClientIds,
    serviceFavoriteClientIds,
    excludedProFavoriteClientIds,
  ] = await Promise.all([
    loadIntentClientIds({
      tx,
      professionalId: opening.professionalId,
      serviceIds,
      offeringIds,
      since,
    }),
    loadServiceFavoriteClientIds({
      tx,
      serviceIds,
    }),
    loadExcludedProFavoriteClientIds({
      tx,
      professionalId: opening.professionalId,
    }),
  ])

  const rawCandidateIds = Array.from(
    new Set([
      ...Array.from(intentClientIds),
      ...Array.from(serviceFavoriteClientIds),
    ]),
  ).filter((clientId) => !excludedProFavoriteClientIds.has(clientId))

  if (rawCandidateIds.length === 0) {
    return []
  }

  const searchAreasByClientId = await loadSearchAreasByClientId({
    tx,
    clientIds: rawCandidateIds,
  })

  const geographicallyMatchedClientIds = rawCandidateIds.filter((clientId) => {
    const searchAreas = searchAreasByClientId.get(clientId) ?? []
    if (searchAreas.length === 0) {
      return false
    }

    if (opening.locationType === ServiceLocationType.SALON) {
      return matchesSalonRadius({
        openingLat,
        openingLng,
        searchAreas,
      })
    }

    return matchesMobileRadius({
      openingLat,
      openingLng,
      proMobileRadiusMiles: opening.professional.mobileRadiusMiles ?? 0,
      searchAreas,
    })
  })

  if (geographicallyMatchedClientIds.length === 0) {
    return []
  }

  const candidates: LastMinuteAudienceCandidate[] = geographicallyMatchedClientIds.map(
    (clientId) => ({
      clientId,
      matchedTier: LastMinuteTier.DISCOVERY,
    }),
  )

  return mergeAndDedupeRecipients({
    tx,
    openingId: opening.id,
    professionalId: opening.professionalId,
    openingTimeZone: opening.timeZone,
    now,
    candidates,
  })
}