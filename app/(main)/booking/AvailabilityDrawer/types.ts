// app/(main)/booking/AvailabilityDrawer/types.ts

/**
 * Single source of truth for API envelopes (type-level).
 * Matches jsonOk/jsonFail:
 * - success: { ok: true, ... }
 * - failure: { ok: false, error: string, ... }
 */
export type ApiOk<T extends object> = { ok: true } & T
export type ApiFail<T extends object = {}> = { ok: false; error: string } & T

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
   * ✅ Optional but supported.
   * When provided, it helps the server resolve location + timezone reliably.
   */
  offeringId?: string | null

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

/**
 * Money serialized over JSON should be string (e.g. "25.00").
 * Keep as string to avoid Decimal leaks into client code.
 */
export type MoneyString = string

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
  salonPriceStartingAt: MoneyString | null
  mobilePriceStartingAt: MoneyString | null
}

/** ---------------------------
 * Availability: SUMMARY mode
 * -------------------------- */

export type AvailabilitySummaryOk = ApiOk<{
  mode: 'SUMMARY'
  mediaId: string | null
  serviceId: string
  professionalId: string

  // ✅ values returned by the API
  serviceName: string
  serviceCategoryName: string | null

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

  offering: AvailabilityOffering
}>

export type AvailabilitySummaryFail = ApiFail<{
  // Optional context that can help the client message correctly
  timeZone?: string
  locationId?: string
}>

export type AvailabilitySummaryResponse = AvailabilitySummaryOk | AvailabilitySummaryFail

/** ---------------------------
 * Availability: DAY mode
 * -------------------------- */

export type AvailabilityDayOk = ApiOk<{
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
}>

export type AvailabilityDayFail = ApiFail<{
  timeZone?: string
  locationId?: string
}>

export type AvailabilityDayResponse = AvailabilityDayOk | AvailabilityDayFail

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