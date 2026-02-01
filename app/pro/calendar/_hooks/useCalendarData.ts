// app/pro/calendar/_hooks/useCalendarData.ts
'use client'

import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import type {
  BlockRow,
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
import { addDays, startOfMonth, startOfWeek, toIso, roundUpToNext15, clamp } from '../_utils/date'
import {
  PX_PER_MINUTE,
  SNAP_MINUTES,
  roundTo15,
  snapMinutes,
  computeDurationMinutesFromIso,
  isBlockedEvent,
  extractBlockId,
  blockToEvent,
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

/**
 * View range in UTC, anchored to TZ day boundaries (strict).
 * - Day: [start of day, +1 day)
 * - Week: start at Sunday 00:00 in tz, 7 days
 * - Month view: 6-week grid starting at week-start containing 1st of month (tz), 42 days
 */
function rangeForViewUtcInTimeZone(v: ViewMode, focusUtc: Date, tz: string) {
  const safeTz = sanitizeTimeZone(tz, DEFAULT_TIME_ZONE)

  if (v === 'day') {
    const from = startOfDayUtcInTimeZone(focusUtc, safeTz)
    const to = new Date(from.getTime() + 24 * 60 * 60_000)
    return { from, to }
  }

  // Week start: compute in TZ, then build from local Y/M/D at 00:00 in TZ.
  if (v === 'week') {
    const p = getZonedParts(focusUtc, safeTz)

    // Day-of-week in TZ (Sun=0..Sat=6)
    const weekdayShort = new Intl.DateTimeFormat('en-US', { timeZone: safeTz, weekday: 'short' }).format(focusUtc)
    const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
    const dow = map[weekdayShort] ?? 0

    // Local Y/M/D for week start in TZ
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

  // Month grid: find local first-of-month in TZ, then go to week start containing it, then 42 days.
  const p = getZonedParts(focusUtc, safeTz)

  const firstOfMonthUtc = zonedTimeToUtc({
    year: p.year,
    month: p.month,
    day: 1,
    hour: 12, // noon to avoid DST edge weirdness when deriving weekday
    minute: 0,
    second: 0,
    timeZone: safeTz,
  })

  const firstWeekdayShort = new Intl.DateTimeFormat('en-US', { timeZone: safeTz, weekday: 'short' }).format(
    firstOfMonthUtc,
  )
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const firstDow = map[firstWeekdayShort] ?? 0

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
  const [needsTimeZoneSetup, setNeedsTimeZoneSetup] = useState(false)

  // Working hours are per-locationType (SALON vs MOBILE)
  const [canSalon, setCanSalon] = useState(true)
  const [canMobile, setCanMobile] = useState(false)
  const [activeLocationType, setActiveLocationType] = useState<LocationType>('SALON')

  const [workingHours, setWorkingHours] = useState<WorkingHoursJson>(null)
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
  const [selectedServiceId, setSelectedServiceId] = useState<string>('')
  const [durationMinutes, setDurationMinutes] = useState<number>(60)
  const [allowOutsideHours, setAllowOutsideHours] = useState(false)

  // ✅ NEW: separate state for ManagementModal actions (don’t fight booking modal save state)
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

  useEffect(() => {
    return () => {
      if (suppressClickTimerRef.current) window.clearTimeout(suppressClickTimerRef.current)
      window.removeEventListener('mousemove', onResizeMove as any)
      window.removeEventListener('mouseup', onResizeEnd as any)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  async function loadServicesOnce() {
    if (servicesLoaded) return
    try {
      const res = await fetch('/api/pro/services', { cache: 'no-store' })
      const data = await safeJson(res)
      if (!res.ok) return
      setServices(Array.isArray(data?.services) ? data.services : [])
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
      const data = await safeJson(res)
      if (!res.ok) throw new Error(data?.error || 'Failed to save.')
      setAutoAccept(Boolean(data?.professionalProfile?.autoAcceptBookings))
    } catch (e) {
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
    const data = await safeJson(res)
    if (!res.ok) throw new Error(data?.error || `Failed to load ${locationType} hours.`)
    return (data?.workingHours ?? null) as WorkingHoursJson
  }

  async function loadCalendar() {
    const seq = ++loadSeqRef.current

    try {
      setLoading(true)
      setError(null)

      // 1) core
      const res = await fetch('/api/pro/calendar', { cache: 'no-store' })
      const data = await safeJson(res)

      if (seq !== loadSeqRef.current) return

      if (!res.ok) {
        setError(data?.error || `Failed to load calendar (${res.status}).`)
        return
      }

      const apiTzRaw = typeof data?.timeZone === 'string' ? data.timeZone.trim() : ''
      const apiTzValid = isValidIanaTimeZone(apiTzRaw)

      // ✅ Strict: if API tz is missing/invalid, do NOT use browser tz.
      // Use UTC for rendering and force tz setup in UI.
      const nextTz = apiTzValid ? apiTzRaw : DEFAULT_TIME_ZONE
      setTimeZone(nextTz)

      const needsSetup = Boolean(data?.needsTimeZoneSetup) || !apiTzValid
      setNeedsTimeZoneSetup(needsSetup)

      if (!apiTzValid) {
        console.warn('[Calendar] API timezone missing/invalid; forcing UTC until pro sets timezone.', { apiTzRaw })
      }

      const nextCanSalon = Boolean(data?.canSalon ?? true)
      const nextCanMobile = Boolean(data?.canMobile ?? false)
      setCanSalon(nextCanSalon)
      setCanMobile(nextCanMobile)

      setActiveLocationType((prev) => pickLocationType(nextCanSalon, nextCanMobile, prev))

      const bookingEvents = (Array.isArray(data?.events) ? data.events : []) as CalendarEvent[]

      setStats((data?.stats ?? null) as CalendarStats)
      setAutoAccept(Boolean(data?.autoAcceptBookings))

      const m = data?.management
      if (m && typeof m === 'object') {
        setManagement({
          todaysBookings: Array.isArray(m.todaysBookings) ? m.todaysBookings : [],
          pendingRequests: Array.isArray(m.pendingRequests) ? m.pendingRequests : [],
          waitlistToday: Array.isArray(m.waitlistToday) ? m.waitlistToday : [],
          blockedToday: Array.isArray(m.blockedToday) ? m.blockedToday : [],
        })
      } else {
        setManagement({ todaysBookings: [], pendingRequests: [], waitlistToday: [], blockedToday: [] })
      }

      // 2) range blocks (STRICT TZ RANGE)
      const { from, to } = rangeForViewUtcInTimeZone(view, currentDate, nextTz)

      const blocksRes = await fetch(
        `/api/pro/calendar/blocked?from=${encodeURIComponent(toIso(from))}&to=${encodeURIComponent(toIso(to))}`,
        { cache: 'no-store' },
      )
      const blocksData = await safeJson(blocksRes)
      if (seq !== loadSeqRef.current) return

      const blocks = (blocksRes.ok && Array.isArray(blocksData?.blocks) ? blocksData.blocks : []) as BlockRow[]
      const blockEvents = blocks.map(blockToEvent)

      // 3) working hours for ACTIVE type
      const effectiveLocationType = pickLocationType(nextCanSalon, nextCanMobile, activeLocationType)
      const nextHours = await loadWorkingHoursFor(effectiveLocationType)

      if (seq !== loadSeqRef.current) return
      setWorkingHours(nextHours)

      // 4) merge + sort
      const nextEvents = [...blockEvents, ...bookingEvents].sort(
        (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
      )
      setEvents(nextEvents)
    } catch (e) {
      console.error(e)
      if (seq === loadSeqRef.current) setError('Network error loading calendar.')
    } finally {
      if (seq === loadSeqRef.current) setLoading(false)
    }
  }

  // Load services once
  useEffect(() => {
    void loadServicesOnce()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reload calendar when view/currentDate changes
  useEffect(() => {
    void loadCalendar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, currentDate])

  // Reload workingHours when switching SALON/MOBILE
  useEffect(() => {
    let cancelled = false
    async function loadHoursOnly() {
      try {
        const next = await loadWorkingHoursFor(activeLocationType)
        if (!cancelled) setWorkingHours(next)
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load working hours.')
      }
    }
    void loadHoursOnly()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLocationType])

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
    const res = await fetch('/api/pro/calendar/blocked', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startsAt: startsAtIso, endsAt: endsAtIso, note: note ?? null }),
    })
    const data = await safeJson(res)
    if (!res.ok) throw new Error(data?.error || 'Failed to create block.')
    return (data?.block ?? data) as { id: string; startsAt: string; endsAt: string; note?: string | null }
  }

  async function oneClickBlockFullDay(day: Date) {
    try {
      setLoading(true)
      setError(null)
      const tz = sanitizeTimeZone(timeZone, DEFAULT_TIME_ZONE)
      const startUtc = startOfDayUtcInTimeZone(day, tz)
      const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60_000)
      await createBlock(startUtc.toISOString(), endUtc.toISOString(), 'Full day off')
      await loadCalendar()
    } catch (e: any) {
      console.error(e)
      setError(e?.message || 'Could not block full day.')
      setTimeout(() => setError(null), 3500)
    } finally {
      setLoading(false)
    }
  }

  function openCreateBlockNow() {
    // ✅ Round up in the calendar TZ, not browser local.
    const tz = sanitizeTimeZone(timeZone, DEFAULT_TIME_ZONE)
    const nowUtc = new Date()
    const p = getZonedParts(nowUtc, tz)
    const minutesNow = p.hour * 60 + p.minute
    const rounded = snapMinutes(Math.ceil(minutesNow / 15) * 15)
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

  // ✅ OPTION B: approve/deny directly from the ManagementModal by booking id
  async function setBookingStatusById(args: { bookingId: string; status: 'ACCEPTED' | 'CANCELLED' }) {
    const { bookingId, status } = args
    if (!bookingId) return
    if (managementActionBusyId) return

    setManagementActionBusyId(bookingId)
    setManagementActionError(null)

    const current = eventsRef.current.find((x) => x.id === bookingId)
    const currentStatus = String((current as any)?.status || '').toUpperCase()
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
      const data = await safeJson(res)
      if (!res.ok) throw new Error(data?.error || 'Failed to update booking.')
      await loadCalendar()
    } catch (e: any) {
      console.error(e)
      setManagementActionError(e?.message || 'Failed to update booking.')
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
      const data = await safeJson(res)
      if (!res.ok) throw new Error(data?.error || `Failed to load booking (${res.status}).`)

      const b = data?.booking as BookingDetails
      setBooking(b)

      // ✅ Fill inputs in CALENDAR TZ (strict), not browser local.
      const tz = sanitizeTimeZone(timeZone, DEFAULT_TIME_ZONE)
      const start = new Date(b.scheduledFor)
      setReschedDate(toDateInputValueInTimeZone(start, tz))
      setReschedTime(toTimeInputValueInTimeZone(start, tz))
      setNotifyClient(true)

      const svcList = (Array.isArray(data?.services) ? data.services : services) as ServiceOption[]
      if (svcList?.length) setServices(svcList)

      setSelectedServiceId(b.serviceId || '')
      setDurationMinutes(Number(b.totalDurationMinutes || 60))
    } catch (e: any) {
      console.error(e)
      setBookingError(e?.message || 'Failed to load booking.')
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
      workingHours,
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
        workingHours,
        timeZone: tz,
      })

      const res = await fetch(`/api/pro/bookings/${encodeURIComponent(booking.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduledFor: nextStart.toISOString(),
          totalDurationMinutes: snappedDur,
          serviceId: selectedServiceId || null,
          notifyClient,
          allowOutsideWorkingHours: outside ? Boolean(allowOutsideHours) : false,
        }),
      })
      const data = await safeJson(res)
      if (!res.ok) throw new Error(data?.error || 'Failed to save changes.')

      closeBooking()
      await loadCalendar()
    } catch (e: any) {
      console.error(e)
      setBookingError(e?.message || 'Failed to save changes.')
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
      const data = await safeJson(res)
      if (!res.ok) throw new Error(data?.error || 'Failed to approve booking.')
      closeBooking()
      await loadCalendar()
    } catch (e: any) {
      setBookingError(e?.message || 'Failed to approve booking.')
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
      const data = await safeJson(res)
      if (!res.ok) throw new Error(data?.error || 'Failed to deny booking.')
      closeBooking()
      await loadCalendar()
    } catch (e: any) {
      setBookingError(e?.message || 'Failed to deny booking.')
    } finally {
      setSavingReschedule(false)
    }
  }

  // Confirm modal helpers
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

  async function applyConfirm() {
    if (!pendingChange || applyingChange) return
    setApplyingChange(true)

    try {
      if (pendingChange.entityType === 'booking') {
        const payload: any = { notifyClient: true }
        if (pendingChange.kind === 'resize') payload.totalDurationMinutes = pendingChange.nextTotalDurationMinutes
        else payload.scheduledFor = pendingChange.nextStartIso

        const res = await fetch(`/api/pro/bookings/${encodeURIComponent(pendingChange.apiId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = await safeJson(res)
        if (!res.ok) throw new Error(data?.error || 'Failed to apply changes.')
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
        const data = await safeJson(res)
        if (!res.ok) throw new Error(data?.error || 'Failed to apply changes.')
      }

      setConfirmOpen(false)
      setPendingChange(null)
      await loadCalendar()
    } catch (e: any) {
      console.error(e)
      rollbackPending()
      setConfirmOpen(false)
      setPendingChange(null)
      setError(e?.message || 'Could not apply changes.')
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

  // Resize handlers
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

  function onResizeMove(e: MouseEvent) {
    const s = resizingRef.current
    if (!s) return

    const y = e.clientY - s.columnTop
    const endMinutes = snapMinutes(y / PX_PER_MINUTE)
    const rawDur = endMinutes - s.startMinutes

    const dur = Math.max(SNAP_MINUTES, roundTo15(rawDur))

    const tz = sanitizeTimeZone(timeZone, DEFAULT_TIME_ZONE)
    const start = utcFromDayAndMinutesInTimeZone(s.day, s.startMinutes, tz)
    const end = new Date(start.getTime() + dur * 60_000)

    setEvents((prev) => prev.map((ev) => (ev.id === s.eventId ? { ...ev, endsAt: end.toISOString(), durationMinutes: dur } : ev)))
  }

  function onResizeEnd() {
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

  return {
    view,
    currentDate,
    events,
    setEvents,

    timeZone,
    needsTimeZoneSetup,
    blockedMinutesToday,

    canSalon,
    canMobile,
    activeLocationType,
    setActiveLocationType,

    workingHours,
    setWorkingHours,

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

    // ✅ NEW: for ManagementModal Option B
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
