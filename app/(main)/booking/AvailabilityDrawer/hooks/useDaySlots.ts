// app/(main)/booking/AvailabilityDrawer/hooks/useDaySlots.ts
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import type {
  AvailabilitySummaryResponse,
  ServiceLocationType,
} from '../types'

import { safeJson } from '../utils/safeJson'

const DAY_SLOT_CACHE_TTL_MS = 60_000
const OTHER_PRO_FETCH_CONCURRENCY = 3

type DaySlotCacheEntry = {
  slots: string[]
  cachedAt: number
}

type DaySlotsSummary = Extract<
  AvailabilitySummaryResponse,
  { ok: true; mode: 'SUMMARY' }
>

type OtherProRef = {
  id: string
  locationId: string
}

type FetchDaySlotsParams = {
  proId: string
  ymd: string
  locationType: ServiceLocationType
  locationId: string
  forceRefresh?: boolean
}

type FetchDaySlotsResult = {
  slots: string[]
  error: string | null
}

type InvalidateDaySlotCacheParams = {
  selectedDayYMD: string | null
  locationType: ServiceLocationType
  clientAddressId: string | null
}

type OtherProLoadResult =
  | {
      id: string
      slots: string[]
      failed: false
    }
  | {
      id: string
      failed: true
    }

function isRecord(x: unknown): x is Record<string, unknown> {
  return Boolean(x && typeof x === 'object' && !Array.isArray(x))
}

