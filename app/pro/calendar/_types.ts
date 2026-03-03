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
  | (string & {}) // allow unknown statuses without turning everything into `string`

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

// ✅ Fix 1: this is what BookingModal + useCalendarData are trying to import
export type ServiceOption = {
  id: string
  name: string
  durationMinutes?: number | null
  offeringId?: string
}

export type BookingDetails = {
  id: string
  status: string
  scheduledFor: string // ISO string for a UTC instant
  endsAt: string       // ISO string for a UTC instant
  totalDurationMinutes: number
  bufferMinutes?: number
  serviceId: string | null
  serviceName: string
  client: {
    fullName: string
    email: string | null
    phone: string | null
  }
  timeZone: IanaTimeZone
}

/**
 * ✅ Fix 2: discriminated union for events.
 * - Only BLOCK events have blockId + note
 * - BOOKING events never pretend to have blockId
 */
export type BookingCalendarEvent = {
  kind: 'BOOKING'
  id: string
  startsAt: string // ISO string for a UTC instant
  endsAt: string   // ISO string for a UTC instant
  title: string
  clientName: string
  status: CalendarStatus
  durationMinutes?: number
  // bookings should not carry block-only fields
  note?: never
  blockId?: never
}

export type BlockCalendarEvent = {
  kind: 'BLOCK'
  id: string // UI id (often "block:xyz")
  blockId: string // real DB id used by API routes
  startsAt: string
  endsAt: string
  title: string
  clientName: string
  status: 'BLOCKED' | CalendarStatus
  durationMinutes?: number
  note?: string | null
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

export type ManagementKey = 'todaysBookings' | 'pendingRequests' | 'waitlistToday' | 'blockedToday'

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