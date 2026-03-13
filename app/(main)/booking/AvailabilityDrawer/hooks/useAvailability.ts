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
import {
  INITIAL_WINDOW_DAYS,
  NEXT_WINDOW_DAYS,
} from '../utils/availabilityWindow'
import { mergeAvailableDays } from '../utils/mergeAvailableDays'

type SummaryOk = Extract<
  AvailabilitySummaryResponse,
  { ok: true; mode: 'SUMMARY' }
>

type CacheEntry = {
  at: number
  data: SummaryOk
}

const CACHE_TTL_MS = 45_000
const MAX_CACHE_ENTRIES = 200

const summaryWindowCache = new Map<string, CacheEntry>()
const inFlightByKey = new Map<string, Promise<SummaryOk>>()

function pickApiError(raw: unknown): string | null {
  if (!isRecord(raw)) return null
  return pickString(raw.error)
}

function buildBaseQueryKey(args: {
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

function buildWindowQueryKey(args: {
  baseKey: string
  startDate: string
  days: number
  includeOtherPros: boolean
}) {
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

function pruneCache() {
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

function getFreshCache(key: string): SummaryOk | null {
  const hit = summaryWindowCache.get(key)
  if (!hit) return null
  if (!isFresh(hit)) return null
  return hit.data
}

function getAnyCache(key: string): SummaryOk | null {
  const hit = summaryWindowCache.get(key)
  return hit ? hit.data : null
}


function mergeSummaryData(current: SummaryOk | null, incoming: SummaryOk): SummaryOk {
  if (!current) return incoming

  return {
    ...current,
    mediaId: incoming.mediaId ?? current.mediaId,
    availableDays: mergeAvailableDays(current.availableDays, incoming.availableDays),
    windowStartDate: current.windowStartDate,
    windowEndDate: incoming.windowEndDate,
    nextStartDate: incoming.nextStartDate,
    hasMoreDays: incoming.hasMoreDays,
    otherPros:
      current.otherPros.length > 0 ? current.otherPros : incoming.otherPros,
    debug: incoming.debug ?? current.debug,
  }
}


export function useAvailability(
  open: boolean,
  context: DrawerContext,
  locationType: ServiceLocationType | null,
  clientAddressId?: string | null,
  includeOtherPros = true,
) {
  const router = useRouter()
  const requestSeqRef = useRef(0)

  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<SummaryOk | null>(null)

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

  const baseQueryKey = useMemo(
    () =>
      buildBaseQueryKey({
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

  const fetchSummaryWindow = useCallback(
    async (args: {
      startDate?: string | null
      days: number
      includeOtherProsForRequest: boolean
    }): Promise<SummaryOk> => {
      const windowKey = buildWindowQueryKey({
        baseKey: baseQueryKey,
        startDate: args.startDate ?? 'AUTO',
        days: args.days,
        includeOtherPros: args.includeOtherProsForRequest,
      })

      const fresh = getFreshCache(windowKey)
      if (fresh) return fresh

      let promise = inFlightByKey.get(windowKey)
      if (!promise) {
        const qs = new URLSearchParams()
        qs.set('professionalId', proId)
        qs.set('serviceId', serviceId)
        if (args.startDate) {
          qs.set('startDate', args.startDate)
        }
        qs.set('days', String(args.days))
        qs.set(
          'includeOtherPros',
          args.includeOtherProsForRequest ? '1' : '0',
        )

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

        promise = (async (): Promise<SummaryOk> => {
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
    },
    [
      baseQueryKey,
      proId,
      serviceId,
      locationType,
      mediaId,
      viewer,
      requiresClientAddress,
      normalizedClientAddressId,
      router,
    ],
  )

  const loadInitial = useCallback(
    async (keepExistingData: boolean) => {
      const seq = ++requestSeqRef.current

      if (keepExistingData) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }

      setError(null)

      try {
        const freshKey = buildWindowQueryKey({
          baseKey: baseQueryKey,
          startDate: 'AUTO',
          days: INITIAL_WINDOW_DAYS,
          includeOtherPros,
        })

        const stale = getAnyCache(freshKey)
        if (keepExistingData && stale) {
          if (seq !== requestSeqRef.current) return
          setData(stale)
        }

        const firstPage = await fetchSummaryWindow({
          startDate: null,
          days: INITIAL_WINDOW_DAYS,
          includeOtherProsForRequest: includeOtherPros,
        })

        if (seq !== requestSeqRef.current) return
        setData(firstPage)
      } catch (e: unknown) {
        if (seq !== requestSeqRef.current) return
        setError(
          e instanceof Error ? e.message : 'Failed to load availability.',
        )
      } finally {
        if (seq === requestSeqRef.current) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    },
    [
      baseQueryKey,
      fetchSummaryWindow,
      includeOtherPros,
    ],
  )

  const loadMore = useCallback(async () => {
    if (!data?.hasMoreDays || !data.nextStartDate) return
    if (loading || refreshing || loadingMore) return

    setLoadingMore(true)
    setError(null)

    try {
      const nextPage = await fetchSummaryWindow({
        startDate: data.nextStartDate,
        days: NEXT_WINDOW_DAYS,
        includeOtherProsForRequest: false,
      })

      setData((current) => mergeSummaryData(current, nextPage))
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : 'Failed to load more availability.',
      )
    } finally {
      setLoadingMore(false)
    }
  }, [data, fetchSummaryWindow, loading, refreshing, loadingMore])

  useEffect(() => {
    return () => {
      requestSeqRef.current += 1
    }
  }, [])

  useEffect(() => {
    if (!open) {
      setLoading(false)
      setLoadingMore(false)
      setRefreshing(false)
      setError(null)
      return
    }

    if (!proId) {
      setLoading(false)
      setLoadingMore(false)
      setRefreshing(false)
      setData(null)
      setError('Missing professional. Please try again.')
      return
    }

    if (!serviceId) {
      setLoading(false)
      setLoadingMore(false)
      setRefreshing(false)
      setData(null)
      setError(
        'No service is linked yet. Ask the pro to attach a service to this look.',
      )
      return
    }

    if (!canFetch) {
      setLoading(false)
      setLoadingMore(false)
      setRefreshing(false)
      setData(null)
      setError(null)
      return
    }

    const initialWindowKey = buildWindowQueryKey({
      baseKey: baseQueryKey,
      startDate: 'AUTO',
      days: INITIAL_WINDOW_DAYS,
      includeOtherPros,
    })

    const fresh = getFreshCache(initialWindowKey)
    if (fresh) {
      setData(fresh)
      setError(null)
      setLoading(false)
      setLoadingMore(false)
      setRefreshing(false)
      return
    }

    const stale = getAnyCache(initialWindowKey)
    if (stale) {
      setData(stale)
      setError(null)
      void loadInitial(true)
      return
    }

    setData(null)
    void loadInitial(false)
  }, [
    open,
    proId,
    serviceId,
    canFetch,
    baseQueryKey,
    includeOtherPros,
    loadInitial,
  ])

  return {
    loading,
    loadingMore,
    refreshing,
    error,
    data,
    hasMoreDays: Boolean(data?.hasMoreDays),
    loadMore,
    setError,
    setData,
  }
}