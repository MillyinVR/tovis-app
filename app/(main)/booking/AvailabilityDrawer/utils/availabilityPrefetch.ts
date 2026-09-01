// app/(main)/booking/AvailabilityDrawer/utils/availabilityPrefetch.ts
import type {
  AvailabilityBootstrapResponse,
  AvailabilityOtherPro,
  DrawerContext,
  ServiceLocationType,
} from '../types'

import {
  parseAvailabilityBootstrapResponse,
  parseAvailabilityOtherProsResponse,
} from '../contract'
import { safeJson } from './safeJson'
import { INITIAL_WINDOW_DAYS } from './availabilityWindow'
import { BookingApiRequestError, parseBookingApiError } from './bookingError'

type BootstrapOk = Extract<AvailabilityBootstrapResponse, { ok: true }>

type CacheEntry = {
  at: number
  data: BootstrapOk
}

export type ViewerContext = {
  lat: number
  lng: number
  radiusMiles: number | null
  placeId: string | null
}

export type AvailabilityPrefetchArgs = {
  professionalId: string
  serviceId: string
  locationType: ServiceLocationType | null
  locationId?: string | null
  mediaId?: string | null
  clientAddressId?: string | null
  viewer?: ViewerContext | null
  /**
   * Set when the drawer is MOVING a booking: the server sizes the window from
   * that booking's committed width instead of the offering's base (B3-A). It is
   * part of the cache key because this cache is MODULE-scoped — a
   * reschedule-sized window must never be handed to a plain booking flow.
   */
  rescheduleBookingId?: string | null
  /**
   * Set when the window sizes a consult's booking proposal (B4b). Part of the
   * cache key for the same reason `rescheduleBookingId` is: this cache is
   * MODULE-scoped, and a proposal-sized window must never be handed to a plain
   * booking flow.
   */
  consultId?: string | null
  startDate?: string | null
  days?: number
  includeOtherPros?: boolean
  signal?: AbortSignal
}

const CACHE_TTL_MS = 180_000
const MAX_CACHE_ENTRIES = 200

const bootstrapWindowCache = new Map<string, CacheEntry>()
const inFlightByKey = new Map<string, Promise<BootstrapOk>>()
const inFlightOtherProsByKey = new Map<string, Promise<AvailabilityOtherPro[]>>()

