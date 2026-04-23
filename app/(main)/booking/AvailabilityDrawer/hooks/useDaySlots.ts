// app/(main)/booking/AvailabilityDrawer/hooks/useDaySlots.ts
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type {
  AvailabilityBootstrapResponse,
  ServiceLocationType,
} from '../types'

import { parseAvailabilityDayResponse } from '../contract'
import { safeJson } from '../utils/safeJson'
import { asTrimmedString, getRecordProp, isRecord } from '@/lib/guards'

const DAY_SLOT_CACHE_TTL_MS = 60_000
const MAX_BOOTSTRAP_SELECTED_DAY_AGE_MS = 10_000

type BootstrapData = Extract<AvailabilityBootstrapResponse, { ok: true }>

type DaySlotCacheEntry = {
  slots: string[]
  cachedAt: number
  availabilityVersion: string | null
  generatedAt: string | null
}

type DaySlotRequest = {
  proId: string
  ymd: string
  locationType: ServiceLocationType
  locationId: string
  clientAddressId: string | null
  serviceId: string
  debug: boolean
}

type FetchDaySlotsParams = DaySlotRequest & {
  forceRefresh?: boolean
  useCacheForRead?: boolean
  signal?: AbortSignal
}

type FetchDaySlotsResult = {
  slots: string[]
  error: string | null
  availabilityVersion: string | null
  generatedAt: string | null
}

type InvalidateDaySlotCacheParams = {
  selectedDayYMD: string | null
  locationType: ServiceLocationType
  clientAddressId: string | null
}

function pickErrorMessage(raw: unknown): string | null {
  if (!isRecord(raw)) return null
  return asTrimmedString(getRecordProp(raw, 'error'))
}

function getActiveClientAddressId(
  locationType: ServiceLocationType,
  selectedClientAddressId: string | null,
): string | null {
  return locationType === 'MOBILE' ? selectedClientAddressId : null
}

function buildDaySlotCacheKey(args: {
  proId: string
  ymd: string
  locationType: ServiceLocationType
  locationId: string
  serviceId: string
  clientAddressId: string | null
}): string {
  return [
    args.proId,
    args.serviceId,
    args.ymd,
    args.locationType,
    args.locationId,
    args.clientAddressId ?? 'none',
  ].join('|')
}

function buildDaySlotRequest(args: {
  proId: string | null
  ymd: string | null
  locationType: ServiceLocationType
  locationId: string | null
  selectedClientAddressId: string | null
  serviceId: string | null
  debug: boolean
}): DaySlotRequest | null {
  if (!args.proId || !args.ymd || !args.locationId || !args.serviceId) {
    return null
  }

  return {
    proId: args.proId,
    ymd: args.ymd,
    locationType: args.locationType,
    locationId: args.locationId,
    clientAddressId: getActiveClientAddressId(
      args.locationType,
      args.selectedClientAddressId,
    ),
    serviceId: args.serviceId,
    debug: args.debug,
  }
}

function pruneExpiredDaySlotCache(
  cache: Record<string, DaySlotCacheEntry>,
): void {
  const now = Date.now()

  for (const [key, entry] of Object.entries(cache)) {
    if (now - entry.cachedAt >= DAY_SLOT_CACHE_TTL_MS) {
      delete cache[key]
    }
  }
}

function cloneCacheEntry(entry: DaySlotCacheEntry): DaySlotCacheEntry {
  return {
    slots: entry.slots.slice(),
    cachedAt: entry.cachedAt,
    availabilityVersion: entry.availabilityVersion,
    generatedAt: entry.generatedAt,
  }
}

function getFreshDaySlotCacheValue(
  cache: Record<string, DaySlotCacheEntry>,
  key: string,
): DaySlotCacheEntry | null {
  const entry = cache[key]
  if (!entry) return null
  if (Date.now() - entry.cachedAt >= DAY_SLOT_CACHE_TTL_MS) return null
  return cloneCacheEntry(entry)
}

