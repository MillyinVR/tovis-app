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

  // optional viewer location (for "other pros near you")
  viewerLat?: number | null
  viewerLng?: number | null
  viewerRadiusMiles?: number | null
  viewerPlaceId?: string | null
  viewerLocationLabel?: string | null
}

export type ServiceLocationType = 'SALON' | 'MOBILE'

export type ClientAddressKind = 'SEARCH_AREA' | 'SERVICE_ADDRESS'

export type MobileAddressOption = {
  id: string
  label: string
  formattedAddress: string
  isDefault: boolean
}

export type ClientAddressRecord = {
  id: string
  kind: ClientAddressKind
  label: string | null
  formattedAddress: string | null
  addressLine1?: string | null
  addressLine2?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
  countryCode?: string | null
  placeId?: string | null
  lat?: number | null
  lng?: number | null
  isDefault: boolean
}

export type ClientAddressesResponse = ApiOk<{
  addresses: ClientAddressRecord[]
}>

export type ClientAddressUpsertResponse = ApiOk<{
  address: ClientAddressRecord
}>

export type ClientAddressFormDraft = {
  label: string
  addressLine1: string
  addressLine2: string
  city: string
  state: string
  postalCode: string
  countryCode: string
  formattedAddress: string
  placeId: string
  lat: number | null
  lng: number | null
  isDefault: boolean
}

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

  // bookable location used for availability math
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

  serviceName: string
  serviceCategoryName: string | null

  locationType: ServiceLocationType
  locationId: string
  timeZone: string

  stepMinutes: number
  leadTimeMinutes: number
  locationBufferMinutes: number
  adjacencyBufferMinutes: number
  maxDaysAhead: number
  durationMinutes: number

  primaryPro: ProCard & {
    offeringId: string
    isCreator: true
    timeZone: string
  }

  availableDays: Array<{ date: string; slotCount: number }>
  otherPros: AvailabilityOtherPro[]
  waitlistSupported: boolean

  offering: AvailabilityOffering
}>

export type AvailabilitySummaryFail = ApiFail<{
  timeZone?: string
  locationId?: string
}>

export type AvailabilitySummaryResponse =
  | AvailabilitySummaryOk
  | AvailabilitySummaryFail

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
  locationBufferMinutes: number
  adjacencyBufferMinutes: number
  maxDaysAhead: number

  durationMinutes: number
  dayStartUtc: string
  dayEndExclusiveUtc: string
  slots: string[]

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
  locationType: ServiceLocationType | null
}

export type SelectedHold = {
  proId: string
  offeringId: string
  slotISO: string
  proTimeZone: string
  holdId: string
}