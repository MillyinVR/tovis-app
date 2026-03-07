// app/pro/calendar/_types.ts
import type { IanaTimeZone } from '@/lib/timeZone'

export type ViewMode = 'day' | 'week' | 'month'

export type CalendarStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'WAITLIST'
  | 'BLOCKED'
  | (string & {})

export type EntityType = 'booking' | 'block'

export type WeekdayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'

export type WorkingHoursDay = {
  enabled: boolean
  start: string // "HH:MM" (24h)
  end: string   // "HH:MM" (24h)
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
 *
 * Keep this flexible for now, because the hook is still loading the existing
 * /api/pro/services payload and we will tighten it further when we wire the
 * edit modal to offering-driven service items.
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
 * This is now the real source of truth for editable booking services.
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
 * Booking details for the edit modal.
 *
 * Important:
 * - Do not pretend a booking is single-service anymore.
 * - serviceItems drives display + future edit payload construction.
 * - totalDurationMinutes remains the persisted booking duration.
 */
export type BookingDetails = {
  id: string
  status: string
  scheduledFor: string // ISO string for a UTC instant
  endsAt: string       // ISO string for a UTC instant
  locationType?: 'SALON' | 'MOBILE' | (string & {})
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

export type BookingCalendarEvent = {
  kind: 'BOOKING'
  id: string
  startsAt: string
  endsAt: string
  title: string
  clientName: string
  status: CalendarStatus
  locationId: string
  locationType?: 'SALON' | 'MOBILE' | (string & {})
  durationMinutes?: number
  details?: {
    serviceName: string
    bufferMinutes: number
    serviceItems: {
      id: string
      name: string | null
      durationMinutes: number
      price: unknown | null
      sortOrder: number
    }[]
  }
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
  status: 'BLOCKED' | CalendarStatus
  durationMinutes?: number
  note?: string | null
  locationId?: string | null
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