function invalidateMatchingDaySlotCacheEntries(args: {
  cache: Record<string, DaySlotCacheEntry>
  ymd: string
  locationType: ServiceLocationType
  serviceId: string
  clientAddressId: string | null
}): void {
  const expectedClientAddressId =
    args.locationType === 'MOBILE' ? (args.clientAddressId ?? 'none') : 'none'

  for (const key of Object.keys(args.cache)) {
    const parts = key.split('|')
    if (parts.length !== 6) continue

    const [, serviceId, ymd, locationType, , clientAddressId] = parts

    if (serviceId !== args.serviceId) continue
    if (ymd !== args.ymd) continue
    if (locationType !== args.locationType) continue
    if (clientAddressId !== expectedClientAddressId) continue

    delete args.cache[key]
  }
}

function isFreshBootstrapGeneratedAt(
  generatedAt: string | null | undefined,
): boolean {
  if (!generatedAt) return false

  const generatedAtMs = Date.parse(generatedAt)
  if (!Number.isFinite(generatedAtMs)) return false

  return Date.now() - generatedAtMs <= MAX_BOOTSTRAP_SELECTED_DAY_AGE_MS
}

function getFreshBootstrapSelectedDayForRequest(args: {
  summary: BootstrapData | null
  selectedDayYMD: string | null
  locationType: ServiceLocationType
  selectedClientAddressId: string | null
}): { date: string; slots: string[] } | null {
  const { summary, selectedDayYMD, locationType, selectedClientAddressId } = args

  if (!summary || !selectedDayYMD) return null
  if (!isFreshBootstrapGeneratedAt(summary.generatedAt)) return null

  const selectedDay = summary.selectedDay
  if (!selectedDay) return null
  if (selectedDay.date !== selectedDayYMD) return null
  if (!Array.isArray(selectedDay.slots)) return null
  if (!selectedDay.slots.every((slot) => typeof slot === 'string')) return null

  if (summary.request.locationType !== locationType) return null

  const requestClientAddressId = summary.request.clientAddressId ?? null
  const activeClientAddressId =
    locationType === 'MOBILE' ? (selectedClientAddressId ?? null) : null

  if (requestClientAddressId !== activeClientAddressId) return null

  return {
    date: selectedDay.date,
    slots: selectedDay.slots.slice(),
  }
}

async function fetchDaySlotsDetailed(
  params: FetchDaySlotsParams,
  cache: Record<string, DaySlotCacheEntry>,
): Promise<FetchDaySlotsResult> {
  if (!params.serviceId) {
    return {
      slots: [],
      error: null,
      availabilityVersion: null,
      generatedAt: null,
    }
  }

  if (params.locationType === 'MOBILE' && !params.clientAddressId) {
    return {
      slots: [],
      error: null,
      availabilityVersion: null,
      generatedAt: null,
    }
  }

  pruneExpiredDaySlotCache(cache)

  const cacheKey = buildDaySlotCacheKey({
    proId: params.proId,
    ymd: params.ymd,
    locationType: params.locationType,
    locationId: params.locationId,
    serviceId: params.serviceId,
    clientAddressId:
      params.locationType === 'MOBILE' ? params.clientAddressId : null,
  })

  const allowCacheRead = params.useCacheForRead !== false && !params.forceRefresh
  if (allowCacheRead) {
    const cached = getFreshDaySlotCacheValue(cache, cacheKey)
    if (cached) {
      return {
        slots: cached.slots,
        error: null,
        availabilityVersion: cached.availabilityVersion,
        generatedAt: cached.generatedAt,
      }
    }
  }

  const qs = new URLSearchParams({
    professionalId: params.proId,
    serviceId: params.serviceId,
    date: params.ymd,
    locationType: params.locationType,
    locationId: params.locationId,
  })

  if (params.locationType === 'MOBILE' && params.clientAddressId) {
    qs.set('clientAddressId', params.clientAddressId)
  }

  if (params.debug) {
    qs.set('debug', '1')
  }

  const res = await fetch(`/api/availability/day?${qs.toString()}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: params.signal,
  })

  const raw = await safeJson(res)

  if (res.status === 401) {
    return {
      slots: [],
      error: null,
      availabilityVersion: null,
      generatedAt: null,
    }
  }

  if (!res.ok) {
    return {
      slots: [],
      error: pickErrorMessage(raw) ?? `Couldn't load times (${res.status}).`,
      availabilityVersion: null,
      generatedAt: null,
    }
  }

  const parsed = parseAvailabilityDayResponse(raw)
  if (!parsed || !parsed.ok) {
    return {
      slots: [],
      error:
        (parsed && !parsed.ok ? parsed.error : null) ?? "Couldn't load times.",
      availabilityVersion: null,
      generatedAt: null,
    }
  }

  cache[cacheKey] = {
    slots: parsed.slots.slice(),
    cachedAt: Date.now(),
    availabilityVersion: parsed.availabilityVersion,
    generatedAt: parsed.generatedAt,
  }

  return {
    slots: parsed.slots.slice(),
    error: null,
    availabilityVersion: parsed.availabilityVersion,
    generatedAt: parsed.generatedAt,
  }
}

