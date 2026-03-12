// app/pro/calendar/_hooks/useCalendarFetch.ts
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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
import { safeJson, errorMessageFromUnknown } from '@/lib/http'

type CalendarFetchDeps = {
  view: ViewMode
  currentDate: Date
  activeLocationId: string | null
  setActiveLocationId: (id: string | null) => void
  locationsLoaded: boolean
  activeLocation: ProLocation | null
  activeLocationType: LocationType
  setCanSalon: (v: boolean) => void
  setCanMobile: (v: boolean) => void
  resolveActiveCalendarTimeZone: (fallback?: string) => string
}

export function useCalendarFetch(deps: CalendarFetchDeps) {
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const eventsRef = useRef<CalendarEvent[]>([])
  useEffect(() => {
    eventsRef.current = events
  }, [events])

  const [timeZone, setTimeZone] = useState<string>(DEFAULT_TIME_ZONE)
  const timeZoneRef = useRef(timeZone)
  useEffect(() => {
    timeZoneRef.current = timeZone
  }, [timeZone])

  const [needsTimeZoneSetup, setNeedsTimeZoneSetup] = useState(false)

  const [stats, setStats] = useState<CalendarStats>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [autoAccept, setAutoAccept] = useState(false)
  const [savingAutoAccept, setSavingAutoAccept] = useState(false)

  const [workingHoursSalon, setWorkingHoursSalon] = useState<WorkingHoursJson>(null)
  const [workingHoursMobile, setWorkingHoursMobile] = useState<WorkingHoursJson>(null)

  const [management, setManagement] = useState<ManagementLists>({
    todaysBookings: [],
    pendingRequests: [],
    waitlistToday: [],
    blockedToday: [],
  })

  const loadSeqRef = useRef(0)

  const workingHoursActive = useMemo(() => {
    if (deps.activeLocation?.workingHours) return deps.activeLocation.workingHours
    return deps.activeLocationType === 'MOBILE' ? workingHoursMobile : workingHoursSalon
  }, [deps.activeLocation, deps.activeLocationType, workingHoursSalon, workingHoursMobile])

  const blockedMinutesToday = useMemo(() => {
    const tz = sanitizeTimeZone(timeZone, DEFAULT_TIME_ZONE)
    const dayStartUtc = startOfDayUtcInTimeZone(new Date(), tz)
    const dayEndUtc = new Date(dayStartUtc.getTime() + 24 * 60 * 60_000)

    let sum = 0
    for (const ev of events) {
      if (!isBlockedEvent(ev)) continue

      const s = new Date(ev.startsAt).getTime()
      const e = new Date(ev.endsAt).getTime()
      if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue

      const overlapStart = Math.max(s, dayStartUtc.getTime())
      const overlapEnd = Math.min(e, dayEndUtc.getTime())
      if (overlapEnd > overlapStart) {
        sum += Math.round((overlapEnd - overlapStart) / 60_000)
      }
    }

    return sum
  }, [events, timeZone])

  // ── Working hours loader ──────────────────────────────────────────

  async function loadWorkingHoursFor(locationType: LocationType) {
    const res = await fetch(
      `/api/pro/working-hours?locationType=${encodeURIComponent(locationType)}`,
      {
        method: 'GET',
        cache: 'no-store',
      },
    )
    const data: unknown = await safeJson(res)

    if (!res.ok) {
      throw new Error(apiMessage(data, `Failed to load ${locationType} hours.`))
    }
    if (!isRecord(data)) return null

    return parseWorkingHoursJson(data.workingHours)
  }

  // ── Auto-accept toggle ────────────────────────────────────────────

  async function toggleAutoAccept(next: boolean) {
    setAutoAccept(next)
    setSavingAutoAccept(true)

    try {
      const res = await fetch('/api/pro/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoAcceptBookings: next }),
      })
      const data: unknown = await safeJson(res)

      if (!res.ok) {
        throw new Error(apiMessage(data, 'Failed to save.'))
      }

      if (isRecord(data) && isRecord(data.professionalProfile)) {
        const v = pickBool(data.professionalProfile.autoAcceptBookings)
        if (v !== null) setAutoAccept(v)
      }
    } catch (e: unknown) {
      console.error(e)
      setAutoAccept((prev) => !prev)
    } finally {
      setSavingAutoAccept(false)
    }
  }

  // ── Main calendar loader ──────────────────────────────────────────

  async function loadCalendar() {
    const seq = ++loadSeqRef.current

    try {
      setLoading(true)
      setError(null)

      const requestedLocationId = deps.activeLocationId?.trim() || null
      const tzGuess = deps.resolveActiveCalendarTimeZone()

      async function fetchCalendarFor(tzForRange: string) {
        const safeTz = sanitizeTimeZone(tzForRange, DEFAULT_TIME_ZONE)
        const { from, to } = rangeForViewUtcInTimeZone(deps.view, deps.currentDate, safeTz)

        const qs = new URLSearchParams({
          from: toIso(from),
          to: toIso(to),
        })

        if (requestedLocationId) {
          qs.set('locationId', requestedLocationId)
        }

        const res = await fetch(`/api/pro/calendar?${qs.toString()}`, {
          cache: 'no-store',
        })
        const data: unknown = await safeJson(res)
        return { res, data }
      }

      let { res, data } = await fetchCalendarFor(tzGuess)
      if (seq !== loadSeqRef.current) return

      if (!res.ok) {
        setError(apiMessage(data, `Failed to load calendar (${res.status}).`))
        return
      }

      const firstRecord = isRecord(data) ? data : null
      const firstApiTzRaw = firstRecord ? pickString(firstRecord.timeZone) ?? '' : ''
      const firstApiTz = isValidIanaTimeZone(firstApiTzRaw)
        ? sanitizeTimeZone(firstApiTzRaw, DEFAULT_TIME_ZONE)
        : DEFAULT_TIME_ZONE

      const shouldRefetchForApiTz =
        isValidIanaTimeZone(firstApiTzRaw) &&
        firstApiTz !== sanitizeTimeZone(tzGuess, DEFAULT_TIME_ZONE)

      if (shouldRefetchForApiTz) {
        const second = await fetchCalendarFor(firstApiTz)
        if (seq !== loadSeqRef.current) return

        if (second.res.ok) {
          res = second.res
          data = second.data
        }
      }

      const record = isRecord(data) ? data : null
      const apiLocation = record ? parseCalendarRouteLocation(record.location) : null

      if (apiLocation?.id && apiLocation.id !== deps.activeLocationId) {
        deps.setActiveLocationId(apiLocation.id)
      }

      const finalApiTzRaw = record ? pickString(record.timeZone) ?? '' : ''
      const finalApiTz = isValidIanaTimeZone(finalApiTzRaw)
        ? sanitizeTimeZone(finalApiTzRaw, DEFAULT_TIME_ZONE)
        : DEFAULT_TIME_ZONE

      setTimeZone(finalApiTz)
      setNeedsTimeZoneSetup(Boolean(record?.needsTimeZoneSetup))

      const nextCanSalon = record ? Boolean(record.canSalon ?? true) : true
      const nextCanMobile = record ? Boolean(record.canMobile ?? false) : false

      deps.setCanSalon(nextCanSalon)
      deps.setCanMobile(nextCanMobile)

      setStats(record ? parseCalendarStats(record.stats) : null)
      setAutoAccept(record ? Boolean(record.autoAcceptBookings) : false)

      setManagement(
        record
          ? parseManagementLists(record.management)
          : {
              todaysBookings: [],
              pendingRequests: [],
              waitlistToday: [],
              blockedToday: [],
            },
      )

      const apiEvents = record ? parseCalendarEvents(record.events) : []

      const [nextSalon, nextMobile] = await Promise.all([
        loadWorkingHoursFor('SALON'),
        loadWorkingHoursFor('MOBILE'),
      ])

      if (seq !== loadSeqRef.current) return

      setWorkingHoursSalon(nextSalon)
      setWorkingHoursMobile(nextMobile)

      const nextEvents = [...apiEvents].sort(
        (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
      )

      setEvents(nextEvents)
    } catch (e: unknown) {
      console.error(e)
      if (seq === loadSeqRef.current) {
        setError('Network error loading calendar.')
      }
    } finally {
      if (seq === loadSeqRef.current) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    if (!deps.locationsLoaded && deps.activeLocationId == null) return
    void loadCalendar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps.view, deps.currentDate, deps.activeLocationId, deps.locationsLoaded])

  function reload() {
    void loadCalendar()
  }

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
