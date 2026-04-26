// app/pro/calendar/_utils/parsers.ts
//
// Pure parser / normalizer functions extracted from calendar hooks.
// Zero React dependency. Safe to unit-test in isolation.

import type {
  BookingCalendarEvent,
  BookingCalendarStatus,
  BookingDetails,
  BookingServiceItem,
  BookingServiceItemType,
  BlockCalendarEvent,
  CalendarEvent,
  CalendarLocationType,
  CalendarRangeMeta,
  CalendarResponse,
  CalendarResponseLocation,
  CalendarServiceItem,
  CalendarStats,
  ManagementLists,
  ServiceLocationType,
  ServiceOption,
  TimeZoneTruthSource,
  WorkingHoursDay,
  WorkingHoursJson,
} from '../_types'

import { isRecord } from '@/lib/guards'
import { readErrorMessage } from '@/lib/http'
import { pickBool, pickNumber, pickString } from '@/lib/pick'
import { parseHHMM } from '@/lib/scheduling/workingHours'
import { DEFAULT_TIME_ZONE, sanitizeTimeZone } from '@/lib/timeZone'

export type LocationType = CalendarLocationType
export type ProLocationType = 'SALON' | 'SUITE' | 'MOBILE_BASE' | string

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

// ─── Primitive helpers ────────────────────────────────────────────────────────

function normalizeText(value: unknown): string {
  return pickString(value)?.trim() ?? ''
}

function nullableText(value: unknown): string | null {
  const text = normalizeText(value)

  return text ? text : null
}

function optionalText(value: unknown): string | undefined {
  const text = normalizeText(value)

  return text ? text : undefined
}

function finiteNumberOrNull(value: unknown): number | null {
  const number = pickNumber(value)

  return number !== null && Number.isFinite(number) ? number : null
}

function positiveNumberOrUndefined(value: unknown): number | undefined {
  const number = finiteNumberOrNull(value)

  return number !== null && number > 0 ? number : undefined
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return pickBool(value) ?? fallback
}

function validIsoString(value: unknown): string | null {
  const iso = nullableText(value)
  if (!iso) return null

  const date = new Date(iso)

  return Number.isFinite(date.getTime()) ? iso : null
}

function nullablePriceText(value: unknown): string | null {
  if (value === null || value === undefined) return null

  const text = nullableText(value)

  if (text) return text

  const number = finiteNumberOrNull(value)

  return number === null ? null : String(number)
}

function normalizeHHMM(value: unknown): string | null {
  const parsed = parseHHMM(value)
  if (!parsed) return null

  return `${String(parsed.hh).padStart(2, '0')}:${String(parsed.mm).padStart(
    2,
    '0',
  )}`
}

function emptyManagementLists(): ManagementLists {
  return {
    todaysBookings: [],
    pendingRequests: [],
    waitlistToday: [],
    blockedToday: [],
  }
}

export function apiMessage(data: unknown, fallback: string): string {
  return (
    readErrorMessage(data) ??
    nullableText(isRecord(data) ? data.message : null) ??
    fallback
  )
}

export function upper(value: unknown): string {
  return normalizeText(value).toUpperCase()
}

// ─── Status / enum-ish normalizers ────────────────────────────────────────────

function normalizeBookingCalendarStatus(value: unknown): BookingCalendarStatus {
  const raw = upper(value)

  if (raw === 'PENDING') return 'PENDING'
  if (raw === 'ACCEPTED') return 'ACCEPTED'
  if (raw === 'CONFIRMED') return 'CONFIRMED'
  if (raw === 'COMPLETED') return 'COMPLETED'
  if (raw === 'CANCELLED') return 'CANCELLED'
  if (raw === 'DECLINED') return 'DECLINED'
  if (raw === 'NO_SHOW') return 'NO_SHOW'
  if (raw === 'RESCHEDULE_REQUESTED') return 'RESCHEDULE_REQUESTED'
  if (raw === 'WAITLIST') return 'WAITLIST'
  if (raw === 'UNKNOWN') return 'UNKNOWN'

  return nullableText(value) ?? 'UNKNOWN'
}

