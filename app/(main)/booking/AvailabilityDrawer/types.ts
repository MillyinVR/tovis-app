// app/(main)/booking/AvailabilityDrawer/types.ts

export type ApiOk<T extends object> = { ok: true } & T
export type ApiFail<T extends object = {}> = { ok: false; error: string } & T
export type BookingSource = 'REQUESTED' | 'DISCOVERY' | 'AFTERCARE'

export type DrawerContext = {
  professionalId: string
  mediaId?: string | null
  serviceId?: string | null
  offeringId?: string | null
  source?: BookingSource

  // ✅ optional viewer location (for "other pros near you")
  viewerLat?: number | null
  viewerLng?: number | null
  viewerRadiusMiles?: number | null
  viewerPlaceId?: string | null
  viewerLocationLabel?: string | null
}

export type ServiceLocationType = 'SALON' | 'MOBILE'

export type AvailabilityReason =
  | 'OK'
  | 'MISSING_SERVICE'
  | 'SERVICE_NOT_OFFERED'
  | 'NO_BOOKABLE_MODE'
export type MoneyString = string
export type ProCard = {
  id: string
  businessName: string | null
  avatarUrl: string | null
  location: string | null
  offeringId: string | null
  timeZone?: string | null
  isCreator?: boolean

  // ✅ bookable location used for availability math
  locationId?: string | null

  // optional, nice for future UI
  distanceMiles?: number | null

  slots?: string[]
}
export type AvailabilityOtherPro = ProCard & {
  offeringId: string
  locationId: string
  timeZone: string
  distanceMiles?: number | null
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
  otherPros: AvailabilityOtherPro[]
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