// app/pro/calendar/_hooks/useCalendarData.ts
'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import type {
  BookingDetails,
  CalendarEvent,
  CalendarStats,
  EntityType,
  ManagementKey,
  ManagementLists,
  PendingChange,
  ServiceOption,
  ViewMode,
  WorkingHoursJson,
} from '../_types'
import { safeJson } from '../_utils/http'
import { startOfMonth, startOfWeek, toIso, clamp } from '../_utils/date'
import {
  PX_PER_MINUTE,
  SNAP_MINUTES,
  roundTo15,
  snapMinutes,
  computeDurationMinutesFromIso,
  isBlockedEvent,
  extractBlockId,
  isOutsideWorkingHours,
} from '../_utils/calendarMath'
import {
  DEFAULT_TIME_ZONE,
  isValidIanaTimeZone,
  sanitizeTimeZone,
  startOfDayUtcInTimeZone,
  zonedTimeToUtc,
  utcFromDayAndMinutesInTimeZone,
  getZonedParts,
} from '@/lib/timeZone'

type Args = { view: ViewMode; currentDate: Date }
type LocationType = 'SALON' | 'MOBILE'
type ProLocationType = 'SALON' | 'SUITE' | 'MOBILE_BASE' | (string & {})

type ProLocation = {
  id: string
  type: ProLocationType
  name: string | null
  formattedAddress: string | null
  isPrimary: boolean
  isBookable: boolean
  timeZone: string | null
  workingHours: WorkingHoursJson
  stepMinutes: number | null
}

/** must match ProSessionFooter/useProSession.ts */
const PRO_SESSION_FORCE_EVENT = 'tovis:pro-session:force'

function forceProFooterRefresh() {
  try {
    window.dispatchEvent(new Event(PRO_SESSION_FORCE_EVENT))
  } catch {
    // ignore
  }
}

function pickLocationType(canSalon: boolean, canMobile: boolean, preferred?: LocationType): LocationType {
  if (preferred && ((preferred === 'SALON' && canSalon) || (preferred === 'MOBILE' && canMobile))) return preferred
  if (canSalon) return 'SALON'
  if (canMobile) return 'MOBILE'
  return 'SALON'
}

// Anchor a "day" to local noon for working-hours weekday math (not timezone conversion).
function anchorDayLocalNoon(year: number, month1: number, day: number) {
  return new Date(year, month1 - 1, day, 12, 0, 0, 0)
}

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

