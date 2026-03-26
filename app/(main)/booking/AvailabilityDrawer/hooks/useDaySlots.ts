// app/(main)/booking/AvailabilityDrawer/hooks/useDaySlots.ts
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import type {
  AvailabilitySummaryResponse,
  ServiceLocationType,
} from '../types'

import { safeJson } from '../utils/safeJson'

const DAY_SLOT_CACHE_TTL_MS = 60_000

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

function getOtherProsFromSummary(summary: DaySlotsSummary | null): OtherProRef[] {
  if (!summary) return []

  return summary.otherPros.map((pro) => ({
    id: pro.id,
    locationId: pro.locationId,
  }))
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
  const otherSlotsRequestIdRef = useRef(0)
  const previousRetryKeyRef = useRef(retryKey)

  const primaryId = summary?.primaryPro.id ?? null
  const primaryLocationId = summary?.locationId ?? null

  const othersRef = useRef<OtherProRef[]>([])
  othersRef.current = getOtherProsFromSummary(summary)

  const clearDaySlots = useCallback(() => {
    setPrimarySlots([])
    setOtherSlots({})
    setLoadingPrimarySlots(false)
    setLoadingOtherSlots(false)
    otherSlotsRequestIdRef.current += 1
  }, [])

  const clearDaySlotCache = useCallback(() => {
    daySlotCacheRef.current = {}
  }, [])

  const fetchDaySlots = useCallback(
    async (params: {
      proId: string
      ymd: string
      locationType: ServiceLocationType
      locationId: string
      isPrimary: boolean
      forceRefresh?: boolean
    }) => {
      if (!effectiveServiceId) return []

      if (params.locationType === 'MOBILE' && !selectedClientAddressId) {
        return []
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
          return cachedSlots
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
        return []
      }

      if (!res.ok) {
        if (params.isPrimary) {
          setError(
            pickErrorMessage(raw) ?? `Couldn’t load times (${res.status}).`,
          )
        }
        return []
      }

      const parsed = parseDaySlots(raw)
      if (!parsed.ok) {
        if (params.isPrimary) {
          setError(parsed.error ?? 'Couldn’t load times.')
        }
        return []
      }

      daySlotCacheRef.current[cacheKey] = {
        slots: parsed.slots.slice(),
        cachedAt: Date.now(),
      }

      return parsed.slots.slice()
    },
    [debug, effectiveServiceId, selectedClientAddressId, setError],
  )

  const fetchDaySlotsRef = useRef(fetchDaySlots)
  fetchDaySlotsRef.current = fetchDaySlots

  useEffect(() => {
    if (!summary?.firstDaySlots?.length) return

    const firstDate = summary.availableDays[0]?.date
    if (
      !firstDate ||
      !primaryId ||
      !primaryLocationId ||
      !effectiveServiceId
    ) {
      return
    }

    const cacheKey = buildDaySlotCacheKey({
      proId: primaryId,
      ymd: firstDate,
      locationType: activeLocationType,
      locationId: primaryLocationId,
      serviceId: effectiveServiceId,
      clientAddressId:
        activeLocationType === 'MOBILE' ? selectedClientAddressId : null,
    })

    if (!isFreshDaySlotCacheEntry(daySlotCacheRef.current[cacheKey])) {
      daySlotCacheRef.current[cacheKey] = {
        slots: summary.firstDaySlots.slice(),
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

      if (Object.keys(nextCachedOtherSlots).length > 0) {
        setOtherSlots(nextCachedOtherSlots)
      } else {
        setOtherSlots({})
      }

      if (prosToFetch.length === 0) {
        setLoadingOtherSlots(false)
        return
      }

      const requestId = otherSlotsRequestIdRef.current + 1
      otherSlotsRequestIdRef.current = requestId
      setLoadingOtherSlots(true)

      try {
        const otherResults = await Promise.all(
          prosToFetch.map(async (pro) => {
            const slots = await fetchDaySlotsRef.current({
              proId: pro.id,
              ymd: selectedDayYMD,
              locationType: activeLocationType,
              locationId: pro.locationId,
              isPrimary: false,
              forceRefresh: options?.forceRefresh,
            })

            return { id: pro.id, slots }
          }),
        )

        if (otherSlotsRequestIdRef.current !== requestId) return

        const nextOtherSlots: Record<string, string[]> = {
          ...nextCachedOtherSlots,
        }

        for (const { id, slots } of otherResults) {
          nextOtherSlots[id] = slots
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
      setPrimarySlots([])
      setLoadingPrimarySlots(false)
      previousRetryKeyRef.current = retryKey
      return
    }

    pruneExpiredDaySlotCache(daySlotCacheRef.current)

    const currentDayYMD = selectedDayYMD
    const currentPrimaryId = primaryId
    const currentPrimaryLocationId = primaryLocationId
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

    if (cachedPrimarySlots) {
      if (!holding) {
        setError(null)
      }
      setPrimarySlots(cachedPrimarySlots)
      setLoadingPrimarySlots(false)
      return
    }

    let cancelled = false

    async function loadPrimarySlotsForSelectedDay() {
      try {
        if (!holding) {
          setError(null)
        }

        setLoadingPrimarySlots(true)

        const primaryDaySlots = await fetchDaySlotsRef.current({
          proId: currentPrimaryId,
          ymd: currentDayYMD,
          locationType: activeLocationType,
          locationId: currentPrimaryLocationId,
          isPrimary: true,
          forceRefresh,
        })

        if (cancelled) return

        setPrimarySlots(primaryDaySlots)
      } catch {
        if (cancelled) return
        setPrimarySlots([])
        setError('Network error loading times.')
      } finally {
        if (!cancelled) {
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

    const nextDays = availableDays.slice(selectedIdx + 1, selectedIdx + 3)
    if (!nextDays.length) return

    const proId = primaryId
    const locationId = primaryLocationId

    for (const day of nextDays) {
      void fetchDaySlotsRef
        .current({
          proId,
          ymd: day.date,
          locationType: activeLocationType,
          locationId,
          isPrimary: false,
        })
        .catch(() => {})
    }
  }, [
    open,
    primaryId,
    primaryLocationId,
    selectedDayYMD,
    activeLocationType,
    effectiveServiceId,
    summary,
  ])

  return {
    primarySlots,
    otherSlots,
    loadingPrimarySlots,
    loadingOtherSlots,
    clearDaySlots,
    clearDaySlotCache,
    fetchDaySlots,
    loadOtherSlots,
  }
}