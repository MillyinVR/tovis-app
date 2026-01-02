// app/pro/calendar/page.tsx
'use client'

import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import WorkingHoursForm from './WorkingHoursForm'
import CreateBookingModal from './CreateBookingModal'
import BlockTimeModal from './BlockTimeModal'
import EditBlockModal from './EditBlockModal'

type CalendarStatus = 'PENDING' | 'ACCEPTED' | 'COMPLETED' | 'CANCELLED' | 'WAITLIST' | 'BLOCKED' | string

type CalendarEvent = {
  id: string
  startsAt: string
  endsAt: string
  title: string
  clientName: string
  status: CalendarStatus
  durationMinutes?: number
  note?: string | null
  blockId?: string
  kind?: string
}

type ViewMode = 'day' | 'week' | 'month'

const PX_PER_MINUTE = 1
const SNAP_MINUTES = 15
const MIN_DURATION = 15
const MAX_DURATION = 12 * 60

type WorkingHoursJson = {
  [key: string]: {
    enabled: boolean
    start: string
    end: string
  }
} | null

type CalendarStats = {
  todaysBookings: number
  availableHours: number | null
  pendingRequests: number
  blockedHours: number | null
} | null

type ServiceOption = { id: string; name: string; durationMinutes?: number | null; offeringId?: string }

type BookingDetails = {
  id: string
  status: string
  scheduledFor: string
  endsAt: string
  totalDurationMinutes: number
  bufferMinutes?: number
  serviceId: string | null
  serviceName: string
  client: {
    fullName: string
    email: string | null
    phone: string | null
  }
  timeZone: string
}

type EntityType = 'booking' | 'block'

type PendingChange =
  | {
      kind: 'resize'
      entityType: EntityType
      eventId: string
      apiId: string
      nextTotalDurationMinutes: number
      original: CalendarEvent
    }
  | {
      kind: 'move'
      entityType: EntityType
      eventId: string
      apiId: string
      nextStartIso: string
      original: CalendarEvent
    }

type ManagementKey = 'todaysBookings' | 'pendingRequests' | 'waitlistToday' | 'blockedToday'

