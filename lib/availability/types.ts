// lib/availability/types.ts

import { ServiceLocationType } from '@prisma/client'

export type YMD = {
  year: number
  month: number
  day: number
}

export type AvailabilityTimeZoneSource =
  | 'BOOKING_SNAPSHOT'
  | 'HOLD_SNAPSHOT'
  | 'LOCATION'
  | 'PROFESSIONAL'
  | 'FALLBACK'

export type OtherProRow = {
  id: string
  businessName: string | null
  avatarUrl: string | null
  location: string | null
  offeringId: string
  timeZone: string
  locationId: string
  distanceMiles: number
}

export type DayComputationResult =
  | {
      ok: true
      slots: string[]
      dayStartUtc: Date
      dayEndExclusiveUtc: Date
      debug?: unknown
    }
  | {
      ok: false
      code: 'WORKING_HOURS_REQUIRED' | 'WORKING_HOURS_INVALID'
      dayStartUtc: Date
      dayEndExclusiveUtc: Date
      debug?: unknown
    }

export type AvailabilityPlacementErrorCode =
  | 'LOCATION_NOT_FOUND'
  | 'CLIENT_SERVICE_ADDRESS_REQUIRED'
  | 'SALON_LOCATION_ADDRESS_REQUIRED'
  | 'TIMEZONE_REQUIRED'
  | 'WORKING_HOURS_REQUIRED'
  | 'WORKING_HOURS_INVALID'
  | 'MODE_NOT_SUPPORTED'
  | 'DURATION_REQUIRED'
  | 'PRICE_REQUIRED'
  | 'COORDINATES_REQUIRED'
  | 'NO_SCHEDULING_READY_LOCATION'

export type CachedPlacement = {
  locationId: string
  locationType: ServiceLocationType
  timeZone: string
  timeZoneSource: AvailabilityTimeZoneSource
  workingHours: unknown
  stepMinutes: number
  leadTimeMinutes: number
  locationBufferMinutes: number
  maxAdvanceDays: number
  durationMinutes: number
  priceStartingAt: number
  formattedAddress: string | null
  lat: number | undefined
  lng: number | undefined
  proBusinessName: string | null
  proAvatarUrl: string | null
  proLocation: string | null
  serviceName: string | null
  serviceCategory: string | null
  offeringId: string
  offersInSalon: boolean
  offersMobile: boolean
  salonDurationMinutes: number | null
  mobileDurationMinutes: number | null
  salonPriceStartingAt: string | null
  mobilePriceStartingAt: string | null
  locationCity: string | null
}