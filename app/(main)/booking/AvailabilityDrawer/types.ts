// app/(main)/booking/AvailabilityDrawer/types.ts
import type {
  BookingSource,
  ClientAddressKind,
  ProNameDisplay,
  ServiceLocationType,
} from '@prisma/client'

// hold.ts and AppointmentTypeToggle read this off the drawer's own types.
export type { ServiceLocationType }

export type EmptyObject = Record<string, never>

export type ApiOk<T extends object> = { ok: true } & T
export type ApiFail<T extends object = EmptyObject> = { ok: false; error: string } & T

/**
 * The sources a CLIENT-side booking flow can produce. Derived from the schema
 * enum minus `IMPORTED`, which only a competitor-calendar migration writes —
 * no drawer can create one, and the finalize route rejects it.
 *
 * Deliberately not named `BookingSource`: shadowing the enum's name with a
 * narrower type is how a reader ends up believing they have the full set.
 */
export type ClientBookingSource = Exclude<BookingSource, 'IMPORTED'>

export type DrawerContext = {
  professionalId: string

  /**
   * Legacy discovery/media linkage used by older flows.
   * Do not use this to carry the canonical look feed post id.
   */
  mediaId?: string | null

  /**
   * Canonical discovery identifier for Looks-based booking entry points.
   * Use this for feed/detail flows that open booking from a look post.
   */
  lookPostId?: string | null

  serviceId?: string | null
  offeringId?: string | null
  source?: ClientBookingSource

  /**
   * Optional YMD (pro-timezone) to anchor the initial availability window to.
   * Used by the aftercare rebook entry point so the drawer opens on the pro's
   * recommended rebook window instead of today. Null/omitted = open on today.
   */
  initialStartDate?: string | null

  /**
   * Set when the drawer is picking a new time for an EXISTING booking. The hold
   * it places is then sized from that booking's committed duration rather than
   * the offering's current base, because that is what the reschedule will take
   * (B3). Without it the reservation is routinely narrower than the commit —
   * the tail is takeable mid-checkout, and the last starts of the day are
   * offered then refused at the confirm.
   */
  rescheduleBookingId?: string | null

  /**
   * Set when the drawer is picking a time for a consult's BOOKING PROPOSAL
   * (Book the Look, B4b). The grid, the hold and the finalize are then all sized
   * by the WHOLE estimate — every line the client is committing to — instead of
   * by this offering's base duration. Without it a 3 AM booking reserves the
   * time the look's one linked service takes, which is a lie about the pro's day
   * (decision 11).
   *
   * The id is only a CLAIM on the wire: every route that honours it
   * re-authorizes the consult and re-derives the proposal under the session
   * lock before sizing anything from it.
   */
  consultId?: string | null

  /**
   * Pins the drawer to ONE mode, hiding the salon/mobile toggle.
   *
   * Book the Look, B4b: a consult's proposal is derived FOR a mode — its price,
   * its line durations and the width of the slot all change with it — and the
   * client chose that mode on the booking page before she got here. Letting the
   * sheet flip it would quietly show her times for a proposal she has not seen,
   * and the estimate framing decision 5 requires would be nowhere near it.
   */
  lockedLocationType?: ServiceLocationType | null

  // optional viewer location (for "other pros near you")
  viewerLat?: number | null
  viewerLng?: number | null
  viewerRadiusMiles?: number | null
  viewerPlaceId?: string | null
  viewerLocationLabel?: string | null
}

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
  firstName?: string | null
  lastName?: string | null
  handle?: string | null
  nameDisplay?: ProNameDisplay | null
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

export type AvailabilityCover = {
  imageUrl: string | null
  lookName: string | null
}

/**
 * Wire twin of `BookingTrustSignals` (lib/booking/trustSignals.ts). Every field
 * is nullable on purpose: a chip whose signal is unknown is not rendered, rather
 * than rendered as a zero.
 */
export type AvailabilityTrust = {
  verified: boolean
  completedBookings: number | null
  rating: { average: number; count: number } | null
  freeCancellationHours: number | null
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

/**
 * One bookable salon/suite option for the primary pro. Present so the
 * client can choose which location to visit when the pro has several.
 * Empty for mobile mode.
 */
export type AvailabilityLocationOption = {
  id: string
  type: string
  name: string | null
  city: string | null
  state: string | null
  /**
   * The exact street address — **null unless the pro published it**
   * (`ProfessionalLocation.isAddressPublic`). This endpoint is unauthenticated,
   * and a "salon" is often a home studio, so an address arrives here only when
   * the pro chose to publish one. Render `areaLabel` when this is null.
   */
  formattedAddress: string | null
  /**
   * The coarse place ("Brooklyn, NY"). Always sent when the location has a city
   * or state, published address or not — this is what lets the booking sheet
   * answer "where is this pro?" for every pro without exposing a home address.
   */
  areaLabel?: string | null
  isPrimary: boolean
}

/**
 * A MOBILE pro's reach: how far they travel, and from where.
 *
 * The sheet's answer to "where is this pro?" when there is no salon to name.
 * Both halves describe the rule the write boundary actually enforces at booking
 * time (`ProfessionalProfile.mobileRadiusMiles`, measured from the MOBILE_BASE
 * location), so it can't drift into a second, softer promise. Null when the pro
 * has published neither — an absent line beats "up to null miles around null".
 *
 * 🔴 Deliberately carries NO address. A mobile base is very often the pro's home.
 */
export type AvailabilityServiceArea = {
  radiusMiles: number | null
  areaLabel: string | null
}

export type AvailabilityBootstrapOk = ApiOk<
  AvailabilityFreshness & {
    mode: 'BOOTSTRAP'
    request: AvailabilityRequestBase

    mediaId: string | null
    serviceName: string | null
    serviceCategoryName: string | null

    /**
     * The look this booking started from — the sheet's cover photo and the
     * add-ons step's context thumbnail. Null when the flow was entered from a
     * pro's profile rather than from a look, which the sheet renders as its
     * cover-less header rather than an empty photo well.
     */
    cover: AvailabilityCover | null

    /** Reassurance chips under the service line. See lib/booking/trustSignals. */
    trust: AvailabilityTrust

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
    locationOptions: AvailabilityLocationOption[]
    /** MOBILE only; null in salon mode and for pros with no published reach. */
    serviceArea?: AvailabilityServiceArea | null
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