type ManagementLists = {
  todaysBookings: CalendarEvent[]
  pendingRequests: CalendarEvent[]
  waitlistToday: CalendarEvent[]
  blockedToday: CalendarEvent[]
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

function startOfDay(d: Date) {
  const nd = new Date(d)
  nd.setHours(0, 0, 0, 0)
  return nd
}

function addDays(d: Date, days: number) {
  const nd = new Date(d)
  nd.setDate(nd.getDate() + days)
  return nd
}

function startOfWeek(d: Date) {
  const nd = startOfDay(d)
  const day = nd.getDay()
  const diff = (day + 6) % 7
  nd.setDate(nd.getDate() - diff)
  return nd
}

function startOfMonth(d: Date) {
  const nd = new Date(d.getFullYear(), d.getMonth(), 1)
  nd.setHours(0, 0, 0, 0)
  return nd
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function formatDayLabel(d: Date) {
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

function formatMonthRange(d: Date) {
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

function formatWeekRange(d: Date) {
  const weekStart = startOfWeek(d)
  const weekEnd = addDays(weekStart, 6)
  const startStr = weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const endStr = weekEnd.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return `${startStr} – ${endStr}`
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function snapMinutes(mins: number) {
  const snapped = Math.round(mins / SNAP_MINUTES) * SNAP_MINUTES
  return clamp(snapped, 0, 24 * 60 - SNAP_MINUTES)
}

function roundTo15(mins: number) {
  const snapped = Math.round(mins / SNAP_MINUTES) * SNAP_MINUTES
  return clamp(snapped, MIN_DURATION, MAX_DURATION)
}

function toDateInputValue(d: Date) {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function toTimeInputValue(d: Date) {
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function setDateTimeParts(baseDate: Date, hhmm: string) {
  const [hhStr, mmStr] = (hhmm || '').split(':')
  const hh = Number(hhStr)
  const mm = Number(mmStr)
  const out = new Date(baseDate)
  out.setHours(Number.isFinite(hh) ? hh : 0, Number.isFinite(mm) ? mm : 0, 0, 0)
  return out
}

function roundUpToNext15(date: Date) {
  const d = new Date(date)
  d.setSeconds(0, 0)
  const mins = d.getMinutes()
  const next = Math.ceil(mins / 15) * 15
  d.setMinutes(next === 60 ? 0 : next)
  if (next === 60) d.setHours(d.getHours() + 1)
  return d
}

async function safeJson(res: Response) {
  return res.json().catch(() => ({})) as Promise<any>
}

function getWorkingWindowForDate(date: Date, workingHours: WorkingHoursJson) {
  if (!workingHours) return null
  const key = DAY_KEYS[date.getDay()]
  const cfg = (workingHours as any)[key]
  if (!cfg || !cfg.enabled || !cfg.start || !cfg.end) return null

  const [sh, sm] = String(cfg.start).split(':').map((x: string) => parseInt(x, 10) || 0)
  const [eh, em] = String(cfg.end).split(':').map((x: string) => parseInt(x, 10) || 0)

  const startMinutes = sh * 60 + sm
  const endMinutes = eh * 60 + em
  if (endMinutes <= startMinutes) return null
  return { startMinutes, endMinutes }
}

function isOutsideWorkingHours(args: { day: Date; startMinutes: number; endMinutes: number; workingHours: WorkingHoursJson }) {
  const { day, startMinutes, endMinutes, workingHours } = args
  const key = DAY_KEYS[day.getDay()]
  const cfg = workingHours && (workingHours as any)[key] ? (workingHours as any)[key] : null
  if (!cfg || !cfg.enabled) return true
  const window = getWorkingWindowForDate(day, workingHours)
  if (!window) return true
  return startMinutes < window.startMinutes || endMinutes > window.endMinutes
}

function statusLabel(s: CalendarStatus) {
  const v = String(s || '').toUpperCase()
  if (v === 'ACCEPTED') return 'Accepted'
  if (v === 'PENDING') return 'Pending'
  if (v === 'COMPLETED') return 'Completed'
  if (v === 'CANCELLED') return 'Cancelled'
  if (v === 'WAITLIST') return 'Waitlist'
  if (v === 'BLOCKED') return 'Blocked'
  return v || 'Unknown'
}

function eventChipStyle(ev: CalendarEvent) {
  const s = String(ev.status || '').toUpperCase()
  if (s === 'COMPLETED') return { bg: '#d1fae5', border: '#10b981' }
  if (s === 'ACCEPTED') return { bg: '#bfdbfe', border: '#3b82f6' }
  if (s === 'PENDING') return { bg: '#fef9c3', border: '#eab308' }
  if (s === 'WAITLIST') return { bg: '#e0e7ff', border: '#6366f1' }
  if (s === 'BLOCKED') return { bg: '#f4f4f5', border: '#71717a' }
  return { bg: '#fee2e2', border: '#ef4444' }
}

function isBlockedEvent(ev: CalendarEvent) {
  const s = String(ev.status || '').toUpperCase()
  if (s === 'BLOCKED') return true
  if (String(ev.id || '').startsWith('block:')) return true
  if (String(ev.kind || '').toUpperCase() === 'BLOCK') return true
  return false
}

function extractBlockId(ev: CalendarEvent) {
  if (ev.blockId) return ev.blockId
  const id = String(ev.id || '')
  if (id.startsWith('block:')) return id.slice('block:'.length)
  return null
}

function computeDurationMinutesFromIso(startsAtIso: string, endsAtIso: string) {
  const s = new Date(startsAtIso).getTime()
  const e = new Date(endsAtIso).getTime()
  const mins = Math.round((e - s) / 60_000)
  return Number.isFinite(mins) && mins > 0 ? mins : 60
}

function toIso(d: Date) {
  return new Date(d).toISOString()
}

function rangeForView(view: ViewMode, currentDate: Date) {
  if (view === 'day') {
    const from = startOfDay(currentDate)
    const to = addDays(from, 1)
    return { from, to }
  }
  if (view === 'week') {
    const from = startOfWeek(currentDate)
    const to = addDays(from, 7)
    return { from, to }
  }
  const from = startOfWeek(startOfMonth(currentDate))
  const to = addDays(from, 42)
  return { from, to }
}

type BlockRow = { id: string; startsAt: string | Date; endsAt: string | Date; note?: string | null }

function blockToEvent(b: BlockRow): CalendarEvent {
  const s = new Date(b.startsAt)
  const e = new Date(b.endsAt)
  const note = b.note ?? null
  return {
    id: `block:${b.id}`,
    blockId: b.id,
    kind: 'BLOCK',
    status: 'BLOCKED',
    title: 'Blocked',
    clientName: note || 'Personal time',
    note,
    startsAt: s.toISOString(),
    endsAt: e.toISOString(),
    durationMinutes: Math.max(15, Math.round((e.getTime() - s.getTime()) / 60_000)),
  }
}

export default function ProCalendarPage() {
  const [view, setView] = useState<ViewMode>('week')
  const [currentDate, setCurrentDate] = useState(new Date())
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const eventsRef = useRef<CalendarEvent[]>([])
  useEffect(() => {
    eventsRef.current = events
  }, [events])

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

  function openManagement(key: ManagementKey) {
    setManagementKey(key)
    setManagementOpen(true)
  }
  function closeManagement() {
    setManagementOpen(false)
  }

  function managementTitle(key: ManagementKey) {
    if (key === 'todaysBookings') return "Today's bookings"
    if (key === 'pendingRequests') return 'Pending requests'
    if (key === 'waitlistToday') return 'Waitlist (today)'
    return 'Blocked time (today)'
  }

  function managementDescription(key: ManagementKey) {
    if (key === 'todaysBookings') return 'Accepted + completed appointments happening today.'
    if (key === 'pendingRequests') return 'Requests waiting on you to accept/reschedule/decline.'
    if (key === 'waitlistToday') return 'Clients trying to get in today.'
    return 'Time you blocked off for yourself.'
  }

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

  useEffect(() => {
    return () => {
      if (suppressClickTimerRef.current) window.clearTimeout(suppressClickTimerRef.current)
      window.removeEventListener('mousemove', onResizeMove as any)
      window.removeEventListener('mouseup', onResizeEnd as any)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      setAutoAccept((prev: boolean) => !prev)
    } finally {
      setSavingAutoAccept(false)
    }
  }

  function deriveManagementFromEvents(evts: CalendarEvent[]) {
    const now = new Date()
    const todayStart = startOfDay(now)
    const todayEnd = new Date(todayStart)
    todayEnd.setHours(23, 59, 59, 999)

    const isTodayIso = (iso: string) => {
      const t = new Date(iso).getTime()
      return t >= todayStart.getTime() && t <= todayEnd.getTime()
    }

    const todaysBookings = evts.filter((e) => {
      const s = String(e.status || '').toUpperCase()
      return isTodayIso(e.startsAt) && (s === 'ACCEPTED' || s === 'COMPLETED')
    })

    const pendingRequests = evts.filter((e) => {
      const s = String(e.status || '').toUpperCase()
      return s === 'PENDING' && isTodayIso(e.startsAt)
    })


    const waitlistToday = evts.filter((e) => {
      const s = String(e.status || '').toUpperCase()
      return isTodayIso(e.startsAt) && s === 'WAITLIST'
    })

    const blockedToday = evts.filter((e) => {
      if (!isBlockedEvent(e)) return false
      const s = new Date(e.startsAt).getTime()
      const en = new Date(e.endsAt).getTime()
      return s < todayEnd.getTime() && en > todayStart.getTime()
    })


    return { todaysBookings, pendingRequests, waitlistToday, blockedToday }
  }

  async function loadCalendar() {
    try {
      setLoading(true)
      setError(null)

      const res = await fetch('/api/pro/calendar', { cache: 'no-store' })
      const data = await safeJson(res)
      if (!res.ok) {
        setError(data?.error || `Failed to load calendar (${res.status}).`)
        return
      }

      const bookingEvents = (data.events || []) as CalendarEvent[]

      const { from, to } = rangeForView(view, currentDate)
      const blocksRes = await fetch(
        `/api/pro/calendar/blocked?from=${encodeURIComponent(toIso(from))}&to=${encodeURIComponent(toIso(to))}`,
        { cache: 'no-store' },
      )
      const blocksData = await safeJson(blocksRes)
      const blocks = (blocksRes.ok && Array.isArray(blocksData?.blocks) ? blocksData.blocks : []) as BlockRow[]
      const blockEvents = blocks.map(blockToEvent)

      const nextEvents = [...blockEvents, ...bookingEvents].sort(
        (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
      )

      setEvents(nextEvents)
      setWorkingHours(data.workingHours || null)
      setStats(data.stats || null)
      setAutoAccept(Boolean(data.autoAcceptBookings))

      const m = data?.management
      if (m && typeof m === 'object') {
        setManagement({
          todaysBookings: Array.isArray(m.todaysBookings) ? m.todaysBookings : [],
          pendingRequests: Array.isArray(m.pendingRequests) ? m.pendingRequests : [],
          waitlistToday: Array.isArray(m.waitlistToday) ? m.waitlistToday : [],
          blockedToday: Array.isArray(m.blockedToday) ? m.blockedToday : deriveManagementFromEvents(nextEvents).blockedToday,
        })
      } else {
        setManagement(deriveManagementFromEvents(nextEvents))
      }
    } catch (e) {
      console.error(e)
      setError('Network error loading calendar.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadServicesOnce()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void loadCalendar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, currentDate])

  const visibleDays: Date[] = useMemo(() => {
    if (view === 'day') return [startOfDay(currentDate)]
    if (view === 'week') {
      const start = startOfWeek(currentDate)
      return Array.from({ length: 7 }, (_, i) => addDays(start, i))
    }
    const first = startOfMonth(currentDate)
    const firstWeekStart = startOfWeek(first)
    return Array.from({ length: 42 }, (_, i) => addDays(firstWeekStart, i))
  }, [view, currentDate])

  const hours = useMemo(() => Array.from({ length: 24 }, (_, h) => h), [])

  function overlapMinutesWithinDay(startsAtIso: string, endsAtIso: string, day: Date) {
    const dayStart = startOfDay(day)
    const dayEnd = addDays(dayStart, 1)

    const s = new Date(startsAtIso)
    const e = new Date(endsAtIso)

    const startMs = Math.max(s.getTime(), dayStart.getTime())
    const endMs = Math.min(e.getTime(), dayEnd.getTime())

    const mins = Math.round((endMs - startMs) / 60_000)
    return mins > 0 ? mins : 0
  }

  function formatHoursFromMinutes(mins: number) {
    const hours = mins / 60
    // nice readable: 0h, 0.5h, 1h, 1.25h etc.
    const rounded = Math.round(hours * 10) / 10
    return `${rounded}h`
  }

  function eventsForDay(day: Date) {
    return events.filter((ev) => isSameDay(new Date(ev.startsAt), day))
  }

  function handleToday() {
    setCurrentDate(new Date())
  }

  function handleBack() {
    if (view === 'day') setCurrentDate((d) => addDays(d, -1))
    else if (view === 'week') setCurrentDate((d) => addDays(d, -7))
    else setCurrentDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, d.getDate()))
  }

  function handleNext() {
    if (view === 'day') setCurrentDate((d) => addDays(d, 1))
    else if (view === 'week') setCurrentDate((d) => addDays(d, 7))
    else setCurrentDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, d.getDate()))
  }

  const headerLabel =
    view === 'month'
      ? formatMonthRange(currentDate)
      : view === 'week'
        ? formatWeekRange(currentDate)
        : currentDate.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })

  function eventDurationMinutes(ev: CalendarEvent) {
    if (Number.isFinite(ev.durationMinutes) && (ev.durationMinutes as number) > 0) return ev.durationMinutes as number
    return computeDurationMinutesFromIso(ev.startsAt, ev.endsAt)
  }

  // -------------------------
  // Block modal helpers
  // -------------------------
  function openCreateBlockNow() {
    const start = roundUpToNext15(new Date())
    setBlockCreateInitialStart(start)
    setBlockCreateOpen(true)
  }

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

      const start = startOfDay(day)
      const end = addDays(start, 1)

      await createBlock(start.toISOString(), end.toISOString(), 'Full day off')
      await loadCalendar()
    } catch (e: any) {
      console.error(e)
      setError(e?.message || 'Could not block full day.')
      setTimeout(() => setError(null), 3500)
    } finally {
      setLoading(false)
    }
  }

  function openEditBlockFromEvent(ev: CalendarEvent) {
    const bid = extractBlockId(ev)
    if (!bid) return
    setEditBlockId(bid)
    setEditBlockOpen(true)
  }

  // -------------------------
  // Edit booking modal
  // -------------------------
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
    const base = new Date(booking.scheduledFor)
    const [yyyy, mm, dd] = (reschedDate || '').split('-').map((x) => Number(x))
    if (!yyyy || !mm || !dd) return false

    const day = new Date(yyyy, mm - 1, dd, base.getHours(), base.getMinutes(), 0, 0)
    const nextStart = setDateTimeParts(day, reschedTime)

    const startMinutes = nextStart.getHours() * 60 + nextStart.getMinutes()
    const dur = roundTo15(Number(durationMinutes || booking.totalDurationMinutes || 60))
    const endMinutes = startMinutes + dur

    return isOutsideWorkingHours({ day: nextStart, startMinutes, endMinutes, workingHours })
  }

  async function submitChanges() {
    if (!booking || savingReschedule) return
    setSavingReschedule(true)
    setBookingError(null)

    try {
      const base = new Date(booking.scheduledFor)
      const [yyyy, mm, dd] = (reschedDate || '').split('-').map((x) => Number(x))
      if (!yyyy || !mm || !dd) throw new Error('Pick a valid date.')

      const day = new Date(yyyy, mm - 1, dd, base.getHours(), base.getMinutes(), 0, 0)
      const nextStart = setDateTimeParts(day, reschedTime)
      const snappedDur = roundTo15(Number(durationMinutes))

      const outside = isOutsideWorkingHours({
        day: nextStart,
        startMinutes: nextStart.getHours() * 60 + nextStart.getMinutes(),
        endMinutes: nextStart.getHours() * 60 + nextStart.getMinutes() + snappedDur,
        workingHours,
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


  // -------------------------
  // Confirm modal helpers
  // -------------------------
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
        const startIso = pendingChange.kind === 'move' ? pendingChange.nextStartIso : current?.startsAt ?? pendingChange.original.startsAt
        const dur = pendingChange.kind === 'resize' ? pendingChange.nextTotalDurationMinutes : eventDurationMinutes(pendingChange.original)
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

  // -------------------------
  // Drag move
  // -------------------------
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

    const nextStart = startOfDay(day)
    nextStart.setMinutes(topMinutes, 0, 0)

    if (nextStart.toISOString() === original.startsAt) return

    const dur = eventDurationMinutes(original)
    const nextEnd = new Date(nextStart.getTime() + dur * 60_000)

    setEvents((prev) =>
      prev.map((e) => (e.id === eventId ? { ...e, startsAt: nextStart.toISOString(), endsAt: nextEnd.toISOString(), durationMinutes: dur } : e)),
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

  // -------------------------
  // Resize
  // -------------------------
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
    const dur = roundTo15(rawDur)

    const start = startOfDay(s.day)
    start.setMinutes(s.startMinutes, 0, 0)
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
    const dur = roundTo15(raw)

    if (dur === s.originalDuration) {
      const rollbackEnd = new Date(start.getTime() + s.originalDuration * 60_000)
      setEvents((prev) => prev.map((x) => (x.id === s.eventId ? { ...x, endsAt: rollbackEnd.toISOString(), durationMinutes: s.originalDuration } : x)))
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

  // -------------------------
  // Click-to-create booking
  // -------------------------
  function openCreateForClick(day: Date, clientY: number, columnTop: number) {
    if (confirmOpen || pendingChange || openBookingId) return
    if (managementOpen) return
    if (blockCreateOpen || editBlockOpen) return

    const y = clientY - columnTop
    const mins = snapMinutes(y / PX_PER_MINUTE)

    const start = startOfDay(day)
    start.setMinutes(mins, 0, 0)

    setCreateInitialStart(start)
    setCreateOpen(true)
  }

  const editOutside = booking ? editWouldBeOutsideHours() : false
  const activeList = management[managementKey] || []
  const activeCount = activeList.length

  const blockedMinutesToday = useMemo(() => {
    const today = new Date()
    return (events ?? [])
      .filter((ev) => isBlockedEvent(ev))
      .reduce((sum, ev) => sum + overlapMinutesWithinDay(ev.startsAt, ev.endsAt, today), 0)
  }, [events])



  return (
    <main style={{ maxWidth: 1100, margin: '40px auto', padding: '0 16px', fontFamily: 'system-ui' }}>
      <header style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 4 }}>Calendar</h1>
          <p style={{ fontSize: 13, color: '#555' }}>Visual overview of your day, week, or month.</p>
        </div>
        <a href="/pro" style={{ fontSize: 12, color: '#555', textDecoration: 'none' }}>
          ← Back to pro dashboard
        </a>
      </header>

      {/* MANAGEMENT STRIP */}
      <section style={{ borderRadius: 12, padding: 16, marginBottom: 16, background: '#111', color: '#fff' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Calendar management</div>
            <div style={{ fontSize: 12, color: '#ddd' }}>Manage availability and appointments.</div>
          </div>

          <button
            type="button"
            onClick={() => setShowHoursForm((v) => !v)}
            style={{
              padding: '6px 10px',
              borderRadius: 999,
              border: '1px solid #fff',
              background: showHoursForm ? '#fff' : 'transparent',
              color: showHoursForm ? '#111' : '#fff',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            {showHoursForm ? 'Hide schedule editor' : 'Edit working hours'}
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, marginTop: 16 }}>
          <button
            type="button"
            onClick={() => openManagement('todaysBookings')}
            style={{
              borderRadius: 10,
              padding: 12,
              background: '#18181b',
              fontSize: 12,
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.12)',
              textAlign: 'left',
              cursor: 'pointer',
            }}
          >
            <div style={{ marginBottom: 4, color: '#a1a1aa' }}>Today&apos;s bookings</div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>{stats?.todaysBookings ?? management.todaysBookings.length ?? 0}</div>
            <div style={{ marginTop: 6, fontSize: 11, color: '#a1a1aa' }}>View list</div>
          </button>

          <button
            type="button"
            onClick={() => openManagement('waitlistToday')}
            style={{
              borderRadius: 10,
              padding: 12,
              background: '#18181b',
              fontSize: 12,
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.12)',
              textAlign: 'left',
              cursor: 'pointer',
            }}
          >
            <div style={{ marginBottom: 4, color: '#a1a1aa' }}>Waitlist (today)</div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>{management.waitlistToday.length}</div>
            <div style={{ marginTop: 6, fontSize: 11, color: '#a1a1aa' }}>View list</div>
          </button>

          <button
            type="button"
            onClick={() => openManagement('pendingRequests')}
            style={{
              borderRadius: 10,
              padding: 12,
              background: '#18181b',
              fontSize: 12,
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.12)',
              textAlign: 'left',
              cursor: 'pointer',
            }}
          >
            <div style={{ marginBottom: 4, color: '#a1a1aa' }}>Pending requests</div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>{stats?.pendingRequests ?? management.pendingRequests.length ?? 0}</div>
            <div style={{ marginTop: 6, fontSize: 11, color: '#a1a1aa' }}>Review</div>
          </button>

          <button
            type="button"
            onClick={() => openManagement('blockedToday')}
            style={{
              borderRadius: 10,
              padding: 12,
              background: '#18181b',
              fontSize: 12,
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.12)',
              textAlign: 'left',
              cursor: 'pointer',
            }}
          >
            <div style={{ marginBottom: 4, color: '#a1a1aa' }}>Blocked time (today)</div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>
              {formatHoursFromMinutes(blockedMinutesToday)}
            </div>
            <div style={{ marginTop: 6, fontSize: 11, color: '#a1a1aa' }}>View list</div>
          </button>
        </div>

        <div
          style={{
            marginTop: 12,
            borderRadius: 10,
            padding: 12,
            background: '#18181b',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800 }}>Auto-accept bookings</div>
            <div style={{ fontSize: 12, color: '#a1a1aa', marginTop: 2 }}>
              When enabled, new client requests go straight to <b>Accepted</b>.
            </div>
          </div>

          <button
            type="button"
            onClick={() => toggleAutoAccept(!autoAccept)}
            disabled={savingAutoAccept}
            style={{
              padding: '8px 12px',
              borderRadius: 999,
              border: '1px solid #fff',
              background: autoAccept ? '#fff' : 'transparent',
              color: autoAccept ? '#111' : '#fff',
              fontSize: 12,
              fontWeight: 900,
              cursor: savingAutoAccept ? 'default' : 'pointer',
              opacity: savingAutoAccept ? 0.7 : 1,
              whiteSpace: 'nowrap',
            }}
          >
            {savingAutoAccept ? 'Saving…' : autoAccept ? 'On' : 'Off'}
          </button>
        </div>

        {showHoursForm && (
          <div style={{ marginTop: 16, padding: 12, borderRadius: 10, background: '#18181b' }}>
            <WorkingHoursForm initialHours={workingHours} onSaved={(next) => setWorkingHours(next)} />
          </div>
        )}
      </section>

      {/* Controls */}
      <section style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button type="button" onClick={handleToday} style={{ padding: '6px 10px', borderRadius: 999, border: '1px solid #ddd', background: '#f9f9f9', fontSize: 12, cursor: 'pointer' }}>
            Today
          </button>
          <button type="button" onClick={handleBack} style={{ padding: '6px 10px', borderRadius: 999, border: '1px solid #ddd', background: '#f9f9f9', fontSize: 12, cursor: 'pointer' }}>
            ‹ Back
          </button>
          <button type="button" onClick={handleNext} style={{ padding: '6px 10px', borderRadius: 999, border: '1px solid #ddd', background: '#f9f9f9', fontSize: 12, cursor: 'pointer' }}>
            Next ›
          </button>

          <div style={{ marginLeft: 12, fontSize: 14, fontWeight: 500 }}>{headerLabel}</div>
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {(['day', 'week', 'month'] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setView(mode)}
              style={{
                padding: '6px 10px',
                borderRadius: 999,
                border: '1px solid #ddd',
                fontSize: 12,
                cursor: 'pointer',
                background: view === mode ? '#111' : '#f9f9f9',
                color: view === mode ? '#fff' : '#111',
              }}
            >
              {mode[0].toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>
      </section>

      {loading && <div style={{ fontSize: 13, color: '#777', marginBottom: 8 }}>Loading…</div>}
      {error && <div style={{ fontSize: 13, color: 'red', marginBottom: 8 }}>{error}</div>}

      {/* DAY / WEEK */}
      {view === 'day' || view === 'week' ? (
        <section style={{ borderRadius: 12, border: '1px solid #eee', overflow: 'hidden', background: '#fff' }}>
          <div style={{ display: 'grid', gridTemplateColumns: `80px repeat(${visibleDays.length}, 1fr)`, borderBottom: '1px solid #eee', background: '#fafafa' }}>
            <div />
            {visibleDays.map((d, idx) => (
              <div key={idx} style={{ padding: '8px 6px', borderLeft: idx === 0 ? 'none' : '1px solid #eee', fontSize: 12, fontWeight: 500 }}>
                {formatDayLabel(d)}
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: `80px repeat(${visibleDays.length}, 1fr)`, position: 'relative', maxHeight: 700, overflowY: 'auto' }}>
            {/* hour labels */}
            <div style={{ borderRight: '1px solid #eee', background: '#fafafa', position: 'relative' }}>
              <div style={{ position: 'relative', height: 24 * 60 * PX_PER_MINUTE }}>
                {hours.map((h) => (
                  <div
                    key={h}
                    style={{
                      position: 'absolute',
                      top: h * 60 * PX_PER_MINUTE,
                      height: 60 * PX_PER_MINUTE,
                      fontSize: 11,
                      color: '#777',
                      paddingTop: 2,
                      paddingLeft: 4,
                      boxSizing: 'border-box',
                    }}
                  >
                    {new Date(0, 0, 0, h).toLocaleTimeString(undefined, { hour: 'numeric', minute: undefined }).replace(':00', '')}
                  </div>
                ))}
              </div>
            </div>

            {/* day columns */}
            {visibleDays.map((day, dayIdx) => {
              const dayEvents = eventsForDay(day)
              const totalMinutes = 24 * 60
              const isToday = isSameDay(day, new Date())
              const baseBg = dayIdx % 2 === 0 ? '#ffffff' : '#fafafa'

              const key = DAY_KEYS[day.getDay()]
              const dayConfig = workingHours && (workingHours as any)[key] ? (workingHours as any)[key] : null
              const dayEnabled = !!dayConfig?.enabled
              const workingWindow = dayEnabled ? getWorkingWindowForDate(day, workingHours) : null

              return (
                <div
                  key={dayIdx}
                  style={{ borderLeft: '1px solid #eee', position: 'relative', background: isToday ? '#fcfcff' : baseBg }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault()
                    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
                    void onDropOnDayColumn(day, e.clientY, rect.top)
                  }}
                  onMouseDown={(e) => {
                    if (suppressClickRef.current) return
                    if (confirmOpen || pendingChange || openBookingId || createOpen) return
                    if (managementOpen) return
                    if (blockCreateOpen || editBlockOpen) return
                    if (e.button !== 0) return

                    const el = e.target as HTMLElement
                    if (el.closest('[data-cal-event="1"]')) return

                    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
                    openCreateForClick(day, e.clientY, rect.top)
                  }}
                >
                  <div style={{ position: 'relative', height: totalMinutes * PX_PER_MINUTE }}>
                    {!dayEnabled && dayConfig && (
                      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: totalMinutes * PX_PER_MINUTE, background: 'rgba(0,0,0,0.12)', pointerEvents: 'none' }} />
                    )}

                    {dayEnabled && workingWindow && (
                      <>
                        {workingWindow.startMinutes > 0 && (
                          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: workingWindow.startMinutes * PX_PER_MINUTE, background: 'rgba(0,0,0,0.10)', pointerEvents: 'none' }} />
                        )}
                        {workingWindow.endMinutes < totalMinutes && (
                          <div
                            style={{
                              position: 'absolute',
                              top: workingWindow.endMinutes * PX_PER_MINUTE,
                              left: 0,
                              right: 0,
                              height: (totalMinutes - workingWindow.endMinutes) * PX_PER_MINUTE,
                              background: 'rgba(0,0,0,0.10)',
                              pointerEvents: 'none',
                            }}
                          />
                        )}
                      </>
                    )}

                    {Array.from({ length: 24 * 4 }, (_, i) => {
                      const minute = i * 15
                      const isHour = minute % 60 === 0
                      return (
                        <div
                          key={i}
                          style={{
                            position: 'absolute',
                            top: minute * PX_PER_MINUTE,
                            left: 0,
                            right: 0,
                            borderTop: `1px solid ${isHour ? '#eee' : 'rgba(238,238,238,0.6)'}`,
                            boxSizing: 'border-box',
                            pointerEvents: 'none',
                          }}
                        />
                      )
                    })}

                    {dayEvents.map((ev) => {
                      const start = new Date(ev.startsAt)
                      const end = new Date(ev.endsAt)
                      const startMinutes = start.getHours() * 60 + start.getMinutes()
                      const endMinutes = end.getHours() * 60 + end.getMinutes()
                      const duration = Math.max(endMinutes - startMinutes, 15)

                      const chip = eventChipStyle(ev)
                      const isBlock = isBlockedEvent(ev)
                      const entityType: EntityType = isBlock ? 'block' : 'booking'
                      const apiId = isBlock ? extractBlockId(ev) : ev.id

                      return (
                        <div
                          key={ev.id}
                          data-cal-event="1"
                          draggable={Boolean(apiId)}
                          onDragStart={(e) => onDragStart(ev, e)}
                          onMouseDown={(e) => {
                            e.stopPropagation()
                          }}
                          onClick={() => {
                            if (suppressClickRef.current) return
                            if (isBlock) {
                              openEditBlockFromEvent(ev)
                              return
                            }
                            void openBooking(ev.id)
                          }}
                          style={{
                            position: 'absolute',
                            left: '6px',
                            right: '6px',
                            top: startMinutes * PX_PER_MINUTE,
                            height: duration * PX_PER_MINUTE,
                            borderRadius: 6,
                            background: chip.bg,
                            border: `1px solid ${chip.border}`,
                            padding: '4px 6px',
                            fontSize: 11,
                            boxSizing: 'border-box',
                            overflow: 'hidden',
                            cursor: 'move',
                            userSelect: 'none',
                            opacity: isBlock ? 0.92 : 1,
                          }}
                          title={isBlock ? 'Drag to move, drag bottom to resize. Click to edit.' : 'Drag to move, drag bottom to resize.'}
                        >
                          <div style={{ fontWeight: 700, marginBottom: 2, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                            {isBlock ? 'Blocked' : ev.title}
                          </div>
                          <div style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                            {isBlock ? ev.clientName || ev.note || 'Personal time' : ev.clientName}
                          </div>

                          {/* resize handle */}
                          <div
                            onMouseDown={(e) => {
                              e.stopPropagation()
                              e.preventDefault()
                              if (!apiId) return
                              const rect = (e.currentTarget.parentElement as HTMLDivElement).parentElement!.getBoundingClientRect()
                              beginResize({
                                entityType,
                                eventId: ev.id,
                                apiId,
                                day,
                                startMinutes,
                                originalDuration: eventDurationMinutes(ev),
                                columnTop: rect.top,
                              })
                            }}
                            style={{
                              position: 'absolute',
                              left: 0,
                              right: 0,
                              bottom: 0,
                              height: 10,
                              cursor: 'ns-resize',
                              background: 'rgba(0,0,0,0.06)',
                            }}
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ) : null}

      {/* MONTH */}
      {view === 'month' ? (
        <section style={{ borderRadius: 12, border: '1px solid #eee', overflow: 'hidden', background: '#fff' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid #eee', background: '#fafafa' }}>
            {DAY_KEYS.map((k) => (
              <div key={k} style={{ padding: '8px 10px', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: '#555' }}>
                {k}
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
            {visibleDays.map((d, idx) => {
              const inMonth = d.getMonth() === currentDate.getMonth()
              const dayEvents = eventsForDay(d).slice(0, 2)
              const extra = Math.max(0, eventsForDay(d).length - dayEvents.length)

              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    setCurrentDate(d)
                    setView('day')
                  }}
                  style={{
                    minHeight: 110,
                    padding: 10,
                    border: 'none',
                    borderRight: (idx + 1) % 7 === 0 ? 'none' : '1px solid #eee',
                    borderBottom: '1px solid #eee',
                    background: inMonth ? '#fff' : '#fafafa',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <div style={{ fontSize: 12, fontWeight: 900, color: inMonth ? '#111' : '#777' }}>{d.getDate()}</div>
                    {isSameDay(d, new Date()) && (
                      <div style={{ fontSize: 10, fontWeight: 800, color: '#111', border: '1px solid #111', borderRadius: 999, padding: '1px 6px' }}>Today</div>
                    )}
                  </div>

                  <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
                    {dayEvents.map((ev) => {
                      const chip = eventChipStyle(ev)
                      const isBlock = isBlockedEvent(ev)
                      return (
                        <div
                          key={ev.id}
                          style={{
                            borderRadius: 999,
                            border: `1px solid ${chip.border}`,
                            background: chip.bg,
                            padding: '2px 8px',
                            fontSize: 11,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                          title={isBlock ? 'Blocked' : ev.title}
                        >
                          {isBlock ? 'Blocked' : ev.title}
                        </div>
                      )
                    })}
                    {extra > 0 && <div style={{ fontSize: 11, color: '#666' }}>+{extra} more</div>}
                  </div>
                </button>
              )
            })}
          </div>
        </section>
      ) : null}

      {/* CREATE BOOKING MODAL */}
      <CreateBookingModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        workingHours={workingHours}
        initialStart={createInitialStart}
        services={services}
        onCreated={(newEv) => {
          setEvents((prev) => [newEv as any, ...prev])
          void loadCalendar()
        }}
      />

      {/* BLOCK CREATE MODAL */}
      <BlockTimeModal
        open={blockCreateOpen}
        onClose={() => setBlockCreateOpen(false)}
        initialStart={blockCreateInitialStart}
        onCreated={() => {
          setBlockCreateOpen(false)
          void loadCalendar()
        }}
      />

      {/* BLOCK EDIT MODAL */}
      <EditBlockModal
        open={editBlockOpen}
        blockId={editBlockId}
        onClose={() => {
          setEditBlockOpen(false)
          setEditBlockId(null)
        }}
        onSaved={() => {
          void loadCalendar()
        }}
      />

      {/* MANAGEMENT MODAL */}
      {managementOpen && (
        <div
          onClick={closeManagement}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            zIndex: 1100,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 720,
              background: '#fff',
              borderRadius: 14,
              border: '1px solid #eee',
              boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: 14, borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 900 }}>{managementTitle(managementKey)}</div>
                <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>{managementDescription(managementKey)}</div>
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {managementKey === 'blockedToday' && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button
                      type="button"
                      onClick={() => {
                        closeManagement()
                        openCreateBlockNow()
                      }}
                      style={{
                        border: 'none',
                        background: '#111',
                        color: '#fff',
                        borderRadius: 999,
                        padding: '8px 12px',
                        cursor: 'pointer',
                        fontSize: 12,
                        fontWeight: 900,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      + Block personal time
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        closeManagement()
                        void oneClickBlockFullDay(new Date())
                      }}
                      style={{
                        border: '1px solid #111',
                        background: '#fff',
                        color: '#111',
                        borderRadius: 999,
                        padding: '8px 12px',
                        cursor: 'pointer',
                        fontSize: 12,
                        fontWeight: 900,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Block full day
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={closeManagement}
                  style={{ border: '1px solid #ddd', background: '#fff', borderRadius: 999, padding: '6px 10px', cursor: 'pointer', fontSize: 12 }}
                >
                  Close
                </button>
              </div>
            </div>

            <div style={{ padding: 14 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                {(['todaysBookings', 'pendingRequests', 'waitlistToday', 'blockedToday'] as ManagementKey[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setManagementKey(k)}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 999,
                      border: '1px solid #ddd',
                      background: managementKey === k ? '#111' : '#fff',
                      color: managementKey === k ? '#fff' : '#111',
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    {managementTitle(k)} ({management[k]?.length ?? 0})
                  </button>
                ))}
              </div>

              {activeCount === 0 ? (
                <div style={{ fontSize: 12, color: '#666', padding: 14, borderRadius: 12, border: '1px dashed #ddd' }}>
                  Nothing here right now.
                  <div style={{ marginTop: 6, color: '#888' }}>
                    If you haven’t implemented <b>WAITLIST</b> / <b>BLOCKED</b> yet, this being empty is expected.
                  </div>
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 10 }}>
                  {activeList.map((ev) => {
                    const chip = eventChipStyle(ev)
                    const isBlock = isBlockedEvent(ev)

                    return (
                      <button
                        key={ev.id}
                        type="button"
                        onClick={() => {
                          closeManagement()
                          if (isBlock) {
                            openEditBlockFromEvent(ev)
                            return
                          }
                          void openBooking(ev.id)
                        }}
                        style={{
                          textAlign: 'left',
                          borderRadius: 12,
                          border: `1px solid ${chip.border}`,
                          background: chip.bg,
                          padding: 12,
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 900, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {isBlock ? 'Blocked time' : ev.title}
                            </div>
                            <div style={{ fontSize: 12, color: '#333', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {isBlock ? ev.clientName || ev.note || 'Personal time' : ev.clientName} • {statusLabel(ev.status)}
                            </div>
                          </div>
                          <div style={{ fontSize: 12, color: '#333', whiteSpace: 'nowrap' }}>
                            {new Date(ev.startsAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* CONFIRM MODAL */}
      {confirmOpen && pendingChange && (
        <div
          onClick={cancelConfirm}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            zIndex: 1200,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 520,
              background: '#fff',
              borderRadius: 14,
              border: '1px solid #eee',
              boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: 14, borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 900 }}>Apply changes?</div>
              <button type="button" onClick={cancelConfirm} style={{ border: '1px solid #ddd', background: '#fff', borderRadius: 999, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>
                Close
              </button>
            </div>

            <div style={{ padding: 14 }}>
              <div style={{ fontSize: 12, color: '#111', fontWeight: 800, marginBottom: 6 }}>
                You changed this {pendingChange.entityType === 'block' ? 'blocked time' : 'appointment'} by {pendingChange.kind === 'resize' ? 'resizing' : 'moving'} it.
              </div>

              <div style={{ fontSize: 12, color: '#444', lineHeight: 1.4 }}>
                {pendingChange.kind === 'resize' ? (
                  <>
                    New duration: <b>{pendingChange.nextTotalDurationMinutes} min</b>
                  </>
                ) : (
                  <>
                    New start time:{' '}
                    <b>
                      {new Date(pendingChange.nextStartIso).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </b>
                  </>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
                <button type="button" onClick={cancelConfirm} disabled={applyingChange} style={{ border: '1px solid #ddd', background: '#fff', borderRadius: 999, padding: '8px 12px', cursor: applyingChange ? 'default' : 'pointer', fontSize: 12 }}>
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void applyConfirm()}
                  disabled={applyingChange}
                  style={{
                    border: 'none',
                    background: '#111',
                    color: '#fff',
                    borderRadius: 999,
                    padding: '8px 12px',
                    cursor: applyingChange ? 'default' : 'pointer',
                    fontSize: 12,
                    opacity: applyingChange ? 0.7 : 1,
                  }}
                >
                  {applyingChange ? 'Applying…' : 'Confirm'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* EDIT BOOKING MODAL */}
      {openBookingId && (
        <div
          onClick={closeBooking}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            zIndex: 999,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 600,
              background: '#fff',
              borderRadius: 14,
              border: '1px solid #eee',
              boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: 14, borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 900 }}>Appointment</div>
              <button type="button" onClick={closeBooking} style={{ border: '1px solid #ddd', background: '#fff', borderRadius: 999, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>
                Close
              </button>
            </div>

            <div style={{ padding: 14 }}>
              {bookingLoading && <div style={{ fontSize: 12, color: '#666' }}>Loading booking…</div>}
              {bookingError && <div style={{ fontSize: 12, color: 'red', marginBottom: 8 }}>{bookingError}</div>}

              {booking && (
                <>
                  <div style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 900 }}>{booking.serviceName}</div>
                    <div style={{ fontSize: 12, color: '#444' }}>
                      <b>Client:</b> {booking.client.fullName}
                      {booking.client.email ? ` • ${booking.client.email}` : ''}
                      {booking.client.phone ? ` • ${booking.client.phone}` : ''}
                    </div>
                    <div style={{ fontSize: 12, color: '#444' }}>
                      <b>When:</b>{' '}
                      {String(booking.status).toUpperCase() === 'PENDING' && (
                        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                          <button
                            type="button"
                            onClick={async () => {
                              setBookingError(null)
                              try {
                                const res = await fetch(`/api/pro/bookings/${encodeURIComponent(booking.id)}/status`, {
                                  method: 'PATCH',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ status: 'ACCEPTED' }),
                                })
                                const data = await safeJson(res)
                                if (!res.ok) throw new Error(data?.error || 'Failed to approve booking.')
                                closeBooking()
                                await loadCalendar()
                              } catch (e: any) {
                                setBookingError(e?.message || 'Failed to approve booking.')
                              }
                            }}
                            style={{
                              border: 'none',
                              background: '#111',
                              color: '#fff',
                              borderRadius: 999,
                              padding: '8px 12px',
                              cursor: 'pointer',
                              fontSize: 12,
                              fontWeight: 900,
                            }}
                          >
                            Approve
                          </button>

                          <button
                            type="button"
                            onClick={async () => {
                              setBookingError(null)
                              try {
                                const res = await fetch(`/api/pro/bookings/${encodeURIComponent(booking.id)}/cancel`, {
                                  method: 'PATCH',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ reason: 'Declined by professional' }),
                                })
                                const data = await safeJson(res)
                                if (!res.ok) throw new Error(data?.error || 'Failed to deny booking.')
                                closeBooking()
                                await loadCalendar()
                              } catch (e: any) {
                                setBookingError(e?.message || 'Failed to deny booking.')
                              }
                            }}
                            style={{
                              border: '1px solid #111',
                              background: '#fff',
                              color: '#111',
                              borderRadius: 999,
                              padding: '8px 12px',
                              cursor: 'pointer',
                              fontSize: 12,
                              fontWeight: 900,
                            }}
                          >
                            Deny
                          </button>
                        </div>
                      )}

                      {new Date(booking.scheduledFor).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })} ({booking.totalDurationMinutes} min)
                    </div>
                  </div>

                {String(booking.status || '').toUpperCase() === 'PENDING' && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => void approveBooking()}
                      disabled={savingReschedule}
                      style={{
                        border: 'none',
                        background: '#111',
                        color: '#fff',
                        borderRadius: 999,
                        padding: '8px 12px',
                        cursor: savingReschedule ? 'default' : 'pointer',
                        fontSize: 12,
                        fontWeight: 900,
                        opacity: savingReschedule ? 0.7 : 1,
                      }}
                    >
                      Approve
                    </button>

                    <button
                      type="button"
                      onClick={() => void denyBooking()}
                      disabled={savingReschedule}
                      style={{
                        border: '1px solid #111',
                        background: '#fff',
                        color: '#111',
                        borderRadius: 999,
                        padding: '8px 12px',
                        cursor: savingReschedule ? 'default' : 'pointer',
                        fontSize: 12,
                        fontWeight: 900,
                        opacity: savingReschedule ? 0.7 : 1,
                      }}
                    >
                      Deny
                    </button>
                  </div>
                )}


                  <div style={{ borderTop: '1px solid #eee', paddingTop: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 900, marginBottom: 8 }}>Edit appointment</div>

                    {editOutside && (
                      <div style={{ border: '1px solid #f59e0b', background: '#fffbeb', borderRadius: 10, padding: 10, marginBottom: 10, fontSize: 12 }}>
                        <div style={{ fontWeight: 900, marginBottom: 4 }}>Outside working hours</div>
                        <div style={{ color: '#92400e' }}>You can still schedule this, but it’s outside your set hours. Toggle override to allow it.</div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                          <input type="checkbox" checked={allowOutsideHours} onChange={(e) => setAllowOutsideHours(e.target.checked)} />
                          Allow outside working hours (pro override)
                        </label>
                      </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <div>
                        <div style={{ fontSize: 11, color: '#555', marginBottom: 4 }}>Date</div>
                        <input type="date" value={reschedDate} onChange={(e) => setReschedDate(e.target.value)} style={{ width: '100%', padding: '8px 10px', borderRadius: 10, border: '1px solid #ddd', fontSize: 12 }} />
                      </div>

                      <div>
                        <div style={{ fontSize: 11, color: '#555', marginBottom: 4 }}>Time</div>
                        <input type="time" step={SNAP_MINUTES * 60} value={reschedTime} onChange={(e) => setReschedTime(e.target.value)} style={{ width: '100%', padding: '8px 10px', borderRadius: 10, border: '1px solid #ddd', fontSize: 12 }} />
                      </div>
                    </div>

                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 11, color: '#555', marginBottom: 4 }}>Duration (minutes)</div>
                      <input
                        type="number"
                        step={15}
                        min={15}
                        max={720}
                        value={durationMinutes}
                        onChange={(e) => setDurationMinutes(Number(e.target.value))}
                        style={{ width: '100%', padding: '8px 10px', borderRadius: 10, border: '1px solid #ddd', fontSize: 12 }}
                      />
                    </div>

                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12 }}>
                      <input type="checkbox" checked={notifyClient} onChange={(e) => setNotifyClient(e.target.checked)} />
                      Notify client about changes
                    </label>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                      <button type="button" onClick={closeBooking} style={{ border: '1px solid #ddd', background: '#fff', borderRadius: 999, padding: '8px 12px', cursor: 'pointer', fontSize: 12 }}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => void submitChanges()}
                        disabled={savingReschedule || (editOutside && !allowOutsideHours)}
                        style={{
                          border: 'none',
                          background: '#111',
                          color: '#fff',
                          borderRadius: 999,
                          padding: '8px 12px',
                          cursor: savingReschedule ? 'default' : 'pointer',
                          fontSize: 12,
                          opacity: savingReschedule || (editOutside && !allowOutsideHours) ? 0.7 : 1,
                        }}
                        title={editOutside && !allowOutsideHours ? 'Enable override to save outside working hours.' : ''}
                      >
                        {savingReschedule ? 'Saving…' : 'Save changes'}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
