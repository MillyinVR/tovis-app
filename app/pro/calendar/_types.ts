// app/pro/calendar/_types.ts

import type { IanaTimeZone } from '@/lib/timeZone'

export type ViewMode = 'day' | 'week' | 'month'
export type EntityType = 'booking' | 'block'

export type CalendarDisplayDensity = 'full' | 'compact' | 'micro'

export type WeekdayKey =
  | 'sun'
  | 'mon'
  | 'tue'
  | 'wed'
  | 'thu'
  | 'fri'
  | 'sat'

export type TimeZoneTruthSource =
  | 'BOOKING_SNAPSHOT'
  | 'HOLD_SNAPSHOT'
  | 'LOCATION'
  | 'PROFESSIONAL'
  | 'FALLBACK'

/**
 * UI-facing location mode.
 * Keep this narrow because calendar layout logic only understands these modes.
 */
export type CalendarLocationType = 'SALON' | 'MOBILE'

/**
 * Backend-facing service location mode.
 * Keep this extensible because backend/provider enums may grow.
 */
export type ServiceLocationType =
  | CalendarLocationType
  | (string & Record<never, never>)

/**
 * Backend-facing booking status.
 * Known values get strong handling, but future statuses should not break parsing.
 */
export type BookingCalendarStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'CONFIRMED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'DECLINED'
  | 'NO_SHOW'
  | 'RESCHEDULE_REQUESTED'
  | 'WAITLIST'
  | 'UNKNOWN'
  | (string & Record<never, never>)

export type BlockCalendarStatus = 'BLOCKED'
export type CalendarStatus = BookingCalendarStatus | BlockCalendarStatus

export type WorkingHoursDay = {
  enabled: boolean
  start: string
  end: string
}

export type WorkingHoursJson = Record<WeekdayKey, WorkingHoursDay> | null

export type CalendarStats = {
  todaysBookings: number
  availableHours: number | null
  pendingRequests: number
  blockedHours: number | null
} | null

export type ServiceOption = {
  id: string
  name: string
  durationMinutes?: number | null
  offeringId?: string
  priceStartingAt?: string | null
}

export type BookingServiceItemType =
  | 'BASE'
  | 'ADD_ON'
  | (string & Record<never, never>)

export type BookingServiceItem = {
  id: string
  serviceId: string
  offeringId: string | null
  itemType: BookingServiceItemType
  serviceName: string
  priceSnapshot: string | null
  durationMinutesSnapshot: number
  sortOrder: number
}

export type BookingClientSnapshot = {
  fullName: string
  email: string | null
  phone: string | null
}

export type BookingDetails = {
  id: string
  status: BookingCalendarStatus
  scheduledFor: string
  endsAt: string

  locationId?: string | null
  locationType?: ServiceLocationType | null

  locationAddressSnapshot?: string | null
  locationLatSnapshot?: number | null
  locationLngSnapshot?: number | null

  totalDurationMinutes: number
  durationMinutes?: number | null
  bufferMinutes?: number | null
  subtotalSnapshot?: string | null

  client: BookingClientSnapshot

  timeZone: IanaTimeZone
  timeZoneSource?: TimeZoneTruthSource
  serviceItems: BookingServiceItem[]
}

export type CalendarServiceItem = {
  id: string
  name: string | null
  durationMinutes: number
  price: string | null
  sortOrder: number
}

export type BookingEventDetails = {
  serviceName: string
  bufferMinutes: number
  serviceItems: CalendarServiceItem[]
}

type CalendarEventBase = {
  id: string
  startsAt: string
  endsAt: string
  title: string
  clientName: string
  durationMinutes?: number
  locationId: string | null
}

export type BookingCalendarEvent = CalendarEventBase & {
  kind: 'BOOKING'
  status: BookingCalendarStatus
  locationType: ServiceLocationType | null

  /**
   * Authoritative appointment-local timezone for this booking.
   */
  timeZone: IanaTimeZone

  timeZoneSource: TimeZoneTruthSource

  /**
   * Day key in the booking appointment timezone.
   */
  localDateKey: string

  /**
   * Day key in the selected calendar viewport timezone.
   */
  viewLocalDateKey?: string

  details: BookingEventDetails

  note?: never
  blockId?: never
}

export type BlockCalendarEvent = CalendarEventBase & {
  kind: 'BLOCK'
  blockId: string
  status: BlockCalendarStatus
  note: string | null

  /**
   * Block rows are viewport-scoped in the current calendar payload.
   */
  localDateKey?: string

  details?: never
  locationType?: never
  timeZone?: never
  timeZoneSource?: never
  viewLocalDateKey?: never
}

export type CalendarEvent = BookingCalendarEvent | BlockCalendarEvent

export type PendingResizeChange = {
  kind: 'resize'
  entityType: EntityType
  eventId: string
  apiId: string
  nextTotalDurationMinutes: number
  original: CalendarEvent
}

export type PendingMoveChange = {
  kind: 'move'
  entityType: EntityType
  eventId: string
  apiId: string
  nextStartIso: string
  original: CalendarEvent
}

export type PendingChange = PendingResizeChange | PendingMoveChange

export type ManagementKey =
  | 'todaysBookings'
  | 'pendingRequests'
  | 'waitlistToday'
  | 'blockedToday'

export type ManagementLists = Record<ManagementKey, CalendarEvent[]>

export type BlockRow = {
  id: string
  startsAt: string | Date
  endsAt: string | Date
  note?: string | null
  locationId?: string | null
}

export type CalendarResponseLocation = {
  id: string
  type: string
  timeZone: string | null
  timeZoneValid: boolean
}

export type CalendarRangeMeta = {
  from: string
  requestedTo: string
  effectiveTo: string
  clamped: boolean
  maxDays: number
}

export type CalendarResponse = {
  location: CalendarResponseLocation | null
  range: CalendarRangeMeta

  timeZone: string
  viewportTimeZone: string
  needsTimeZoneSetup: boolean

  events: CalendarEvent[]

  canSalon: boolean
  canMobile: boolean

  stats: CalendarStats
  blockedMinutesToday: number

  autoAcceptBookings: boolean
  management: ManagementLists
}