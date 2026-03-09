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

const CACHE_TTL_MS = 7_500

function pickApiError(raw: unknown): string | null {
  if (!isRecord(raw)) return null
  return pickString(raw.error)
}

function buildQueryKey(args: {
  proId: string
  serviceId: string
  locationType: ServiceLocationType | null
  mediaId?: string
  viewer?: {
    lat: number
    lng: number
    radiusMiles: number | null
    placeId: string | null
  } | null
}) {
  const viewerKey = args.viewer
    ? `viewer=${args.viewer.lat.toFixed(4)},${args.viewer.lng.toFixed(4)},${
        args.viewer.radiusMiles ?? ''
      },${args.viewer.placeId ?? ''}`
    : ''

  return [
    `pro=${args.proId}`,
    `service=${args.serviceId}`,
    `loc=${args.locationType ?? 'AUTO'}`,
    `media=${args.mediaId ?? ''}`,
    viewerKey,
  ]
    .filter(Boolean)
    .join('|')
}

export function useAvailability(
  open: boolean,
  context: DrawerContext,
  locationType: ServiceLocationType | null,
) {
  const router = useRouter()

  const abortRef = useRef<AbortController | null>(null)
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map())
  const requestSeqRef = useRef(0)

  const [loading, setLoading] = useState(false)
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

  const queryKey = useMemo(
    () =>
      buildQueryKey({
        proId,
        serviceId,
        locationType,
        mediaId,
        viewer,
      }),
    [proId, serviceId, locationType, mediaId, viewer],
  )

  const clearInFlight = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  useEffect(() => clearInFlight, [clearInFlight])

  const fetchAvailability = useCallback(
    async (key: string) => {
      const seq = ++requestSeqRef.current

      clearInFlight()
      const controller = new AbortController()
      abortRef.current = controller

      setLoading(true)
      setError(null)

      const qs = new URLSearchParams()
      qs.set('professionalId', proId)
      qs.set('serviceId', serviceId)

      if (locationType) {
        qs.set('locationType', locationType)
      }

      if (mediaId) {
        qs.set('mediaId', mediaId)
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

      try {
        // This route returns SUMMARY when no `date` param is provided.
        const res = await fetch(`/api/availability/day?${qs.toString()}`, {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
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

        if (seq !== requestSeqRef.current) return

        cacheRef.current.set(key, {
          at: Date.now(),
          data: parsed,
        })

        setData(parsed)
      } catch (e: unknown) {
        if (e instanceof Error && e.name === 'AbortError') return
        if (seq !== requestSeqRef.current) return

        setError(
          e instanceof Error ? e.message : 'Failed to load availability.',
        )
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null
        }

        if (seq === requestSeqRef.current) {
          setLoading(false)
        }
      }
    },
    [clearInFlight, router, proId, serviceId, locationType, mediaId, viewer],
  )

  useEffect(() => {
    if (!open) {
      clearInFlight()
      setLoading(false)
      return
    }

    if (!proId) {
      clearInFlight()
      setLoading(false)
      setData(null)
      setError('Missing professional. Please try again.')
      return
    }

    if (!serviceId) {
      clearInFlight()
      setLoading(false)
      setData(null)
      setError(
        'No service is linked yet. Ask the pro to attach a service to this look.',
      )
      return
    }

    const hit = cacheRef.current.get(queryKey)

    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      setData(hit.data)
      setError(null)
      setLoading(false)
      return
    }

    void fetchAvailability(queryKey)
  }, [open, proId, serviceId, queryKey, fetchAvailability, clearInFlight])

  return {
    loading,
    error,
    data,
    setError,
    setData,
  }
}