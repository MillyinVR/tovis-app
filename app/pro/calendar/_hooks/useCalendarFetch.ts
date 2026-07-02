// app/pro/calendar/_hooks/useCalendarFetch.ts
'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import type {
  CalendarEvent,
  CalendarRangeMeta,
  CalendarStats,
  ManagementLists,
  ViewMode,
  WorkingHoursJson,
} from '../_types'

import {
  apiMessage,
  parseCalendarResponse,
  parseWorkingHoursJson,
  type LocationType,
  type ProLocation,
} from '../_utils/parsers'

import { rangeForViewUtcInTimeZone } from '../_utils/calendarRange'

import {
  DEFAULT_TIME_ZONE,
  isValidIanaTimeZone,
  sanitizeTimeZone,
} from '@/lib/timeZone'

import { toIso } from '../_utils/date'
import { isRecord } from '@/lib/guards'
import { pickBool, pickString } from '@/lib/pick'
import { isAbortError, safeJson } from '@/lib/http'

type CalendarFetchDeps = {
  view: ViewMode
  currentDate: Date
  activeLocationId: string | null
  setActiveLocationId: (id: string | null) => void
  locationsLoaded: boolean
  activeLocation: ProLocation | null
  activeLocationType: LocationType
  setCanSalon: (value: boolean) => void
  setCanMobile: (value: boolean) => void
  resolveActiveCalendarTimeZone: (fallback?: string) => string
}

type CalendarFetchResult = {
  response: Response
  data: unknown
}

function emptyManagementLists(): ManagementLists {
  return {
    todaysBookings: [],
    pendingRequests: [],
    waitlistToday: [],
    blockedToday: [],
  }
}

function workingHoursEndpoint(locationType: LocationType): string {
  const params = new URLSearchParams({ locationType })

  return `/api/v1/pro/working-hours?${params.toString()}`
}

function calendarEndpoint(args: {
  from: Date
  to: Date
  locationId: string | null
}): string {
  const params = new URLSearchParams({
    from: toIso(args.from),
    to: toIso(args.to),
  })

  if (args.locationId) {
    params.set('locationId', args.locationId)
  }

  return `/api/v1/pro/calendar?${params.toString()}`
}

function eventStartMs(event: CalendarEvent): number {
  const ms = new Date(event.startsAt).getTime()

  return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER
}

function sortEventsByStart(events: CalendarEvent[]): CalendarEvent[] {
  return [...events].sort((first, second) => {
    return eventStartMs(first) - eventStartMs(second)
  })
}

function pickValidTimeZone(value: unknown): string | null {
  const rawTimeZone = pickString(value)

  if (rawTimeZone && isValidIanaTimeZone(rawTimeZone)) {
    return sanitizeTimeZone(rawTimeZone, DEFAULT_TIME_ZONE)
  }

  return null
}

function parseApiViewportTimeZone(record: Record<string, unknown> | null): string {
  if (!record) return DEFAULT_TIME_ZONE

  return (
    pickValidTimeZone(record.viewportTimeZone) ??
    pickValidTimeZone(record.timeZone) ??
    DEFAULT_TIME_ZONE
  )
}

function validApiViewportTimeZoneWasReturned(
  record: Record<string, unknown> | null,
): boolean {
  if (!record) return false

  return Boolean(
    pickValidTimeZone(record.viewportTimeZone) ??
      pickValidTimeZone(record.timeZone),
  )
}

function shouldRefetchForApiTimeZone(args: {
  apiTimeZone: string
  apiTimeZoneWasValid: boolean
  guessedTimeZone: string
}): boolean {
  if (!args.apiTimeZoneWasValid) return false

  return (
    args.apiTimeZone !==
    sanitizeTimeZone(args.guessedTimeZone, DEFAULT_TIME_ZONE)
  )
}

