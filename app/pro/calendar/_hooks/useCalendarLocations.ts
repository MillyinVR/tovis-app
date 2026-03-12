// app/pro/calendar/_hooks/useCalendarLocations.ts
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { normalizeStepMinutes } from '../_utils/calendarMath'
import {
  upper,
  pickLocationType,
  locationTypeFromProfessionalType,
  parseProLocation,
  type LocationType,
  type ProLocation,
} from '../_utils/parsers'
import { isRecord } from '@/lib/guards'
import { safeJson } from '@/lib/http'

export function useCalendarLocations() {
  const [locations, setLocations] = useState<ProLocation[]>([])
  const [locationsLoaded, setLocationsLoaded] = useState(false)

  // User-selected location id. The actual active location is derived from this
  // plus the currently loaded set of bookable locations.
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null)

  // These stay mutable because other calendar flows may override capability flags.
  const [canSalon, setCanSalon] = useState(true)
  const [canMobile, setCanMobile] = useState(false)

  // Manual fallback used only when there is no active location selected/resolved.
  const [manualHoursEditorLocationType, setManualHoursEditorLocationType] =
    useState<LocationType>('SALON')

  const loadedRef = useRef(false)

  const scopedLocations = useMemo(
    () => locations.filter((location) => location.isBookable),
    [locations],
  )

  const primaryBookableLocation = useMemo(() => {
    return (
      scopedLocations.find((location) => location.isPrimary) ??
      scopedLocations[0] ??
      null
    )
  }, [scopedLocations])

  const activeLocationId = useMemo(() => {
    if (
      selectedLocationId &&
      scopedLocations.some((location) => location.id === selectedLocationId)
    ) {
      return selectedLocationId
    }

    return primaryBookableLocation?.id ?? null
  }, [selectedLocationId, scopedLocations, primaryBookableLocation])

  const activeLocation = useMemo(() => {
    if (!activeLocationId) return null
    return locations.find((location) => location.id === activeLocationId) ?? null
  }, [locations, activeLocationId])

  const activeLocationType = useMemo<LocationType>(() => {
    if (activeLocation) {
      return locationTypeFromProfessionalType(activeLocation.type)
    }

    return pickLocationType(canSalon, canMobile, manualHoursEditorLocationType)
  }, [activeLocation, canSalon, canMobile, manualHoursEditorLocationType])

  const hoursEditorLocationType = useMemo<LocationType>(() => {
    if (activeLocation) {
      return locationTypeFromProfessionalType(activeLocation.type)
    }

    return manualHoursEditorLocationType
  }, [activeLocation, manualHoursEditorLocationType])

  const activeLocationLabel = useMemo(() => {
    if (!activeLocation) return null

    const base =
      activeLocation.name ||
      (upper(activeLocation.type) === 'MOBILE_BASE'
        ? 'Mobile base'
        : upper(activeLocation.type) === 'SUITE'
          ? 'Suite'
          : 'Salon')

    const addr = activeLocation.formattedAddress
      ? ` — ${activeLocation.formattedAddress}`
      : ''

    return `${base}${addr}`
  }, [activeLocation])

  const activeStepMinutes = useMemo(
    () => normalizeStepMinutes(activeLocation?.stepMinutes),
    [activeLocation?.stepMinutes],
  )

  const resolveLocationById = useCallback(
    (locationId: string | null) => {
      if (!locationId) return null
      return locations.find((entry) => entry.id === locationId) ?? null
    },
    [locations],
  )

  const resolveLocationStepMinutes = useCallback(
    (locationId: string | null, fallback?: number | null) => {
      const location = resolveLocationById(locationId)
      return normalizeStepMinutes(location?.stepMinutes ?? fallback ?? null)
    },
    [resolveLocationById],
  )

  const resolveLocationTypeFromId = useCallback(
    (locationId: string | null, fallback: LocationType): LocationType => {
      const location = resolveLocationById(locationId)
      return location ? locationTypeFromProfessionalType(location.type) : fallback
    },
    [resolveLocationById],
  )

  const loadLocationsOnce = useCallback(async () => {
    if (loadedRef.current) return
    loadedRef.current = true

    try {
      const res = await fetch('/api/pro/locations', { cache: 'no-store' })
      const data: unknown = await safeJson(res)

      if (!res.ok || !isRecord(data) || !Array.isArray(data.locations)) {
        setLocations([])
        setLocationsLoaded(true)
        return
      }

      const parsed = data.locations
        .map(parseProLocation)
        .filter((location): location is ProLocation => Boolean(location))

      const bookable = parsed.filter((location) => location.isBookable)

      const nextCanSalon = bookable.some(
        (location) =>
          upper(location.type) === 'SALON' || upper(location.type) === 'SUITE',
      )

      const nextCanMobile = bookable.some(
        (location) => upper(location.type) === 'MOBILE_BASE',
      )

      setLocations(parsed)
      setCanSalon(nextCanSalon)
      setCanMobile(nextCanMobile)

      if (!bookable.length) {
        setSelectedLocationId(null)
        setManualHoursEditorLocationType(
          pickLocationType(nextCanSalon, nextCanMobile, manualHoursEditorLocationType),
        )
      }

      setLocationsLoaded(true)
    } catch {
      setLocations([])
      setLocationsLoaded(true)
    }
  }, [manualHoursEditorLocationType])

  useEffect(() => {
    let cancelled = false

    void Promise.resolve().then(async () => {
      if (cancelled) return
      await loadLocationsOnce()
    })

    return () => {
      cancelled = true
    }
  }, [loadLocationsOnce])

  const setActiveLocationId = useCallback((locationId: string | null) => {
    setSelectedLocationId(locationId)
  }, [])

  const setHoursEditorLocationType = useCallback((value: LocationType) => {
    setManualHoursEditorLocationType(value)
  }, [])

  return {
    locations,
    locationsLoaded,
    scopedLocations,
    activeLocationId,
    setActiveLocationId,
    activeLocation,
    activeLocationLabel,
    activeLocationType,
    activeStepMinutes,

    canSalon,
    setCanSalon,
    canMobile,
    setCanMobile,

    hoursEditorLocationType,
    setHoursEditorLocationType,

    resolveLocationById,
    resolveLocationStepMinutes,
    resolveLocationTypeFromId,
  }
}

export type CalendarLocationsState = ReturnType<typeof useCalendarLocations>