// app/(main)/booking/AvailabilityDrawer/hooks/useDaySlots.ts
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type {
  AvailabilitySummaryResponse,
  ServiceLocationType,
} from '../types'

import { safeJson } from '../utils/safeJson'

const DAY_SLOT_CACHE_TTL_MS = 30_000

type DaySlotCacheEntry = {
  slots: string[]
  cachedAt: number
}

type DaySlotsSummary = Extract<
  AvailabilitySummaryResponse,
  { ok: true; mode: 'SUMMARY' }
>

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

export function useDaySlots(args: {
  open: boolean
  summary: DaySlotsSummary | null
  selectedDayYMD: string | null
  activeLocationType: ServiceLocationType
  effectiveServiceId: string | null
  selectedClientAddressId: string | null
  debug: boolean
  holding: boolean
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
    setError,
  } = args

  const [primarySlots, setPrimarySlots] = useState<string[]>([])
  const [otherSlots, setOtherSlots] = useState<Record<string, string[]>>({})
  const [loadingPrimarySlots, setLoadingPrimarySlots] = useState(false)
  const [loadingOtherSlots, setLoadingOtherSlots] = useState(false)

  const daySlotCacheRef = useRef<Record<string, DaySlotCacheEntry>>({})

  const others = useMemo(() => summary?.otherPros ?? [], [summary])

  const clearDaySlots = useCallback(() => {
    setPrimarySlots([])
    setOtherSlots({})
    setLoadingPrimarySlots(false)
    setLoadingOtherSlots(false)
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
        const cached = daySlotCacheRef.current[cacheKey]
        if (isFreshDaySlotCacheEntry(cached)) {
          return cached.slots.slice()
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
        cache: 'no-store',
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

  useEffect(() => {
    if (!open || !summary || !selectedDayYMD) return

    const currentDayYMD = selectedDayYMD
    const primaryId = summary.primaryPro.id
    const primaryLocationId = summary.locationId
    const currentOthers = summary.otherPros

    let cancelled = false

    async function loadSlotsForSelectedDay() {
      try {
        if (!holding) {
          setError(null)
        }

        setLoadingPrimarySlots(true)
        setLoadingOtherSlots(true)
        setOtherSlots({})

        const primaryDaySlots = await fetchDaySlots({
          proId: primaryId,
          ymd: currentDayYMD,
          locationType: activeLocationType,
          locationId: primaryLocationId,
          isPrimary: true,
        })

        if (cancelled) return

        setPrimarySlots(primaryDaySlots)
        setLoadingPrimarySlots(false)

        const otherResults = await Promise.all(
          currentOthers.map(async (pro) => {
            const slots = await fetchDaySlots({
              proId: pro.id,
              ymd: currentDayYMD,
              locationType: activeLocationType,
              locationId: pro.locationId,
              isPrimary: false,
            })
            return { id: pro.id, slots }
          }),
        )

        if (cancelled) return

        const nextOtherSlots: Record<string, string[]> = {}
        for (const { id, slots } of otherResults) {
          nextOtherSlots[id] = slots
        }

        setOtherSlots(nextOtherSlots)
      } catch {
        if (cancelled) return

        setPrimarySlots([])
        setOtherSlots({})
        setError('Network error loading times.')
      } finally {
        if (!cancelled) {
          setLoadingPrimarySlots(false)
          setLoadingOtherSlots(false)
        }
      }
    }

    void loadSlotsForSelectedDay()

    return () => {
      cancelled = true
    }
  }, [
    open,
    summary,
    selectedDayYMD,
    activeLocationType,
    fetchDaySlots,
    holding,
    setError,
    others,
  ])

  return {
    primarySlots,
    otherSlots,
    loadingPrimarySlots,
    loadingOtherSlots,
    clearDaySlots,
    clearDaySlotCache,
    fetchDaySlots,
  }
}