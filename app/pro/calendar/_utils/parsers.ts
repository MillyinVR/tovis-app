// app/pro/calendar/_utils/parsers.ts
//
// Pure parser / normalizer functions extracted from useCalendarData.
// Zero React dependency — safe to unit-test in isolation.
//

import type {
  BookingDetails,
  BookingServiceItem,
  CalendarEvent,
  CalendarStats,
  ManagementLists,
  ServiceOption,
  WorkingHoursDay,
  WorkingHoursJson,
  BookingCalendarStatus,
} from '../_types'
import { isRecord } from '@/lib/guards'
import { pickNumber, pickString } from '@/lib/pick'
import { readErrorMessage } from '@/lib/http'
import { sanitizeTimeZone, DEFAULT_TIME_ZONE } from '@/lib/timeZone'

// ── Local types (not React-specific) ─────────────────────────────────

export type LocationType = 'SALON' | 'MOBILE'
export type ProLocationType = 'SALON' | 'SUITE' | 'MOBILE_BASE' | (string & {})

export type ProLocation = {
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

export type CalendarRouteLocation = {
  id: string
  type: ProLocationType
  timeZone: string | null
}

// Keep this aligned with the server event payload.
type AppointmentTimeZoneSource =
  | 'BOOKING_SNAPSHOT'
  | 'HOLD_SNAPSHOT'
  | 'LOCATION'
  | 'PROFESSIONAL'
  | 'FALLBACK'

// ── Tiny helpers ────────────────────────────────────────────────────

export function apiMessage(data: unknown, fallback: string) {
  return (
    readErrorMessage(data) ??
    (isRecord(data) ? pickString(data.message) : null) ??
    fallback
  )
}

export function upper(v: unknown): string {
  return (pickString(v) ?? '').toUpperCase()
}

function normalizeKnownBookingLocationType(value: unknown): 'SALON' | 'MOBILE' {
  const raw = upper(value)
  return raw === 'MOBILE' || raw === 'MOBILE_BASE' ? 'MOBILE' : 'SALON'
}

function normalizeBookingCalendarStatus(value: unknown): BookingCalendarStatus {
  const raw = upper(value)

  if (
    raw === 'PENDING' ||
    raw === 'ACCEPTED' ||
    raw === 'COMPLETED' ||
    raw === 'CANCELLED' ||
    raw === 'WAITLIST' ||
    raw === 'UNKNOWN'
  ) {
    return raw
  }

  const fallback = pickString(value)
  return (fallback ?? 'UNKNOWN') as BookingCalendarStatus
}

function normalizeAppointmentTimeZoneSource(
  value: unknown,
): AppointmentTimeZoneSource {
  const raw = upper(value)

  if (raw === 'BOOKING_SNAPSHOT') return 'BOOKING_SNAPSHOT'
  if (raw === 'HOLD_SNAPSHOT') return 'HOLD_SNAPSHOT'
  if (raw === 'LOCATION') return 'LOCATION'
  if (raw === 'PROFESSIONAL') return 'PROFESSIONAL'
  if (raw === 'FALLBACK') return 'FALLBACK'

  return 'FALLBACK'
}

// ── Location-type normalisers ──────────────────────────────────────

export function normalizeProLocationType(value: unknown): ProLocationType {
  const raw = upper(value)

  if (raw === 'SALON') return 'SALON'
  if (raw === 'SUITE') return 'SUITE'
  if (raw === 'MOBILE_BASE') return 'MOBILE_BASE'

  const fallback = pickString(value)
  return (fallback ?? 'SALON') as ProLocationType
}

export function normalizeLocationType(value: unknown): LocationType {
  return upper(value) === 'MOBILE' || upper(value) === 'MOBILE_BASE'
    ? 'MOBILE'
    : 'SALON'
}

export function pickLocationType(
  canSalon: boolean,
  canMobile: boolean,
  preferred?: LocationType,
): LocationType {
  if (
    preferred &&
    ((preferred === 'SALON' && canSalon) ||
      (preferred === 'MOBILE' && canMobile))
  ) {
    return preferred
  }
  if (canSalon) return 'SALON'
  if (canMobile) return 'MOBILE'
  return 'SALON'
}

export function locationTypeFromProfessionalType(value: unknown): LocationType {
  return normalizeLocationType(value)
}

export function locationTypeFromBookingValue(value: unknown): LocationType {
  return normalizeLocationType(value)
}

// ── Working-hours parsers ──────────────────────────────────────────

export function parseWorkingHoursDay(v: unknown): WorkingHoursDay | null {
  if (!isRecord(v)) return null

  const enabled = typeof v.enabled === 'boolean' ? v.enabled : null
  const start = pickString(v.start)
  const end = pickString(v.end)

  if (enabled == null || !start || !end) return null

  return { enabled, start, end }
}

export function parseWorkingHoursJson(v: unknown): WorkingHoursJson {
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

// ── Location parsers ───────────────────────────────────────────────

export function parseCalendarRouteLocation(
  v: unknown,
): CalendarRouteLocation | null {
  if (!isRecord(v)) return null

  const id = pickString(v.id)
  if (!id) return null

  return {
    id,
    type: normalizeProLocationType(v.type),
    timeZone: pickString(v.timeZone) ?? null,
  }
}

export function parseProLocation(v: unknown): ProLocation | null {
  if (!isRecord(v)) return null

  const id = pickString(v.id)
  if (!id) return null

  const stepMinutesRaw =
    v.stepMinutes === null ? null : pickNumber(v.stepMinutes)
  const stepMinutes =
    stepMinutesRaw != null && Number.isFinite(stepMinutesRaw)
      ? stepMinutesRaw
      : null

  return {
    id,
    type: normalizeProLocationType(v.type),
    name: pickString(v.name) ?? null,
    formattedAddress: pickString(v.formattedAddress) ?? null,
    isPrimary: Boolean(v.isPrimary),
    isBookable: v.isBookable === undefined ? true : Boolean(v.isBookable),
    timeZone: pickString(v.timeZone) ?? null,
    workingHours: parseWorkingHoursJson(v.workingHours),
    stepMinutes,
  }
}

// ── Calendar-event parsers ─────────────────────────────────────────

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

export function parseCalendarEvent(v: unknown): CalendarEvent | null {
  if (!isRecord(v)) return null

  const kind = pickString(v.kind)
  const id = pickString(v.id)
  const startsAt = pickString(v.startsAt)
  const endsAt = pickString(v.endsAt)

  if (!kind || !id || !startsAt || !endsAt) return null

  const title =
    pickString(v.title) ?? (kind === 'BLOCK' ? 'Blocked' : 'Booking')
  const clientName = pickString(v.clientName) ?? ''

  const dur = pickNumber(v.durationMinutes)
  const durationMinutes = dur != null && dur > 0 ? dur : undefined

  if (kind === 'BOOKING') {
    const locationId =
      v.locationId === null ? null : (pickString(v.locationId) ?? null)

    const locationType = normalizeKnownBookingLocationType(v.locationType)

    const detailsRecord = isRecord(v.details) ? v.details : null
    const rawServiceItems = detailsRecord?.serviceItems

    const serviceItems = Array.isArray(rawServiceItems)
      ? rawServiceItems.reduce<
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

    const timeZone = sanitizeTimeZone(v.timeZone, DEFAULT_TIME_ZONE)
    const timeZoneSource = normalizeAppointmentTimeZoneSource(v.timeZoneSource)
    const localDateKey =
      pickString(v.localDateKey) ?? pickString(v.date) ?? startsAt.slice(0, 10)

    return {
      kind: 'BOOKING',
      id,
      startsAt,
      endsAt,
      title,
      clientName,
      status: normalizeBookingCalendarStatus(v.status),
      locationId,
      locationType,
      timeZone,
      timeZoneSource,
      localDateKey,
      details: {
        serviceName: detailsRecord
          ? pickString(detailsRecord.serviceName) ?? title
          : title,
        bufferMinutes: detailsRecord
          ? pickNumber(detailsRecord.bufferMinutes) ?? 0
          : 0,
        serviceItems,
      },
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
      status: 'BLOCKED',
      note: note ?? null,
      locationId: locationId ?? null,
      ...(durationMinutes != null ? { durationMinutes } : {}),
    }
  }

  return null
}

export function parseCalendarEvents(v: unknown): CalendarEvent[] {
  if (!Array.isArray(v)) return []

  const out: CalendarEvent[] = []
  for (const row of v) {
    const ev = parseCalendarEvent(row)
    if (ev) out.push(ev)
  }

  return out
}

// ── Management / stats parsers ────────────────────────────────────

export function parseManagementLists(v: unknown): ManagementLists {
  if (!isRecord(v)) {
    return {
      todaysBookings: [],
      pendingRequests: [],
      waitlistToday: [],
      blockedToday: [],
    }
  }

  return {
    todaysBookings: parseCalendarEvents(v.todaysBookings),
    pendingRequests: parseCalendarEvents(v.pendingRequests),
    waitlistToday: parseCalendarEvents(v.waitlistToday),
    blockedToday: parseCalendarEvents(v.blockedToday),
  }
}

export function parseCalendarStats(v: unknown): CalendarStats {
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

// ── Service-option parser ──────────────────────────────────────────

export function parseServiceOptions(v: unknown): ServiceOption[] {
  if (!Array.isArray(v)) return []

  const out: ServiceOption[] = []
  for (const row of v) {
    if (!isRecord(row)) continue

    const id = pickString(row.id)
    const name = pickString(row.name)
    if (!id || !name) continue

    const durationMinutes =
      row.durationMinutes === null
        ? null
        : (pickNumber(row.durationMinutes) ?? null)

    const offeringId = pickString(row.offeringId) ?? undefined
    const priceStartingAt =
      row.priceStartingAt === null
        ? null
        : (pickString(row.priceStartingAt) ?? null)

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

// ── Booking-detail parsers ─────────────────────────────────────────

export function parseBookingServiceItem(v: unknown): BookingServiceItem | null {
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

export function parseBookingServiceItems(v: unknown): BookingServiceItem[] {
  if (!Array.isArray(v)) return []

  const out: BookingServiceItem[] = []
  for (const row of v) {
    const item = parseBookingServiceItem(row)
    if (item) out.push(item)
  }

  return out.sort((a, b) => a.sortOrder - b.sortOrder)
}

export function parseBookingDetails(v: unknown): BookingDetails | null {
  if (!isRecord(v)) return null

  const id = pickString(v.id)
  const status = pickString(v.status)
  const scheduledFor = pickString(v.scheduledFor)
  const endsAt = pickString(v.endsAt)
  const totalDurationMinutes = pickNumber(v.totalDurationMinutes)
  const durationMinutes = pickNumber(v.durationMinutes) ?? undefined
  const bufferMinutes = pickNumber(v.bufferMinutes) ?? undefined
  const subtotalSnapshot = pickString(v.subtotalSnapshot) ?? undefined

  const locationId =
    v.locationId === null ? null : (pickString(v.locationId) ?? undefined)

  const locationTypeRaw = pickString(v.locationType)
  const locationType =
    locationTypeRaw === 'SALON' || locationTypeRaw === 'MOBILE'
      ? locationTypeRaw
      : undefined

  const locationAddressSnapshot =
    v.locationAddressSnapshot === null
      ? null
      : (pickString(v.locationAddressSnapshot) ?? undefined)

  const rawLat = pickNumber(v.locationLatSnapshot)
  const locationLatSnapshot =
    rawLat != null && Number.isFinite(rawLat) ? rawLat : undefined

  const rawLng = pickNumber(v.locationLngSnapshot)
  const locationLngSnapshot =
    rawLng != null && Number.isFinite(rawLng) ? rawLng : undefined

  const client = v.client
  if (!isRecord(client)) return null

  const fullName = pickString(client.fullName)
  const email = client.email === null ? null : pickString(client.email)
  const phone = client.phone === null ? null : pickString(client.phone)

  const tz = sanitizeTimeZone(v.timeZone, DEFAULT_TIME_ZONE)
  const serviceItems = parseBookingServiceItems(v.serviceItems)

  if (
    !id ||
    !status ||
    !scheduledFor ||
    !endsAt ||
    totalDurationMinutes == null ||
    !fullName
  ) {
    return null
  }

  return {
    id,
    status,
    scheduledFor,
    endsAt,
    ...(locationId !== undefined ? { locationId } : {}),
    ...(locationType ? { locationType } : {}),
    ...(locationAddressSnapshot !== undefined ? { locationAddressSnapshot } : {}),
    ...(locationLatSnapshot !== undefined ? { locationLatSnapshot } : {}),
    ...(locationLngSnapshot !== undefined ? { locationLngSnapshot } : {}),
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