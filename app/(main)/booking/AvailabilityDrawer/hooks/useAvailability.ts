// app/(main)/booking/AvailabilityDrawer/hooks/useAvailability.ts
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import type {
  AvailabilitySummaryResponse,
  DrawerContext,
  ServiceLocationType,
} from '../types'

import { safeJson } from '../utils/safeJson'
import { redirectToLogin } from '../utils/authRedirect'
import { parseAvailabilitySummaryResponse } from '../contract'

import { isRecord } from '@/lib/guards'
import { pickString } from '@/lib/pick'

type CacheEntry = {
  at: number
  data: AvailabilitySummaryResponse
}

const CACHE_TTL_MS = 45_000
const MAX_CACHE_ENTRIES = 100

const summaryCache = new Map<string, CacheEntry>()
const inFlightByKey = new Map<string, Promise<AvailabilitySummaryResponse>>()

function pickApiError(raw: unknown): string | null {
  if (!isRecord(raw)) return null
  return pickString(raw.error)
}

function buildQueryKey(args: {
  proId: string
  serviceId: string
  locationType: ServiceLocationType | null
  mediaId?: string
  clientAddressId?: string | null
  viewer?: {
    lat: number
    lng: number
    radiusMiles: number | null
    placeId: string | null
  } | null
}) {
  const viewerKey = args.viewer
    ? `viewer=${args.viewer.lat.toFixed(3)},${args.viewer.lng.toFixed(3)},${
        args.viewer.radiusMiles ?? ''
      },${args.viewer.placeId ?? ''}`
    : ''

  return [
    `pro=${args.proId}`,
    `service=${args.serviceId}`,
    `loc=${args.locationType ?? 'AUTO'}`,
    `media=${args.mediaId ?? ''}`,
    `clientAddress=${args.clientAddressId ?? ''}`,
    viewerKey,
  ]
    .filter(Boolean)
    .join('|')
}

function isFresh(entry: CacheEntry): boolean {
  return Date.now() - entry.at < CACHE_TTL_MS
}

function pruneCache() {
  const now = Date.now()

  for (const [key, entry] of summaryCache.entries()) {
    if (now - entry.at >= CACHE_TTL_MS) {
      summaryCache.delete(key)
    }
  }

  if (summaryCache.size <= MAX_CACHE_ENTRIES) return

  const sorted = Array.from(summaryCache.entries()).sort(
    (a, b) => a[1].at - b[1].at,
  )

  const overflow = summaryCache.size - MAX_CACHE_ENTRIES
  for (let i = 0; i < overflow; i += 1) {
    const row = sorted[i]
    if (row) summaryCache.delete(row[0])
  }
}

function getFreshCache(key: string): AvailabilitySummaryResponse | null {
  const hit = summaryCache.get(key)
  if (!hit) return null
  if (!isFresh(hit)) return null
  return hit.data
}

function getAnyCache(key: string): AvailabilitySummaryResponse | null {
  const hit = summaryCache.get(key)
  return hit ? hit.data : null
}

