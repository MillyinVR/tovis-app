// app/(main)/booking/AvailabilityDrawer/types.ts

/**
 * Booking source attribution.
 * Must stay stable because it becomes analytics + business logic.
 *
 * NOTE: This intentionally matches Prisma enum BookingSource.
 */
export type BookingSource = 'REQUESTED' | 'DISCOVERY' | 'AFTERCARE'

/**
 * Context passed into AvailabilityDrawer.
 * IMPORTANT: Make your React state nullable (DrawerContext | null),
 * but do NOT embed null into the type itself.
 */
export type DrawerContext = {
  professionalId: string

  /**
   * If launched from a Look, this will exist.
   * If launched from pro profile/services list, this can be null/undefined.
   */
  mediaId?: string | null

  /**
   * Service to look up availability for.
   * Optional to keep compatibility with older callers.
   */
  serviceId?: string | null

  /**
   * Optional. If callers don't pass it, the drawer can default at runtime.
   * Must match Prisma BookingSource.
   */
  source?: BookingSource
}

export type ServiceLocationType = 'SALON' | 'MOBILE'

export type AvailabilityReason =
  | 'OK'
  | 'MISSING_SERVICE'
  | 'SERVICE_NOT_OFFERED'
  | 'NO_BOOKABLE_MODE'

export type ProCard = {
  id: string
  businessName: string | null
  avatarUrl: string | null
  location: string | null
  offeringId: string | null
  timeZone?: string | null
  isCreator?: boolean

  // slots are day-specific now, not global
  slots?: string[]
}

export type AvailabilityOffering = {
  id: string
  offersInSalon: boolean
  offersMobile: boolean
  salonDurationMinutes: number | null
  mobileDurationMinutes: number | null
  salonPriceStartingAt: unknown | null
  mobilePriceStartingAt: unknown | null
}

export type AvailabilitySummaryResponse = {
  ok: true
  mode: 'SUMMARY'
  mediaId: string | null
  serviceId: string
  professionalId: string

  locationType: ServiceLocationType
  locationId: string
  timeZone: string

  stepMinutes: number
  leadTimeMinutes: number
  adjacencyBufferMinutes: number
  maxDaysAhead: number
  durationMinutes: number

  primaryPro: ProCard & { offeringId: string; isCreator: true; timeZone: string }
  availableDays: Array<{ date: string; slotCount: number }>
  otherPros: Array<ProCard & { offeringId: string }>
  waitlistSupported: boolean

  // ✅ server adds this (safe extra field)
  offering: AvailabilityOffering
}

export type AvailabilityDayResponse =
  | {
      ok: true
      mode: 'DAY'
      professionalId: string
      serviceId: string
      locationType: ServiceLocationType
      date: string

      locationId: string
      timeZone: string
      stepMinutes: number
      leadTimeMinutes: number
      adjacencyBufferMinutes: number
      maxDaysAhead: number

      durationMinutes: number
      dayStartUtc: string
      dayEndExclusiveUtc: string
      slots: string[]

      // ✅ server adds this (safe extra field)
      offering?: AvailabilityOffering
    }
  | { ok: false; error: string; timeZone?: string; locationId?: string }

export type HoldParsed = {
  holdId: string
  holdUntilMs: number
  scheduledForISO: string
  locationType?: ServiceLocationType | null
}

/**
 * Keep this shape for compatibility with the existing drawer logic.
 * Even if you stop “using” proTimeZone, other parts still expect it.
 */
export type SelectedHold = {
  proId: string
  offeringId: string
  slotISO: string // UTC ISO
  proTimeZone: string
  holdId: string
}