function pickErrorMessage(raw: unknown): string | null {
  if (!isRecord(raw)) return null
  const value = raw.error
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function parseDaySlots(
  raw: unknown,
): { ok: true; slots: string[] } | { ok: false; error?: string } {
  if (!isRecord(raw)) return { ok: false }

  if (raw.ok === false) {
    return { ok: false, error: pickErrorMessage(raw) ?? undefined }
  }

  if (raw.ok !== true) {
    return { ok: false }
  }

  if (raw.mode !== 'DAY') {
    return { ok: false, error: 'Unexpected availability response.' }
  }

  const slots = raw.slots
  if (!Array.isArray(slots) || !slots.every((s) => typeof s === 'string')) {
    return { ok: false, error: 'Slots malformed.' }
  }

  return { ok: true, slots: slots.slice() }
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
): string[] | null {
  const entry = cache[key]
  if (!isFreshDaySlotCacheEntry(entry)) return null
  return entry.slots.slice()
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

function getOtherProsFromSummary(
  summary: DaySlotsSummary | null,
): OtherProRef[] {
  if (!summary) return []

  return summary.otherPros.map((pro) => ({
    id: pro.id,
    locationId: pro.locationId,
  }))
}

function getSeededPrimarySlotsFromSummary(args: {
  summary: DaySlotsSummary | null
  selectedDayYMD: string | null
}): string[] | null {
  const initialSelectedDay = args.summary?.initialSelectedDay

  if (!initialSelectedDay) return null
  if (!args.selectedDayYMD) return null
  if (initialSelectedDay.date !== args.selectedDayYMD) return null
  if (!Array.isArray(initialSelectedDay.slots)) return null
  if (initialSelectedDay.slots.length === 0) return []

  return initialSelectedDay.slots.slice()
}

async function mapWithConcurrencyLimit<TItem, TResult>(
  items: readonly TItem[],
  concurrency: number,
  worker: (item: TItem) => Promise<TResult>,
): Promise<TResult[]> {
  if (items.length === 0) return []

  const queue = items.map((item, index) => ({ item, index }))
  const results: TResult[] = []
  const workerCount = Math.max(1, Math.min(concurrency, queue.length))

  async function runWorker() {
    while (queue.length > 0) {
      const next = queue.shift()
      if (!next) return
      results[next.index] = await worker(next.item)
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()))
  return results
}

export function useDaySlots(args: {
  open: boolean
  summary: DaySlotsSummary | null
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
  const [otherSlots, setOtherSlots] = useState<Record<string, string[]>>({})
  const [loadingPrimarySlots, setLoadingPrimarySlots] = useState(false)
  const [loadingOtherSlots, setLoadingOtherSlots] = useState(false)

  const daySlotCacheRef = useRef<Record<string, DaySlotCacheEntry>>({})
  const backgroundPrefetchInFlightRef = useRef<Set<string>>(new Set())
  const primarySlotsRequestIdRef = useRef(0)
  const otherSlotsRequestIdRef = useRef(0)
  const previousRetryKeyRef = useRef(retryKey)

  const primaryId = summary?.primaryPro.id ?? null
  const primaryLocationId = summary?.locationId ?? null

  const othersRef = useRef<OtherProRef[]>([])
  othersRef.current = getOtherProsFromSummary(summary)

  const clearDaySlots = useCallback(() => {
    primarySlotsRequestIdRef.current += 1
    otherSlotsRequestIdRef.current += 1
    setPrimarySlots([])
    setOtherSlots({})
    setLoadingPrimarySlots(false)
    setLoadingOtherSlots(false)
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
        return { slots: [], error: null }
      }

      if (params.locationType === 'MOBILE' && !selectedClientAddressId) {
        return { slots: [], error: null }
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

      if (!params.forceRefresh) {
        const cachedSlots = getFreshDaySlotCacheValue(
          daySlotCacheRef.current,
          cacheKey,
        )
        if (cachedSlots) {
          return { slots: cachedSlots, error: null }
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
      })

      const raw = await safeJson(res)

      if (res.status === 401) {
        return { slots: [], error: null }
      }

      if (!res.ok) {
        return {
          slots: [],
          error: pickErrorMessage(raw) ?? `Couldn’t load times (${res.status}).`,
        }
      }

      const parsed = parseDaySlots(raw)
      if (!parsed.ok) {
        return {
          slots: [],
          error: parsed.error ?? 'Couldn’t load times.',
        }
      }

      daySlotCacheRef.current[cacheKey] = {
        slots: parsed.slots.slice(),
        cachedAt: Date.now(),
      }

      return { slots: parsed.slots.slice(), error: null }
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
    const seededDay = summary?.initialSelectedDay
    if (!seededDay?.slots.length) return

    if (!primaryId || !primaryLocationId || !effectiveServiceId) {
      return
    }

    const cacheKey = buildDaySlotCacheKey({
      proId: primaryId,
      ymd: seededDay.date,
      locationType: activeLocationType,
      locationId: primaryLocationId,
      serviceId: effectiveServiceId,
      clientAddressId:
        activeLocationType === 'MOBILE' ? selectedClientAddressId : null,
    })

    if (!isFreshDaySlotCacheEntry(daySlotCacheRef.current[cacheKey])) {
      daySlotCacheRef.current[cacheKey] = {
        slots: seededDay.slots.slice(),
        cachedAt: Date.now(),
      }
    }
  }, [
    summary,
    primaryId,
    primaryLocationId,
    effectiveServiceId,
    activeLocationType,
    selectedClientAddressId,
  ])

  const loadOtherSlots = useCallback(
    async (options?: { forceRefresh?: boolean }) => {
      if (!open || !selectedDayYMD) return
      if (!effectiveServiceId) return

      const currentOthers = othersRef.current
      if (currentOthers.length === 0) {
        setOtherSlots({})
        setLoadingOtherSlots(false)
        return
      }

      pruneExpiredDaySlotCache(daySlotCacheRef.current)

      const nextCachedOtherSlots: Record<string, string[]> = {}
      const prosToFetch: OtherProRef[] = []

      for (const pro of currentOthers) {
        const cacheKey = buildDaySlotCacheKey({
          proId: pro.id,
          ymd: selectedDayYMD,
          locationType: activeLocationType,
          locationId: pro.locationId,
          serviceId: effectiveServiceId,
          clientAddressId:
            activeLocationType === 'MOBILE' ? selectedClientAddressId : null,
        })

        if (!options?.forceRefresh) {
          const cachedSlots = getFreshDaySlotCacheValue(
            daySlotCacheRef.current,
            cacheKey,
          )
          if (cachedSlots) {
            nextCachedOtherSlots[pro.id] = cachedSlots
            continue
          }
        }

        prosToFetch.push(pro)
      }

      setOtherSlots(
        Object.keys(nextCachedOtherSlots).length > 0 ? nextCachedOtherSlots : {},
      )

      if (prosToFetch.length === 0) {
        setLoadingOtherSlots(false)
        return
      }

      const requestId = otherSlotsRequestIdRef.current + 1
      otherSlotsRequestIdRef.current = requestId
      setLoadingOtherSlots(true)

      try {
        const otherResults = await mapWithConcurrencyLimit(
          prosToFetch,
          OTHER_PRO_FETCH_CONCURRENCY,
          async (pro): Promise<OtherProLoadResult> => {
            try {
              const result = await fetchDaySlotsDetailedRef.current({
                proId: pro.id,
                ymd: selectedDayYMD,
                locationType: activeLocationType,
                locationId: pro.locationId,
                forceRefresh: options?.forceRefresh,
              })

              return {
                id: pro.id,
                slots: result.slots,
                failed: false,
              }
            } catch {
              return {
                id: pro.id,
                failed: true,
              }
            }
          },
        )

        if (otherSlotsRequestIdRef.current !== requestId) return

        const nextOtherSlots: Record<string, string[]> = {
          ...nextCachedOtherSlots,
        }

        for (const result of otherResults) {
          if (result.failed) continue
          nextOtherSlots[result.id] = result.slots
        }

        setOtherSlots(nextOtherSlots)
      } catch {
        if (otherSlotsRequestIdRef.current !== requestId) return
        setOtherSlots(nextCachedOtherSlots)
      } finally {
        if (otherSlotsRequestIdRef.current === requestId) {
          setLoadingOtherSlots(false)
        }
      }
    },
    [
      open,
      selectedDayYMD,
      effectiveServiceId,
      activeLocationType,
      selectedClientAddressId,
    ],
  )

  useEffect(() => {
    otherSlotsRequestIdRef.current += 1
    setOtherSlots({})
    setLoadingOtherSlots(false)
  }, [
    open,
    selectedDayYMD,
    activeLocationType,
    selectedClientAddressId,
    primaryId,
    summary?.windowEndDate,
  ])

  useEffect(() => {
    if (!open || !primaryId || !primaryLocationId || !selectedDayYMD) {
      primarySlotsRequestIdRef.current += 1
      setPrimarySlots([])
      setLoadingPrimarySlots(false)
      previousRetryKeyRef.current = retryKey
      return
    }

    pruneExpiredDaySlotCache(daySlotCacheRef.current)

     const currentDayYMD = selectedDayYMD
      const currentPrimaryId = primaryId
      const currentPrimaryLocationId = primaryLocationId
      const seededPrimarySlots = getSeededPrimarySlotsFromSummary({
        summary,
        selectedDayYMD: currentDayYMD,
      })

      const forceRefresh = retryKey !== previousRetryKeyRef.current
    previousRetryKeyRef.current = retryKey

    const cacheKey = buildDaySlotCacheKey({
      proId: currentPrimaryId,
      ymd: currentDayYMD,
      locationType: activeLocationType,
      locationId: currentPrimaryLocationId,
      serviceId: effectiveServiceId ?? '',
      clientAddressId:
        activeLocationType === 'MOBILE' ? selectedClientAddressId : null,
    })

    const cachedPrimarySlots =
      effectiveServiceId && !forceRefresh
        ? getFreshDaySlotCacheValue(daySlotCacheRef.current, cacheKey)
        : null

    const immediatePrimarySlots =
      cachedPrimarySlots ?? (!forceRefresh ? seededPrimarySlots : null)

    if (immediatePrimarySlots) {
      if (
        effectiveServiceId &&
        !cachedPrimarySlots
      ) {
        daySlotCacheRef.current[cacheKey] = {
          slots: immediatePrimarySlots.slice(),
          cachedAt: Date.now(),
        }
      }

      if (!holding) {
        setError(null)
      }

      setPrimarySlots(immediatePrimarySlots)
      setLoadingPrimarySlots(false)
      return
    }

    const requestId = primarySlotsRequestIdRef.current + 1
    primarySlotsRequestIdRef.current = requestId

    let cancelled = false

    async function loadPrimarySlotsForSelectedDay() {
      try {
        if (!holding) {
          setError(null)
        }

        setLoadingPrimarySlots(true)

        const result = await fetchDaySlotsDetailedRef.current({
          proId: currentPrimaryId,
          ymd: currentDayYMD,
          locationType: activeLocationType,
          locationId: currentPrimaryLocationId,
          forceRefresh,
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
    effectiveServiceId,
    selectedClientAddressId,
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

    const cachedSlots = getFreshDaySlotCacheValue(
      daySlotCacheRef.current,
      cacheKey,
    )
    if (cachedSlots) return

    if (backgroundPrefetchInFlightRef.current.has(cacheKey)) return

    backgroundPrefetchInFlightRef.current.add(cacheKey)

    void fetchDaySlotsRef
      .current({
        proId: primaryId,
        ymd: nextDay.date,
        locationType: activeLocationType,
        locationId: primaryLocationId,
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
    otherSlots,
    loadingPrimarySlots,
    loadingOtherSlots,
    clearDaySlots,
    invalidateDaySlotCache,
    fetchDaySlots,
    loadOtherSlots,
  }
}