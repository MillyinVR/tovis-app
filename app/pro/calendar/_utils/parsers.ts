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
  HoldCalendarEvent,
  ManagementLists,
  ServiceLocationType,
  ServiceOption,
  TimeZoneTruthSource,
  WorkingHoursDay,
  WorkingHoursJson,
} from '../_types'

import {
  CALENDAR_SCOPE_ALL,
  DEFAULT_HOLD_CLIENT_NAME,
  DEFAULT_HOLD_TITLE,
  type CalendarScopeMode,
} from '@/lib/calendar/constants'
import { parseClientConfirmationBadgeWire } from '@/lib/booking/clientConfirmation'
import { parseConsentRequirementBadgeWire } from '@/lib/consentForms/requirement'
import { parseRecurringMarkWire } from '@/lib/booking/recurringMark'
import { parsePaymentBadgeWire } from '@/lib/booking/paymentBadge'
import { parseRelationshipBadgeWire } from '@/lib/booking/relationshipLabel'
import { parseCalendarSwatch } from '@/lib/calendar/eventColor'
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

/**
 * ⚠️ Anything that is not literally `ALL` reads as `LOCATION` — including an
 * ABSENT field. A pre-K3 server ignores `?scope=` and answers with a
 * single-location feed; believing that was "all locations" is the very lie this
 * step exists to remove, so the client degrades to the filtered UI instead.
 */
function normalizeCalendarScopeMode(value: unknown): CalendarScopeMode {
  return upper(value) === CALENDAR_SCOPE_ALL ? 'ALL' : 'LOCATION'
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
  const clientProfileId = optionalText(value.clientProfileId)
  const preferenceLabel = optionalText(value.preferenceLabel)
  const offerHref = optionalText(value.offerHref)
  const waitlistEntryId = optionalText(value.waitlistEntryId)
  const serviceId = optionalText(value.serviceId)
  const offeringId = optionalText(value.offeringId)
  const pendingOfferRecord = isRecord(value.pendingOffer)
    ? value.pendingOffer
    : null
  const pendingOfferId = pendingOfferRecord
    ? optionalText(pendingOfferRecord.id)
    : undefined
  const pendingOfferStartsAt = pendingOfferRecord
    ? validIsoString(pendingOfferRecord.startsAt)
    : null
  const pendingOffer =
    pendingOfferId && pendingOfferStartsAt
      ? {
          id: pendingOfferId,
          startsAt: pendingOfferStartsAt,
          locationType:
            normalizeServiceLocationType(pendingOfferRecord?.locationType) ??
            'SALON',
        }
      : null
  // Kind-validated against the canonical helper; a malformed wire value just
  // drops the chip rather than rendering a made-up money state.
  const paymentBadge = parsePaymentBadgeWire(value.paymentBadge)
  // Same rule for the K5 relationship mark — unknown kind → no chip.
  const relationshipBadge = parseRelationshipBadgeWire(value.relationshipBadge)
  // And for the K7 service colour: an id this build's palette doesn't define
  // resolves to neutral (the stripe keeps its status tone) rather than to a
  // data-swatch attribute the stylesheet silently ignores.
  const serviceSwatch = parseCalendarSwatch(value.serviceSwatch)
  // K11 confirmation state — unknown kind → no glyph, never a made-up
  // attendance state. Absent (never requested, or a pre-K11 server) parses to
  // null the same way.
  const clientConfirmation = parseClientConfirmationBadgeWire(
    value.clientConfirmation,
  )
  // K15 unsigned-consent mark — malformed → no chip, never an invented warning.
  const consentRequirement = parseConsentRequirementBadgeWire(
    value.consentRequirement,
  )
  // K19-C recurring mark — no seriesId → no mark, because the mark's whole job
  // is to point at the series.
  const recurring = parseRecurringMarkWire(value.recurring)

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
    ...(paymentBadge ? { paymentBadge } : {}),
    ...(relationshipBadge ? { relationshipBadge } : {}),
    ...(serviceSwatch ? { serviceSwatch } : {}),
    ...(clientConfirmation ? { clientConfirmation } : {}),
    ...(consentRequirement ? { consentRequirement } : {}),
    ...(recurring ? { recurring } : {}),
    ...(clientProfileId ? { clientProfileId } : {}),
    ...(preferenceLabel ? { preferenceLabel } : {}),
    ...(offerHref ? { offerHref } : {}),
    ...(waitlistEntryId ? { waitlistEntryId } : {}),
    ...(serviceId ? { serviceId } : {}),
    ...(offeringId ? { offeringId } : {}),
    ...(pendingOffer ? { pendingOffer } : {}),
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

function parseHoldEvent(
  value: Record<string, unknown>,
): HoldCalendarEvent | null {
  const id = nullableText(value.id)
  const startsAt = validIsoString(value.startsAt)
  const endsAt = validIsoString(value.endsAt)

  if (!id || !startsAt || !endsAt) return null

  // Same shape as the block parser's: prefer the explicit field, fall back to
  // the prefixed row id ([[calendar-block-event-id-prefix]]).
  const derivedHoldId = id.startsWith('hold:') ? id.slice('hold:'.length) : null

  const holdId = nullableText(value.holdId) ?? derivedHoldId
  if (!holdId) return null

  // A hold with no expiry is not a live reservation we can reason about, and
  // rendering one would leave a segment on the calendar that never clears.
  const expiresAt = validIsoString(value.expiresAt)
  if (!expiresAt) return null

  const localDateKey = optionalText(value.localDateKey)
  const durationMinutes = positiveNumberOrUndefined(value.durationMinutes)

  const event: HoldCalendarEvent = {
    kind: 'HOLD',
    id,
    holdId,
    startsAt,
    endsAt,
    expiresAt,
    title: nullableText(value.title) ?? DEFAULT_HOLD_TITLE,
    clientName: nullableText(value.clientName) ?? DEFAULT_HOLD_CLIENT_NAME,
    status: 'HELD',
    locationId:
      value.locationId === null ? null : nullableText(value.locationId),
    locationType: normalizeServiceLocationType(value.locationType),
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

  if (kind === 'HOLD') {
    return parseHoldEvent(value)
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

  const professionalId = optionalText(value.professionalId)

  return {
    ...(professionalId ? { professionalId } : {}),
    scope: normalizeCalendarScopeMode(value.scope),
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

    // `GET /api/v1/pro/services` carries price + duration NESTED under
    // `selectedMode` — the mode it resolved for the requested `locationType`
    // — not at the top level (see app/api/v1/pro/services/route.ts, and the
    // iOS decoder TovisKit `ProSellableService`). Read the nested mode first
    // and only then fall back to a flat field, so a row that never resolved a
    // mode stays duration-less rather than borrowing the wrong mode's number.
    const selectedMode = isRecord(row.selectedMode) ? row.selectedMode : null

    const rawDuration = selectedMode?.durationMinutes ?? row.durationMinutes
    const rawPrice = selectedMode?.priceStartingAt ?? row.priceStartingAt

    const durationMinutes =
      rawDuration === null || rawDuration === undefined
        ? null
        : finiteNumberOrNull(rawDuration)

    const offeringId = optionalText(row.offeringId)

    const priceStartingAt =
      rawPrice === null || rawPrice === undefined
        ? null
        : nullableText(rawPrice)

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