export function useDaySlots(args: {
  open: boolean
  summary: BootstrapData | null
  selectedDayYMD: string | null
  activeLocationType: ServiceLocationType
  effectiveServiceId: string | null
  selectedClientAddressId: string | null
  debug: boolean
  holding: boolean
  retryKey: number
  setError: (value: string | null) => void
}) {
  const {
    open,
    summary,
    selectedDayYMD,
    activeLocationType,
    effectiveServiceId,
    selectedClientAddressId,
    debug,
    holding,
    retryKey,
    setError,
  } = args

  const [primarySlots, setPrimarySlots] = useState<string[]>([])
  const [loadingPrimarySlots, setLoadingPrimarySlots] = useState(false)

  const daySlotCacheRef = useRef<Record<string, DaySlotCacheEntry>>({})
  const backgroundPrefetchInFlightRef = useRef<Set<string>>(new Set())
  const primarySlotsRequestIdRef = useRef(0)
  const previousRetryKeyRef = useRef(retryKey)
  const currentAbortControllerRef = useRef<AbortController | null>(null)

  const primaryId = summary?.primaryPro.id ?? null
  const primaryLocationId = summary?.request.locationId ?? null

  const selectedDayRequest = useMemo(
    () =>
      buildDaySlotRequest({
        proId: primaryId,
        ymd: selectedDayYMD,
        locationType: activeLocationType,
        locationId: primaryLocationId,
        selectedClientAddressId,
        serviceId: effectiveServiceId,
        debug,
      }),
    [
      primaryId,
      selectedDayYMD,
      activeLocationType,
      primaryLocationId,
      selectedClientAddressId,
      effectiveServiceId,
      debug,
    ],
  )

  const stopActivePrimaryRequest = useCallback(() => {
    primarySlotsRequestIdRef.current += 1
    currentAbortControllerRef.current?.abort()
    currentAbortControllerRef.current = null
  }, [])

  const clearDaySlots = useCallback(() => {
    stopActivePrimaryRequest()
    setPrimarySlots([])
    setLoadingPrimarySlots(false)
  }, [stopActivePrimaryRequest])

  const invalidateDaySlotCache = useCallback(
    (params: InvalidateDaySlotCacheParams) => {
      if (!effectiveServiceId) return
      if (!params.selectedDayYMD) return

      invalidateMatchingDaySlotCacheEntries({
        cache: daySlotCacheRef.current,
        ymd: params.selectedDayYMD,
        locationType: params.locationType,
        serviceId: effectiveServiceId,
        clientAddressId: params.clientAddressId,
      })
    },
    [effectiveServiceId],
  )

  useEffect(() => {
    if (!open || !selectedDayRequest) {
      clearDaySlots()
      previousRetryKeyRef.current = retryKey
      return
    }

    const forceRefresh = retryKey !== previousRetryKeyRef.current
    previousRetryKeyRef.current = retryKey

    const bootstrapSelectedDay = !forceRefresh
      ? getFreshBootstrapSelectedDayForRequest({
          summary,
          selectedDayYMD: selectedDayRequest.ymd,
          locationType: selectedDayRequest.locationType,
          selectedClientAddressId: selectedDayRequest.clientAddressId,
        })
      : null

    stopActivePrimaryRequest()

    const requestId = primarySlotsRequestIdRef.current
    let cancelled = false

    if (bootstrapSelectedDay) {
      setPrimarySlots(bootstrapSelectedDay.slots)
      setLoadingPrimarySlots(false)

      if (!holding) {
        setError(null)
      }

      return () => {
        cancelled = true
      }
    }

    const controller = new AbortController()
    currentAbortControllerRef.current = controller

    setPrimarySlots([])
    setLoadingPrimarySlots(true)

    if (!holding) {
      setError(null)
    }

    void (async () => {
      try {
        const result = await fetchDaySlotsDetailed(
          {
            ...selectedDayRequest,
            forceRefresh,
            useCacheForRead: false,
            signal: controller.signal,
          },
          daySlotCacheRef.current,
        )

        if (cancelled) return
        if (primarySlotsRequestIdRef.current !== requestId) return

        setPrimarySlots(result.slots)

        if (!holding) {
          setError(result.error)
        }
      } catch (error: unknown) {
        if (cancelled) return
        if (primarySlotsRequestIdRef.current !== requestId) return

        const isAbort =
          error instanceof DOMException && error.name === 'AbortError'

        if (isAbort) {
          return
        }

        setPrimarySlots([])
        if (!holding) {
          setError('Network error loading times.')
        }
      } finally {
        if (!cancelled && primarySlotsRequestIdRef.current === requestId) {
          setLoadingPrimarySlots(false)
        }
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [
    open,
    summary,
    selectedDayRequest,
    holding,
    retryKey,
    setError,
    clearDaySlots,
    stopActivePrimaryRequest,
  ])

  useEffect(() => {
    if (!open || !summary || !selectedDayRequest) {
      return
    }

    const availableDays = summary.availableDays ?? []
    if (availableDays.length === 0) return

    const selectedIndex = availableDays.findIndex(
      (day) => day.date === selectedDayRequest.ymd,
    )
    if (selectedIndex < 0) return

    const nextDay = availableDays[selectedIndex + 1]
    if (!nextDay) return

    const nextDayRequest: DaySlotRequest = {
      ...selectedDayRequest,
      ymd: nextDay.date,
    }

    pruneExpiredDaySlotCache(daySlotCacheRef.current)

    const cacheKey = buildDaySlotCacheKey({
      proId: nextDayRequest.proId,
      ymd: nextDayRequest.ymd,
      locationType: nextDayRequest.locationType,
      locationId: nextDayRequest.locationId,
      serviceId: nextDayRequest.serviceId,
      clientAddressId: nextDayRequest.clientAddressId,
    })

    if (getFreshDaySlotCacheValue(daySlotCacheRef.current, cacheKey)) {
      return
    }

    if (backgroundPrefetchInFlightRef.current.has(cacheKey)) {
      return
    }

    backgroundPrefetchInFlightRef.current.add(cacheKey)

    void fetchDaySlotsDetailed(
      {
        ...nextDayRequest,
        useCacheForRead: true,
      },
      daySlotCacheRef.current,
    )
      .catch(() => {
        // best-effort prefetch only
      })
      .finally(() => {
        backgroundPrefetchInFlightRef.current.delete(cacheKey)
      })
  }, [open, summary, selectedDayRequest])

  useEffect(() => {
    return () => {
      currentAbortControllerRef.current?.abort()
    }
  }, [])

  return {
    primarySlots,
    loadingPrimarySlots,
    clearDaySlots,
    invalidateDaySlotCache,
  }
}