function normalizeTrimmed(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeViewer(context: DrawerContext): ViewerContext | null {
  const lat =
    typeof context.viewerLat === 'number' && Number.isFinite(context.viewerLat)
      ? context.viewerLat
      : null

  const lng =
    typeof context.viewerLng === 'number' && Number.isFinite(context.viewerLng)
      ? context.viewerLng
      : null

  if (lat == null || lng == null) return null

  const radiusMiles =
    typeof context.viewerRadiusMiles === 'number' &&
    Number.isFinite(context.viewerRadiusMiles)
      ? context.viewerRadiusMiles
      : null

  const placeId =
    typeof context.viewerPlaceId === 'string' && context.viewerPlaceId.trim()
      ? context.viewerPlaceId.trim()
      : null

  return { lat, lng, radiusMiles, placeId }
}

function buildBaseQueryKey(args: {
  proId: string
  serviceId: string
  locationType: ServiceLocationType | null
  locationId: string
  mediaId: string
  clientAddressId: string
  rescheduleBookingId: string
  consultId: string
  viewer: ViewerContext | null
}): string {
  // Emitted only when present, so every existing key keeps its exact shape.
  const rescheduleKey = args.rescheduleBookingId
    ? `reschedule=${args.rescheduleBookingId}`
    : ''

  const consultKey = args.consultId ? `consult=${args.consultId}` : ''

  const viewerKey = args.viewer
    ? `viewer=${args.viewer.lat.toFixed(3)},${args.viewer.lng.toFixed(3)},${
        args.viewer.radiusMiles ?? ''
      },${args.viewer.placeId ?? ''}`
    : ''

  return [
    `pro=${args.proId}`,
    `service=${args.serviceId}`,
    `loc=${args.locationType ?? 'AUTO'}`,
    `locId=${args.locationId || 'AUTO'}`,
    `media=${args.mediaId}`,
    `clientAddress=${args.clientAddressId}`,
    rescheduleKey,
    consultKey,
    viewerKey,
  ]
    .filter(Boolean)
    .join('|')
}

function buildWindowQueryKey(args: {
  baseKey: string
  startDate: string
  days: number
  includeOtherPros: boolean
}): string {
  return [
    args.baseKey,
    `start=${args.startDate}`,
    `days=${args.days}`,
    `otherPros=${args.includeOtherPros ? '1' : '0'}`,
  ].join('|')
}

function isFresh(entry: CacheEntry): boolean {
  return Date.now() - entry.at < CACHE_TTL_MS
}

function pruneCache(): void {
  const now = Date.now()

  for (const [key, entry] of bootstrapWindowCache.entries()) {
    if (now - entry.at >= CACHE_TTL_MS) {
      bootstrapWindowCache.delete(key)
    }
  }

  if (bootstrapWindowCache.size <= MAX_CACHE_ENTRIES) return

  const sorted = Array.from(bootstrapWindowCache.entries()).sort(
    (a, b) => a[1].at - b[1].at,
  )

  const overflow = bootstrapWindowCache.size - MAX_CACHE_ENTRIES
  for (let i = 0; i < overflow; i += 1) {
    const row = sorted[i]
    if (row) bootstrapWindowCache.delete(row[0])
  }
}

export function getCachedAvailabilitySummaryWindow(
  key: string,
): BootstrapOk | null {
  const hit = bootstrapWindowCache.get(key)
  if (!hit) return null
  if (!isFresh(hit)) return null
  return hit.data
}

export function getAnyCachedAvailabilitySummaryWindow(
  key: string,
): BootstrapOk | null {
  const hit = bootstrapWindowCache.get(key)
  return hit ? hit.data : null
}

export function clearAvailabilitySummaryPrefetchCache(): void {
  bootstrapWindowCache.clear()
  inFlightByKey.clear()
}

export function buildAvailabilitySummaryPrefetchKey(args: {
  professionalId: string
  serviceId: string
  locationType: ServiceLocationType | null
  locationId?: string | null
  mediaId?: string | null
  clientAddressId?: string | null
  rescheduleBookingId?: string | null
  consultId?: string | null
  viewer?: ViewerContext | null
  startDate?: string | null
  days?: number
  includeOtherPros?: boolean
}): string {
  const baseKey = buildBaseQueryKey({
    proId: normalizeTrimmed(args.professionalId),
    serviceId: normalizeTrimmed(args.serviceId),
    locationType: args.locationType,
    locationId: normalizeTrimmed(args.locationId),
    mediaId: normalizeTrimmed(args.mediaId),
    clientAddressId: normalizeTrimmed(args.clientAddressId),
    rescheduleBookingId: normalizeTrimmed(args.rescheduleBookingId),
    consultId: normalizeTrimmed(args.consultId),
    viewer: args.viewer ?? null,
  })

  return buildWindowQueryKey({
    baseKey,
    startDate: args.startDate ?? 'AUTO',
    days: args.days ?? INITIAL_WINDOW_DAYS,
    includeOtherPros: Boolean(args.includeOtherPros),
  })
}

export async function fetchAvailabilitySummaryWindow(
  args: AvailabilityPrefetchArgs,
): Promise<BootstrapOk> {
  const professionalId = normalizeTrimmed(args.professionalId)
  const serviceId = normalizeTrimmed(args.serviceId)
  const locationId = normalizeTrimmed(args.locationId)
  const mediaId = normalizeTrimmed(args.mediaId)
  const clientAddressId = normalizeTrimmed(args.clientAddressId)
  const rescheduleBookingId = normalizeTrimmed(args.rescheduleBookingId)
  const consultId = normalizeTrimmed(args.consultId)
  const locationType = args.locationType ?? null
  const viewer = args.viewer ?? null
  const days = args.days ?? INITIAL_WINDOW_DAYS
  const includeOtherPros = Boolean(args.includeOtherPros)
  const startDate = args.startDate ?? null

  if (!professionalId) {
    throw new Error('Missing professionalId.')
  }

  if (!serviceId) {
    throw new Error('Missing serviceId.')
  }

  if (locationType === 'MOBILE' && !clientAddressId) {
    throw new Error('Mobile availability requires clientAddressId.')
  }

  const baseKey = buildBaseQueryKey({
    proId: professionalId,
    serviceId,
    locationType,
    locationId,
    mediaId,
    clientAddressId,
    rescheduleBookingId,
    consultId,
    viewer,
  })

  const windowKey = buildWindowQueryKey({
    baseKey,
    startDate: startDate ?? 'AUTO',
    days,
    includeOtherPros,
  })

  const fresh = getCachedAvailabilitySummaryWindow(windowKey)
  if (fresh) return fresh

  let promise = inFlightByKey.get(windowKey)
  if (!promise) {
    const qs = new URLSearchParams()
    qs.set('professionalId', professionalId)
    qs.set('serviceId', serviceId)
    qs.set('days', String(days))
    qs.set('includeOtherPros', includeOtherPros ? '1' : '0')

    if (startDate) {
      qs.set('startDate', startDate)
    }

    if (locationType) {
      qs.set('locationType', locationType)
    }

    if (locationId) {
      qs.set('locationId', locationId)
    }

    if (mediaId) {
      qs.set('mediaId', mediaId)
    }

    if (locationType === 'MOBILE' && clientAddressId) {
      qs.set('clientAddressId', clientAddressId)
    }

    if (rescheduleBookingId) {
      qs.set('rescheduleBookingId', rescheduleBookingId)
    }

    if (consultId) {
      qs.set('consultId', consultId)
    }

    if (viewer) {
      qs.set('viewerLat', String(viewer.lat))
      qs.set('viewerLng', String(viewer.lng))

      if (viewer.radiusMiles != null) {
        qs.set('radiusMiles', String(viewer.radiusMiles))
      }

      if (viewer.placeId) {
        qs.set('viewerPlaceId', viewer.placeId)
      }
    }

    promise = (async (): Promise<BootstrapOk> => {
      const res = await fetch(`/api/v1/availability/bootstrap?${qs.toString()}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: args.signal,
      })

      const raw = await safeJson(res)

      if (res.status === 401) {
        throw new Error('Unauthorized.')
      }

      if (!res.ok) {
        const apiError = parseBookingApiError(raw)
        throw new BookingApiRequestError(
          apiError?.message ?? `Availability request failed (${res.status}).`,
          apiError?.code ?? null,
        )
      }

      const parsed = parseAvailabilityBootstrapResponse(raw)
      if (!parsed) {
        throw new Error('Availability endpoint returned unexpected response.')
      }

      if (!parsed.ok) {
        throw new BookingApiRequestError(
          parsed.error,
          parseBookingApiError(raw)?.code ?? null,
        )
      }

      if (parsed.mode !== 'BOOTSTRAP') {
        throw new Error('Availability endpoint returned unexpected response.')
      }

      pruneCache()
      bootstrapWindowCache.set(windowKey, {
        at: Date.now(),
        data: parsed,
      })

      return parsed
    })()

    inFlightByKey.set(windowKey, promise)
  }

  try {
    return await promise
  } finally {
    const currentPromise = inFlightByKey.get(windowKey)
    if (currentPromise === promise) {
      inFlightByKey.delete(windowKey)
    }
  }
}

export async function prefetchAvailabilitySummary(
  args: AvailabilityPrefetchArgs,
): Promise<void> {
  try {
    await fetchAvailabilitySummaryWindow(args)
  } catch {
    // fail-open on background prefetch
  }
}

export type AvailabilityOtherProsFetchArgs = {
  professionalId: string
  serviceId: string
  locationType: ServiceLocationType | null
  locationId?: string | null
  clientAddressId?: string | null
  viewer?: ViewerContext | null
  signal?: AbortSignal
}

/**
 * GET /api/v1/availability/other-pros — refresh ONLY the nearby-pros rail.
 *
 * The rail used to be refreshed by refetching the entire bootstrap window with
 * `includeOtherPros=1`, i.e. recomputing every day's slots in order to update
 * one list. This endpoint exists for exactly this job and is version-keyed +
 * cached server-side for 120s.
 *
 * Returns the ROWS only. The route's `availabilityVersion` is a different
 * namespace from the bootstrap window's and its top-level `timeZone` comes from
 * a placement fork — see `parseAvailabilityOtherProsResponse`. Nothing else on
 * that payload is safe to merge into a bootstrap response.
 *
 * NOT client-cached: the bootstrap window cache is keyed on a window this
 * response does not describe, and the rail is only ever fetched as a refresh.
 * Concurrent callers still share one request.
 */
export async function fetchAvailabilityOtherPros(
  args: AvailabilityOtherProsFetchArgs,
): Promise<AvailabilityOtherPro[]> {
  const professionalId = normalizeTrimmed(args.professionalId)
  const serviceId = normalizeTrimmed(args.serviceId)
  const locationId = normalizeTrimmed(args.locationId)
  const clientAddressId = normalizeTrimmed(args.clientAddressId)
  const locationType = args.locationType ?? null
  const viewer = args.viewer ?? null

  if (!professionalId) {
    throw new Error('Missing professionalId.')
  }

  if (!serviceId) {
    throw new Error('Missing serviceId.')
  }

  if (locationType === 'MOBILE' && !clientAddressId) {
    throw new Error('Mobile availability requires clientAddressId.')
  }

  const qs = new URLSearchParams()
  qs.set('professionalId', professionalId)
  qs.set('serviceId', serviceId)

  if (locationType) {
    qs.set('locationType', locationType)
  }

  if (locationId) {
    qs.set('locationId', locationId)
  }

  if (locationType === 'MOBILE' && clientAddressId) {
    qs.set('clientAddressId', clientAddressId)
  }

  if (viewer) {
    qs.set('viewerLat', String(viewer.lat))
    qs.set('viewerLng', String(viewer.lng))

    if (viewer.radiusMiles != null) {
      qs.set('radiusMiles', String(viewer.radiusMiles))
    }

    if (viewer.placeId) {
      qs.set('viewerPlaceId', viewer.placeId)
    }
  }

  const requestKey = qs.toString()

  let promise = inFlightOtherProsByKey.get(requestKey)
  if (!promise) {
    promise = (async (): Promise<AvailabilityOtherPro[]> => {
      const res = await fetch(`/api/v1/availability/other-pros?${requestKey}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: args.signal,
      })

      const raw = await safeJson(res)

      if (res.status === 401) {
        throw new Error('Unauthorized.')
      }

      if (!res.ok) {
        const apiError = parseBookingApiError(raw)
        throw new BookingApiRequestError(
          apiError?.message ?? `Availability request failed (${res.status}).`,
          apiError?.code ?? null,
        )
      }

      const parsed = parseAvailabilityOtherProsResponse(raw)
      if (!parsed) {
        throw new Error('Availability endpoint returned unexpected response.')
      }

      return parsed.otherPros
    })()

    inFlightOtherProsByKey.set(requestKey, promise)
  }

  try {
    return await promise
  } finally {
    const currentPromise = inFlightOtherProsByKey.get(requestKey)
    if (currentPromise === promise) {
      inFlightOtherProsByKey.delete(requestKey)
    }
  }
}

