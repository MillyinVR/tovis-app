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
import { startOfDay, startOfMonth, startOfWeek, toDateInputValue, toIso, toTimeInputValue, roundUpToNext15, clamp } from '../_utils/date'
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
  isValidIanaTimeZone,
  sanitizeTimeZone,
  startOfDayUtcInTimeZone,
  zonedTimeToUtc,
  utcFromDayAndMinutesInTimeZone,
} from '@/lib/timeZone'

type Args = { view: ViewMode; currentDate: Date }
type LocationType = 'SALON' | 'MOBILE'

function getBrowserTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (tz && isValidIanaTimeZone(tz)) return tz
  } catch {
    // ignore
  }
  return 'UTC'
}

// Anchor a "day" to local noon to avoid DST edges for weekday math.
function anchorDayLocalNoon(year: number, month1: number, day: number) {
  return new Date(year, month1 - 1, day, 12, 0, 0, 0)
}

function pickLocationType(canSalon: boolean, canMobile: boolean, preferred?: LocationType): LocationType {
  if (preferred && ((preferred === 'SALON' && canSalon) || (preferred === 'MOBILE' && canMobile))) return preferred
  if (canSalon) return 'SALON'
  if (canMobile) return 'MOBILE'
  return 'SALON'
}

export function useCalendarData({ view, currentDate }: Args) {
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const eventsRef = useRef<CalendarEvent[]>([])
  useEffect(() => {
    eventsRef.current = events
  }, [events])

  // default: browser TZ, later replaced by API TZ
  const [timeZone, setTimeZone] = useState<string>(getBrowserTimeZone())
  const [needsTimeZoneSetup, setNeedsTimeZoneSetup] = useState(false)
  const tzSetupSavedRef = useRef(false)

  // Working hours are now per-locationType (SALON vs MOBILE)
  const [canSalon, setCanSalon] = useState(true)
  const [canMobile, setCanMobile] = useState(false)
  const [activeLocationType, setActiveLocationType] = useState<LocationType>('SALON')

  const [workingHours, setWorkingHours] = useState<WorkingHoursJson>(null) // hours for ACTIVE locationType
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

  function rangeForViewUtcInProTz(v: ViewMode, d: Date, tz: string) {
    const safeTz = sanitizeTimeZone(tz, 'UTC')

    if (v === 'day') {
      const fromLocal = startOfDay(d)
      const from = startOfDayUtcInTimeZone(fromLocal, safeTz)
      const to = new Date(from.getTime() + 24 * 60 * 60_000)
      return { from, to }
    }
    if (v === 'week') {
      const fromLocal = startOfWeek(d)
      const from = startOfDayUtcInTimeZone(fromLocal, safeTz)
      const to = new Date(from.getTime() + 7 * 24 * 60 * 60_000)
      return { from, to }
    }
    const fromLocal = startOfWeek(startOfMonth(d))
    const from = startOfDayUtcInTimeZone(fromLocal, safeTz)
    const to = new Date(from.getTime() + 42 * 24 * 60 * 60_000)
    return { from, to }
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

  async function saveTimeZoneIfMissing(tz: string) {
    if (tzSetupSavedRef.current) return
    tzSetupSavedRef.current = true
    try {
      const res = await fetch('/api/pro/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeZone: tz }),
      })
      if (!res.ok) tzSetupSavedRef.current = false
    } catch {
      tzSetupSavedRef.current = false
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

      // 1) Load calendar core (events, tz, canSalon/canMobile, stats, autoAccept, management)
      const res = await fetch('/api/pro/calendar', { cache: 'no-store' })
      const data = await safeJson(res)

      if (seq !== loadSeqRef.current) return

      if (!res.ok) {
        setError(data?.error || `Failed to load calendar (${res.status}).`)
        return
      }

      const browserTz = getBrowserTimeZone()
      const apiTzRaw = typeof data?.timeZone === 'string' ? data.timeZone.trim() : ''
      const apiTzValid = isValidIanaTimeZone(apiTzRaw)
      const nextTz = apiTzValid ? apiTzRaw : browserTz || 'UTC'

      setTimeZone(nextTz)

      const needsSetup = Boolean(data?.needsTimeZoneSetup) || !apiTzValid
      setNeedsTimeZoneSetup(needsSetup)

      if (needsSetup && isValidIanaTimeZone(browserTz)) {
        void saveTimeZoneIfMissing(browserTz)
      }

      const nextCanSalon = Boolean(data?.canSalon ?? true)
      const nextCanMobile = Boolean(data?.canMobile ?? false)
      setCanSalon(nextCanSalon)
      setCanMobile(nextCanMobile)

      // Keep active tab valid as permissions change
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

      // 2) Range-based blocked events
      const { from, to } = rangeForViewUtcInProTz(view, currentDate, nextTz)

      const blocksRes = await fetch(
        `/api/pro/calendar/blocked?from=${encodeURIComponent(toIso(from))}&to=${encodeURIComponent(toIso(to))}`,
        { cache: 'no-store' },
      )
      const blocksData = await safeJson(blocksRes)
      if (seq !== loadSeqRef.current) return

      const blocks = (blocksRes.ok && Array.isArray(blocksData?.blocks) ? blocksData.blocks : []) as BlockRow[]
      const blockEvents = blocks.map(blockToEvent)

      // 3) Working hours for ACTIVE location type (SALON/MOBILE)
      const effectiveLocationType = pickLocationType(nextCanSalon, nextCanMobile, activeLocationType)
      const nextHours = await loadWorkingHoursFor(effectiveLocationType)

      if (seq !== loadSeqRef.current) return

      setWorkingHours(nextHours)

      // 4) Merge + sort
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

  // Reload workingHours when the user switches SALON/MOBILE
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

  // blocked minutes today computed locally (timezone-aware)
  const blockedMinutesToday = useMemo(() => {
    const tz = sanitizeTimeZone(timeZone, 'UTC')
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
      const tz = sanitizeTimeZone(timeZone, 'UTC')
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
    const start = roundUpToNext15(new Date())
    setBlockCreateInitialStart(start)
    setBlockCreateOpen(true)
  }

  function openEditBlockFromEvent(ev: CalendarEvent) {
    const bid = extractBlockId(ev)
    if (!bid) return
    setEditBlockId(bid)
    setEditBlockOpen(true)
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

      const start = new Date(b.scheduledFor)
      setReschedDate(toDateInputValue(start))
      setReschedTime(toTimeInputValue(start))
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
      timeZone: sanitizeTimeZone(timeZone, 'UTC'),
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

      const tz = sanitizeTimeZone(timeZone, 'UTC')

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
          pendingChange.kind === 'move'
            ? pendingChange.nextStartIso
            : current?.startsAt ?? pendingChange.original.startsAt

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

    const tz = sanitizeTimeZone(timeZone, 'UTC')
    const nextStart = utcFromDayAndMinutesInTimeZone(day, topMinutes, tz)

    if (nextStart.toISOString() === original.startsAt) return

    const dur = eventDurationMinutes(original)
    const nextEnd = new Date(nextStart.getTime() + dur * 60_000)

    setEvents((prev) =>
      prev.map((e) =>
        e.id === eventId
          ? { ...e, startsAt: nextStart.toISOString(), endsAt: nextEnd.toISOString(), durationMinutes: dur }
          : e,
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

    // ✅ Never allow 0/negative durations while resizing
    const dur = Math.max(SNAP_MINUTES, roundTo15(rawDur))

    const tz = sanitizeTimeZone(timeZone, 'UTC')
    const start = utcFromDayAndMinutesInTimeZone(s.day, s.startMinutes, tz)
    const end = new Date(start.getTime() + dur * 60_000)

    setEvents((prev) =>
      prev.map((ev) => (ev.id === s.eventId ? { ...ev, endsAt: end.toISOString(), durationMinutes: dur } : ev)),
    )
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
        prev.map((x) =>
          x.id === s.eventId ? { ...x, endsAt: rollbackEnd.toISOString(), durationMinutes: s.originalDuration } : x,
        ),
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

    const tz = sanitizeTimeZone(timeZone, 'UTC')
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

    // ✅ New: location mode awareness
    canSalon,
    canMobile,
    activeLocationType,
    setActiveLocationType,

    // Working hours for the ACTIVE location type
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
