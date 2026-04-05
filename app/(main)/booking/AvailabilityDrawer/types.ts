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

/** ---------------------------
 * Shared availability contract
 * -------------------------- */

export type AvailabilityFreshness = {
  /**
   * Client-visible freshness token for the exact request context.
   * Exact slots are reusable only when this matches.
   */
  availabilityVersion: string

  /**
   * ISO timestamp for when the payload was generated.
   */
  generatedAt: string
}

export type AvailabilityRequestBase = {
  professionalId: string
  serviceId: string
  offeringId: string | null
  locationType: ServiceLocationType
  locationId: string
  clientAddressId: string | null
  addOnIds: string[]
  durationMinutes: number
}

export type AvailabilityDayRequest = AvailabilityRequestBase & {
  date: string
}

export type AvailabilityDaySummary = {
  date: string
  slotCount: number
}

export type AvailabilitySelectedDay = {
  date: string
  slots: string[]
}

export type ProCard = {
  id: string
  businessName: string | null
  avatarUrl: string | null
  location: string | null

  /**
   * Optional on the generic UI card because primary vs alternate cards
   * have slightly different guarantees. Use the specialized types below
   * when availability context must guarantee bookability.
   */
  offeringId?: string | null

  timeZone?: string | null
  isCreator?: boolean

  // bookable location used for availability math
  locationId?: string | null

  // optional, nice for UI
  distanceMiles?: number | null

  /**
   * UI convenience only. Do not treat these as globally authoritative
   * without request/version validation.
   */
  slots?: string[]
}

export type AvailabilityPrimaryPro = ProCard & {
  offeringId: string
  isCreator: true
  timeZone: string
  locationId: string
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

export type AvailabilitySummaryDebug = {
  emptyReason?: string | null
  otherProsCount?: number
  includeOtherPros?: boolean
  center?: {
    lat: number
    lng: number
    radiusMiles: number
  } | null
  usedViewerCenter?: boolean
  addOnIds?: string[]
  clientAddressId?: string | null
  requestedSummaryDays?: number
}

/** ---------------------------
 * Availability: BOOTSTRAP mode
 * -------------------------- */

export type AvailabilityBootstrapOk = ApiOk<
  AvailabilityFreshness & {
    mode: 'BOOTSTRAP'
    request: AvailabilityRequestBase

    mediaId: string | null
    serviceName: string | null
    serviceCategoryName: string | null

    /**
     * Transitional duplicate fields.
     * Prefer `request.*` in all new code.
     */
    professionalId: string
    serviceId: string
    locationType: ServiceLocationType
    locationId: string
    durationMinutes: number

    timeZone: string
    stepMinutes: number
    leadTimeMinutes: number
    locationBufferMinutes: number
    adjacencyBufferMinutes: number
    maxDaysAhead: number

    windowStartDate: string
    windowEndDate: string
    nextStartDate: string | null
    hasMoreDays: boolean

    primaryPro: AvailabilityPrimaryPro
    availableDays: AvailabilityDaySummary[]

    /**
     * Canonical enterprise field.
     * Authoritative for first paint because it belongs to the current
     * bootstrap response.
     */
    selectedDay: AvailabilitySelectedDay | null

    otherPros: AvailabilityOtherPro[]
    waitlistSupported: boolean
    offering: AvailabilityOffering

    debug?: AvailabilitySummaryDebug
  }
>

export type AvailabilityBootstrapFail = ApiFail<{
  timeZone?: string
  locationId?: string
}>

export type AvailabilityBootstrapResponse =
  | AvailabilityBootstrapOk
  | AvailabilityBootstrapFail

/**
 * Transitional aliases for older imports only.
 * These now point at the permanent bootstrap contract.
 */
export type AvailabilitySummaryOk = AvailabilityBootstrapOk
export type AvailabilitySummaryFail = AvailabilityBootstrapFail
export type AvailabilitySummaryResponse = AvailabilityBootstrapResponse

/** ---------------------------
 * Availability: DAY mode
 * -------------------------- */

export type AvailabilityDayOk = ApiOk<
  AvailabilityFreshness & {
    mode: 'DAY'
    request: AvailabilityDayRequest

    /**
     * Transitional duplicate fields.
     * Prefer `request.*` in all new code.
     */
    professionalId: string
    serviceId: string
    locationType: ServiceLocationType
    locationId: string
    date: string
    durationMinutes: number

    timeZone: string
    stepMinutes: number
    leadTimeMinutes: number
    locationBufferMinutes: number
    adjacencyBufferMinutes: number
    maxDaysAhead: number

    dayStartUtc: string
    dayEndExclusiveUtc: string
    slots: string[]

    offering?: AvailabilityOffering
    debug?: unknown
  }
>

export type AvailabilityDayFail = ApiFail<{
  timeZone?: string
  locationId?: string
}>

export type AvailabilityDayResponse = AvailabilityDayOk | AvailabilityDayFail

/** ---------------------------
 * Availability: ALTERNATES mode
 * -------------------------- */

export type AvailabilityAlternateSlots = {
  pro: AvailabilityOtherPro
  slots: string[]
}

export type AvailabilityAlternatesRequest = Omit<
  AvailabilityDayRequest,
  'professionalId'
>

export type AvailabilityAlternatesOk = ApiOk<
  AvailabilityFreshness & {
    mode: 'ALTERNATES'
    request: AvailabilityAlternatesRequest
    selectedDay: string
    alternates: AvailabilityAlternateSlots[]
    debug?: unknown
  }
>

export type AvailabilityAlternatesFail = ApiFail<{
  timeZone?: string
  locationId?: string
}>

export type AvailabilityAlternatesResponse =
  | AvailabilityAlternatesOk
  | AvailabilityAlternatesFail

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
