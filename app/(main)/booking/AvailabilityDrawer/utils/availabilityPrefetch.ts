// app/(main)/booking/AvailabilityDrawer/utils/availabilityPrefetch.ts
import type {
  AvailabilitySummaryResponse,
  DrawerContext,
  ServiceLocationType,
} from '../types'

import { parseAvailabilitySummaryResponse } from '../contract'
import { safeJson } from './safeJson'
import { INITIAL_WINDOW_DAYS } from './availabilityWindow'

import { isRecord } from '@/lib/guards'
import { pickString } from '@/lib/pick'

type SummaryOk = Extract<
  AvailabilitySummaryResponse,
  { ok: true; mode: 'SUMMARY' }
>

type CacheEntry = {
  at: number
  data: SummaryOk
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
  mediaId?: string | null
  clientAddressId?: string | null
  viewer?: ViewerContext | null
  startDate?: string | null
  days?: number
  includeOtherPros?: boolean
  signal?: AbortSignal
}

const CACHE_TTL_MS = 45_000
const MAX_CACHE_ENTRIES = 200

const summaryWindowCache = new Map<string, CacheEntry>()
const inFlightByKey = new Map<string, Promise<SummaryOk>>()

function pickApiError(raw: unknown): string | null {
  if (!isRecord(raw)) return null
  return pickString(raw.error)
}

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
  mediaId: string
  clientAddressId: string
  viewer: ViewerContext | null
}): string {
  const viewerKey = args.viewer
    ? `viewer=${args.viewer.lat.toFixed(3)},${args.viewer.lng.toFixed(3)},${
        args.viewer.radiusMiles ?? ''
      },${args.viewer.placeId ?? ''}`
    : ''

  return [
    `pro=${args.proId}`,
    `service=${args.serviceId}`,
    `loc=${args.locationType ?? 'AUTO'}`,
    `media=${args.mediaId}`,
    `clientAddress=${args.clientAddressId}`,
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

  for (const [key, entry] of summaryWindowCache.entries()) {
    if (now - entry.at >= CACHE_TTL_MS) {
      summaryWindowCache.delete(key)
    }
  }

  if (summaryWindowCache.size <= MAX_CACHE_ENTRIES) return

  const sorted = Array.from(summaryWindowCache.entries()).sort(
    (a, b) => a[1].at - b[1].at,
  )

  const overflow = summaryWindowCache.size - MAX_CACHE_ENTRIES
  for (let i = 0; i < overflow; i += 1) {
    const row = sorted[i]
    if (row) summaryWindowCache.delete(row[0])
  }
}

export function getCachedAvailabilitySummaryWindow(
  key: string,
): SummaryOk | null {
  const hit = summaryWindowCache.get(key)
  if (!hit) return null
  if (!isFresh(hit)) return null
  return hit.data
}

export function getAnyCachedAvailabilitySummaryWindow(
  key: string,
): SummaryOk | null {
  const hit = summaryWindowCache.get(key)
  return hit ? hit.data : null
}

export function clearAvailabilitySummaryPrefetchCache(): void {
  summaryWindowCache.clear()
  inFlightByKey.clear()
}

export function buildAvailabilitySummaryPrefetchKey(args: {
  professionalId: string
  serviceId: string
  locationType: ServiceLocationType | null
  mediaId?: string | null
  clientAddressId?: string | null
  viewer?: ViewerContext | null
  startDate?: string | null
  days?: number
  includeOtherPros?: boolean
}): string {
  const baseKey = buildBaseQueryKey({
    proId: normalizeTrimmed(args.professionalId),
    serviceId: normalizeTrimmed(args.serviceId),
    locationType: args.locationType,
    mediaId: normalizeTrimmed(args.mediaId),
    clientAddressId: normalizeTrimmed(args.clientAddressId),
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
): Promise<SummaryOk> {
  const professionalId = normalizeTrimmed(args.professionalId)
  const serviceId = normalizeTrimmed(args.serviceId)
  const mediaId = normalizeTrimmed(args.mediaId)
  const clientAddressId = normalizeTrimmed(args.clientAddressId)
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
    mediaId,
    clientAddressId,
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

    if (mediaId) {
      qs.set('mediaId', mediaId)
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

    promise = (async (): Promise<SummaryOk> => {
      const res = await fetch(`/api/availability/day?${qs.toString()}`, {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: args.signal,
      })

      const raw = await safeJson(res)

      if (res.status === 401) {
        throw new Error('Unauthorized.')
      }

      if (!res.ok) {
        throw new Error(
          pickApiError(raw) ?? `Availability request failed (${res.status}).`,
        )
      }

      const parsed = parseAvailabilitySummaryResponse(raw)
      if (!parsed) {
        throw new Error('Availability endpoint returned unexpected response.')
      }

      if (!parsed.ok) {
        throw new Error(parsed.error)
      }

      if (parsed.mode !== 'SUMMARY') {
        throw new Error('Availability endpoint returned unexpected response.')
      }

      pruneCache()
      summaryWindowCache.set(windowKey, {
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

export function buildAvailabilityPrefetchArgsFromContext(args: {
  context: DrawerContext
  locationType: ServiceLocationType | null
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
    mediaId: normalizeTrimmed(args.context.mediaId),
    clientAddressId: clientAddressId || null,
    viewer: normalizeViewer(args.context),
    includeOtherPros: Boolean(args.includeOtherPros),
    days: args.days ?? INITIAL_WINDOW_DAYS,
    startDate: args.startDate ?? null,
  }
}