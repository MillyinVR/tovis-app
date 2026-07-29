// app/pro/calendar/_hooks/useCalendarLocations.ts
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import { normalizeStepMinutes } from '../_utils/calendarMath'
import {
  locationFullLabel,
  locationShortLabel,
} from '../_utils/locationLabels'
import {
  locationTypeFromProfessionalType,
  parseProLocation,
  pickLocationType,
  upper,
  type LocationType,
  type ProLocation,
} from '../_utils/parsers'

import { isRecord } from '@/lib/guards'
import { isAbortError, safeJson } from '@/lib/http'

type LocationCapabilitySummary = {
  canSalon: boolean
  canMobile: boolean
}

const LOCATION_TYPE_FALLBACK_LABEL = 'Location'

function isProLocation(value: ProLocation | null): value is ProLocation {
  return value !== null
}

function labelForLocation(location: ProLocation) {
  return locationFullLabel({
    location,
    fallbackLabel: LOCATION_TYPE_FALLBACK_LABEL,
  })
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
  const response = await fetch('/api/v1/pro/locations', {
    cache: 'no-store',
    signal,
  })

  const data: unknown = await safeJson(response)

  if (!response.ok || !isRecord(data) || !Array.isArray(data.locations)) {
    return []
  }

  return data.locations.map(parseProLocation).filter(isProLocation)
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

  /**
   * The location the calendar is FILTERED to, or null for "all locations".
   *
   * 🔴 null no longer falls back to the primary location (K3). All-locations is
   * a real selection — the one that matches what the DB's overlap constraint
   * enforces — and resolving it back to a single location here is what made the
   * calendar hide occupancy in the first place.
   */
  const activeLocationId = useMemo(() => {
    if (
      selectedLocationIsBookable({
        selectedLocationId,
        bookableLocations: scopedLocations,
      })
    ) {
      return selectedLocationId
    }

    return null
  }, [scopedLocations, selectedLocationId])

  const activeLocation = useMemo(() => {
    if (!activeLocationId) return null

    return (
      locations.find((location) => location.id === activeLocationId) ?? null
    )
  }, [activeLocationId, locations])

  const isAllLocations = activeLocationId === null

  /**
   * The location that stands in for "the calendar" when nothing is filtered:
   * the primary bookable one. Timezone, step and the hours-editor mode read
   * from it so all-locations keeps the defaults the pro had before, and so the
   * client's guessed viewport zone matches the anchor the server answers with
   * (a mismatch costs an extra round trip on every load — see useCalendarFetch).
   * It is NEVER a filter; only `activeLocationId` is.
   */
  const anchorLocation = useMemo(
    () => activeLocation ?? primaryBookableLocation,
    [activeLocation, primaryBookableLocation],
  )

  const activeLocationType = useMemo<LocationType>(() => {
    if (anchorLocation) {
      return locationTypeFromProfessionalType(anchorLocation.type)
    }

    return pickLocationType(canSalon, canMobile, manualHoursEditorLocationType)
  }, [anchorLocation, canMobile, canSalon, manualHoursEditorLocationType])

  const hoursEditorLocationType = useMemo<LocationType>(() => {
    if (anchorLocation) {
      return locationTypeFromProfessionalType(anchorLocation.type)
    }

    return manualHoursEditorLocationType
  }, [anchorLocation, manualHoursEditorLocationType])

  const activeLocationLabel = useMemo(() => {
    return activeLocation ? labelForLocation(activeLocation) : null
  }, [activeLocation])

  const anchorLocationLabel = useMemo(() => {
    return anchorLocation ? labelForLocation(anchorLocation) : null
  }, [anchorLocation])

  const activeStepMinutes = useMemo(
    () => normalizeStepMinutes(anchorLocation?.stepMinutes),
    [anchorLocation?.stepMinutes],
  )

  /**
   * Short label per location id for the chip on an event card — populated ONLY
   * while the grid mixes locations, so a single-location pro's cards stay
   * exactly as they were and a filtered view doesn't repeat the filter on every
   * card. An empty map is the signal "don't render location chips".
   */
  const eventLocationLabels = useMemo<Record<string, string>>(() => {
    if (!isAllLocations || scopedLocations.length < 2) return {}

    const labels: Record<string, string> = {}

    for (const location of scopedLocations) {
      labels[location.id] = locationShortLabel({
        location,
        fallbackLabel: LOCATION_TYPE_FALLBACK_LABEL,
      })
    }

    return labels
  }, [isAllLocations, scopedLocations])

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
    isAllLocations,
    anchorLocation,
    anchorLocationLabel,
    eventLocationLabels,

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