export function buildAvailabilityPrefetchArgsFromContext(args: {
  context: DrawerContext
  locationType: ServiceLocationType | null
  locationId?: string | null
  clientAddressId?: string | null
  includeOtherPros?: boolean
  days?: number
  startDate?: string | null
}): AvailabilityPrefetchArgs | null {
  const professionalId = normalizeTrimmed(args.context.professionalId)
  const serviceId = normalizeTrimmed(args.context.serviceId)

  if (!professionalId || !serviceId) {
    return null
  }

  const locationType = args.locationType ?? null
  const clientAddressId = normalizeTrimmed(args.clientAddressId)

  if (locationType === 'MOBILE' && !clientAddressId) {
    return null
  }

  return {
    professionalId,
    serviceId,
    locationType,
    locationId: normalizeTrimmed(args.locationId) || null,
    mediaId: normalizeTrimmed(args.context.mediaId),
    clientAddressId: clientAddressId || null,
    rescheduleBookingId:
      normalizeTrimmed(args.context.rescheduleBookingId) || null,
    consultId: normalizeTrimmed(args.context.consultId) || null,
    viewer: normalizeViewer(args.context),
    includeOtherPros: Boolean(args.includeOtherPros),
    days: args.days ?? INITIAL_WINDOW_DAYS,
    startDate: args.startDate ?? null,
  }
}
