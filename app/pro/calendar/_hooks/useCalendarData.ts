// app/pro/calendar/_hooks/useCalendarData.ts
'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import type {
  BookingDetails,
  BookingServiceItem,
  CalendarEvent,
  CalendarStats,
  EntityType,
  ManagementKey,
  ManagementLists,
  PendingChange,
  ServiceOption,
  ViewMode,
  WorkingHoursDay,
  WorkingHoursJson,
} from '../_types'
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

import { isRecord } from '@/lib/guards'
import { pickBool, pickNumber, pickString } from '@/lib/pick'
import { safeJson, readErrorMessage, errorMessageFromUnknown } from '@/lib/http'

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

function apiMessage(data: unknown, fallback: string) {
  return readErrorMessage(data) ?? (isRecord(data) ? pickString(data.message) : null) ?? fallback
}

function upper(v: unknown) {
  return (pickString(v) ?? '').toUpperCase()
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

function parseWorkingHoursDay(v: unknown): WorkingHoursDay | null {
  if (!isRecord(v)) return null

  const enabled = typeof v.enabled === 'boolean' ? v.enabled : null
  const start = pickString(v.start)
  const end = pickString(v.end)

  if (enabled == null || !start || !end) return null

  return {
    enabled,
    start,
    end,
  }
}

function parseWorkingHoursJson(v: unknown): WorkingHoursJson {
  if (!isRecord(v)) return null

  const sun = parseWorkingHoursDay(v.sun)
  const mon = parseWorkingHoursDay(v.mon)
  const tue = parseWorkingHoursDay(v.tue)
  const wed = parseWorkingHoursDay(v.wed)
  const thu = parseWorkingHoursDay(v.thu)
  const fri = parseWorkingHoursDay(v.fri)
  const sat = parseWorkingHoursDay(v.sat)

  if (!sun || !mon || !tue || !wed || !thu || !fri || !sat) return null

  return { sun, mon, tue, wed, thu, fri, sat }
}

function serviceItemsTotalDuration(items: BookingServiceItem[]): number {
  return items.reduce((sum, item) => sum + Number(item.durationMinutesSnapshot ?? 0), 0)
}

function serviceItemsLabel(items: BookingServiceItem[]): string {
  const names = items
    .map((item) => item.serviceName.trim())
    .filter(Boolean)

  return names.length ? names.join(' + ') : 'Appointment'
}

/* ---------------------------------------------
   Parsing helpers (no casts, match _types.ts)
--------------------------------------------- */

function parseCalendarServiceItem(v: unknown): {
  id: string
  name: string | null
  durationMinutes: number
  price: unknown
  sortOrder: number
} | null {
  if (!isRecord(v)) return null

  const id = pickString(v.id)
  const sortOrder = pickNumber(v.sortOrder)
  const durationMinutes = pickNumber(v.durationMinutes)

  if (!id || sortOrder == null || durationMinutes == null) return null

  return {
    id,
    name: pickString(v.name) ?? null,
    durationMinutes,
    price: 'price' in v ? v.price : null,
    sortOrder,
  }
}

function parseCalendarEvent(v: unknown): CalendarEvent | null {
  if (!isRecord(v)) return null

  const kind = pickString(v.kind)
  const id = pickString(v.id)
  const startsAt = pickString(v.startsAt)
  const endsAt = pickString(v.endsAt)

  if (!kind || !id || !startsAt || !endsAt) return null

  const title = pickString(v.title) ?? (kind === 'BLOCK' ? 'Blocked' : 'Booking')
  const clientName = pickString(v.clientName) ?? ''
  const status = pickString(v.status) ?? (kind === 'BLOCK' ? 'BLOCKED' : 'PENDING')

  const dur = pickNumber(v.durationMinutes)
  const durationMinutes = dur != null && dur > 0 ? dur : undefined

  if (kind === 'BOOKING') {
    const locationId = pickString(v.locationId)
    if (!locationId) return null

    const locationTypeRaw = pickString(v.locationType)
    const locationType =
      locationTypeRaw === 'SALON' || locationTypeRaw === 'MOBILE'
        ? locationTypeRaw
        : locationTypeRaw ?? ''

    const serviceItems =
      isRecord(v.details) && Array.isArray(v.details.serviceItems)
        ? v.details.serviceItems.reduce<
            {
              id: string
              name: string | null
              durationMinutes: number
              price: unknown
              sortOrder: number
            }[]
          >((acc, row) => {
            const item = parseCalendarServiceItem(row)
            if (item) acc.push(item)
            return acc
          }, [])
        : []

    const details = {
      serviceName:
        isRecord(v.details) ? pickString(v.details.serviceName) ?? title : title,
      bufferMinutes:
        isRecord(v.details) ? pickNumber(v.details.bufferMinutes) ?? 0 : 0,
      serviceItems,
    }

    return {
      kind: 'BOOKING',
      id,
      startsAt,
      endsAt,
      title,
      clientName,
      status,
      locationId,
      locationType,
      details,
      ...(durationMinutes != null ? { durationMinutes } : {}),
    }
  }

  if (kind === 'BLOCK') {
    const derived = id.startsWith('block:') ? id.slice('block:'.length) : null
    const blockId = pickString(v.blockId) ?? derived
    if (!blockId) return null

    const note = v.note === null ? null : pickString(v.note)
    const locationId = v.locationId === null ? null : pickString(v.locationId)

    return {
      kind: 'BLOCK',
      id,
      blockId,
      startsAt,
      endsAt,
      title,
      clientName,
      status,
      note: note ?? null,
      locationId: locationId ?? null,
      ...(durationMinutes != null ? { durationMinutes } : {}),
    }
  }

  return null
}

function parseCalendarEvents(v: unknown): CalendarEvent[] {
  if (!Array.isArray(v)) return []
  const out: CalendarEvent[] = []

  for (const row of v) {
    const ev = parseCalendarEvent(row)
    if (ev) out.push(ev)
  }

  return out
}

function parseManagementLists(v: unknown): ManagementLists {
  if (!isRecord(v)) {
    return { todaysBookings: [], pendingRequests: [], waitlistToday: [], blockedToday: [] }
  }

  return {
    todaysBookings: parseCalendarEvents(v.todaysBookings),
    pendingRequests: parseCalendarEvents(v.pendingRequests),
    waitlistToday: parseCalendarEvents(v.waitlistToday),
    blockedToday: parseCalendarEvents(v.blockedToday),
  }
}

function parseCalendarStats(v: unknown): CalendarStats {
  if (!isRecord(v)) return null

  const todaysBookings = pickNumber(v.todaysBookings)
  const pendingRequests = pickNumber(v.pendingRequests)

  const availableHours =
    v.availableHours === null ? null : (pickNumber(v.availableHours) ?? null)

  const blockedHours =
    v.blockedHours === null ? null : (pickNumber(v.blockedHours) ?? null)

  if (todaysBookings == null || pendingRequests == null) return null

  return {
    todaysBookings,
    availableHours,
    pendingRequests,
    blockedHours,
  }
}

function parseServiceOptions(v: unknown): ServiceOption[] {
  if (!Array.isArray(v)) return []
  const out: ServiceOption[] = []

  for (const row of v) {
    if (!isRecord(row)) continue

    const id = pickString(row.id)
    const name = pickString(row.name)
    if (!id || !name) continue

    const durationMinutes =
      row.durationMinutes === null ? null : (pickNumber(row.durationMinutes) ?? null)

    const offeringId = pickString(row.offeringId) ?? undefined
    const priceStartingAt =
      row.priceStartingAt === null ? null : (pickString(row.priceStartingAt) ?? null)

    out.push({
      id,
      name,
      ...(durationMinutes !== null ? { durationMinutes } : {}),
      ...(offeringId ? { offeringId } : {}),
      ...(priceStartingAt !== null ? { priceStartingAt } : {}),
    })
  }

  return out
}
function normalizeMoneyString(raw: string | null | undefined): string {
  const value = (raw ?? '').trim()
  return value ? value : '0.00'
}

function makeDraftItemId(serviceId: string, offeringId: string, sortOrder: number): string {
  return `draft:${serviceId}:${offeringId}:${sortOrder}`
}

function buildDraftItemFromServiceOption(
  service: ServiceOption,
  sortOrder: number,
): BookingServiceItem | null {
  const offeringId = service.offeringId?.trim() ?? ''
  const durationMinutesSnapshot = Number(service.durationMinutes ?? 0)
  const priceSnapshot = normalizeMoneyString(service.priceStartingAt)

  if (!service.id || !service.name || !offeringId) return null
  if (!Number.isFinite(durationMinutesSnapshot) || durationMinutesSnapshot <= 0) return null

  return {
    id: makeDraftItemId(service.id, offeringId, sortOrder),
    serviceId: service.id,
    offeringId,
    itemType: sortOrder === 0 ? 'BASE' : 'ADD_ON',
    serviceName: service.name,
    priceSnapshot,
    durationMinutesSnapshot: Math.max(SNAP_MINUTES, roundTo15(durationMinutesSnapshot)),
    sortOrder,
  }
}

function normalizeDraftServiceItems(items: BookingServiceItem[]): BookingServiceItem[] {
  return items.map((item, index) => ({
    ...item,
    itemType: index === 0 ? 'BASE' : 'ADD_ON',
    sortOrder: index,
  }))
}

function sameServiceItems(a: BookingServiceItem[], b: BookingServiceItem[]): boolean {
  if (a.length !== b.length) return false

  for (let i = 0; i < a.length; i += 1) {
    const left = a[i]
    const right = b[i]
    if (!left || !right) return false

    if (left.serviceId !== right.serviceId) return false
    if ((left.offeringId ?? null) !== (right.offeringId ?? null)) return false
    if (left.serviceName !== right.serviceName) return false
    if (left.priceSnapshot !== right.priceSnapshot) return false
    if (Number(left.durationMinutesSnapshot) !== Number(right.durationMinutesSnapshot)) return false
    if (Number(left.sortOrder) !== Number(right.sortOrder)) return false
    if (String(left.itemType) !== String(right.itemType)) return false
  }

  return true
}

function parseBookingServiceItem(v: unknown): BookingServiceItem | null {
  if (!isRecord(v)) return null

  const id = pickString(v.id)
  const serviceId = pickString(v.serviceId)
  const offeringId = v.offeringId === null ? null : pickString(v.offeringId)
  const itemType = pickString(v.itemType)
  const serviceName = pickString(v.serviceName)
  const priceSnapshot = pickString(v.priceSnapshot)
  const durationMinutesSnapshot = pickNumber(v.durationMinutesSnapshot)
  const sortOrder = pickNumber(v.sortOrder)

  if (
    !id ||
    !serviceId ||
    !itemType ||
    !serviceName ||
    !priceSnapshot ||
    durationMinutesSnapshot == null ||
    sortOrder == null
  ) {
    return null
  }

  return {
    id,
    serviceId,
    offeringId,
    itemType,
    serviceName,
    priceSnapshot,
    durationMinutesSnapshot,
    sortOrder,
  }
}

function parseBookingServiceItems(v: unknown): BookingServiceItem[] {
  if (!Array.isArray(v)) return []
  const out: BookingServiceItem[] = []

  for (const row of v) {
    const item = parseBookingServiceItem(row)
    if (item) out.push(item)
  }

  return out.sort((a, b) => a.sortOrder - b.sortOrder)
}

function parseBookingDetails(v: unknown): BookingDetails | null {
  if (!isRecord(v)) return null

  const id = pickString(v.id)
  const status = pickString(v.status)
  const scheduledFor = pickString(v.scheduledFor)
  const endsAt = pickString(v.endsAt)
  const totalDurationMinutes = pickNumber(v.totalDurationMinutes)
  const durationMinutes = pickNumber(v.durationMinutes) ?? undefined
  const bufferMinutes = pickNumber(v.bufferMinutes) ?? undefined
  const subtotalSnapshot = pickString(v.subtotalSnapshot) ?? undefined

  const locationTypeRaw = pickString(v.locationType)
  const locationType =
    locationTypeRaw === 'SALON' || locationTypeRaw === 'MOBILE'
      ? locationTypeRaw
      : undefined

  const client = v.client
  if (!isRecord(client)) return null

  const fullName = pickString(client.fullName)
  const email = client.email === null ? null : pickString(client.email)
  const phone = client.phone === null ? null : pickString(client.phone)

  const tz = sanitizeTimeZone(v.timeZone, DEFAULT_TIME_ZONE)
  const serviceItems = parseBookingServiceItems(v.serviceItems)

  if (!id || !status || !scheduledFor || !endsAt || totalDurationMinutes == null || !fullName) {
    return null
  }

  return {
    id,
    status,
    scheduledFor,
    endsAt,
    ...(locationType ? { locationType } : {}),
    totalDurationMinutes,
    ...(durationMinutes != null ? { durationMinutes } : {}),
    ...(bufferMinutes != null ? { bufferMinutes } : {}),
    ...(subtotalSnapshot ? { subtotalSnapshot } : {}),
    client: {
      fullName,
      email: email ?? null,
      phone: phone ?? null,
    },
    timeZone: tz,
    serviceItems,
  }
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

  const p = getZonedParts(focusUtc, safeTz)

  const firstOfMonthUtc = zonedTimeToUtc({
    year: p.year,
    month: p.month,
    day: 1,
    hour: 12,
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

  const [timeZone, setTimeZone] = useState<string>(DEFAULT_TIME_ZONE)
  const timeZoneRef = useRef(timeZone)

  useEffect(() => {
    timeZoneRef.current = timeZone
  }, [timeZone])

  const [needsTimeZoneSetup, setNeedsTimeZoneSetup] = useState(false)

  const [canSalon, setCanSalon] = useState(true)
  const [canMobile, setCanMobile] = useState(false)
  const [activeLocationType, setActiveLocationType] = useState<LocationType>('SALON')

  const [workingHoursSalon, setWorkingHoursSalon] = useState<WorkingHoursJson>(null)
  const [workingHoursMobile, setWorkingHoursMobile] = useState<WorkingHoursJson>(null)

  const [locations, setLocations] = useState<ProLocation[]>([])
  const [locationsLoaded, setLocationsLoaded] = useState(false)
  const [activeLocationId, setActiveLocationId] = useState<string | null>(null)

  const scopedLocations = useMemo(() => {
    const list = locations.filter((l) => l.isBookable)
    if (activeLocationType === 'MOBILE') return list.filter((l) => upper(l.type) === 'MOBILE_BASE')
    return list.filter((l) => upper(l.type) === 'SALON' || upper(l.type) === 'SUITE')
  }, [locations, activeLocationType])

  const activeLocation = useMemo(() => {
    if (!activeLocationId) return null
    return locations.find((l) => l.id === activeLocationId) ?? null
  }, [locations, activeLocationId])

  const activeLocationLabel = useMemo(() => {
    if (!activeLocation) return null

    const base =
      activeLocation.name ||
      (upper(activeLocation.type) === 'MOBILE_BASE'
        ? 'Mobile base'
        : upper(activeLocation.type) === 'SUITE'
          ? 'Suite'
          : 'Salon')

    const addr = activeLocation.formattedAddress ? ` — ${activeLocation.formattedAddress}` : ''
    return `${base}${addr}`
  }, [activeLocation])

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
  

  const [openBookingId, setOpenBookingId] = useState<string | null>(null)
  const [bookingLoading, setBookingLoading] = useState(false)
  const [bookingError, setBookingError] = useState<string | null>(null)
  const [booking, setBooking] = useState<BookingDetails | null>(null)

  const [serviceItemsDraft, setServiceItemsDraft] = useState<BookingServiceItem[]>([])
  const [manualDurationMinutes, setManualDurationMinutes] = useState<number>(60)

  const [reschedDate, setReschedDate] = useState<string>('')
  const [reschedTime, setReschedTime] = useState<string>('')
  const [notifyClient, setNotifyClient] = useState(true)
  const [savingReschedule, setSavingReschedule] = useState(false)
  const [allowOutsideHours, setAllowOutsideHours] = useState(false)

  const [managementActionBusyId, setManagementActionBusyId] = useState<string | null>(null)
  const [managementActionError, setManagementActionError] = useState<string | null>(null)

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

  const loadSeqRef = useRef(0)
  const locationSetByApiRef = useRef(false)

  const utils = useMemo(
    () => ({
      startOfWeek,
      startOfMonth,
    }),
    [],
  )

  const hasDraftServiceItemsChanges = useMemo(() => {
    if (!booking) return false
    return !sameServiceItems(
      normalizeDraftServiceItems(serviceItemsDraft),
      normalizeDraftServiceItems(booking.serviceItems),
    )
  }, [serviceItemsDraft, booking])

  function setDraftServiceIds(nextServiceIds: string[]) {
    const uniqueIds = Array.from(
      new Set(
        nextServiceIds
          .map((id) => id.trim())
          .filter(Boolean),
      ),
    )

    const nextItems = uniqueIds
      .map((serviceId, index) => {
        const option = services.find((s) => s.id === serviceId)
        return option ? buildDraftItemFromServiceOption(option, index) : null
      })
      .filter((item): item is BookingServiceItem => Boolean(item))

    setServiceItemsDraft(normalizeDraftServiceItems(nextItems))
  }

  const bookingServiceLabel = useMemo(() => {
    const source = serviceItemsDraft.length ? serviceItemsDraft : booking?.serviceItems ?? []
    return serviceItemsLabel(source)
  }, [serviceItemsDraft, booking])
  const durationMinutes = useMemo(() => {
    const draftComputed = serviceItemsTotalDuration(serviceItemsDraft)

    if (hasDraftServiceItemsChanges && draftComputed > 0) {
      return draftComputed
    }

    const persisted = Number(booking?.totalDurationMinutes ?? 0)
    if (persisted > 0) return persisted

    if (draftComputed > 0) return draftComputed

    const fallback = Number(manualDurationMinutes || 60)
    return Math.max(SNAP_MINUTES, roundTo15(fallback))
  }, [
    serviceItemsDraft,
    hasDraftServiceItemsChanges,
    booking?.totalDurationMinutes,
    manualDurationMinutes,
  ])
  const selectedDraftServiceIds = useMemo(
    () => serviceItemsDraft.map((item) => item.serviceId),
    [serviceItemsDraft],
  )

  

  function eventDurationMinutes(ev: CalendarEvent) {
    return typeof ev.durationMinutes === 'number' && Number.isFinite(ev.durationMinutes) && ev.durationMinutes > 0
      ? ev.durationMinutes
      : computeDurationMinutesFromIso(ev.startsAt, ev.endsAt)
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

    setEvents((prev) =>
      prev.map((ev) =>
        ev.id === s.eventId
          ? { ...ev, endsAt: end.toISOString(), durationMinutes: dur }
          : ev,
      ),
    )
  }, [])

  const onResizeEnd = useCallback(() => {
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
          x.id === s.eventId
            ? { ...x, endsAt: rollbackEnd.toISOString(), durationMinutes: s.originalDuration }
            : x,
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
  }, [onResizeMove])

  useEffect(() => {
    return () => {
      if (suppressClickTimerRef.current) window.clearTimeout(suppressClickTimerRef.current)
      window.removeEventListener('mousemove', onResizeMove)
      window.removeEventListener('mouseup', onResizeEnd)
    }
  }, [onResizeMove, onResizeEnd])

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

          const id = pickString(raw.id)
          if (!id) return null

          const type: ProLocationType = pickString(raw.type) ?? 'SALON'
          const name = pickString(raw.name) ?? null
          const formattedAddress = pickString(raw.formattedAddress) ?? null
          const isPrimary = Boolean(raw.isPrimary)
          const isBookable = raw.isBookable === undefined ? true : Boolean(raw.isBookable)
          const timeZone = pickString(raw.timeZone) ?? null
          const stepMinutes = raw.stepMinutes === null ? null : (pickNumber(raw.stepMinutes) ?? null)
          const workingHours = parseWorkingHoursJson(raw.workingHours)

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

      const nextCanSalon = parsed.some((l) => l.isBookable && (upper(l.type) === 'SALON' || upper(l.type) === 'SUITE'))
      const nextCanMobile = parsed.some((l) => l.isBookable && upper(l.type) === 'MOBILE_BASE')

      setCanSalon(nextCanSalon)
      setCanMobile(nextCanMobile)

      const nextType = pickLocationType(nextCanSalon, nextCanMobile, activeLocationType)
      setActiveLocationType(nextType)

      if (!activeLocationId) {
        const scoped = parsed
          .filter((l) => l.isBookable)
          .filter((l) => {
            if (nextType === 'MOBILE') return upper(l.type) === 'MOBILE_BASE'
            return upper(l.type) === 'SALON' || upper(l.type) === 'SUITE'
          })

        const next =
          scoped.find((l) => l.isPrimary)?.id ??
          scoped[0]?.id ??
          parsed.find((l) => l.isPrimary)?.id ??
          parsed[0]?.id ??
          null

        if (next) setActiveLocationId(next)
      }
    } catch {
      setLocations([])
      setLocationsLoaded(true)
    }
  }

  async function loadServicesForLocation(locationType: LocationType): Promise<ServiceOption[]> {
    try {
      const res = await fetch(
        `/api/pro/services?locationType=${encodeURIComponent(locationType)}`,
        { cache: 'no-store' },
      )
      const data: unknown = await safeJson(res)

      if (!res.ok || !isRecord(data)) {
        setServices([])
        return []
      }

      const parsed = parseServiceOptions(data.services)
      setServices(parsed)
      return parsed
    } catch {
      setServices([])
      return []
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

      if (!res.ok) throw new Error(apiMessage(data, 'Failed to save.'))

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

  async function loadWorkingHoursFor(locationType: LocationType) {
    const res = await fetch(`/api/pro/working-hours?locationType=${encodeURIComponent(locationType)}`, {
      method: 'GET',
      cache: 'no-store',
    })
    const data: unknown = await safeJson(res)

    if (!res.ok) throw new Error(apiMessage(data, `Failed to load ${locationType} hours.`))
    if (!isRecord(data)) return null

    return parseWorkingHoursJson(data.workingHours)
  }

  async function loadCalendar() {
    const seq = ++loadSeqRef.current

    try {
      setLoading(true)
      setError(null)

      const tzGuess = sanitizeTimeZone(timeZoneRef.current, DEFAULT_TIME_ZONE)

      async function fetchCalendarFor(tzForRange: string, locationId: string | null) {
        const { from, to } = rangeForViewUtcInTimeZone(view, currentDate, tzForRange)

        const base = `/api/pro/calendar?from=${encodeURIComponent(toIso(from))}&to=${encodeURIComponent(toIso(to))}`
        const url = locationId ? `${base}&locationId=${encodeURIComponent(locationId)}` : base

        const res = await fetch(url, { cache: 'no-store' })
        const data: unknown = await safeJson(res)
        return { res, data }
      }

      let { res, data } = await fetchCalendarFor(tzGuess, activeLocationId)
      if (seq !== loadSeqRef.current) return

      if (!res.ok) {
        setError(apiMessage(data, `Failed to load calendar (${res.status}).`))
        return
      }

      const record = isRecord(data) ? data : null

      const apiLocId =
        record && isRecord(record.location) ? pickString(record.location.id) : null

      if (apiLocId && apiLocId !== activeLocationId) {
        locationSetByApiRef.current = true
        setActiveLocationId(apiLocId)
      }

      const apiTzRaw = record ? pickString(record.timeZone) ?? '' : ''
      const apiTzValid = isValidIanaTimeZone(apiTzRaw)
      const nextTz = apiTzValid ? apiTzRaw : DEFAULT_TIME_ZONE

      if (apiTzValid && nextTz !== tzGuess) {
        const second = await fetchCalendarFor(nextTz, apiLocId ?? activeLocationId)
        if (seq !== loadSeqRef.current) return
        if (second.res.ok) {
          res = second.res
          data = second.data
        }
      }

      const record2 = isRecord(data) ? data : null

      setTimeZone(nextTz)
      setNeedsTimeZoneSetup(Boolean(record2?.needsTimeZoneSetup) || !apiTzValid)

      const nextCanSalon = record2 ? Boolean(record2.canSalon ?? true) : true
      const nextCanMobile = record2 ? Boolean(record2.canMobile ?? false) : false

      setCanSalon(nextCanSalon)
      setCanMobile(nextCanMobile)
      setActiveLocationType((prev) => pickLocationType(nextCanSalon, nextCanMobile, prev))

      setStats(record2 ? parseCalendarStats(record2.stats) : null)
      setAutoAccept(record2 ? Boolean(record2.autoAcceptBookings) : false)

      setManagement(
        record2
          ? parseManagementLists(record2.management)
          : { todaysBookings: [], pendingRequests: [], waitlistToday: [], blockedToday: [] },
      )

      const apiEvents = record2 ? parseCalendarEvents(record2.events) : []

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
      if (seq === loadSeqRef.current) setError('Network error loading calendar.')
    } finally {
      if (seq === loadSeqRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    void loadLocationsOnce()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void loadServicesForLocation(activeLocationType)
  }, [activeLocationType])

  useEffect(() => {
    void loadCalendar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, currentDate])

  useEffect(() => {
    if (locationSetByApiRef.current) {
      locationSetByApiRef.current = false
      return
    }
    if (!activeLocationId) return
    void loadCalendar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLocationId])

  useEffect(() => {
    if (!locationsLoaded) return
    if (activeLocationId && scopedLocations.some((l) => l.id === activeLocationId)) return

    const next = scopedLocations.find((l) => l.isPrimary)?.id ?? scopedLocations[0]?.id ?? null
    setActiveLocationId(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLocationType, locationsLoaded, scopedLocations])

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

  function openManagement(key: ManagementKey) {
    setManagementKey(key)
    setManagementOpen(true)
  }

  function closeManagement() {
    setManagementOpen(false)
  }

  async function createBlock(startsAtIso: string, endsAtIso: string, note?: string) {
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
    if (!res.ok) throw new Error(apiMessage(data, 'Failed to create block.'))

    if (isRecord(data) && isRecord(data.block)) {
      const id = pickString(data.block.id) ?? ''
      const startsAt = pickString(data.block.startsAt) ?? startsAtIso
      const endsAt = pickString(data.block.endsAt) ?? endsAtIso
      const noteOut = data.block.note === null ? null : pickString(data.block.note)

      return {
        id,
        startsAt,
        endsAt,
        note: noteOut ?? null,
      }
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
      setError(errorMessageFromUnknown(e))
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
        const msg = apiMessage(data, 'Failed to update booking.')

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
      setManagementActionError(errorMessageFromUnknown(e))
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
    setServiceItemsDraft([])
    setBookingError(null)
    setBookingLoading(true)
    setAllowOutsideHours(false)

    try {
      const res = await fetch(`/api/pro/bookings/${encodeURIComponent(id)}`, {
        method: 'GET',
        cache: 'no-store',
      })
      const data: unknown = await safeJson(res)

      if (!res.ok) throw new Error(apiMessage(data, `Failed to load booking (${res.status}).`))
      if (!isRecord(data)) throw new Error('Malformed booking response.')

      const parsed = parseBookingDetails(data.booking)
      if (!parsed) throw new Error('Malformed booking response.')

      setBooking(parsed)
      setServiceItemsDraft(parsed.serviceItems)
      setManualDurationMinutes(Number(parsed.totalDurationMinutes || 60))

      const bookingTz = sanitizeTimeZone(parsed.timeZone, DEFAULT_TIME_ZONE)
      const start = new Date(parsed.scheduledFor)
      setReschedDate(toDateInputValueInTimeZone(start, bookingTz))
      setReschedTime(toTimeInputValueInTimeZone(start, bookingTz))
      setNotifyClient(true)

      const editLocationType: LocationType =
        parsed.locationType === 'MOBILE' ? 'MOBILE' : 'SALON'

      await loadServicesForLocation(editLocationType)
    } catch (e: unknown) {
      console.error(e)
      setBookingError(errorMessageFromUnknown(e))
    } finally {
      setBookingLoading(false)
    }
  }

  function closeBooking() {
    setOpenBookingId(null)
    setBooking(null)
    setServiceItemsDraft([])
    setBookingError(null)
    setSavingReschedule(false)
    setAllowOutsideHours(false)
    setManualDurationMinutes(60)
  }

  function editWouldBeOutsideHours() {
    if (!booking) return false

    const [yyyy, mm, dd] = (reschedDate || '').split('-').map((x) => Number(x))
    if (!yyyy || !mm || !dd) return false

    const [hh, mi] = (reschedTime || '').split(':').map((x) => Number(x))
    if (!Number.isFinite(hh) || !Number.isFinite(mi)) return false

    const startMinutes = hh * 60 + mi
    const endMinutes = startMinutes + durationMinutes
    const dayAnchor = anchorDayLocalNoon(yyyy, mm, dd)
    const editTz = sanitizeTimeZone(booking.timeZone || timeZone, DEFAULT_TIME_ZONE)

    return isOutsideWorkingHours({
      day: dayAnchor,
      startMinutes,
      endMinutes,
      workingHours: workingHoursActive,
      timeZone: editTz,
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

      const tz = sanitizeTimeZone(booking.timeZone || timeZone, DEFAULT_TIME_ZONE)

      const nextStart = zonedTimeToUtc({
        year: yyyy,
        month: mm,
        day: dd,
        hour: hh,
        minute: mi,
        second: 0,
        timeZone: tz,
      })

      const effectiveDuration =
        hasDraftServiceItemsChanges && serviceItemsDraft.length > 0
          ? serviceItemsTotalDuration(serviceItemsDraft)
          : Number(booking.totalDurationMinutes || durationMinutes || 60)

      const snappedDur = Math.max(SNAP_MINUTES, roundTo15(effectiveDuration))

      const dayAnchor = anchorDayLocalNoon(yyyy, mm, dd)
      const outside = isOutsideWorkingHours({
        day: dayAnchor,
        startMinutes: hh * 60 + mi,
        endMinutes: hh * 60 + mi + snappedDur,
        workingHours: workingHoursActive,
        timeZone: tz,
      })

      const payload: {
        scheduledFor: string
        notifyClient: boolean
        allowOutsideWorkingHours: boolean
        serviceItems?: {
          serviceId: string
          offeringId: string
          durationMinutesSnapshot: number
          priceSnapshot: string
          sortOrder: number
        }[]
      } = {
        scheduledFor: nextStart.toISOString(),
        notifyClient,
        allowOutsideWorkingHours: outside ? Boolean(allowOutsideHours) : false,
      }

      if (hasDraftServiceItemsChanges) {
        payload.serviceItems = normalizeDraftServiceItems(serviceItemsDraft).map((item) => ({
          serviceId: item.serviceId,
          offeringId: item.offeringId ?? '',
          durationMinutesSnapshot: Number(item.durationMinutesSnapshot),
          priceSnapshot: item.priceSnapshot,
          sortOrder: Number(item.sortOrder),
        }))
      }

      const res = await fetch(`/api/pro/bookings/${encodeURIComponent(booking.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data: unknown = await safeJson(res)
      if (!res.ok) throw new Error(apiMessage(data, 'Failed to save changes.'))

      closeBooking()
      await loadCalendar()
      forceProFooterRefresh()
    } catch (e: unknown) {
      console.error(e)
      setBookingError(errorMessageFromUnknown(e))
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
      if (!res.ok) throw new Error(apiMessage(data, 'Failed to approve booking.'))

      closeBooking()
      await loadCalendar()
      forceProFooterRefresh()
    } catch (e: unknown) {
      setBookingError(errorMessageFromUnknown(e))
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
      if (!res.ok) throw new Error(apiMessage(data, 'Failed to deny booking.'))

      closeBooking()
      await loadCalendar()
      forceProFooterRefresh()
    } catch (e: unknown) {
      setBookingError(errorMessageFromUnknown(e))
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
        if (!res.ok) throw new Error(apiMessage(data, 'Failed to apply changes.'))
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

        const data: unknown = await safeJson(res)
        if (!res.ok) throw new Error(apiMessage(data, 'Failed to apply changes.'))
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
      setError(errorMessageFromUnknown(e))
      setTimeout(() => setError(null), 3500)
    } finally {
      setApplyingChange(false)
    }
  }

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

    const target = e.currentTarget
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

  const pendingOutsideWorkingHours = pendingChange
    ? isPendingChangeOutsideWorkingHours(pendingChange)
    : false

  return {
    view,
    currentDate,
    events,
    setEvents,

    timeZone,
    needsTimeZoneSetup,
    blockedMinutesToday,

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
    bookingServiceLabel,
    serviceItemsDraft,
    setServiceItemsDraft,
    selectedDraftServiceIds,
    setDraftServiceIds,
    hasDraftServiceItemsChanges,
    reschedDate,
    reschedTime,
    durationMinutes,
    notifyClient,
    allowOutsideHours,
    savingReschedule,
    editOutside,

    setReschedDate,
    setReschedTime,
    setDurationMinutes: setManualDurationMinutes,
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