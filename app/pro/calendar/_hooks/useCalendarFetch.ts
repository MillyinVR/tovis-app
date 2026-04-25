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
  CalendarStats,
  ManagementLists,
  ViewMode,
  WorkingHoursJson,
} from '../_types'

import { isBlockedEvent } from '../_utils/calendarMath'

import {
  apiMessage,
  parseWorkingHoursJson,
  parseCalendarRouteLocation,
  parseCalendarEvents,
  parseManagementLists,
  parseCalendarStats,
  type LocationType,
  type ProLocation,
} from '../_utils/parsers'

import { rangeForViewUtcInTimeZone } from '../_utils/calendarRange'

import {
  DEFAULT_TIME_ZONE,
  isValidIanaTimeZone,
  sanitizeTimeZone,
  startOfDayUtcInTimeZone,
} from '@/lib/timeZone'

import { toIso } from '../_utils/date'
import { isRecord } from '@/lib/guards'
import { pickBool, pickString } from '@/lib/pick'
import { safeJson } from '@/lib/http'

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

const DAY_MS = 24 * 60 * 60_000

function emptyManagementLists(): ManagementLists {
  return {
    todaysBookings: [],
    pendingRequests: [],
    waitlistToday: [],
    blockedToday: [],
  }
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError'
}

function workingHoursEndpoint(locationType: LocationType) {
  const params = new URLSearchParams({ locationType })
  return `/api/pro/working-hours?${params.toString()}`
}

function calendarEndpoint(args: {
  from: Date
  to: Date
  locationId: string | null
}) {
  const params = new URLSearchParams({
    from: toIso(args.from),
    to: toIso(args.to),
  })

  if (args.locationId) {
    params.set('locationId', args.locationId)
  }

  return `/api/pro/calendar?${params.toString()}`
}

function eventStartMs(event: CalendarEvent) {
  const ms = new Date(event.startsAt).getTime()
  return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER
}

function sortEventsByStart(events: CalendarEvent[]) {
  return [...events].sort((first, second) => {
    return eventStartMs(first) - eventStartMs(second)
  })
}

function parseApiTimeZone(record: Record<string, unknown> | null) {
  const rawTimeZone = record ? pickString(record.timeZone) : null

  if (rawTimeZone && isValidIanaTimeZone(rawTimeZone)) {
    return sanitizeTimeZone(rawTimeZone, DEFAULT_TIME_ZONE)
  }

  return DEFAULT_TIME_ZONE
}

function shouldRefetchForApiTimeZone(args: {
  apiTimeZone: string
  apiTimeZoneWasValid: boolean
  guessedTimeZone: string
}) {
  if (!args.apiTimeZoneWasValid) return false

  return (
    args.apiTimeZone !==
    sanitizeTimeZone(args.guessedTimeZone, DEFAULT_TIME_ZONE)
  )
}

function validApiTimeZoneWasReturned(record: Record<string, unknown> | null) {
  const rawTimeZone = record ? pickString(record.timeZone) : null
  return Boolean(rawTimeZone && isValidIanaTimeZone(rawTimeZone))
}

function blockedOverlapMinutesForToday(args: {
  events: CalendarEvent[]
  timeZone: string
}) {
  const timeZone = sanitizeTimeZone(args.timeZone, DEFAULT_TIME_ZONE)
  const dayStartUtc = startOfDayUtcInTimeZone(new Date(), timeZone)
  const dayStartMs = dayStartUtc.getTime()
  const dayEndMs = dayStartMs + DAY_MS

  let totalMinutes = 0

  for (const event of args.events) {
    if (!isBlockedEvent(event)) continue

    const startsAtMs = new Date(event.startsAt).getTime()
    const endsAtMs = new Date(event.endsAt).getTime()

    if (
      !Number.isFinite(startsAtMs) ||
      !Number.isFinite(endsAtMs) ||
      endsAtMs <= startsAtMs
    ) {
      continue
    }

    const overlapStartMs = Math.max(startsAtMs, dayStartMs)
    const overlapEndMs = Math.min(endsAtMs, dayEndMs)

    if (overlapEndMs > overlapStartMs) {
      totalMinutes += Math.round((overlapEndMs - overlapStartMs) / 60_000)
    }
  }

  return totalMinutes
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

  const [timeZone, setTimeZone] = useState(DEFAULT_TIME_ZONE)
  const timeZoneRef = useRef(timeZone)

  const [needsTimeZoneSetup, setNeedsTimeZoneSetup] = useState(false)
  const [stats, setStats] = useState<CalendarStats>(null)
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

  const blockedMinutesToday = useMemo(
    () =>
      blockedOverlapMinutesForToday({
        events,
        timeZone,
      }),
    [events, timeZone],
  )

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
        const response = await fetch('/api/pro/settings', {
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

      const firstApiTimeZone = parseApiTimeZone(firstRecord)
      const firstApiTimeZoneWasValid =
        validApiTimeZoneWasReturned(firstRecord)

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

      const record = isRecord(calendarResult.data)
        ? calendarResult.data
        : null

      const apiLocation = record
        ? parseCalendarRouteLocation(record.location)
        : null

      if (apiLocation?.id && apiLocation.id !== activeLocationId) {
        setActiveLocationId(apiLocation.id)
      }

      const finalTimeZone = parseApiTimeZone(record)
      const nextNeedsTimeZoneSetup =
        record ? pickBool(record.needsTimeZoneSetup) ?? false : false
      const nextCanSalon = record ? pickBool(record.canSalon) ?? true : true
      const nextCanMobile = record ? pickBool(record.canMobile) ?? false : false
      const nextStats = record ? parseCalendarStats(record.stats) : null
      const nextAutoAccept =
        record ? pickBool(record.autoAcceptBookings) ?? false : false
      const nextManagement = record
        ? parseManagementLists(record.management)
        : emptyManagementLists()
      const nextEvents = record ? parseCalendarEvents(record.events) : []

      const [nextSalonHours, nextMobileHours] = await Promise.all([
        loadWorkingHoursFor('SALON', controller.signal),
        loadWorkingHoursFor('MOBILE', controller.signal),
      ])

      if (
        sequence !== loadSequenceRef.current ||
        controller.signal.aborted
      ) {
        return
      }

      setTimeZone(finalTimeZone)
      setNeedsTimeZoneSetup(nextNeedsTimeZoneSetup)
      setCanSalon(nextCanSalon)
      setCanMobile(nextCanMobile)
      setStats(nextStats)
      setAutoAccept(nextAutoAccept)
      setManagement(nextManagement)
      setWorkingHoursSalon(nextSalonHours)
      setWorkingHoursMobile(nextMobileHours)
      setEvents(sortEventsByStart(nextEvents))
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

    timeZone,
    timeZoneRef,
    needsTimeZoneSetup,
    blockedMinutesToday,

    stats,
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