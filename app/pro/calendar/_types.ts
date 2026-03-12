// app/pro/calendar/_types.ts
import type { IanaTimeZone } from '@/lib/timeZone'

export type ViewMode = 'day' | 'week' | 'month'
export type EntityType = 'booking' | 'block'

export type WeekdayKey =
  | 'sun'
  | 'mon'
  | 'tue'
  | 'wed'
  | 'thu'
  | 'fri'
  | 'sat'

export type ServiceLocationType =
  | 'SALON'
  | 'MOBILE'
  | (string & {})

export type BookingCalendarStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'WAITLIST'
  | 'UNKNOWN'
  | (string & {})

export type CalendarStatus = BookingCalendarStatus | 'BLOCKED'

export type WorkingHoursDay = {
  enabled: boolean
  start: string // "HH:MM" (24h)
  end: string // "HH:MM" (24h)
}

export type WorkingHoursJson = Record<WeekdayKey, WorkingHoursDay> | null

export type CalendarStats =
  | {
      todaysBookings: number
      availableHours: number | null
      pendingRequests: number
      blockedHours: number | null
    }
  | null

/**
 * Service selector option used by calendar booking create/edit UI.
 *
 * Current API shape from /api/pro/services is:
 * - id = service id
 * - offeringId = optional active offering id
 * - durationMinutes = display/helper duration
 */
export type ServiceOption = {
  id: string
  name: string
  durationMinutes?: number | null
  offeringId?: string
  priceStartingAt?: string | null
}

/**
 * Booking service item returned by GET /api/pro/bookings/[id].
 * This is the source of truth for editable booking services.
 */
export type BookingServiceItem = {
  id: string
  serviceId: string
  offeringId: string | null
  itemType: 'BASE' | 'ADD_ON' | (string & {})
  serviceName: string
  priceSnapshot: string
  durationMinutesSnapshot: number
  sortOrder: number
}

/**
 * Booking details used by the edit modal.
 *
 * Notes:
 * - serviceItems is the actual editable unit
 * - totalDurationMinutes is still the persisted booking duration
 * - location snapshot fields are optional so the UI can progressively
 *   support mobile-address rendering without breaking older payloads
 */
export type BookingDetails = {
  id: string
  status: string
  scheduledFor: string // ISO string for a UTC instant
  endsAt: string // ISO string for a UTC instant

  locationId?: string | null
  locationType?: ServiceLocationType

  locationAddressSnapshot?: string | null
  locationLatSnapshot?: number | null
  locationLngSnapshot?: number | null

  totalDurationMinutes: number
  durationMinutes?: number
  bufferMinutes?: number
  subtotalSnapshot?: string

  client: {
    fullName: string
    email: string | null
    phone: string | null
  }

  timeZone: IanaTimeZone
  serviceItems: BookingServiceItem[]
}

export type CalendarServiceItem = {
  id: string
  name: string | null
  durationMinutes: number
  price: unknown | null
  sortOrder: number
}

export type BookingEventDetails = {
  serviceName: string
  bufferMinutes: number
  serviceItems: CalendarServiceItem[]
}

export type BookingCalendarEvent = {
  kind: 'BOOKING'
  id: string
  startsAt: string
  endsAt: string
  title: string
  clientName: string
  status: BookingCalendarStatus
  locationId: string | null
  locationType: ServiceLocationType
  durationMinutes?: number
  details: BookingEventDetails
  note?: never
  blockId?: never
}

export type BlockCalendarEvent = {
  kind: 'BLOCK'
  id: string
  blockId: string
  startsAt: string
  endsAt: string
  title: string
  clientName: string
  status: 'BLOCKED'
  durationMinutes?: number
  note: string | null
  locationId: string | null
}

export type CalendarEvent = BookingCalendarEvent | BlockCalendarEvent

export type PendingChange =
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
      nextStartIso: string // ISO string for a UTC instant
      original: CalendarEvent
    }

export type ManagementKey =
  | 'todaysBookings'
  | 'pendingRequests'
  | 'waitlistToday'
  | 'blockedToday'

export type ManagementLists = {
  todaysBookings: CalendarEvent[]
  pendingRequests: CalendarEvent[]
  waitlistToday: CalendarEvent[]
  blockedToday: CalendarEvent[]
}

export type BlockRow = {
  id: string
  startsAt: string | Date
  endsAt: string | Date
  note?: string | null
}