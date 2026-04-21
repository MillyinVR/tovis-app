// lib/looks/serviceOwnership.ts

export type LookServiceCategoryShape = {
  name: string
  slug: string
}

export type LookServiceShape = {
  id: string
  name: string
  category: LookServiceCategoryShape | null
}

export type LookPrimaryServiceSource =
  | 'LOOK_POST_SERVICE'
  | 'LOOK_POST_SERVICE_ID_ONLY'
  | 'LEGACY_MEDIA_TAG'
  | 'NONE'

export type ResolveLookPrimaryServiceArgs = {
  serviceId: string | null | undefined
  service: LookServiceShape | null | undefined
  legacyPrimaryService?: LookServiceShape | null | undefined
  legacyServiceIds?: readonly string[] | null | undefined
}

export type ResolvedLookPrimaryService = {
  source: LookPrimaryServiceSource
  primaryService: LookServiceShape | null
  primaryServiceId: string | null
  serviceIds: string[]
}

export type LookPrimaryServiceSummary = {
  id: string
  name: string | null
  categoryName: string | null
  categorySlug: string | null
}

function pickNonEmptyString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function buildStableServiceIds(args: {
  primaryServiceId: string | null
  legacyServiceIds?: readonly string[] | null | undefined
}): string[] {
  const primaryServiceId = args.primaryServiceId

  const secondaryIds = Array.from(
    new Set(
      (args.legacyServiceIds ?? [])
        .map((serviceId) => pickNonEmptyString(serviceId))
        .filter((serviceId): serviceId is string => serviceId !== null),
    ),
  )
    .filter((serviceId) => serviceId !== primaryServiceId)
    .sort((a, b) => a.localeCompare(b))

  return primaryServiceId
    ? [primaryServiceId, ...secondaryIds]
    : secondaryIds
}

export function resolveLookPrimaryService(
  args: ResolveLookPrimaryServiceArgs,
): ResolvedLookPrimaryService {
  if (args.service) {
    return {
      source: 'LOOK_POST_SERVICE',
      primaryService: args.service,
      primaryServiceId: args.service.id,
      serviceIds: buildStableServiceIds({
        primaryServiceId: args.service.id,
        legacyServiceIds: args.legacyServiceIds,
      }),
    }
  }

  const explicitServiceId = pickNonEmptyString(args.serviceId)
  if (explicitServiceId) {
    return {
      source: 'LOOK_POST_SERVICE_ID_ONLY',
      primaryService: null,
      primaryServiceId: explicitServiceId,
      serviceIds: buildStableServiceIds({
        primaryServiceId: explicitServiceId,
        legacyServiceIds: args.legacyServiceIds,
      }),
    }
  }

  if (args.legacyPrimaryService) {
    return {
      source: 'LEGACY_MEDIA_TAG',
      primaryService: args.legacyPrimaryService,
      primaryServiceId: args.legacyPrimaryService.id,
      serviceIds: buildStableServiceIds({
        primaryServiceId: args.legacyPrimaryService.id,
        legacyServiceIds: args.legacyServiceIds,
      }),
    }
  }

  return {
    source: 'NONE',
    primaryService: null,
    primaryServiceId: null,
    serviceIds: [],
  }
}

export function toLookPrimaryServiceSummary(
  input: ResolvedLookPrimaryService,
): LookPrimaryServiceSummary | null {
  if (!input.primaryServiceId) return null

  return {
    id: input.primaryServiceId,
    name: input.primaryService?.name ?? null,
    categoryName: input.primaryService?.category?.name ?? null,
    categorySlug: input.primaryService?.category?.slug ?? null,
  }
}