export function useCalendarFetch(deps: CalendarFetchDeps) {
  const {
    view,
    currentDate,
    activeLocationId,
    setActiveLocationId,
    locationsLoaded,
    activeLocation,
    activeLocationType,
    setCanSalon,
    setCanMobile,
    resolveActiveCalendarTimeZone,
  } = deps

  const [events, setEvents] = useState<CalendarEvent[]>([])
  const eventsRef = useRef<CalendarEvent[]>([])

  const [range, setRange] = useState<CalendarRangeMeta | null>(null)

  const [timeZone, setTimeZone] = useState(DEFAULT_TIME_ZONE)
  const timeZoneRef = useRef(timeZone)

  const [needsTimeZoneSetup, setNeedsTimeZoneSetup] = useState(false)
  const [stats, setStats] = useState<CalendarStats>(null)
  const [blockedMinutesToday, setBlockedMinutesToday] = useState(0)

  // The authed pro's own id, surfaced so the waitlist "Offer a time" modal can
  // query availability (GET /api/v1/availability/day) for a proposed slot.
  const [professionalId, setProfessionalId] = useState<string | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [autoAccept, setAutoAccept] = useState(false)
  const [savingAutoAccept, setSavingAutoAccept] = useState(false)

  const [workingHoursSalon, setWorkingHoursSalon] =
    useState<WorkingHoursJson>(null)
  const [workingHoursMobile, setWorkingHoursMobile] =
    useState<WorkingHoursJson>(null)

  const [management, setManagement] = useState<ManagementLists>(
    emptyManagementLists,
  )

  const loadSequenceRef = useRef(0)
  const abortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    eventsRef.current = events
  }, [events])

  useEffect(() => {
    timeZoneRef.current = timeZone
  }, [timeZone])

  const workingHoursActive = useMemo(() => {
    if (activeLocation?.workingHours) return activeLocation.workingHours

    return activeLocationType === 'MOBILE'
      ? workingHoursMobile
      : workingHoursSalon
  }, [
    activeLocation?.workingHours,
    activeLocationType,
    workingHoursMobile,
    workingHoursSalon,
  ])

  const loadWorkingHoursFor = useCallback(
    async (
      locationType: LocationType,
      signal: AbortSignal,
    ): Promise<WorkingHoursJson> => {
      const response = await fetch(workingHoursEndpoint(locationType), {
        method: 'GET',
        cache: 'no-store',
        signal,
      })

      const data: unknown = await safeJson(response)

      if (!response.ok) {
        throw new Error(
          apiMessage(data, `Failed to load ${locationType} hours.`),
        )
      }

      if (!isRecord(data)) return null

      return parseWorkingHoursJson(data.workingHours)
    },
    [],
  )

  const toggleAutoAccept = useCallback(
    async (next: boolean) => {
      if (savingAutoAccept) return

      const previous = autoAccept

      setAutoAccept(next)
      setSavingAutoAccept(true)

      try {
        const response = await fetch('/api/v1/pro/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ autoAcceptBookings: next }),
        })

        const data: unknown = await safeJson(response)

        if (!response.ok) {
          throw new Error(apiMessage(data, 'Failed to save.'))
        }

        if (isRecord(data) && isRecord(data.professionalProfile)) {
          const savedValue = pickBool(
            data.professionalProfile.autoAcceptBookings,
          )

          if (savedValue !== null) {
            setAutoAccept(savedValue)
          }
        }
      } catch {
        setAutoAccept(previous)
        setError('Failed to save auto-accept setting.')
      } finally {
        setSavingAutoAccept(false)
      }
    },
    [autoAccept, savingAutoAccept],
  )

  const loadCalendar = useCallback(async () => {
    const sequence = loadSequenceRef.current + 1
    loadSequenceRef.current = sequence

    abortControllerRef.current?.abort()

    const controller = new AbortController()
    abortControllerRef.current = controller

    const requestedLocationId = activeLocationId?.trim() || null

    async function fetchCalendarFor(
      timeZoneForRange: string,
    ): Promise<CalendarFetchResult> {
      const safeTimeZone = sanitizeTimeZone(
        timeZoneForRange,
        DEFAULT_TIME_ZONE,
      )

      const { from, to } = rangeForViewUtcInTimeZone(
        view,
        currentDate,
        safeTimeZone,
      )

      const response = await fetch(
        calendarEndpoint({
          from,
          to,
          locationId: requestedLocationId,
        }),
        {
          cache: 'no-store',
          signal: controller.signal,
        },
      )

      const data: unknown = await safeJson(response)

      return {
        response,
        data,
      }
    }

    try {
      setLoading(true)
      setError(null)

      const guessedTimeZone = resolveActiveCalendarTimeZone()
      let calendarResult = await fetchCalendarFor(guessedTimeZone)

      if (
        sequence !== loadSequenceRef.current ||
        controller.signal.aborted
      ) {
        return
      }

      if (!calendarResult.response.ok) {
        setError(
          apiMessage(
            calendarResult.data,
            `Failed to load calendar (${calendarResult.response.status}).`,
          ),
        )
        return
      }

      const firstRecord = isRecord(calendarResult.data)
        ? calendarResult.data
        : null

      const firstApiTimeZone = parseApiViewportTimeZone(firstRecord)
      const firstApiTimeZoneWasValid =
        validApiViewportTimeZoneWasReturned(firstRecord)

      if (
        shouldRefetchForApiTimeZone({
          apiTimeZone: firstApiTimeZone,
          apiTimeZoneWasValid: firstApiTimeZoneWasValid,
          guessedTimeZone,
        })
      ) {
        const refetchedResult = await fetchCalendarFor(firstApiTimeZone)

        if (
          sequence !== loadSequenceRef.current ||
          controller.signal.aborted
        ) {
          return
        }

        if (refetchedResult.response.ok) {
          calendarResult = refetchedResult
        }
      }

      const parsedCalendar = parseCalendarResponse(calendarResult.data)

      if (!parsedCalendar) {
        setError('Calendar response was invalid.')
        return
      }

      if (
        parsedCalendar.location?.id &&
        parsedCalendar.location.id !== activeLocationId
      ) {
        setActiveLocationId(parsedCalendar.location.id)
      }

      // Render the grid immediately from the calendar response. Working hours
      // feed booking create/edit only — not the event grid — so blocking the
      // grid on the two working-hours fetches just added an extra round trip to
      // every load. Apply calendar state and clear the loading state now, then
      // fetch working hours in the background below.
      setRange(parsedCalendar.range)
      setTimeZone(parsedCalendar.viewportTimeZone)
      setNeedsTimeZoneSetup(parsedCalendar.needsTimeZoneSetup)
      setCanSalon(parsedCalendar.canSalon)
      setCanMobile(parsedCalendar.canMobile)
      setProfessionalId(parsedCalendar.professionalId ?? null)
      setStats(parsedCalendar.stats)
      setBlockedMinutesToday(parsedCalendar.blockedMinutesToday)
      setAutoAccept(parsedCalendar.autoAcceptBookings)
      setManagement(parsedCalendar.management)
      setEvents(sortEventsByStart(parsedCalendar.events))
      setLoading(false)

      // Background, non-blocking: only fetch the hours for capabilities the pro
      // actually has, and never let a working-hours failure surface as a
      // calendar error — the grid is already on screen.
      try {
        const [nextSalonHours, nextMobileHours] = await Promise.all([
          parsedCalendar.canSalon
            ? loadWorkingHoursFor('SALON', controller.signal)
            : Promise.resolve<WorkingHoursJson>(null),
          parsedCalendar.canMobile
            ? loadWorkingHoursFor('MOBILE', controller.signal)
            : Promise.resolve<WorkingHoursJson>(null),
        ])

        if (
          sequence !== loadSequenceRef.current ||
          controller.signal.aborted
        ) {
          return
        }

        setWorkingHoursSalon(nextSalonHours)
        setWorkingHoursMobile(nextMobileHours)
      } catch (workingHoursError) {
        if (isAbortError(workingHoursError)) return
        // Non-fatal: the calendar is already displayed; leave hours unset.
      }
    } catch (caught) {
      if (isAbortError(caught)) return

      if (sequence === loadSequenceRef.current) {
        setError('Network error loading calendar.')
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null
      }

      if (
        sequence === loadSequenceRef.current &&
        !controller.signal.aborted
      ) {
        setLoading(false)
      }
    }
  }, [
    activeLocationId,
    currentDate,
    loadWorkingHoursFor,
    resolveActiveCalendarTimeZone,
    setActiveLocationId,
    setCanMobile,
    setCanSalon,
    view,
  ])

  useEffect(() => {
    if (!locationsLoaded && activeLocationId === null) return

    void loadCalendar()

    return () => {
      abortControllerRef.current?.abort()
    }
  }, [activeLocationId, locationsLoaded, loadCalendar])

  const reload = useCallback(() => {
    void loadCalendar()
  }, [loadCalendar])

  return {
    events,
    setEvents,
    eventsRef,

    range,

    timeZone,
    timeZoneRef,
    needsTimeZoneSetup,
    blockedMinutesToday,

    stats,
    professionalId,
    loading,
    setLoading,
    error,
    setError,

    autoAccept,
    savingAutoAccept,
    toggleAutoAccept,

    workingHoursSalon,
    setWorkingHoursSalon,
    workingHoursMobile,
    setWorkingHoursMobile,
    workingHoursActive,

    management,
    setManagement,

    loadCalendar,
    reload,
  }
}

export type CalendarFetchState = ReturnType<typeof useCalendarFetch>