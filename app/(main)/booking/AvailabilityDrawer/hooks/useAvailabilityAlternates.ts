// app/(main)/booking/AvailabilityDrawer/hooks/useAvailabilityAlternates.ts
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type {
  AvailabilityAlternatesResponse,
  AvailabilityBootstrapResponse,
  DrawerContext,
  ServiceLocationType,
} from '../types'

import { parseAvailabilityAlternatesResponse } from '../contract'
import { safeJson } from '../utils/safeJson'

type BootstrapOk = Extract<AvailabilityBootstrapResponse, { ok: true }>
type AlternatesOk = Extract<AvailabilityAlternatesResponse, { ok: true }>

type LoadAlternatesOptions = {
  forceRefresh?: boolean
}

function buildAlternatesRequestKey(args: {
  professionalId: string
  serviceId: string
  offeringId: string | null
  selectedDayYMD: string
  locationType: ServiceLocationType
  locationId: string
  clientAddressId: string | null
  viewerLat: number | null
  viewerLng: number | null
  viewerRadiusMiles: number | null
}): string {
  return [
    args.professionalId,
    args.serviceId,
    args.offeringId ?? 'none',
    args.selectedDayYMD,
    args.locationType,
    args.locationId,
    args.clientAddressId ?? 'none',
    args.viewerLat ?? 'none',
    args.viewerLng ?? 'none',
    args.viewerRadiusMiles ?? 'none',
  ].join('|')
}

function pickApiError(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const error = (raw as { error?: unknown }).error
  return typeof error === 'string' && error.trim() ? error.trim() : null
}

