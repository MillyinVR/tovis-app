// app/pro/calendar/_hooks/useCalendarLocations.ts
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import { normalizeStepMinutes } from '../_utils/calendarMath'
import {
  locationTypeFromProfessionalType,
  parseProLocation,
  pickLocationType,
  upper,
  type LocationType,
  type ProLocation,
} from '../_utils/parsers'

import { isRecord } from '@/lib/guards'
import { safeJson } from '@/lib/http'

type LocationCapabilitySummary = {
  canSalon: boolean
  canMobile: boolean
}

const LOCATION_TYPE_LABELS: Record<string, string> = {
  MOBILE_BASE: 'Mobile base',
  SUITE: 'Suite',
  SALON: 'Salon',
}

function normalizeText(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : ''
}

function isProLocation(value: ProLocation | null): value is ProLocation {
  return value !== null
}

function labelForLocationType(type: string | null | undefined) {
  const normalizedType = upper(type)
  return LOCATION_TYPE_LABELS[normalizedType] ?? 'Location'
}

function labelForLocation(location: ProLocation) {
  const name = normalizeText(location.name)
  const address = normalizeText(location.formattedAddress)
  const base = name || labelForLocationType(location.type)

  return address ? `${base} — ${address}` : base
}

function summarizeCapabilities(bookableLocations: ProLocation[]): LocationCapabilitySummary {
  let canSalon = false
  let canMobile = false

  for (const location of bookableLocations) {
    const type = upper(location.type)

    if (type === 'SALON' || type === 'SUITE') {
      canSalon = true
    }

    if (type === 'MOBILE_BASE') {
      canMobile = true
    }
  }

  return {
    canSalon,
    canMobile,
  }
}

function firstPrimaryBookableLocation(locations: ProLocation[]) {
  return (
    locations.find((location) => location.isPrimary) ??
    locations[0] ??
    null
  )
}

function selectedLocationIsBookable(args: {
  selectedLocationId: string | null
  bookableLocations: ProLocation[]
}) {
  const { selectedLocationId, bookableLocations } = args

  if (!selectedLocationId) return false

  return bookableLocations.some(
    (location) => location.id === selectedLocationId,
  )
}

async function fetchLocations(signal: AbortSignal): Promise<ProLocation[]> {
  const response = await fetch('/api/pro/locations', {
    cache: 'no-store',
    signal,
  })

  const data: unknown = await safeJson(response)

  if (!response.ok || !isRecord(data) || !Array.isArray(data.locations)) {
    return []
  }

  return data.locations.map(parseProLocation).filter(isProLocation)
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError'
}

export function useCalendarLocations() {
  const [locations, setLocations] = useState<ProLocation[]>([])
  const [locationsLoaded, setLocationsLoaded] = useState(false)
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(
    null,
  )

  /**
   * These stay mutable because the calendar API may also report capability flags.
   * Location fetch gives the first local guess; useCalendarFetch may refine it.
   */
  const [canSalon, setCanSalon] = useState(true)
  const [canMobile, setCanMobile] = useState(false)

  /**
   * Fallback editor type when there is no resolved active location.
   */
  const [manualHoursEditorLocationType, setManualHoursEditorLocationType] =
    useState<LocationType>('SALON')

  const scopedLocations = useMemo(
    () => locations.filter((location) => location.isBookable),
    [locations],
  )

  const primaryBookableLocation = useMemo(
    () => firstPrimaryBookableLocation(scopedLocations),
    [scopedLocations],
  )

  const activeLocationId = useMemo(() => {
    if (
      selectedLocationIsBookable({
        selectedLocationId,
        bookableLocations: scopedLocations,
      })
    ) {
      return selectedLocationId
    }

    return primaryBookableLocation?.id ?? null
  }, [primaryBookableLocation?.id, scopedLocations, selectedLocationId])

  const activeLocation = useMemo(() => {
    if (!activeLocationId) return null

    return (
      locations.find((location) => location.id === activeLocationId) ?? null
    )
  }, [activeLocationId, locations])

  const activeLocationType = useMemo<LocationType>(() => {
    if (activeLocation) {
      return locationTypeFromProfessionalType(activeLocation.type)
    }

    return pickLocationType(canSalon, canMobile, manualHoursEditorLocationType)
  }, [activeLocation, canMobile, canSalon, manualHoursEditorLocationType])

  const hoursEditorLocationType = useMemo<LocationType>(() => {
    if (activeLocation) {
      return locationTypeFromProfessionalType(activeLocation.type)
    }

    return manualHoursEditorLocationType
  }, [activeLocation, manualHoursEditorLocationType])

  const activeLocationLabel = useMemo(() => {
    return activeLocation ? labelForLocation(activeLocation) : null
  }, [activeLocation])

  const activeStepMinutes = useMemo(
    () => normalizeStepMinutes(activeLocation?.stepMinutes),
    [activeLocation?.stepMinutes],
  )

  const resolveLocationById = useCallback(
    (locationId: string | null) => {
      if (!locationId) return null

      return locations.find((location) => location.id === locationId) ?? null
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

      return location
        ? locationTypeFromProfessionalType(location.type)
        : fallback
    },
    [resolveLocationById],
  )

  const setActiveLocationId = useCallback((locationId: string | null) => {
    setSelectedLocationId(locationId)
  }, [])

  const setHoursEditorLocationType = useCallback((value: LocationType) => {
    setManualHoursEditorLocationType(value)
  }, [])

  useEffect(() => {
    const controller = new AbortController()

    async function loadLocations() {
      setLocationsLoaded(false)

      try {
        const parsedLocations = await fetchLocations(controller.signal)

        if (controller.signal.aborted) return

        const bookableLocations = parsedLocations.filter(
          (location) => location.isBookable,
        )

        const capabilities = summarizeCapabilities(bookableLocations)

        setLocations(parsedLocations)
        setCanSalon(capabilities.canSalon)
        setCanMobile(capabilities.canMobile)

        if (bookableLocations.length === 0) {
          setSelectedLocationId(null)
          setManualHoursEditorLocationType((previous) =>
            pickLocationType(
              capabilities.canSalon,
              capabilities.canMobile,
              previous,
            ),
          )
        }

        setLocationsLoaded(true)
      } catch (caught) {
        if (isAbortError(caught) || controller.signal.aborted) return

        setLocations([])
        setSelectedLocationId(null)
        setLocationsLoaded(true)
      }
    }

    void loadLocations()

    return () => controller.abort()
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