function normalizeTimeZoneTruthSource(value: unknown): TimeZoneTruthSource {
  const raw = upper(value)

  if (raw === 'BOOKING_SNAPSHOT') return 'BOOKING_SNAPSHOT'
  if (raw === 'HOLD_SNAPSHOT') return 'HOLD_SNAPSHOT'
  if (raw === 'LOCATION') return 'LOCATION'
  if (raw === 'PROFESSIONAL') return 'PROFESSIONAL'
  if (raw === 'FALLBACK') return 'FALLBACK'

  return 'FALLBACK'
}

function normalizeBookingServiceItemType(value: unknown): BookingServiceItemType {
  const raw = upper(value)

  if (raw === 'BASE') return 'BASE'
  if (raw === 'ADD_ON') return 'ADD_ON'

  return nullableText(value) ?? 'ADD_ON'
}

export function normalizeProLocationType(value: unknown): ProLocationType {
  const raw = upper(value)

  if (raw === 'SALON') return 'SALON'
  if (raw === 'SUITE') return 'SUITE'
  if (raw === 'MOBILE_BASE') return 'MOBILE_BASE'

  return nullableText(value) ?? 'SALON'
}

export function normalizeLocationType(value: unknown): LocationType {
  const raw = upper(value)

  return raw === 'MOBILE' || raw === 'MOBILE_BASE' ? 'MOBILE' : 'SALON'
}

function normalizeServiceLocationType(
  value: unknown,
): ServiceLocationType | null {
  if (value === null || value === undefined) return null

  const raw = upper(value)

  if (raw === 'SALON') return 'SALON'
  if (raw === 'MOBILE') return 'MOBILE'

  return nullableText(value)
}

