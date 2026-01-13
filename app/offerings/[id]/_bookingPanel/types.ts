// app/offerings/[id]/_bookingPanel/types.ts

export type BookingSource = string
export type ServiceLocationType = 'SALON' | 'MOBILE'

export type WaitlistPayload = {
  professionalId: string
  serviceId: string
  mediaId: string | null
  desiredFor: string | null
  flexibilityMinutes: number
  notes?: string | null
  preferredTimeBucket?: string | null
}

export type BookingPanelProps = {
  offeringId: string
  professionalId: string
  serviceId: string

  mediaId?: string | null

  offersInSalon: boolean
  offersMobile: boolean

  salonPriceStartingAt?: number | null
  salonDurationMinutes?: number | null
  mobilePriceStartingAt?: number | null
  mobileDurationMinutes?: number | null

  defaultLocationType?: ServiceLocationType | null

  isLoggedInAsClient: boolean
  defaultScheduledForISO?: string | null

  serviceName?: string | null
  professionalName?: string | null
  locationLabel?: string | null

  professionalTimeZone?: string | null
  source: BookingSource

  /**
   * default true: BookingPanel routes user to /client after success
   * set false for “book in-place” flows (Looks drawer / aftercare overlay)
   */
  redirectOnSuccess?: boolean
}
