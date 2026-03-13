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

export type TimeZoneTruthSource =
  | 'BOOKING_SNAPSHOT'
  | 'HOLD_SNAPSHOT'
  | 'LOCATION'
  | 'PROFESSIONAL'
  | 'FALLBACK'

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
  start: string
  end: string
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
  priceStartingAt?: string | null
}

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

export type BookingDetails = {
  id: string
  status: string
  scheduledFor: string
  endsAt: string

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
  timeZoneSource?: TimeZoneTruthSource
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

  timeZone: IanaTimeZone | string
  timeZoneSource: TimeZoneTruthSource
  localDateKey: string

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
      nextStartIso: string
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

export type CalendarResponse = {
  location: {
    id: string
    type: string
    timeZone: string | null
    timeZoneValid: boolean
  }
  timeZone: string
  viewportTimeZone: string
  needsTimeZoneSetup: boolean
  events: CalendarEvent[]
  canSalon: boolean
  canMobile: boolean
  stats: CalendarStats
  autoAcceptBookings: boolean
  management: ManagementLists
}