export function useAvailability(
  open: boolean,
  context: DrawerContext,
  locationType: ServiceLocationType | null,
  clientAddressId?: string | null,
) {
  const router = useRouter()
  const requestSeqRef = useRef(0)

  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<AvailabilitySummaryResponse | null>(null)

  const proId = useMemo(
    () => String(context.professionalId || '').trim(),
    [context.professionalId],
  )

  const serviceId = useMemo(
    () => String(context.serviceId || '').trim(),
    [context.serviceId],
  )

  const mediaId = useMemo(
    () => (context.mediaId ? String(context.mediaId).trim() : ''),
    [context.mediaId],
  )

  const normalizedClientAddressId = useMemo(
    () => (clientAddressId ? String(clientAddressId).trim() : ''),
    [clientAddressId],
  )

  const viewer = useMemo(() => {
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
  }, [
    context.viewerLat,
    context.viewerLng,
    context.viewerRadiusMiles,
    context.viewerPlaceId,
  ])

  const requiresClientAddress = locationType === 'MOBILE'

  const canFetch =
    open &&
    Boolean(proId) &&
    Boolean(serviceId) &&
    (!requiresClientAddress || Boolean(normalizedClientAddressId))

  const queryKey = useMemo(
    () =>
      buildQueryKey({
        proId,
        serviceId,
        locationType,
        mediaId,
        clientAddressId: requiresClientAddress ? normalizedClientAddressId : null,
        viewer,
      }),
    [
      proId,
      serviceId,
      locationType,
      mediaId,
      normalizedClientAddressId,
      requiresClientAddress,
      viewer,
    ],
  )

  const fetchAvailability = useCallback(
    async (key: string, keepExistingData: boolean) => {
      const seq = ++requestSeqRef.current

      if (keepExistingData) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }

      setError(null)

      let promise = inFlightByKey.get(key)

      if (!promise) {
        const qs = new URLSearchParams()
        qs.set('professionalId', proId)
        qs.set('serviceId', serviceId)

        if (locationType) {
          qs.set('locationType', locationType)
        }

        if (mediaId) {
          qs.set('mediaId', mediaId)
        }

        if (requiresClientAddress && normalizedClientAddressId) {
          qs.set('clientAddressId', normalizedClientAddressId)
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

        promise = (async (): Promise<AvailabilitySummaryResponse> => {
          const res = await fetch(`/api/availability/day?${qs.toString()}`, {
            method: 'GET',
            cache: 'no-store',
            headers: { Accept: 'application/json' },
          })

          const raw = await safeJson(res)

          if (res.status === 401) {
            redirectToLogin(router, 'availability')
            throw new Error('Please log in to view availability.')
          }

          if (!res.ok) {
            throw new Error(
              pickApiError(raw) ?? `Request failed (${res.status}).`,
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
          summaryCache.set(key, {
            at: Date.now(),
            data: parsed,
          })

          return parsed
        })()

        inFlightByKey.set(key, promise)
      }

      try {
        const parsed = await promise
        if (seq !== requestSeqRef.current) return
        setData(parsed)
      } catch (e: unknown) {
        if (seq !== requestSeqRef.current) return
        setError(
          e instanceof Error ? e.message : 'Failed to load availability.',
        )
      } finally {
        const currentPromise = inFlightByKey.get(key)
        if (currentPromise === promise) {
          inFlightByKey.delete(key)
        }

        if (seq === requestSeqRef.current) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    },
    [
      router,
      proId,
      serviceId,
      locationType,
      mediaId,
      viewer,
      requiresClientAddress,
      normalizedClientAddressId,
    ],
  )

  useEffect(() => {
    return () => {
      requestSeqRef.current += 1
    }
  }, [])

  useEffect(() => {
  if (!open) {
    setLoading(false)
    setRefreshing(false)
    setError(null)
    return
  }

  if (!proId) {
    setLoading(false)
    setRefreshing(false)
    setData(null)
    setError('Missing professional. Please try again.')
    return
  }

  if (!serviceId) {
    setLoading(false)
    setRefreshing(false)
    setData(null)
    setError(
      'No service is linked yet. Ask the pro to attach a service to this look.',
    )
    return
  }

  if (!canFetch) {
    setLoading(false)
    setRefreshing(false)
    setData(null)
    setError(null)
    return
  }

  const fresh = getFreshCache(queryKey)
  if (fresh) {
    setData(fresh)
    setError(null)
    setLoading(false)
    setRefreshing(false)
    return
  }

  const stale = getAnyCache(queryKey)
  if (stale) {
    setData(stale)
    setError(null)
    void fetchAvailability(queryKey, true)
    return
  }

  if (data) {
    setError(null)
    void fetchAvailability(queryKey, true)
    return
  }

  setData(null)
  void fetchAvailability(queryKey, false)
}, [
  open,
  proId,
  serviceId,
  canFetch,
  queryKey,
  fetchAvailability,
  data,
])

  return {
    loading,
    refreshing,
    error,
    data,
    setError,
    setData,
  }
}