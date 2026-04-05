// app/(main)/booking/AvailabilityDrawer/hooks/useDaySlots.ts
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import type {
  AvailabilityBootstrapResponse,
  ServiceLocationType,
} from '../types'

import { parseAvailabilityDayResponse } from '../contract'
import { safeJson } from '../utils/safeJson'

const DAY_SLOT_CACHE_TTL_MS = 60_000
const MAX_BOOTSTRAP_SELECTED_DAY_AGE_MS = 10_000

type DaySlotCacheEntry = {
  slots: string[]
  cachedAt: number
  availabilityVersion: string | null
  generatedAt: string | null
}

type BootstrapData = Extract<AvailabilityBootstrapResponse, { ok: true }>

type FetchDaySlotsParams = {
  proId: string
  ymd: string
  locationType: ServiceLocationType
  locationId: string
  forceRefresh?: boolean
  useCacheForRead?: boolean
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

function isRecord(x: unknown): x is Record<string, unknown> {
  return Boolean(x && typeof x === 'object' && !Array.isArray(x))
}

function pickErrorMessage(raw: unknown): string | null {
  if (!isRecord(raw)) return null
  const value = raw.error
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function buildDaySlotCacheKey(args: {
  proId: string
  ymd: string
  locationType: ServiceLocationType
  locationId: string
  serviceId: string
  clientAddressId: string | null
}) {
  return [
    args.proId,
    args.serviceId,
    args.ymd,
    args.locationType,
    args.locationId,
    args.clientAddressId ?? 'none',
  ].join('|')
}

function isFreshDaySlotCacheEntry(
  entry: DaySlotCacheEntry | undefined,
): boolean {
  if (!entry) return false
  return Date.now() - entry.cachedAt < DAY_SLOT_CACHE_TTL_MS
}

function pruneExpiredDaySlotCache(cache: Record<string, DaySlotCacheEntry>) {
  const now = Date.now()

  for (const key of Object.keys(cache)) {
    const entry = cache[key]
    if (!entry) continue

    if (now - entry.cachedAt >= DAY_SLOT_CACHE_TTL_MS) {
      delete cache[key]
    }
  }
}

function getFreshDaySlotCacheValue(
  cache: Record<string, DaySlotCacheEntry>,
  key: string,
): DaySlotCacheEntry | null {
  const entry = cache[key]
  if (!isFreshDaySlotCacheEntry(entry)) return null

  return {
    slots: entry.slots.slice(),
    cachedAt: entry.cachedAt,
    availabilityVersion: entry.availabilityVersion,
    generatedAt: entry.generatedAt,
  }
}

function invalidateMatchingDaySlotCacheEntries(args: {
  cache: Record<string, DaySlotCacheEntry>
  ymd: string
  locationType: ServiceLocationType
  serviceId: string
  clientAddressId: string | null
}) {
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

function getBootstrapSelectedDay(args: {
  summary: BootstrapData | null
  selectedDayYMD: string | null
}): { date: string; slots: string[] } | null {
  if (!args.summary || !args.selectedDayYMD) return null

  const selectedDay = args.summary.selectedDay
  if (!selectedDay) return null
  if (selectedDay.date !== args.selectedDayYMD) return null
  if (!Array.isArray(selectedDay.slots)) return null
  if (!selectedDay.slots.every((slot) => typeof slot === 'string')) return null

  return {
    date: selectedDay.date,
    slots: selectedDay.slots.slice(),
  }
}

function canUseBootstrapSelectedDayAsPlaceholder(
  summary: BootstrapData | null,
): boolean {
  if (!summary) return false
  const generatedAt = summary.generatedAt
  if (typeof generatedAt !== 'string' || !generatedAt.trim()) return false

  const generatedAtMs = Date.parse(generatedAt)
  if (!Number.isFinite(generatedAtMs)) return false

  return Date.now() - generatedAtMs <= MAX_BOOTSTRAP_SELECTED_DAY_AGE_MS
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

  const primaryId = summary?.primaryPro.id ?? null
  const primaryLocationId = summary?.request.locationId ?? null

  const clearDaySlots = useCallback(() => {
    primarySlotsRequestIdRef.current += 1
    setPrimarySlots([])
    setLoadingPrimarySlots(false)
  }, [])

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

  const fetchDaySlotsDetailed = useCallback(
    async (params: FetchDaySlotsParams): Promise<FetchDaySlotsResult> => {
      if (!effectiveServiceId) {
        return {
          slots: [],
          error: null,
          availabilityVersion: null,
          generatedAt: null,
        }
      }

      if (params.locationType === 'MOBILE' && !selectedClientAddressId) {
        return {
          slots: [],
          error: null,
          availabilityVersion: null,
          generatedAt: null,
        }
      }

      pruneExpiredDaySlotCache(daySlotCacheRef.current)

      const cacheKey = buildDaySlotCacheKey({
        proId: params.proId,
        ymd: params.ymd,
        locationType: params.locationType,
        locationId: params.locationId,
        serviceId: effectiveServiceId,
        clientAddressId:
          params.locationType === 'MOBILE' ? selectedClientAddressId : null,
      })

      const allowCacheRead =
        params.useCacheForRead !== false && !params.forceRefresh

      if (allowCacheRead) {
        const cached = getFreshDaySlotCacheValue(daySlotCacheRef.current, cacheKey)
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
        serviceId: effectiveServiceId,
        date: params.ymd,
        locationType: params.locationType,
        locationId: params.locationId,
      })

      if (params.locationType === 'MOBILE' && selectedClientAddressId) {
        qs.set('clientAddressId', selectedClientAddressId)
      }

      if (debug) {
        qs.set('debug', '1')
      }

      const res = await fetch(`/api/availability/day?${qs.toString()}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
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
          error: pickErrorMessage(raw) ?? `Couldn’t load times (${res.status}).`,
          availabilityVersion: null,
          generatedAt: null,
        }
      }

      const parsed = parseAvailabilityDayResponse(raw)
      if (!parsed || !parsed.ok) {
        return {
          slots: [],
          error:
            (parsed && !parsed.ok ? parsed.error : null) ??
            'Couldn’t load times.',
          availabilityVersion: null,
          generatedAt: null,
        }
      }

      daySlotCacheRef.current[cacheKey] = {
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
    },
    [debug, effectiveServiceId, selectedClientAddressId],
  )

  const fetchDaySlots = useCallback(
    async (params: FetchDaySlotsParams): Promise<string[]> => {
      const result = await fetchDaySlotsDetailed(params)
      return result.slots
    },
    [fetchDaySlotsDetailed],
  )

  const fetchDaySlotsRef = useRef(fetchDaySlots)
  fetchDaySlotsRef.current = fetchDaySlots

  const fetchDaySlotsDetailedRef = useRef(fetchDaySlotsDetailed)
  fetchDaySlotsDetailedRef.current = fetchDaySlotsDetailed

  useEffect(() => {
    if (!open || !primaryId || !primaryLocationId || !selectedDayYMD) {
      primarySlotsRequestIdRef.current += 1
      setPrimarySlots([])
      setLoadingPrimarySlots(false)
      previousRetryKeyRef.current = retryKey
      return
    }

    const currentDayYMD = selectedDayYMD
    const currentPrimaryId = primaryId
    const currentPrimaryLocationId = primaryLocationId

    const bootstrapSelectedDay = getBootstrapSelectedDay({
      summary,
      selectedDayYMD: currentDayYMD,
    })

    const forceRefresh = retryKey !== previousRetryKeyRef.current
    previousRetryKeyRef.current = retryKey

    const requestId = primarySlotsRequestIdRef.current + 1
    primarySlotsRequestIdRef.current = requestId

    let cancelled = false

    const canUseBootstrapPlaceholder =
      !forceRefresh &&
      bootstrapSelectedDay != null &&
      canUseBootstrapSelectedDayAsPlaceholder(summary)

    if (canUseBootstrapPlaceholder) {
      setPrimarySlots(bootstrapSelectedDay.slots)
    } else {
      setPrimarySlots([])
    }

    if (!holding) {
      setError(null)
    }

    setLoadingPrimarySlots(true)

    async function loadPrimarySlotsForSelectedDay() {
      try {
        const result = await fetchDaySlotsDetailedRef.current({
          proId: currentPrimaryId,
          ymd: currentDayYMD,
          locationType: activeLocationType,
          locationId: currentPrimaryLocationId,
          forceRefresh,
          useCacheForRead: false,
        })

        if (cancelled) return
        if (primarySlotsRequestIdRef.current !== requestId) return

        setPrimarySlots(result.slots)

        if (!holding) {
          setError(result.error)
        }
      } catch {
        if (cancelled) return
        if (primarySlotsRequestIdRef.current !== requestId) return

        setPrimarySlots([])
        setError('Network error loading times.')
      } finally {
        if (!cancelled && primarySlotsRequestIdRef.current === requestId) {
          setLoadingPrimarySlots(false)
        }
      }
    }

    void loadPrimarySlotsForSelectedDay()

    return () => {
      cancelled = true
    }
  }, [
    open,
    summary,
    primaryId,
    primaryLocationId,
    selectedDayYMD,
    activeLocationType,
    retryKey,
    holding,
    setError,
  ])

  useEffect(() => {
    if (!open || !primaryId || !primaryLocationId || !selectedDayYMD) return
    if (!effectiveServiceId) return

    const availableDays = summary?.availableDays ?? []
    if (!availableDays.length) return

    const selectedIdx = availableDays.findIndex((d) => d.date === selectedDayYMD)
    if (selectedIdx < 0) return

    const nextDay = availableDays[selectedIdx + 1]
    if (!nextDay) return

    pruneExpiredDaySlotCache(daySlotCacheRef.current)

    const cacheKey = buildDaySlotCacheKey({
      proId: primaryId,
      ymd: nextDay.date,
      locationType: activeLocationType,
      locationId: primaryLocationId,
      serviceId: effectiveServiceId,
      clientAddressId:
        activeLocationType === 'MOBILE' ? selectedClientAddressId : null,
    })

    const cached = getFreshDaySlotCacheValue(daySlotCacheRef.current, cacheKey)
    if (cached) return

    if (backgroundPrefetchInFlightRef.current.has(cacheKey)) return

    backgroundPrefetchInFlightRef.current.add(cacheKey)

    void fetchDaySlotsRef
      .current({
        proId: primaryId,
        ymd: nextDay.date,
        locationType: activeLocationType,
        locationId: primaryLocationId,
        useCacheForRead: true,
      })
      .catch(() => {})
      .finally(() => {
        backgroundPrefetchInFlightRef.current.delete(cacheKey)
      })
  }, [
    open,
    primaryId,
    primaryLocationId,
    selectedDayYMD,
    activeLocationType,
    effectiveServiceId,
    selectedClientAddressId,
    summary,
  ])

  return {
    primarySlots,
    loadingPrimarySlots,
    clearDaySlots,
    invalidateDaySlotCache,
    fetchDaySlots,
  }
}