function toDateInputValueInTimeZone(dateUtc: Date, tz: string) {
  const p = getZonedParts(dateUtc, tz)
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`
}

function toTimeInputValueInTimeZone(dateUtc: Date, tz: string) {
  const p = getZonedParts(dateUtc, tz)
  return `${pad2(p.hour)}:${pad2(p.minute)}`
}

/* ---------------------------------------------
   Safer runtime guards 
   --------------------------------------------- */

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

function getString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function getBool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null
}

function getNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function toUpper(v: unknown): string {
  return typeof v === 'string' ? v.toUpperCase() : ''
}

function isCalendarEvent(v: unknown): v is CalendarEvent {
  if (!isRecord(v)) return false
  const id = getString(v.id)
  const kind = getString(v.kind)
  const startsAt = getString(v.startsAt)
  const endsAt = getString(v.endsAt)
  if (!id || !kind || !startsAt || !endsAt) return false
  return kind === 'BOOKING' || kind === 'BLOCK'
}

function parseCalendarEvents(v: unknown): CalendarEvent[] {
  if (!Array.isArray(v)) return []
  return v.filter(isCalendarEvent)
}

function parseManagementLists(v: unknown): ManagementLists {
  if (!isRecord(v)) return { todaysBookings: [], pendingRequests: [], waitlistToday: [], blockedToday: [] }

  const tb = Array.isArray(v.todaysBookings) ? v.todaysBookings.filter(isCalendarEvent) : []
  const pr = Array.isArray(v.pendingRequests) ? v.pendingRequests.filter(isCalendarEvent) : []
  const wl = Array.isArray(v.waitlistToday) ? v.waitlistToday.filter(isCalendarEvent) : []
  const bt = Array.isArray(v.blockedToday) ? v.blockedToday.filter(isCalendarEvent) : []

  return { todaysBookings: tb, pendingRequests: pr, waitlistToday: wl, blockedToday: bt }
}

function parseCalendarStats(v: unknown): CalendarStats {
  if (!isRecord(v)) return null

  const todaysBookings = getNumber(v.todaysBookings)
  const pendingRequests = getNumber(v.pendingRequests)
  const blockedHours = getNumber(v.blockedHours)

  // availableHours can be null or number
  const availableHours =
    v.availableHours === null ? null : typeof v.availableHours === 'number' && Number.isFinite(v.availableHours) ? v.availableHours : null

  if (todaysBookings === null || pendingRequests === null || blockedHours === null) return null

  return { todaysBookings, availableHours, pendingRequests, blockedHours }
}

function parseServiceOptions(v: unknown): ServiceOption[] {
  if (!Array.isArray(v)) return []
  // We keep it permissive; UI only needs id+name in most places.
  return v
    .filter((x) => isRecord(x) && typeof x.id === 'string' && x.id && typeof x.name === 'string')
    .map((x) => x as ServiceOption)
}

/* ---------------------------------------------
   View range in UTC, anchored to TZ day boundaries (strict).
   --------------------------------------------- */

function rangeForViewUtcInTimeZone(v: ViewMode, focusUtc: Date, tz: string) {
  const safeTz = sanitizeTimeZone(tz, DEFAULT_TIME_ZONE)

  if (v === 'day') {
    const from = startOfDayUtcInTimeZone(focusUtc, safeTz)
    const to = new Date(from.getTime() + 24 * 60 * 60_000)
    return { from, to }
  }

  const mapMon: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }

  // Week start: Monday-first
  if (v === 'week') {
    const p = getZonedParts(focusUtc, safeTz)
    const weekdayShort = new Intl.DateTimeFormat('en-US', { timeZone: safeTz, weekday: 'short' }).format(focusUtc)
    const dow = mapMon[weekdayShort] ?? 0
    const weekStartDay = p.day - dow

    const from = zonedTimeToUtc({
      year: p.year,
      month: p.month,
      day: weekStartDay,
      hour: 0,
      minute: 0,
      second: 0,
      timeZone: safeTz,
    })

    const to = new Date(from.getTime() + 7 * 24 * 60 * 60_000)
    return { from, to }
  }

  // Month grid: go to Monday of the week containing the 1st, then 42 days
  const p = getZonedParts(focusUtc, safeTz)

  const firstOfMonthUtc = zonedTimeToUtc({
    year: p.year,
    month: p.month,
    day: 1,
    hour: 12, // noon avoids DST edge weirdness when deriving weekday
    minute: 0,
    second: 0,
    timeZone: safeTz,
  })

  const firstWeekdayShort = new Intl.DateTimeFormat('en-US', { timeZone: safeTz, weekday: 'short' }).format(firstOfMonthUtc)
  const firstDow = mapMon[firstWeekdayShort] ?? 0

  const firstParts = getZonedParts(firstOfMonthUtc, safeTz)
  const gridStartDay = firstParts.day - firstDow

  const from = zonedTimeToUtc({
    year: firstParts.year,
    month: firstParts.month,
    day: gridStartDay,
    hour: 0,
    minute: 0,
    second: 0,
    timeZone: safeTz,
  })

  const to = new Date(from.getTime() + 42 * 24 * 60 * 60_000)
  return { from, to }
}

export function useCalendarData({ view, currentDate }: Args) {
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const eventsRef = useRef<CalendarEvent[]>([])
  useEffect(() => {
    eventsRef.current = events
  }, [events])

  // ✅ Strict: start at UTC until API tells us the pro/location timezone.
  const [timeZone, setTimeZone] = useState<string>(DEFAULT_TIME_ZONE)
  const timeZoneRef = useRef(timeZone)
  useEffect(() => {
    timeZoneRef.current = timeZone
  }, [timeZone])

  const [needsTimeZoneSetup, setNeedsTimeZoneSetup] = useState(false)

  // Working hours are transitioning:
  // - legacy: per locationType (SALON vs MOBILE)
  // - preferred: per actual ProfessionalLocation (schema stores workingHours on location)
  const [canSalon, setCanSalon] = useState(true)
  const [canMobile, setCanMobile] = useState(false)
  const [activeLocationType, setActiveLocationType] = useState<LocationType>('SALON')

  const [workingHoursSalon, setWorkingHoursSalon] = useState<WorkingHoursJson>(null)
  const [workingHoursMobile, setWorkingHoursMobile] = useState<WorkingHoursJson>(null)

  // ✅ NEW: locations + activeLocationId
  const [locations, setLocations] = useState<ProLocation[]>([])
  const [locationsLoaded, setLocationsLoaded] = useState(false)
  const [activeLocationId, setActiveLocationId] = useState<string | null>(null)

  const scopedLocations = useMemo(() => {
    const list = locations.filter((l) => l.isBookable)
    if (activeLocationType === 'MOBILE') return list.filter((l) => toUpper(l.type) === 'MOBILE_BASE')
    return list.filter((l) => toUpper(l.type) === 'SALON' || toUpper(l.type) === 'SUITE')
  }, [locations, activeLocationType])

  const activeLocation = useMemo(() => {
    if (!activeLocationId) return null
    return locations.find((l) => l.id === activeLocationId) ?? null
  }, [locations, activeLocationId])

  const activeLocationLabel = useMemo(() => {
    if (!activeLocation) return null
    const base = activeLocation.name || (toUpper(activeLocation.type) === 'MOBILE_BASE' ? 'Mobile base' : toUpper(activeLocation.type) === 'SUITE' ? 'Suite' : 'Salon')
    const addr = activeLocation.formattedAddress ? ` — ${activeLocation.formattedAddress}` : ''
    return `${base}${addr}`
  }, [activeLocation])

  // Prefer real location workingHours if we have it, otherwise fallback to legacy per-type fetch.
  const workingHoursActive = useMemo(() => {
    if (activeLocation?.workingHours) return activeLocation.workingHours
    return activeLocationType === 'MOBILE' ? workingHoursMobile : workingHoursSalon
  }, [activeLocation, activeLocationType, workingHoursSalon, workingHoursMobile])

  const [stats, setStats] = useState<CalendarStats>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showHoursForm, setShowHoursForm] = useState(false)

  const [autoAccept, setAutoAccept] = useState(false)
  const [savingAutoAccept, setSavingAutoAccept] = useState(false)

  const [services, setServices] = useState<ServiceOption[]>([])
  const [servicesLoaded, setServicesLoaded] = useState(false)

  const [openBookingId, setOpenBookingId] = useState<string | null>(null)
  const [bookingLoading, setBookingLoading] = useState(false)
  const [bookingError, setBookingError] = useState<string | null>(null)
  const [booking, setBooking] = useState<BookingDetails | null>(null)

  const [reschedDate, setReschedDate] = useState<string>('')
  const [reschedTime, setReschedTime] = useState<string>('')
  const [notifyClient, setNotifyClient] = useState(true)
  const [savingReschedule, setSavingReschedule] = useState(false)

  // UI-only for now (server no longer supports patching serviceId directly)
  const [selectedServiceId, setSelectedServiceId] = useState<string>('')

  const [durationMinutes, setDurationMinutes] = useState<number>(60)
  const [allowOutsideHours, setAllowOutsideHours] = useState(false)

  // ✅ separate state for ManagementModal actions
  const [managementActionBusyId, setManagementActionBusyId] = useState<string | null>(null)
  const [managementActionError, setManagementActionError] = useState<string | null>(null)

  // drag + resize
  const dragEventIdRef = useRef<string | null>(null)
  const dragApiIdRef = useRef<string | null>(null)
  const dragEntityTypeRef = useRef<EntityType>('booking')
  const dragOriginalEventRef = useRef<CalendarEvent | null>(null)
  const dragGrabOffsetMinutesRef = useRef<number>(0)

  const resizingRef = useRef<{
    entityType: EntityType
    eventId: string
    apiId: string
    day: Date
    startMinutes: number
    originalDuration: number
    columnTop: number
  } | null>(null)

  const [pendingChange, setPendingChange] = useState<PendingChange | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [applyingChange, setApplyingChange] = useState(false)

  // create booking + blocks
  const [createOpen, setCreateOpen] = useState(false)
  const [createInitialStart, setCreateInitialStart] = useState<Date>(new Date())

  const [blockCreateOpen, setBlockCreateOpen] = useState(false)
  const [blockCreateInitialStart, setBlockCreateInitialStart] = useState<Date>(new Date())

  const [editBlockOpen, setEditBlockOpen] = useState(false)
  const [editBlockId, setEditBlockId] = useState<string | null>(null)

  const [management, setManagement] = useState<ManagementLists>({
    todaysBookings: [],
    pendingRequests: [],
    waitlistToday: [],
    blockedToday: [],
  })
  const [managementOpen, setManagementOpen] = useState(false)
  const [managementKey, setManagementKey] = useState<ManagementKey>('todaysBookings')

  // UI click suppression for drag/resize
  const suppressClickRef = useRef(false)
  const suppressClickTimerRef = useRef<number | null>(null)
  function suppressClickBriefly() {
    suppressClickRef.current = true
    if (suppressClickTimerRef.current) window.clearTimeout(suppressClickTimerRef.current)
    suppressClickTimerRef.current = window.setTimeout(() => {
      suppressClickRef.current = false
      suppressClickTimerRef.current = null
    }, 250)
  }

  // Prevent race conditions (stale responses overwriting fresh state)
  const loadSeqRef = useRef(0)

  // Prevent redundant calendar reload when we adopt API-selected locationId
  const locationSetByApiRef = useRef(false)

  /* ---------------------------------------------
     Core helpers
     --------------------------------------------- */

  const utils = useMemo(
    () => ({
      startOfWeek,
      startOfMonth,
    }),
    [],
  )

  function eventDurationMinutes(ev: CalendarEvent) {
    if (Number.isFinite(ev.durationMinutes) && (ev.durationMinutes as number) > 0) return ev.durationMinutes as number
    return computeDurationMinutesFromIso(ev.startsAt, ev.endsAt)
  }

  function openConfirm(change: PendingChange) {
    setPendingChange(change)
    setConfirmOpen(true)
  }

  function rollbackPending() {
    if (!pendingChange) return
    setEvents((prev) =>
      prev.map((ev) =>
        ev.id === pendingChange.eventId
          ? {
              ...ev,
              startsAt: pendingChange.original.startsAt,
              endsAt: pendingChange.original.endsAt,
              durationMinutes: pendingChange.original.durationMinutes,
            }
          : ev,
      ),
    )
  }

  function cancelConfirm() {
    rollbackPending()
    setConfirmOpen(false)
    setPendingChange(null)
  }

  // ✅ For pro drag/resize confirm: determine if the pending booking time is outside working hours.
  function isPendingChangeOutsideWorkingHours(change: PendingChange): boolean {
    if (change.entityType !== 'booking') return false

    const tz = sanitizeTimeZone(timeZoneRef.current, DEFAULT_TIME_ZONE)

    const originalDur = eventDurationMinutes(change.original)
    const nextStartIso = change.kind === 'move' ? change.nextStartIso : change.original.startsAt
    const nextDurMinutes =
      change.kind === 'resize' ? Number(change.nextTotalDurationMinutes || originalDur) : Number(originalDur)

    const startUtc = new Date(nextStartIso)
    if (!Number.isFinite(startUtc.getTime())) return false

    const p = getZonedParts(startUtc, tz)
    const startMinutes = p.hour * 60 + p.minute
    const dur = roundTo15(nextDurMinutes)
    const endMinutes = startMinutes + dur

    const dayAnchor = anchorDayLocalNoon(p.year, p.month, p.day)

    return isOutsideWorkingHours({
      day: dayAnchor,
      startMinutes,
      endMinutes,
      workingHours: workingHoursActive,
      timeZone: tz,
    })
  }

  /* ---------------------------------------------
     Window resize listeners (stable, no casts)
     --------------------------------------------- */

  const onResizeMove = useCallback((e: MouseEvent) => {
    const s = resizingRef.current
    if (!s) return

    const y = e.clientY - s.columnTop
    const endMinutes = snapMinutes(y / PX_PER_MINUTE)
    const rawDur = endMinutes - s.startMinutes
    const dur = Math.max(SNAP_MINUTES, roundTo15(rawDur))

    const tz = sanitizeTimeZone(timeZoneRef.current, DEFAULT_TIME_ZONE)
    const start = utcFromDayAndMinutesInTimeZone(s.day, s.startMinutes, tz)
    const end = new Date(start.getTime() + dur * 60_000)

    setEvents((prev) => prev.map((ev) => (ev.id === s.eventId ? { ...ev, endsAt: end.toISOString(), durationMinutes: dur } : ev)))
  }, [])

  const onResizeEnd = useCallback((_e: MouseEvent) => {
    const s = resizingRef.current
    resizingRef.current = null
    window.removeEventListener('mousemove', onResizeMove)
    window.removeEventListener('mouseup', onResizeEnd)
    if (!s) return

    suppressClickBriefly()

    const ev = eventsRef.current.find((x) => x.id === s.eventId)
    if (!ev) return

    const start = new Date(ev.startsAt)
    const end = new Date(ev.endsAt)
    const raw = Math.round((end.getTime() - start.getTime()) / 60_000)
    const dur = Math.max(SNAP_MINUTES, roundTo15(raw))

    if (dur === s.originalDuration) {
      const rollbackEnd = new Date(start.getTime() + s.originalDuration * 60_000)
      setEvents((prev) =>
        prev.map((x) => (x.id === s.eventId ? { ...x, endsAt: rollbackEnd.toISOString(), durationMinutes: s.originalDuration } : x)),
      )
      return
    }

    const originalForRollback: CalendarEvent = {
      ...ev,
      endsAt: new Date(start.getTime() + s.originalDuration * 60_000).toISOString(),
      durationMinutes: s.originalDuration,
    }

    openConfirm({
      kind: 'resize',
      entityType: s.entityType,
      eventId: s.eventId,
      apiId: s.apiId,
      nextTotalDurationMinutes: dur,
      original: originalForRollback,
    })
  }, [onResizeMove])

  useEffect(() => {
    return () => {
      if (suppressClickTimerRef.current) window.clearTimeout(suppressClickTimerRef.current)
      window.removeEventListener('mousemove', onResizeMove)
      window.removeEventListener('mouseup', onResizeEnd)
    }
  }, [onResizeMove, onResizeEnd])

  /* ---------------------------------------------
     Loads
     --------------------------------------------- */

  async function loadLocationsOnce() {
    if (locationsLoaded) return
    try {
      const res = await fetch('/api/pro/locations', { cache: 'no-store' })
      const data: unknown = await safeJson(res)

      if (!res.ok || !isRecord(data) || !Array.isArray(data.locations)) {
        setLocations([])
        setLocationsLoaded(true)
        return
      }

      const parsed: ProLocation[] = data.locations
        .map((raw: unknown) => {
          if (!isRecord(raw)) return null
          const id = getString(raw.id)
          if (!id) return null

          const type = (getString(raw.type) ?? 'SALON') as ProLocationType
          const name = getString(raw.name)
          const formattedAddress = getString(raw.formattedAddress)

          const isPrimary = Boolean(raw.isPrimary)
          const isBookable = raw.isBookable === undefined ? true : Boolean(raw.isBookable)

          const timeZone = getString(raw.timeZone)
          const stepMinutes = getNumber(raw.stepMinutes)

          // workingHours is Json in schema, so we keep it flexible (WorkingHoursJson)
          const workingHours = (raw.workingHours ?? null) as WorkingHoursJson

          return {
            id,
            type,
            name,
            formattedAddress,
            isPrimary,
            isBookable,
            timeZone,
            workingHours,
            stepMinutes,
          }
        })
        .filter((x): x is ProLocation => Boolean(x))

      setLocations(parsed)
      setLocationsLoaded(true)

      const nextCanSalon = parsed.some((l) => l.isBookable && (toUpper(l.type) === 'SALON' || toUpper(l.type) === 'SUITE'))
      const nextCanMobile = parsed.some((l) => l.isBookable && toUpper(l.type) === 'MOBILE_BASE')
      setCanSalon(nextCanSalon)
      setCanMobile(nextCanMobile)
      setActiveLocationType((prev) => pickLocationType(nextCanSalon, nextCanMobile, prev))

      // If activeLocationId isn't set yet, pick a sensible default within the active type scope.
      if (!activeLocationId) {
        const scoped = parsed.filter((l) => l.isBookable).filter((l) => {
          if (activeLocationType === 'MOBILE') return toUpper(l.type) === 'MOBILE_BASE'
          return toUpper(l.type) === 'SALON' || toUpper(l.type) === 'SUITE'
        })

        const next = scoped.find((l) => l.isPrimary)?.id ?? scoped[0]?.id ?? parsed.find((l) => l.isPrimary)?.id ?? parsed[0]?.id ?? null
        if (next) setActiveLocationId(next)
      }
    } catch {
      setLocations([])
      setLocationsLoaded(true)
    }
  }

  async function loadServicesOnce() {
    if (servicesLoaded) return
    try {
      const res = await fetch('/api/pro/services', { cache: 'no-store' })
      const data: unknown = await safeJson(res)
      if (!res.ok) return
      if (!isRecord(data)) return
      setServices(parseServiceOptions(data.services))
      setServicesLoaded(true)
    } catch {
      // ignore
    }
  }

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
        const msg = isRecord(data) ? getString(data.error) ?? 'Failed to save.' : 'Failed to save.'
        throw new Error(msg)
      }

      if (isRecord(data) && isRecord(data.professionalProfile)) {
        const v = getBool((data.professionalProfile as Record<string, unknown>).autoAcceptBookings)
        if (v !== null) setAutoAccept(v)
      }
    } catch (e: unknown) {
      console.error(e)
      setAutoAccept((prev) => !prev)
    } finally {
      setSavingAutoAccept(false)
    }
  }

  async function loadWorkingHoursFor(locationType: LocationType) {
    const res = await fetch(`/api/pro/working-hours?locationType=${encodeURIComponent(locationType)}`, {
      method: 'GET',
      cache: 'no-store',
    })
    const data: unknown = await safeJson(res)
    if (!res.ok) {
      const msg = isRecord(data) ? getString(data.error) ?? `Failed to load ${locationType} hours.` : `Failed to load ${locationType} hours.`
      throw new Error(msg)
    }
    if (!isRecord(data)) return null
    return (data.workingHours ?? null) as WorkingHoursJson
  }

  async function loadCalendar() {
    const seq = ++loadSeqRef.current

    try {
      setLoading(true)
      setError(null)

      // Start with current tz guess (initially UTC)
      const tzGuess = sanitizeTimeZone(timeZoneRef.current, DEFAULT_TIME_ZONE)

      async function fetchCalendarFor(tzForRange: string, locationId: string | null) {
        const { from, to } = rangeForViewUtcInTimeZone(view, currentDate, tzForRange)

        const base = `/api/pro/calendar?from=${encodeURIComponent(toIso(from))}&to=${encodeURIComponent(toIso(to))}`
        const url = locationId ? `${base}&locationId=${encodeURIComponent(locationId)}` : base

        const res = await fetch(url, { cache: 'no-store' })
        const data: unknown = await safeJson(res)
        return { res, data }
      }

      // 1) fetch using current tz guess and current locationId (if any)
      let { res, data } = await fetchCalendarFor(tzGuess, activeLocationId)
      if (seq !== loadSeqRef.current) return

      if (!res.ok) {
        const msg =
          isRecord(data) ? getString(data.error) ?? `Failed to load calendar (${res.status}).` : `Failed to load calendar (${res.status}).`
        setError(msg)
        return
      }

      const record = isRecord(data) ? data : null

      // Adopt API-selected location if provided (without triggering an extra reload)
      const apiLocId = record && isRecord(record.location) ? getString((record.location as Record<string, unknown>).id) : null
      if (apiLocId && apiLocId !== activeLocationId) {
        locationSetByApiRef.current = true
        setActiveLocationId(apiLocId)
      }

      const apiTzRaw = record ? (getString(record.timeZone) ?? '') : ''
      const apiTzValid = isValidIanaTimeZone(apiTzRaw)
      const nextTz = apiTzValid ? apiTzRaw : DEFAULT_TIME_ZONE

      // 2) if API gives a different valid tz, refetch ONCE so range boundaries are correct
      if (apiTzValid && nextTz !== tzGuess) {
        const second = await fetchCalendarFor(nextTz, apiLocId ?? activeLocationId)
        if (seq !== loadSeqRef.current) return
        if (second.res.ok) {
          res = second.res
          data = second.data
        }
      }

      const record2 = isRecord(data) ? data : null

      // Apply tz + setup flags
      setTimeZone(nextTz)
      const needsSetup = Boolean(record2?.needsTimeZoneSetup) || !apiTzValid
      setNeedsTimeZoneSetup(needsSetup)

      if (!apiTzValid && process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.warn('[Calendar] API timezone missing/invalid; forcing UTC until pro sets timezone.', { apiTzRaw })
      }

      // Capabilities + active location mode
      const nextCanSalon = record2 ? Boolean(record2.canSalon ?? true) : true
      const nextCanMobile = record2 ? Boolean(record2.canMobile ?? false) : false
      setCanSalon(nextCanSalon)
      setCanMobile(nextCanMobile)
      setActiveLocationType((prev) => pickLocationType(nextCanSalon, nextCanMobile, prev))

      // Stats + management + auto-accept
      setStats(record2 ? parseCalendarStats(record2.stats) : null)
      setAutoAccept(record2 ? Boolean(record2.autoAcceptBookings) : false)

      setManagement(record2 ? parseManagementLists(record2.management) : { todaysBookings: [], pendingRequests: [], waitlistToday: [], blockedToday: [] })

      // Events (bookings + blocks)
      const apiEvents = record2 ? parseCalendarEvents(record2.events) : []

      // working hours for BOTH types (fallback). If you have per-location hours, the UI uses that first.
      const [nextSalon, nextMobile] = await Promise.all([loadWorkingHoursFor('SALON'), loadWorkingHoursFor('MOBILE')])
      if (seq !== loadSeqRef.current) return
      setWorkingHoursSalon(nextSalon)
      setWorkingHoursMobile(nextMobile)

      const nextEvents = [...apiEvents].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
      setEvents(nextEvents)
    } catch (e: unknown) {
      console.error(e)
      if (seq === loadSeqRef.current) setError('Network error loading calendar.')
    } finally {
      if (seq === loadSeqRef.current) setLoading(false)
    }
  }

  // Load services once + locations once
  useEffect(() => {
    void loadServicesOnce()
    void loadLocationsOnce()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reload calendar when view/currentDate changes
  useEffect(() => {
    void loadCalendar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, currentDate])

  // Reload calendar when activeLocationId changes (but avoid double-load when set from API)
  useEffect(() => {
    if (locationSetByApiRef.current) {
      locationSetByApiRef.current = false
      return
    }
    if (!activeLocationId) return
    void loadCalendar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLocationId])

  // When switching SALON/MOBILE mode, keep activeLocationId valid for that scope
  useEffect(() => {
    if (!locationsLoaded) return
    if (activeLocationId && scopedLocations.some((l) => l.id === activeLocationId)) return

    const next = scopedLocations.find((l) => l.isPrimary)?.id ?? scopedLocations[0]?.id ?? null
    setActiveLocationId(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLocationType, locationsLoaded, scopedLocations])

  // blocked minutes today (timezone-aware)
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
      if (overlapEnd > overlapStart) sum += Math.round((overlapEnd - overlapStart) / 60_000)
    }
    return sum
  }, [events, timeZone])

  // Management helpers
  function openManagement(key: ManagementKey) {
    setManagementKey(key)
    setManagementOpen(true)
  }
  function closeManagement() {
    setManagementOpen(false)
  }

  // Blocks
  async function createBlock(startsAtIso: string, endsAtIso: string, note?: string) {
    // ✅ Never accidentally create a "global" block because activeLocationId is missing.
    if (!activeLocationId) throw new Error('Select a location first.')

    const res = await fetch('/api/pro/calendar/blocked', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startsAt: startsAtIso,
        endsAt: endsAtIso,
        note: note ?? null,
        locationId: activeLocationId,
      }),
    })
    const data: unknown = await safeJson(res)
    if (!res.ok) {
      const msg = isRecord(data) ? getString(data.error) ?? 'Failed to create block.' : 'Failed to create block.'
      throw new Error(msg)
    }

    if (isRecord(data) && isRecord(data.block)) {
      const b = data.block as Record<string, unknown>
      const id = getString(b.id) ?? ''
      const startsAt = getString(b.startsAt) ?? startsAtIso
      const endsAt = getString(b.endsAt) ?? endsAtIso
      const noteOut = getString(b.note)
      return { id, startsAt, endsAt, note: noteOut }
    }

    return { id: '', startsAt: startsAtIso, endsAt: endsAtIso, note: note ?? null }
  }

  async function oneClickBlockFullDay(day: Date) {
    try {
      if (!activeLocationId) throw new Error('Select a location first.')

      setLoading(true)
      setError(null)
      const tz = sanitizeTimeZone(timeZone, DEFAULT_TIME_ZONE)
      const startUtc = startOfDayUtcInTimeZone(day, tz)
      const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60_000)
      await createBlock(startUtc.toISOString(), endUtc.toISOString(), 'Full day off')
      await loadCalendar()
      forceProFooterRefresh()
    } catch (e: unknown) {
      console.error(e)
      const msg = e instanceof Error ? e.message : 'Could not block full day.'
      setError(msg)
      setTimeout(() => setError(null), 3500)
    } finally {
      setLoading(false)
    }
  }

  function openCreateBlockNow() {
    if (!activeLocationId) {
      setError('Select a location first.')
      setTimeout(() => setError(null), 3000)
      return
    }

    const tz = sanitizeTimeZone(timeZone, DEFAULT_TIME_ZONE)
    const nowUtc = new Date()
    const p = getZonedParts(nowUtc, tz)
    const minutesNow = p.hour * 60 + p.minute
    const rounded = snapMinutes(Math.ceil(minutesNow / SNAP_MINUTES) * SNAP_MINUTES)
    const startUtc = utcFromDayAndMinutesInTimeZone(nowUtc, rounded, tz)

    setBlockCreateInitialStart(startUtc)
    setBlockCreateOpen(true)
  }

  function openEditBlockFromEvent(ev: CalendarEvent) {
    const bid = extractBlockId(ev)
    if (!bid) return
    setEditBlockId(bid)
    setEditBlockOpen(true)
  }

  async function setBookingStatusById(args: { bookingId: string; status: 'ACCEPTED' | 'CANCELLED' }) {
    const { bookingId, status } = args
    if (!bookingId) return
    if (managementActionBusyId) return

    setManagementActionBusyId(bookingId)
    setManagementActionError(null)

    const current = eventsRef.current.find((x) => x.id === bookingId)
    const currentStatus = current ? String(current.status || '').toUpperCase() : ''
    if (currentStatus && currentStatus === status) {
      setManagementActionBusyId(null)
      return
    }

    try {
      const res = await fetch(`/api/pro/bookings/${encodeURIComponent(bookingId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, notifyClient: true }),
      })

      const data: unknown = await safeJson(res)

      if (!res.ok) {
        const msg = isRecord(data) ? getString(data.error) ?? getString(data.message) ?? 'Failed to update booking.' : 'Failed to update booking.'

        // No-op is not an error
        if (msg.toLowerCase().includes('no changes provided')) {
          await loadCalendar()
          forceProFooterRefresh()
          return
        }

        throw new Error(msg)
      }

      await loadCalendar()
      forceProFooterRefresh()
    } catch (e: unknown) {
      console.error(e)
      const msg = e instanceof Error ? e.message : 'Failed to update booking.'
      setManagementActionError(msg)
      setTimeout(() => setManagementActionError(null), 3500)
    } finally {
      setManagementActionBusyId(null)
    }
  }

  async function approveBookingById(bookingId: string) {
    return setBookingStatusById({ bookingId, status: 'ACCEPTED' })
  }

  async function denyBookingById(bookingId: string) {
    return setBookingStatusById({ bookingId, status: 'CANCELLED' })
  }

  // Booking modal
  async function openBooking(id: string) {
    if (confirmOpen || pendingChange || createOpen) return
    if (managementOpen) return
    if (blockCreateOpen || editBlockOpen) return

    const maybeEv = eventsRef.current.find((x) => x.id === id)
    if (maybeEv && isBlockedEvent(maybeEv)) {
      openEditBlockFromEvent(maybeEv)
      return
    }

    setOpenBookingId(id)
    setBooking(null)
    setBookingError(null)
    setBookingLoading(true)
    setAllowOutsideHours(false)

    try {
      const res = await fetch(`/api/pro/bookings/${encodeURIComponent(id)}`, { method: 'GET', cache: 'no-store' })
      const data: unknown = await safeJson(res)
      if (!res.ok) {
        const msg = isRecord(data) ? getString(data.error) ?? `Failed to load booking (${res.status}).` : `Failed to load booking (${res.status}).`
        throw new Error(msg)
      }

      if (!isRecord(data) || !isRecord(data.booking)) throw new Error('Malformed booking response.')

      const b = data.booking as BookingDetails
      setBooking(b)

      const tz = sanitizeTimeZone(timeZone, DEFAULT_TIME_ZONE)
      const start = new Date(b.scheduledFor)
      setReschedDate(toDateInputValueInTimeZone(start, tz))
      setReschedTime(toTimeInputValueInTimeZone(start, tz))
      setNotifyClient(true)

      const svcList = isRecord(data) ? parseServiceOptions((data as Record<string, unknown>).services) : []
      if (svcList.length) setServices(svcList)

      // UI only (server no longer supports changing serviceId with this PATCH)
      setSelectedServiceId(b.serviceId || '')
      setDurationMinutes(Number(b.totalDurationMinutes || 60))
    } catch (e: unknown) {
      console.error(e)
      const msg = e instanceof Error ? e.message : 'Failed to load booking.'
      setBookingError(msg)
    } finally {
      setBookingLoading(false)
    }
  }

  function closeBooking() {
    setOpenBookingId(null)
    setBooking(null)
    setBookingError(null)
    setSavingReschedule(false)
    setAllowOutsideHours(false)
  }

  function editWouldBeOutsideHours() {
    if (!booking) return false
    const [yyyy, mm, dd] = (reschedDate || '').split('-').map((x) => Number(x))
    if (!yyyy || !mm || !dd) return false

    const [hh, mi] = (reschedTime || '').split(':').map((x) => Number(x))
    if (!Number.isFinite(hh) || !Number.isFinite(mi)) return false

    const startMinutes = hh * 60 + mi
    const dur = roundTo15(Number(durationMinutes || booking.totalDurationMinutes || 60))
    const endMinutes = startMinutes + dur

    const dayAnchor = anchorDayLocalNoon(yyyy, mm, dd)

    return isOutsideWorkingHours({
      day: dayAnchor,
      startMinutes,
      endMinutes,
      workingHours: workingHoursActive,
      timeZone: sanitizeTimeZone(timeZone, DEFAULT_TIME_ZONE),
    })
  }

  const editOutside = booking ? editWouldBeOutsideHours() : false

  async function submitChanges() {
    if (!booking || savingReschedule) return
    setSavingReschedule(true)
    setBookingError(null)

    try {
      const [yyyy, mm, dd] = (reschedDate || '').split('-').map((x) => Number(x))
      if (!yyyy || !mm || !dd) throw new Error('Pick a valid date.')

      const [hh, mi] = (reschedTime || '').split(':').map((x) => Number(x))
      if (!Number.isFinite(hh) || !Number.isFinite(mi)) throw new Error('Pick a valid time.')

      const tz = sanitizeTimeZone(timeZone, DEFAULT_TIME_ZONE)

      const nextStart = zonedTimeToUtc({
        year: yyyy,
        month: mm,
        day: dd,
        hour: hh,
        minute: mi,
        second: 0,
        timeZone: tz,
      })

      const snappedDur = roundTo15(Number(durationMinutes || 60))

      const dayAnchor = anchorDayLocalNoon(yyyy, mm, dd)
      const outside = isOutsideWorkingHours({
        day: dayAnchor,
        startMinutes: hh * 60 + mi,
        endMinutes: hh * 60 + mi + snappedDur,
        workingHours: workingHoursActive,
        timeZone: tz,
      })

      const res = await fetch(`/api/pro/bookings/${encodeURIComponent(booking.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduledFor: nextStart.toISOString(),
          // ✅ API expects durationMinutes (NOT totalDurationMinutes)
          durationMinutes: snappedDur,
          notifyClient,
          allowOutsideWorkingHours: outside ? Boolean(allowOutsideHours) : false,
        }),
      })
      const data: unknown = await safeJson(res)
      if (!res.ok) {
        const msg = isRecord(data) ? getString(data.error) ?? 'Failed to save changes.' : 'Failed to save changes.'
        throw new Error(msg)
      }

      closeBooking()
      await loadCalendar()
      forceProFooterRefresh()
    } catch (e: unknown) {
      console.error(e)
      const msg = e instanceof Error ? e.message : 'Failed to save changes.'
      setBookingError(msg)
    } finally {
      setSavingReschedule(false)
    }
  }

  async function approveBooking() {
    if (!booking) return
    setSavingReschedule(true)
    setBookingError(null)
    try {
      const res = await fetch(`/api/pro/bookings/${encodeURIComponent(booking.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ACCEPTED', notifyClient: true }),
      })
      const data: unknown = await safeJson(res)
      if (!res.ok) {
        const msg = isRecord(data) ? getString(data.error) ?? 'Failed to approve booking.' : 'Failed to approve booking.'
        throw new Error(msg)
      }
      closeBooking()
      await loadCalendar()
      forceProFooterRefresh()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to approve booking.'
      setBookingError(msg)
    } finally {
      setSavingReschedule(false)
    }
  }

  async function denyBooking() {
    if (!booking) return
    setSavingReschedule(true)
    setBookingError(null)
    try {
      const res = await fetch(`/api/pro/bookings/${encodeURIComponent(booking.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'CANCELLED', notifyClient: true }),
      })
      const data: unknown = await safeJson(res)
      if (!res.ok) {
        const msg = isRecord(data) ? getString(data.error) ?? 'Failed to deny booking.' : 'Failed to deny booking.'
        throw new Error(msg)
      }
      closeBooking()
      await loadCalendar()
      forceProFooterRefresh()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to deny booking.'
      setBookingError(msg)
    } finally {
      setSavingReschedule(false)
    }
  }

  async function applyConfirm() {
    if (!pendingChange || applyingChange) return
    setApplyingChange(true)

    try {
      if (pendingChange.entityType === 'booking') {
        const payload: {
          notifyClient: true
          durationMinutes?: number
          scheduledFor?: string
          allowOutsideWorkingHours?: boolean
        } = { notifyClient: true }

        if (pendingChange.kind === 'resize') {
          payload.durationMinutes = pendingChange.nextTotalDurationMinutes
        } else {
          payload.scheduledFor = pendingChange.nextStartIso
        }

        if (isPendingChangeOutsideWorkingHours(pendingChange)) {
          payload.allowOutsideWorkingHours = true
        }

        const res = await fetch(`/api/pro/bookings/${encodeURIComponent(pendingChange.apiId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data: unknown = await safeJson(res)
        if (!res.ok) {
          const msg = isRecord(data) ? getString(data.error) ?? 'Failed to apply changes.' : 'Failed to apply changes.'
          throw new Error(msg)
        }
      } else {
        const current = eventsRef.current.find((x) => x.id === pendingChange.eventId)
        const startIso =
          pendingChange.kind === 'move' ? pendingChange.nextStartIso : current?.startsAt ?? pendingChange.original.startsAt

        const dur =
          pendingChange.kind === 'resize'
            ? pendingChange.nextTotalDurationMinutes
            : eventDurationMinutes(pendingChange.original)

        const endIso = new Date(new Date(startIso).getTime() + dur * 60_000).toISOString()

        const res = await fetch(`/api/pro/calendar/blocked/${encodeURIComponent(pendingChange.apiId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ startsAt: startIso, endsAt: endIso }),
        })
        const data: unknown = await safeJson(res)
        if (!res.ok) {
          const msg = isRecord(data) ? getString(data.error) ?? 'Failed to apply changes.' : 'Failed to apply changes.'
          throw new Error(msg)
        }
      }

      setConfirmOpen(false)
      setPendingChange(null)
      await loadCalendar()
      forceProFooterRefresh()
    } catch (e: unknown) {
      console.error(e)
      rollbackPending()
      setConfirmOpen(false)
      setPendingChange(null)
      const msg = e instanceof Error ? e.message : 'Could not apply changes.'
      setError(msg)
      setTimeout(() => setError(null), 3500)
    } finally {
      setApplyingChange(false)
    }
  }

  // Drag handlers
  function onDragStart(ev: CalendarEvent, e: DragEvent<HTMLDivElement>) {
    suppressClickBriefly()

    const isBlock = isBlockedEvent(ev)
    const entityType: EntityType = isBlock ? 'block' : 'booking'
    const apiId = isBlock ? extractBlockId(ev) : ev.id
    if (!apiId) return

    dragEventIdRef.current = ev.id
    dragApiIdRef.current = apiId
    dragEntityTypeRef.current = entityType
    dragOriginalEventRef.current = ev

    const target = e.currentTarget as HTMLDivElement
    const rect = target.getBoundingClientRect()
    const pxFromTop = e.clientY - rect.top
    const minutesFromTop = pxFromTop / PX_PER_MINUTE
    const dur = eventDurationMinutes(ev)

    dragGrabOffsetMinutesRef.current = clamp(minutesFromTop, 0, Math.max(0, dur - SNAP_MINUTES))

    try {
      e.dataTransfer.setData('text/plain', ev.id)
    } catch {}
    e.dataTransfer.effectAllowed = 'move'
  }

  async function onDropOnDayColumn(day: Date, clientY: number, columnTop: number) {
    const eventId = dragEventIdRef.current
    const apiId = dragApiIdRef.current
    const entityType = dragEntityTypeRef.current
    const original = dragOriginalEventRef.current

    dragEventIdRef.current = null
    dragApiIdRef.current = null
    dragOriginalEventRef.current = null

    if (!eventId || !apiId || !original) return

    suppressClickBriefly()

    const y = clientY - columnTop
    const rawMinutes = y / PX_PER_MINUTE
    const topMinutes = snapMinutes(rawMinutes - dragGrabOffsetMinutesRef.current)

    const tz = sanitizeTimeZone(timeZone, DEFAULT_TIME_ZONE)
    const nextStart = utcFromDayAndMinutesInTimeZone(day, topMinutes, tz)

    if (nextStart.toISOString() === original.startsAt) return

    const dur = eventDurationMinutes(original)
    const nextEnd = new Date(nextStart.getTime() + dur * 60_000)

    setEvents((prev) =>
      prev.map((e) =>
        e.id === eventId ? { ...e, startsAt: nextStart.toISOString(), endsAt: nextEnd.toISOString(), durationMinutes: dur } : e,
      ),
    )

    openConfirm({
      kind: 'move',
      entityType,
      eventId,
      apiId,
      nextStartIso: nextStart.toISOString(),
      original: { ...original, durationMinutes: dur },
    })
  }

  // Resize start
  function beginResize(args: {
    entityType: EntityType
    eventId: string
    apiId: string
    day: Date
    startMinutes: number
    originalDuration: number
    columnTop: number
  }) {
    suppressClickBriefly()
    resizingRef.current = args
    window.addEventListener('mousemove', onResizeMove)
    window.addEventListener('mouseup', onResizeEnd)
  }

  // Click-to-create booking
  function openCreateForClick(day: Date, clientY: number, columnTop: number) {
    if (confirmOpen || pendingChange || openBookingId) return
    if (managementOpen) return
    if (blockCreateOpen || editBlockOpen) return

    const y = clientY - columnTop
    const mins = snapMinutes(y / PX_PER_MINUTE)

    const tz = sanitizeTimeZone(timeZone, DEFAULT_TIME_ZONE)
    const startUtc = utcFromDayAndMinutesInTimeZone(day, mins, tz)

    setCreateInitialStart(startUtc)
    setCreateOpen(true)
  }

  function openBookingOrBlock(id: string) {
    const ev = eventsRef.current.find((x) => x.id === id)
    if (ev && isBlockedEvent(ev)) {
      openEditBlockFromEvent(ev)
      return
    }
    void openBooking(id)
  }

  function reload() {
    void loadCalendar()
  }

  const isOverlayOpen = Boolean(
    confirmOpen || pendingChange || openBookingId || createOpen || managementOpen || blockCreateOpen || editBlockOpen,
  )

  const pendingOutsideWorkingHours = useMemo(() => {
    if (!pendingChange) return false
    return isPendingChangeOutsideWorkingHours(pendingChange)
  }, [pendingChange, workingHoursActive, events])

  return {
    view,
    currentDate,
    events,
    setEvents,

    timeZone,
    needsTimeZoneSetup,
    blockedMinutesToday,

    // ✅ NEW: location context (safe to add; page can start using it when ready)
    locations,
    locationsLoaded,
    scopedLocations,
    activeLocationId,
    setActiveLocationId,
    activeLocation,
    activeLocationLabel,

    canSalon,
    canMobile,
    activeLocationType,
    setActiveLocationType,

    workingHoursSalon,
    setWorkingHoursSalon,
    workingHoursMobile,
    setWorkingHoursMobile,
    workingHoursActive,

    stats,

    loading,
    error,

    services,
    setServices,

    management,
    managementOpen,
    managementKey,
    setManagementKey,
    openManagement,
    closeManagement,

    showHoursForm,
    setShowHoursForm,

    autoAccept,
    savingAutoAccept,
    toggleAutoAccept,

    createOpen,
    setCreateOpen,
    createInitialStart,
    setCreateInitialStart,

    blockCreateOpen,
    setBlockCreateOpen,
    blockCreateInitialStart,
    setBlockCreateInitialStart,
    editBlockOpen,
    setEditBlockOpen,
    editBlockId,
    setEditBlockId,
    openCreateBlockNow,
    oneClickBlockFullDay,

    openBookingId,
    bookingLoading,
    bookingError,
    booking,
    reschedDate,
    reschedTime,
    durationMinutes,
    selectedServiceId,
    notifyClient,
    allowOutsideHours,
    savingReschedule,
    editOutside,

    setReschedDate,
    setReschedTime,
    setDurationMinutes,
    setSelectedServiceId,
    setNotifyClient,
    setAllowOutsideHours,

    submitChanges,
    approveBooking,
    denyBooking,

    approveBookingById,
    denyBookingById,
    managementActionBusyId,
    managementActionError,

    openBookingOrBlock,
    closeBooking,

    pendingChange,
    confirmOpen,
    applyingChange,
    cancelConfirm,
    applyConfirm,

    pendingOutsideWorkingHours,

    ui: {
      suppressClickRef,
      suppressClickBriefly,
      isOverlayOpen,
    },

    drag: {
      onDragStart,
      onDropOnDayColumn,
    },
    resize: {
      beginResize,
    },

    openCreateForClick,

    utils,

    reload,
  }
}

export type CalendarData = ReturnType<typeof useCalendarData>