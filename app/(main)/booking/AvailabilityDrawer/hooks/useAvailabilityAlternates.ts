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
import {
  asNumber,
  asTrimmedString,
  getRecordProp,
  isRecord,
} from '@/lib/guards'

type BootstrapOk = Extract<AvailabilityBootstrapResponse, { ok: true }>
type AlternatesOk = Extract<AvailabilityAlternatesResponse, { ok: true }>

type LoadAlternatesOptions = {
  forceRefresh?: boolean
}

type FetchArgs = {
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
  viewerPlaceId: string | null
}

function buildAlternatesRequestKey(args: FetchArgs): string {
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
    args.viewerPlaceId ?? 'none',
  ].join('|')
}

function pickApiError(raw: unknown): string | null {
  if (!isRecord(raw)) return null
  return asTrimmedString(getRecordProp(raw, 'error'))
}

function buildOtherSlots(parsed: AlternatesOk): Record<string, string[]> {
  const nextOtherSlots: Record<string, string[]> = {}

  for (const row of parsed.alternates) {
    nextOtherSlots[row.pro.id] = row.slots.slice()
  }

  return nextOtherSlots
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

  const fallbackProfessionalId = asTrimmedString(context.professionalId)
  const fallbackServiceId = asTrimmedString(context.serviceId)

  const primaryProfessionalId =
    summary?.primaryPro.id ?? fallbackProfessionalId ?? null

  const effectiveServiceId =
    summary?.request.serviceId ?? fallbackServiceId ?? null

  const effectiveOfferingId =
    summary?.request.offeringId ?? summary?.offering.id ?? context.offeringId ?? null

  const effectiveLocationId = summary?.request.locationId ?? null

  const viewerLat = asNumber(context.viewerLat)
  const viewerLng = asNumber(context.viewerLng)
  const viewerRadiusMiles = asNumber(context.viewerRadiusMiles)
  const viewerPlaceId = asTrimmedString(context.viewerPlaceId)

  const fetchArgs = useMemo<FetchArgs | null>(() => {
    if (!open || !requested || !summary) return null
    if (!primaryProfessionalId || !effectiveServiceId || !selectedDayYMD || !effectiveLocationId) {
      return null
    }

    const clientAddressId =
      activeLocationType === 'MOBILE' ? selectedClientAddressId : null

    if (activeLocationType === 'MOBILE' && !clientAddressId) {
      return null
    }

    return {
      professionalId: primaryProfessionalId,
      serviceId: effectiveServiceId,
      offeringId: effectiveOfferingId,
      selectedDayYMD,
      locationType: activeLocationType,
      locationId: effectiveLocationId,
      clientAddressId,
      viewerLat,
      viewerLng,
      viewerRadiusMiles,
      viewerPlaceId,
    }
  }, [
    open,
    requested,
    summary,
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
    viewerPlaceId,
  ])

  const requestKey = useMemo(() => {
    return fetchArgs ? buildAlternatesRequestKey(fetchArgs) : null
  }, [fetchArgs])

  const resetAlternatesState = useCallback(() => {
    setData(null)
    setOtherSlots({})
    setLoadingAlternates(false)
    setAlternatesError(null)
  }, [])

  const clearAlternates = useCallback(() => {
    requestSeqRef.current += 1
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    activeRequestKeyRef.current = null
    resetAlternatesState()
  }, [resetAlternatesState])

  const loadAlternates = useCallback(
    async (options?: LoadAlternatesOptions) => {
      if (!fetchArgs || !requestKey) {
        clearAlternates()
        return
      }

      const seq = ++requestSeqRef.current
      abortControllerRef.current?.abort()

      const controller = new AbortController()
      abortControllerRef.current = controller
      activeRequestKeyRef.current = requestKey

      const forceRefresh = options?.forceRefresh === true

      setLoadingAlternates(true)
      setAlternatesError(null)
      setOtherSlots({})
      setData(null)

      try {
        const qs = new URLSearchParams({
          professionalId: fetchArgs.professionalId,
          serviceId: fetchArgs.serviceId,
          date: fetchArgs.selectedDayYMD,
          locationType: fetchArgs.locationType,
          locationId: fetchArgs.locationId,
        })

        if (fetchArgs.offeringId) {
          qs.set('offeringId', fetchArgs.offeringId)
        }

        if (fetchArgs.locationType === 'MOBILE' && fetchArgs.clientAddressId) {
          qs.set('clientAddressId', fetchArgs.clientAddressId)
        }

        if (fetchArgs.viewerLat != null && fetchArgs.viewerLng != null) {
          qs.set('viewerLat', String(fetchArgs.viewerLat))
          qs.set('viewerLng', String(fetchArgs.viewerLng))

          if (fetchArgs.viewerRadiusMiles != null) {
            qs.set('radiusMiles', String(fetchArgs.viewerRadiusMiles))
          }

          if (fetchArgs.viewerPlaceId) {
            qs.set('viewerPlaceId', fetchArgs.viewerPlaceId)
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
          setData(null)
          setOtherSlots({})
          setAlternatesError('Unauthorized.')
          return
        }

        if (!res.ok) {
          setData(null)
          setOtherSlots({})
          setAlternatesError(
            pickApiError(raw) ?? `Couldn't load alternate pros (${res.status}).`,
          )
          return
        }

        const parsed = parseAvailabilityAlternatesResponse(raw)

        if (!parsed || !parsed.ok || parsed.mode !== 'ALTERNATES') {
          setData(null)
          setOtherSlots({})
          setAlternatesError('Alternates endpoint returned unexpected response.')
          return
        }

        setData(parsed)
        setOtherSlots(buildOtherSlots(parsed))
        setAlternatesError(null)
      } catch (error: unknown) {
        if (controller.signal.aborted) return
        if (seq !== requestSeqRef.current) return
        if (activeRequestKeyRef.current !== requestKey) return

        setData(null)
        setOtherSlots({})
        setAlternatesError(
          error instanceof Error ? error.message : "Couldn't load alternate pros.",
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
    [fetchArgs, requestKey, debug, clearAlternates],
  )

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (!fetchArgs || !requestKey) {
      clearAlternates()
      previousRetryKeyRef.current = retryKey
      return
    }

    const forceRefresh = retryKey !== previousRetryKeyRef.current
    previousRetryKeyRef.current = retryKey

    void loadAlternates({ forceRefresh })
  }, [fetchArgs, requestKey, retryKey, loadAlternates, clearAlternates])

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