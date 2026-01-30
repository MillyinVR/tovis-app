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
  | string

export type CalendarEvent = {
  id: string
  startsAt: string // ISO string for a UTC instant
  endsAt: string   // ISO string for a UTC instant
  title: string
  clientName: string
  status: CalendarStatus
  durationMinutes?: number
  note?: string | null
  blockId?: string
  kind?: string
}

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

export type EntityType = 'booking' | 'block'

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
