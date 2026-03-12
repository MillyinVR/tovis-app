// app/pro/calendar/_hooks/useCalendarLocations.ts
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CalendarEvent, WorkingHoursJson } from '../_types'
import { normalizeStepMinutes, computeDurationMinutesFromIso } from '../_utils/calendarMath'
import {
  upper,
  pickLocationType,
  locationTypeFromProfessionalType,
  locationTypeFromBookingValue,
  parseProLocation,
  type LocationType,
  type ProLocation,
} from '../_utils/parsers'
import {
  DEFAULT_TIME_ZONE,
  isValidIanaTimeZone,
  sanitizeTimeZone,
} from '@/lib/timeZone'
import { isRecord } from '@/lib/guards'
import { safeJson } from '@/lib/http'

export function useCalendarLocations() {
  const [locations, setLocations] = useState<ProLocation[]>([])
  const [locationsLoaded, setLocationsLoaded] = useState(false)
  const [activeLocationId, setActiveLocationId] = useState<string | null>(null)

  const [canSalon, setCanSalon] = useState(true)
  const [canMobile, setCanMobile] = useState(false)

  const [hoursEditorLocationType, setHoursEditorLocationType] =
    useState<LocationType>('SALON')

  const loadedRef = useRef(false)

  const scopedLocations = useMemo(
    () => locations.filter((location) => location.isBookable),
    [locations],
  )

  const activeLocation = useMemo(() => {
    if (!activeLocationId) return null
    return locations.find((location) => location.id === activeLocationId) ?? null
  }, [locations, activeLocationId])

  const activeLocationType = useMemo<LocationType>(() => {
    if (activeLocation) {
      return locationTypeFromProfessionalType(activeLocation.type)
    }
    return pickLocationType(canSalon, canMobile, hoursEditorLocationType)
  }, [activeLocation, canSalon, canMobile, hoursEditorLocationType])

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

  // ── Resolver helpers ──────────────────────────────────────────────

  function resolveLocationById(locationId: string | null) {
    if (!locationId) return null
    return locations.find((entry) => entry.id === locationId) ?? null
  }

  function resolveLocationStepMinutes(locationId: string | null, fallback?: number | null) {
    const location = resolveLocationById(locationId)
    return normalizeStepMinutes(location?.stepMinutes ?? fallback ?? null)
  }

  function resolveLocationTypeFromId(
    locationId: string | null,
    fallback: LocationType,
  ): LocationType {
    const location = resolveLocationById(locationId)
    return location ? locationTypeFromProfessionalType(location.type) : fallback
  }

  // ── Load locations once ───────────────────────────────────────────

  async function loadLocationsOnce() {
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

      setLocations(parsed)
      setLocationsLoaded(true)

      const bookable = parsed.filter((location) => location.isBookable)

      const nextCanSalon = bookable.some(
        (location) =>
          upper(location.type) === 'SALON' || upper(location.type) === 'SUITE',
      )
      const nextCanMobile = bookable.some(
        (location) => upper(location.type) === 'MOBILE_BASE',
      )

      setCanSalon(nextCanSalon)
      setCanMobile(nextCanMobile)

      setActiveLocationId((current) => {
        if (current && bookable.some((location) => location.id === current)) {
          return current
        }

        const primaryBookable =
          bookable.find((location) => location.isPrimary) ?? bookable[0] ?? null

        if (primaryBookable) {
          setHoursEditorLocationType(
            locationTypeFromProfessionalType(primaryBookable.type),
          )
          return primaryBookable.id
        }

        setHoursEditorLocationType(
          pickLocationType(nextCanSalon, nextCanMobile, hoursEditorLocationType),
        )
        return null
      })
    } catch {
      setLocations([])
      setLocationsLoaded(true)
    }
  }

  useEffect(() => {
    void loadLocationsOnce()
  }, [])

  // Auto-select primary bookable location when locations load
  useEffect(() => {
    if (!locationsLoaded) return
    if (activeLocationId && scopedLocations.some((location) => location.id === activeLocationId)) {
      return
    }

    const primaryBookable =
      scopedLocations.find((location) => location.isPrimary) ?? scopedLocations[0] ?? null

    setActiveLocationId(primaryBookable?.id ?? null)
  }, [locationsLoaded, scopedLocations, activeLocationId])

  // Sync hoursEditorLocationType when active location changes
  useEffect(() => {
    if (!activeLocation) return
    setHoursEditorLocationType(locationTypeFromProfessionalType(activeLocation.type))
  }, [activeLocation])

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