export function pickLocationType(
  canSalon: boolean,
  canMobile: boolean,
  preferred?: LocationType,
): LocationType {
  if (preferred === 'SALON' && canSalon) return 'SALON'
  if (preferred === 'MOBILE' && canMobile) return 'MOBILE'
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

// ─── Working hours parsers ────────────────────────────────────────────────────

export function parseWorkingHoursDay(value: unknown): WorkingHoursDay | null {
  if (!isRecord(value)) return null

  const enabled = pickBool(value.enabled)
  const start = normalizeHHMM(value.start)
  const end = normalizeHHMM(value.end)

  if (enabled === null || !start || !end) return null

  return {
    enabled,
    start,
    end,
  }
}

export function parseWorkingHoursJson(value: unknown): WorkingHoursJson {
  if (!isRecord(value)) return null

  const sun = parseWorkingHoursDay(value.sun)
  const mon = parseWorkingHoursDay(value.mon)
  const tue = parseWorkingHoursDay(value.tue)
  const wed = parseWorkingHoursDay(value.wed)
  const thu = parseWorkingHoursDay(value.thu)
  const fri = parseWorkingHoursDay(value.fri)
  const sat = parseWorkingHoursDay(value.sat)

  if (!sun || !mon || !tue || !wed || !thu || !fri || !sat) return null

  return {
    sun,
    mon,
    tue,
    wed,
    thu,
    fri,
    sat,
  }
}

// ─── Location parsers ─────────────────────────────────────────────────────────

export function parseCalendarRouteLocation(
  value: unknown,
): CalendarRouteLocation | null {
  if (!isRecord(value)) return null

  const id = nullableText(value.id)
  if (!id) return null

  return {
    id,
    type: normalizeProLocationType(value.type),
    timeZone: nullableText(value.timeZone),
  }
}

export function parseCalendarResponseLocation(
  value: unknown,
): CalendarResponseLocation | null {
  if (!isRecord(value)) return null

  const id = nullableText(value.id)
  if (!id) return null

  return {
    id,
    type: nullableText(value.type) ?? 'SALON',
    timeZone: nullableText(value.timeZone),
    timeZoneValid: normalizeBoolean(value.timeZoneValid, false),
  }
}

export function parseProLocation(value: unknown): ProLocation | null {
  if (!isRecord(value)) return null

  const id = nullableText(value.id)
  if (!id) return null

  return {
    id,
    type: normalizeProLocationType(value.type),
    name: nullableText(value.name),
    formattedAddress: nullableText(value.formattedAddress),
    isPrimary: normalizeBoolean(value.isPrimary, false),
    isBookable: normalizeBoolean(value.isBookable, true),
    timeZone: nullableText(value.timeZone),
    workingHours: parseWorkingHoursJson(value.workingHours),
    stepMinutes: finiteNumberOrNull(value.stepMinutes),
  }
}

// ─── Range parser ─────────────────────────────────────────────────────────────

export function parseCalendarRangeMeta(
  value: unknown,
): CalendarRangeMeta | null {
  if (!isRecord(value)) return null

  const from = validIsoString(value.from)
  const requestedTo = validIsoString(value.requestedTo)
  const effectiveTo = validIsoString(value.effectiveTo)
  const maxDays = finiteNumberOrNull(value.maxDays)

  if (!from || !requestedTo || !effectiveTo || maxDays === null) return null

  return {
    from,
    requestedTo,
    effectiveTo,
    clamped: normalizeBoolean(value.clamped, false),
    maxDays,
  }
}

// ─── Calendar event parsers ───────────────────────────────────────────────────

function parseCalendarServiceItem(value: unknown): CalendarServiceItem | null {
  if (!isRecord(value)) return null

  const id = nullableText(value.id)
  const durationMinutes = finiteNumberOrNull(value.durationMinutes)
  const sortOrder = finiteNumberOrNull(value.sortOrder)

  if (!id || durationMinutes === null || sortOrder === null) return null

  return {
    id,
    name: nullableText(value.name),
    durationMinutes,
    price: nullablePriceText(value.price),
    sortOrder,
  }
}

function parseCalendarServiceItems(value: unknown): CalendarServiceItem[] {
  if (!Array.isArray(value)) return []

  const items: CalendarServiceItem[] = []

  for (const row of value) {
    const item = parseCalendarServiceItem(row)
    if (item) items.push(item)
  }

  return items.sort((first, second) => first.sortOrder - second.sortOrder)
}

function parseBookingEvent(
  value: Record<string, unknown>,
): BookingCalendarEvent | null {
  const id = nullableText(value.id)
  const startsAt = validIsoString(value.startsAt)
  const endsAt = validIsoString(value.endsAt)

  if (!id || !startsAt || !endsAt) return null

  const title = nullableText(value.title) ?? 'Booking'
  const detailsRecord = isRecord(value.details) ? value.details : null
  const viewLocalDateKey = optionalText(value.viewLocalDateKey)
  const durationMinutes = positiveNumberOrUndefined(value.durationMinutes)

  const event: BookingCalendarEvent = {
    kind: 'BOOKING',
    id,
    startsAt,
    endsAt,
    title,
    clientName: nullableText(value.clientName) ?? '',
    status: normalizeBookingCalendarStatus(value.status),
    locationId:
      value.locationId === null ? null : nullableText(value.locationId),
    locationType: normalizeServiceLocationType(value.locationType),
    timeZone: sanitizeTimeZone(value.timeZone, DEFAULT_TIME_ZONE),
    timeZoneSource: normalizeTimeZoneTruthSource(value.timeZoneSource),
    localDateKey:
      nullableText(value.localDateKey) ??
      nullableText(value.date) ??
      startsAt.slice(0, 10),
    details: {
      serviceName: detailsRecord
        ? nullableText(detailsRecord.serviceName) ?? title
        : title,
      bufferMinutes: detailsRecord
        ? finiteNumberOrNull(detailsRecord.bufferMinutes) ?? 0
        : 0,
      serviceItems: parseCalendarServiceItems(detailsRecord?.serviceItems),
    },
    ...(viewLocalDateKey ? { viewLocalDateKey } : {}),
    ...(durationMinutes !== undefined ? { durationMinutes } : {}),
  }

  return event
}

function parseBlockEvent(
  value: Record<string, unknown>,
): BlockCalendarEvent | null {
  const id = nullableText(value.id)
  const startsAt = validIsoString(value.startsAt)
  const endsAt = validIsoString(value.endsAt)

  if (!id || !startsAt || !endsAt) return null

  const derivedBlockId = id.startsWith('block:')
    ? id.slice('block:'.length)
    : null

  const blockId = nullableText(value.blockId) ?? derivedBlockId
  if (!blockId) return null

  const localDateKey = optionalText(value.localDateKey)
  const durationMinutes = positiveNumberOrUndefined(value.durationMinutes)

  const event: BlockCalendarEvent = {
    kind: 'BLOCK',
    id,
    blockId,
    startsAt,
    endsAt,
    title: nullableText(value.title) ?? 'Blocked',
    clientName: nullableText(value.clientName) ?? 'Personal time',
    status: 'BLOCKED',
    note: value.note === null ? null : nullableText(value.note),
    locationId:
      value.locationId === null ? null : nullableText(value.locationId),
    ...(localDateKey ? { localDateKey } : {}),
    ...(durationMinutes !== undefined ? { durationMinutes } : {}),
  }

  return event
}

export function parseCalendarEvent(value: unknown): CalendarEvent | null {
  if (!isRecord(value)) return null

  const kind = upper(value.kind)

  if (kind === 'BOOKING') {
    return parseBookingEvent(value)
  }

  if (kind === 'BLOCK') {
    return parseBlockEvent(value)
  }

  return null
}

export function parseCalendarEvents(value: unknown): CalendarEvent[] {
  if (!Array.isArray(value)) return []

  const events: CalendarEvent[] = []

  for (const row of value) {
    const event = parseCalendarEvent(row)
    if (event) events.push(event)
  }

  return events
}

export function parseManagementLists(value: unknown): ManagementLists {
  if (!isRecord(value)) return emptyManagementLists()

  return {
    todaysBookings: parseCalendarEvents(value.todaysBookings),
    pendingRequests: parseCalendarEvents(value.pendingRequests),
    waitlistToday: parseCalendarEvents(value.waitlistToday),
    blockedToday: parseCalendarEvents(value.blockedToday),
  }
}

export function parseCalendarStats(value: unknown): CalendarStats {
  if (!isRecord(value)) return null

  const todaysBookings = finiteNumberOrNull(value.todaysBookings)
  const pendingRequests = finiteNumberOrNull(value.pendingRequests)

  if (todaysBookings === null || pendingRequests === null) return null

  return {
    todaysBookings,
    availableHours:
      value.availableHours === null
        ? null
        : finiteNumberOrNull(value.availableHours),
    pendingRequests,
    blockedHours:
      value.blockedHours === null
        ? null
        : finiteNumberOrNull(value.blockedHours),
  }
}

// ─── Calendar response parser ─────────────────────────────────────────────────

export function parseCalendarResponse(value: unknown): CalendarResponse | null {
  if (!isRecord(value)) return null

  const range = parseCalendarRangeMeta(value.range)

  if (!range) return null

  return {
    location: parseCalendarResponseLocation(value.location),
    range,

    timeZone: sanitizeTimeZone(value.timeZone, DEFAULT_TIME_ZONE),
    viewportTimeZone: sanitizeTimeZone(value.viewportTimeZone, DEFAULT_TIME_ZONE),
    needsTimeZoneSetup: normalizeBoolean(value.needsTimeZoneSetup, false),

    events: parseCalendarEvents(value.events),

    canSalon: normalizeBoolean(value.canSalon, false),
    canMobile: normalizeBoolean(value.canMobile, false),

    stats: parseCalendarStats(value.stats),
    blockedMinutesToday: finiteNumberOrNull(value.blockedMinutesToday) ?? 0,

    autoAcceptBookings: normalizeBoolean(value.autoAcceptBookings, false),
    management: parseManagementLists(value.management),
  }
}

// ─── Service option parsers ───────────────────────────────────────────────────

export function parseServiceOptions(value: unknown): ServiceOption[] {
  if (!Array.isArray(value)) return []

  const options: ServiceOption[] = []

  for (const row of value) {
    if (!isRecord(row)) continue

    const id = nullableText(row.id)
    const name = nullableText(row.name)
    if (!id || !name) continue

    const durationMinutes =
      row.durationMinutes === null
        ? null
        : finiteNumberOrNull(row.durationMinutes)

    const offeringId = optionalText(row.offeringId)

    const priceStartingAt =
      row.priceStartingAt === null
        ? null
        : nullableText(row.priceStartingAt)

    options.push({
      id,
      name,
      ...(durationMinutes !== null ? { durationMinutes } : {}),
      ...(offeringId ? { offeringId } : {}),
      ...(priceStartingAt !== null ? { priceStartingAt } : {}),
    })
  }

  return options
}

// ─── Booking detail parsers ───────────────────────────────────────────────────

export function parseBookingServiceItem(
  value: unknown,
): BookingServiceItem | null {
  if (!isRecord(value)) return null

  const id = nullableText(value.id)
  const serviceId = nullableText(value.serviceId)
  const itemType = nullableText(value.itemType)
  const serviceName = nullableText(value.serviceName)
  const durationMinutesSnapshot = finiteNumberOrNull(
    value.durationMinutesSnapshot,
  )
  const sortOrder = finiteNumberOrNull(value.sortOrder)

  if (
    !id ||
    !serviceId ||
    !itemType ||
    !serviceName ||
    durationMinutesSnapshot === null ||
    sortOrder === null
  ) {
    return null
  }

  return {
    id,
    serviceId,
    offeringId:
      value.offeringId === null ? null : nullableText(value.offeringId),
    itemType: normalizeBookingServiceItemType(itemType),
    serviceName,
    priceSnapshot:
      value.priceSnapshot === null ? null : nullableText(value.priceSnapshot),
    durationMinutesSnapshot,
    sortOrder,
  }
}

export function parseBookingServiceItems(value: unknown): BookingServiceItem[] {
  if (!Array.isArray(value)) return []

  const items: BookingServiceItem[] = []

  for (const row of value) {
    const item = parseBookingServiceItem(row)
    if (item) items.push(item)
  }

  return items.sort((first, second) => first.sortOrder - second.sortOrder)
}

export function parseBookingDetails(value: unknown): BookingDetails | null {
  if (!isRecord(value)) return null

  const id = nullableText(value.id)
  const scheduledFor = validIsoString(value.scheduledFor)
  const endsAt = validIsoString(value.endsAt)
  const totalDurationMinutes = finiteNumberOrNull(value.totalDurationMinutes)

  if (!id || !scheduledFor || !endsAt || totalDurationMinutes === null) {
    return null
  }

  const client = value.client
  if (!isRecord(client)) return null

  const fullName = nullableText(client.fullName)
  if (!fullName) return null

  const locationId =
    value.locationId === null ? null : optionalText(value.locationId)

  const locationType = normalizeServiceLocationType(value.locationType)

  const locationAddressSnapshot =
    value.locationAddressSnapshot === null
      ? null
      : optionalText(value.locationAddressSnapshot)

  const locationLatSnapshot = finiteNumberOrNull(value.locationLatSnapshot)
  const locationLngSnapshot = finiteNumberOrNull(value.locationLngSnapshot)
  const durationMinutes = positiveNumberOrUndefined(value.durationMinutes)
  const bufferMinutes = positiveNumberOrUndefined(value.bufferMinutes)
  const subtotalSnapshot =
    value.subtotalSnapshot === null ? null : optionalText(value.subtotalSnapshot)

  return {
    id,
    status: normalizeBookingCalendarStatus(value.status),
    scheduledFor,
    endsAt,
    ...(locationId !== undefined ? { locationId } : {}),
    ...(locationType !== null ? { locationType } : {}),
    ...(locationAddressSnapshot !== undefined
      ? { locationAddressSnapshot }
      : {}),
    ...(locationLatSnapshot !== null ? { locationLatSnapshot } : {}),
    ...(locationLngSnapshot !== null ? { locationLngSnapshot } : {}),
    totalDurationMinutes,
    ...(durationMinutes !== undefined ? { durationMinutes } : {}),
    ...(bufferMinutes !== undefined ? { bufferMinutes } : {}),
    ...(subtotalSnapshot !== undefined ? { subtotalSnapshot } : {}),
    client: {
      fullName,
      email: client.email === null ? null : nullableText(client.email),
      phone: client.phone === null ? null : nullableText(client.phone),
    },
    timeZone: sanitizeTimeZone(value.timeZone, DEFAULT_TIME_ZONE),
    timeZoneSource: normalizeTimeZoneTruthSource(value.timeZoneSource),
    serviceItems: parseBookingServiceItems(value.serviceItems),
  }
}