export function useAvailabilityAlternates(args: {
  open: boolean
  requested: boolean
  summary: BootstrapOk | null
  context: DrawerContext
  selectedDayYMD: string | null
  activeLocationType: ServiceLocationType
  selectedClientAddressId: string | null
  debug: boolean
  retryKey: number
}) {
  const {
    open,
    requested,
    summary,
    context,
    selectedDayYMD,
    activeLocationType,
    selectedClientAddressId,
    debug,
    retryKey,
  } = args

  const [data, setData] = useState<AlternatesOk | null>(null)
  const [otherSlots, setOtherSlots] = useState<Record<string, string[]>>({})
  const [loadingAlternates, setLoadingAlternates] = useState(false)
  const [alternatesError, setAlternatesError] = useState<string | null>(null)

  const requestSeqRef = useRef(0)
  const abortControllerRef = useRef<AbortController | null>(null)
  const previousRetryKeyRef = useRef(retryKey)
  const activeRequestKeyRef = useRef<string | null>(null)

  const fallbackProfessionalId = String(context.professionalId ?? '').trim()
  const fallbackServiceId = String(context.serviceId ?? '').trim()

  const primaryProfessionalId =
    summary?.primaryPro.id ?? (fallbackProfessionalId || null)

  const effectiveServiceId =
    summary?.request.serviceId ?? (fallbackServiceId || null)
  const effectiveOfferingId =
    summary?.request.offeringId ?? summary?.offering.id ?? context.offeringId ?? null

  const effectiveLocationId = summary?.request.locationId ?? null

  const viewerLat =
    typeof context.viewerLat === 'number' && Number.isFinite(context.viewerLat)
      ? context.viewerLat
      : null
  const viewerLng =
    typeof context.viewerLng === 'number' && Number.isFinite(context.viewerLng)
      ? context.viewerLng
      : null
  const viewerRadiusMiles =
    typeof context.viewerRadiusMiles === 'number' &&
    Number.isFinite(context.viewerRadiusMiles)
      ? context.viewerRadiusMiles
      : null

  const canFetch =
    open &&
    requested &&
    Boolean(summary) &&
    Boolean(primaryProfessionalId) &&
    Boolean(effectiveServiceId) &&
    Boolean(selectedDayYMD) &&
    Boolean(effectiveLocationId) &&
    (activeLocationType !== 'MOBILE' || Boolean(selectedClientAddressId))

  const requestKey = useMemo(() => {
    if (
      !primaryProfessionalId ||
      !effectiveServiceId ||
      !selectedDayYMD ||
      !effectiveLocationId
    ) {
      return null
    }

    return buildAlternatesRequestKey({
      professionalId: primaryProfessionalId,
      serviceId: effectiveServiceId,
      offeringId: effectiveOfferingId,
      selectedDayYMD,
      locationType: activeLocationType,
      locationId: effectiveLocationId,
      clientAddressId:
        activeLocationType === 'MOBILE' ? selectedClientAddressId : null,
      viewerLat,
      viewerLng,
      viewerRadiusMiles,
    })
  }, [
    primaryProfessionalId,
    effectiveServiceId,
    effectiveOfferingId,
    selectedDayYMD,
    activeLocationType,
    effectiveLocationId,
    selectedClientAddressId,
    viewerLat,
    viewerLng,
    viewerRadiusMiles,
  ])

  const clearAlternates = useCallback(() => {
    requestSeqRef.current += 1
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    activeRequestKeyRef.current = null

    setData(null)
    setOtherSlots({})
    setLoadingAlternates(false)
    setAlternatesError(null)
  }, [])

  const loadAlternates = useCallback(
    async (options?: LoadAlternatesOptions) => {
      if (!canFetch) {
        clearAlternates()
        return
      }

      if (
        !requestKey ||
        !primaryProfessionalId ||
        !effectiveServiceId ||
        !selectedDayYMD ||
        !effectiveLocationId
      ) {
        clearAlternates()
        return
      }

      const seq = ++requestSeqRef.current
      abortControllerRef.current?.abort()

      const controller = new AbortController()
      abortControllerRef.current = controller
      activeRequestKeyRef.current = requestKey

      const forceRefresh = Boolean(options?.forceRefresh)

      setLoadingAlternates(true)
      setAlternatesError(null)
      setOtherSlots({})
      setData(null)

      try {
        const qs = new URLSearchParams({
          professionalId: primaryProfessionalId,
          serviceId: effectiveServiceId,
          date: selectedDayYMD,
          locationType: activeLocationType,
          locationId: effectiveLocationId,
        })

        if (effectiveOfferingId) {
          qs.set('offeringId', effectiveOfferingId)
        }

        if (activeLocationType === 'MOBILE' && selectedClientAddressId) {
          qs.set('clientAddressId', selectedClientAddressId)
        }

        if (viewerLat != null && viewerLng != null) {
          qs.set('viewerLat', String(viewerLat))
          qs.set('viewerLng', String(viewerLng))

          if (viewerRadiusMiles != null) {
            qs.set('radiusMiles', String(viewerRadiusMiles))
          }

          if (context.viewerPlaceId) {
            qs.set('viewerPlaceId', context.viewerPlaceId)
          }
        }

        if (forceRefresh) {
          qs.set('_ts', String(Date.now()))
        }

        if (debug) {
          qs.set('debug', '1')
        }

        const res = await fetch(`/api/availability/alternates?${qs.toString()}`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        })

        const raw = await safeJson(res)

        if (controller.signal.aborted) return
        if (seq !== requestSeqRef.current) return
        if (activeRequestKeyRef.current !== requestKey) return

        if (res.status === 401) {
          setAlternatesError('Unauthorized.')
          setOtherSlots({})
          setData(null)
          return
        }

        if (!res.ok) {
          setAlternatesError(
            pickApiError(raw) ?? `Couldn’t load alternate pros (${res.status}).`,
          )
          setOtherSlots({})
          setData(null)
          return
        }

        const parsed = parseAvailabilityAlternatesResponse(raw)
        if (!parsed) {
          setAlternatesError('Alternates endpoint returned unexpected response.')
          setOtherSlots({})
          setData(null)
          return
        }

        if (!parsed.ok) {
          setAlternatesError(parsed.error)
          setOtherSlots({})
          setData(null)
          return
        }

        if (parsed.mode !== 'ALTERNATES') {
          setAlternatesError('Alternates endpoint returned unexpected response.')
          setOtherSlots({})
          setData(null)
          return
        }

        const nextOtherSlots: Record<string, string[]> = {}
        for (const row of parsed.alternates) {
          nextOtherSlots[row.pro.id] = row.slots.slice()
        }

        setData(parsed)
        setOtherSlots(nextOtherSlots)
        setAlternatesError(null)
      } catch (error: unknown) {
        if (controller.signal.aborted) return
        if (seq !== requestSeqRef.current) return
        if (activeRequestKeyRef.current !== requestKey) return

        setData(null)
        setOtherSlots({})
        setAlternatesError(
          error instanceof Error
            ? error.message
            : 'Couldn’t load alternate pros.',
        )
      } finally {
        if (
          !controller.signal.aborted &&
          seq === requestSeqRef.current &&
          activeRequestKeyRef.current === requestKey
        ) {
          setLoadingAlternates(false)
        }
      }
    },
    [
      canFetch,
      requestKey,
      primaryProfessionalId,
      effectiveServiceId,
      selectedDayYMD,
      activeLocationType,
      effectiveLocationId,
      effectiveOfferingId,
      selectedClientAddressId,
      viewerLat,
      viewerLng,
      viewerRadiusMiles,
      context.viewerPlaceId,
      debug,
      clearAlternates,
    ],
  )

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (!canFetch || !requestKey) {
      clearAlternates()
      previousRetryKeyRef.current = retryKey
      return
    }

    const forceRefresh = retryKey !== previousRetryKeyRef.current
    previousRetryKeyRef.current = retryKey

    void loadAlternates({ forceRefresh })
  }, [canFetch, requestKey, retryKey, loadAlternates, clearAlternates])

  const refreshAlternates = useCallback(() => {
    void loadAlternates({ forceRefresh: true })
  }, [loadAlternates])

  return {
    data,
    otherSlots,
    loadingAlternates,
    alternatesError,
    clearAlternates,
    refreshAlternates,
  }
}
