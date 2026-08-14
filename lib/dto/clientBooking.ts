// lib/dto/clientBooking.ts
import {
  Prisma,
  AftercareRebookMode,
  StripePaymentStatus,
  type BookingServiceItemType,
  type BookingDepositStatus,
  type BookingStatus,
  type ProNameDisplay,
} from '@prisma/client'
import { moneyToString } from '@/lib/money'
import {
  deriveClientConfirmationBadge,
  type ClientConfirmationBadge,
  type ClientConfirmationBookingRow,
} from '@/lib/booking/clientConfirmation'
import { clientConfirmationLoopEnabled } from '@/lib/booking/clientConfirmationLoop'
import { resolveBookingLocationMeta } from '@/lib/booking/locationMeta'
import { formatBookingServicesLabel } from '@/lib/booking/serviceLabel'
import {
  resolveApptTimeZone,
  type TimeZoneTruthSource,
} from '@/lib/booking/timeZoneTruth'
import { DEFAULT_TIME_ZONE, sanitizeTimeZone } from '@/lib/timeZone'
import { isRecord } from '@/lib/guards'
import {
  parseCancellationPolicySnapshot,
  formatCancellationPolicy,
} from '@/lib/noShowProtection/policyDisclosure'

export type ClientBookingItemDTO = {
  id: string
  type: BookingServiceItemType
  serviceId: string
  name: string
  price: string
  durationMinutes: number
  parentItemId: string | null
  sortOrder: number
}

export type ClientBookingProductSaleDTO = {
  id: string
  productId: string | null
  name: string
  unitPrice: string
  quantity: number
  lineTotal: string
}

export type ClientBookingConsultationDTO = {
  consultationNotes: string | null
  consultationPrice: string | null
  consultationConfirmedAt: string | null

  approvalStatus: string | null
  approvalNotes: string | null
  proposedTotal: string | null
  proposedServicesJson: Prisma.JsonValue | null
  approvedAt: string | null
  rejectedAt: string | null
}

export type ClientBookingTimeZoneSource =
  | 'BOOKING'
  | 'HOLD'
  | 'LOCATION'
  | 'PRO'
  | 'FALLBACK'

export type ClientBookingCheckoutDTO = {
  subtotalSnapshot: string | null
  serviceSubtotalSnapshot: string | null
  productSubtotalSnapshot: string | null
  tipAmount: string | null
  taxAmount: string | null
  discountAmount: string | null
  totalAmount: string | null
  checkoutStatus: string | null
  selectedPaymentMethod: string | null
  paymentAuthorizedAt: string | null
  paymentCollectedAt: string | null
  /**
   * Discovery deposit lifecycle (BookingDepositStatus):
   * NONE · PENDING · PAID · REFUNDED · FAILED. A deposit is OWED-and-unpaid
   * exactly when this is "PENDING" — that's the gate for a "Pay deposit" CTA.
   * Populated only where the source query selects the deposit columns (the
   * client bookings list route); null elsewhere.
   */
  depositStatus: string | null
  /**
   * Decimal deposit amount string (e.g. "25.00"), formatted client-side like the
   * other checkout amounts. Null when no deposit applies.
   */
  depositAmount: string | null
  /**
   * Final-bill refund/dispute truth, so a card can't keep showing a plain "paid"
   * after the money moved back or the charge was disputed (M11 display-truth).
   * Computed server-side. `paymentCollectedAt`/`checkoutStatus` are monotonic and
   * never reverse on a refund/dispute — these do. Populated only where the source
   * query selects the stripe/dispute columns (the client bookings list route + the
   * booking-detail loader); default (false / 0) elsewhere.
   */
  paymentDisputed: boolean
  /** Cumulative cents refunded against the final-bill charge (0 when none). */
  paymentRefundedCents: number
  /** The whole captured final bill has been refunded — money is back with the client. */
  paymentFullyRefunded: boolean
  /** The discovery deposit charge is under (or lost) a Stripe dispute. */
  depositDisputed: boolean
}

export type ClientBookingPaymentMethodDTO = {
  key: string
  label: string
  /** Off-platform handle (Venmo @, Zelle/Apple Cash contact, PayPal); null for
   * on-platform / handle-free methods. Gated to the client's own booking. */
  handle: string | null
}

// The pro's accepted methods (with handles) + tip config + payment note for a
// committed booking — the data the native client checkout needs to render the
// tip selector, method picker, and off-platform pay affordance. Mirrors what the
// web booking page loads server-side via loadProfessionalPaymentSettings. Built
// by lib/payments/clientPaymentOptions.buildClientPaymentOptions.
export type ClientBookingPaymentOptionsDTO = {
  methods: ClientBookingPaymentMethodDTO[]
  tipsEnabled: boolean
  allowCustomTip: boolean
  /** Whole-percent tip presets on the services subtotal; the client prepends 0%. */
  tipSuggestions: number[]
  paymentNote: string | null
  /** "AT_BOOKING" | "AFTER_SERVICE" (or null when the pro has no settings row). */
  collectPaymentAt: string | null
}

export type ClientBookingDTO = {
  id: string
  status: string | null
  source: string | null
  /**
   * When this booking is a rebook, the id of the appointment it was booked off
   * of (the `RebookChain` source). For an aftercare-sourced PENDING rebook whose
   * source payment is AWAITING_CONFIRMATION, this links the two so the native
   * next-booking detail can label it "pending — your pro will confirm after
   * payment". Null for a standalone booking. Populated only where the source
   * query selects `rebookOfBookingId` (the client bookings list route).
   */
  rebookOfBookingId: string | null
  sessionStep: string | null

  scheduledFor: string
  totalDurationMinutes: number
  bufferMinutes: number

  subtotalSnapshot: string | null

  checkout: ClientBookingCheckoutDTO

  locationType: string | null
  locationId: string | null

  timeZone: string | null
  timeZoneSource?: ClientBookingTimeZoneSource

  /**
   * Human label for the place — an address, a salon name, or a city. Display
   * only; do NOT hand it to a maps app.
   */
  locationLabel: string | null
  /**
   * The appointment's actual street address (pro's location for SALON, the
   * client's for MOBILE), or null when the booking carries no address. This is
   * what every client turns into a maps link.
   */
  locationAddress: string | null
  /** Coordinates for that address, when the snapshot captured them. */
  locationLat: number | null
  locationLng: number | null

  professional: {
    id: string
    businessName: string | null
    firstName: string | null
    lastName: string | null
    handle: string | null
    nameDisplay: ProNameDisplay | null
    location: string | null
    timeZone: string | null
  } | null

  bookedLocation: {
    id: string
    name: string | null
    formattedAddress: string | null
    city: string | null
    state: string | null
    timeZone: string | null
  } | null

  display: {
    title: string
    baseName: string
    addOnNames: string[]
    addOnCount: number
  }

  items: ClientBookingItemDTO[]
  productSales: ClientBookingProductSaleDTO[]

  /**
   * K11's client-confirmation state, derived by the one helper
   * (lib/booking/clientConfirmation.ts) and rendered VERBATIM — the client app
   * never recomputes it. OPTIONAL and absent unless the pro's reminder actually
   * asked: with the loop flag off (prod today) every booking reads
   * NOT_REQUESTED, so this key never appears and the payload is byte-identical
   * to pre-K13. Its presence is the app's cue to offer the in-app answer
   * (POST /api/v1/client/bookings/[id]/confirmation { answer }) — which is why
   * it is suppressed outright while ENABLE_CLIENT_CONFIRMATION_LOOP is off,
   * even for a row that carries stamps from an earlier trial: that route
   * refuses, and a control the server will reject must not be drawn.
   */
  clientConfirmation?: ClientConfirmationBadge

  hasUnreadAftercare: boolean
  hasPendingConsultationApproval: boolean
  /**
   * True when the pro proposed a next appointment (aftercare
   * BOOKED_NEXT_APPOINTMENT) the client hasn't confirmed or declined yet —
   * drives the rebook-confirm CTA. Confirm/decline via
   * POST /api/v1/client/bookings/[id]/aftercare-rebook { action }.
   * Populated only where the source query selects the aftercare/rebook columns
   * (the client bookings list route and the /me page loader); false elsewhere.
   */
  hasPendingRebookConfirmation: boolean
  /** The pro-proposed next-appointment instant (ISO) when one is pending; else null. */
  rebookProposedFor: string | null

  /**
   * True when the client has granted the pro media-use consent for this session
   * (allow featuring their photos/video publicly — portfolio/Looks). Toggle via
   * POST /api/v1/client/bookings/[id]/media-consent { granted }. Populated only
   * where the source query selects `mediaUseConsentAt` (the client bookings list
   * route); false elsewhere.
   */
  mediaUseConsent: boolean

  /**
   * The no-show / late-cancel fee policy the client AGREED to at booking (M15),
   * formatted for display, or null if none applied. Sourced from the booking's
   * own `cancellationPolicySnapshot` (what they agreed to — never the pro's
   * possibly-since-edited live settings), so the detail always shows the honest,
   * agreed terms. Populated only where the source query selects the snapshot.
   */
  cancellationPolicy: string | null

  consultation: ClientBookingConsultationDTO | null

  /**
   * The pro's accepted payment methods (with off-platform handles) + tip config
   * + payment note for this booking's checkout. Populated only where the caller
   * loads the pro's payment settings (the client bookings list route, for the
   * native checkout); null elsewhere. Handles are gated to the client's own
   * booking — never exposed on public surfaces.
   */
  paymentOptions: ClientBookingPaymentOptionsDTO | null
}

function mapTimeZoneTruthSourceToClientDtoSource(
  source: TimeZoneTruthSource,
): ClientBookingTimeZoneSource {
  switch (source) {
    case 'BOOKING_SNAPSHOT':
      return 'BOOKING'
    case 'HOLD_SNAPSHOT':
      return 'HOLD'
    case 'LOCATION':
      return 'LOCATION'
    case 'PROFESSIONAL':
      return 'PRO'
    case 'FALLBACK':
      return 'FALLBACK'
  }
}

function pickFormattedAddress(snapshot: unknown): string | null {
  if (!isRecord(snapshot)) return null
  const v = snapshot.formattedAddress
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function decimalToString(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === "string") return v
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  // Prisma.Decimal money columns route through the money SSOT. For a Decimal,
  // moneyToString === String(value.toString()) (Decimal.toString() never emits
  // trailing zeros), so output is unchanged.
  if (v instanceof Prisma.Decimal) return moneyToString(v)
  if (
    typeof v === 'object' &&
    typeof (v as { toString?: unknown }).toString === 'function'
  ) {
    return String((v as { toString: () => string }).toString())
  }
  return null
}

function decimalStringOrZero(v: unknown): string {
  return decimalToString(v) ?? '0.00'
}

function multiplyMoneyString(unitPrice: unknown, quantity: unknown): string {
  const unit = new Prisma.Decimal(decimalStringOrZero(unitPrice))
  const qty =
    typeof quantity === 'number' && Number.isFinite(quantity)
      ? Math.max(0, Math.trunc(quantity))
      : 0

  return unit.mul(qty).toString()
}

function buildLocationLabel(args: {
  /**
   * The snapshot of the place the appointment actually happens — the pro's
   * location for SALON, the CLIENT's address for MOBILE. Resolved by
   * `resolveBookingLocationMeta`, not read off the booking directly: reading
   * `locationAddressSnapshot` unconditionally is how this label used to print
   * the pro's salon on a booking the pro travels to.
   */
  bookedAddress: string | null
  location: {
    formattedAddress: string | null
    name: string | null
    city: string | null
    state: string | null
  } | null
  proLocation: string | null
  isMobile: boolean
}): string | null {
  if (args.bookedAddress) return args.bookedAddress

  // Every fallback below describes the PRO's premises. On a MOBILE booking that
  // is the one address the appointment definitely is not at, so a mobile
  // booking with no client-address snapshot honestly has no location to show.
  if (args.isMobile) return null

  const formatted = args.location?.formattedAddress?.trim()
  if (formatted) return formatted

  const name = args.location?.name?.trim()
  if (name) return name

  const cityState = [args.location?.city, args.location?.state]
    .filter(Boolean)
    .join(', ')
    .trim()
  if (cityState) return cityState

  const proLoc = args.proLocation?.trim()
  if (proLoc) return proLoc

  return null
}

/**
 * This is the booking shape you SELECT in /api/v1/client/bookings.
 * Keep this in sync with bookingSelect in that route.
 */
export type ClientBookingRow = Prisma.BookingGetPayload<{
  select: {
    id: true
    status: true
    source: true
    rebookOfBookingId: true
    sessionStep: true
    scheduledFor: true
    finishedAt: true

    subtotalSnapshot: true
    serviceSubtotalSnapshot: true
    productSubtotalSnapshot: true
    tipAmount: true
    taxAmount: true
    discountAmount: true
    totalAmount: true
    checkoutStatus: true
    selectedPaymentMethod: true
    paymentAuthorizedAt: true
    paymentCollectedAt: true

    totalDurationMinutes: true
    bufferMinutes: true

    locationType: true
    locationId: true
    locationTimeZone: true
    locationAddressSnapshot: true
    locationLatSnapshot: true
    locationLngSnapshot: true
    // MOBILE happens at the CLIENT's address, so the pro-location snapshot above
    // is the wrong place for it — see `resolveBookedPlace` below.
    clientAddressSnapshot: true
    clientAddressLatSnapshot: true
    clientAddressLngSnapshot: true

    service: { select: { id: true; name: true } }

    professional: {
      select: {
        id: true
        businessName: true
        firstName: true
        lastName: true
        handle: true
        nameDisplay: true
        location: true
        timeZone: true
      }
    }

    location: {
      select: {
        id: true
        name: true
        formattedAddress: true
        city: true
        state: true
        timeZone: true
      }
    }

    consultationNotes: true
    consultationPrice: true
    consultationConfirmedAt: true
    consultationApproval: {
      select: {
        status: true
        proposedServicesJson: true
        proposedTotal: true
        notes: true
        approvedAt: true
        rejectedAt: true
      }
    }

    serviceItems: {
      select: {
        id: true
        itemType: true
        parentItemId: true
        sortOrder: true
        durationMinutesSnapshot: true
        priceSnapshot: true
        serviceId: true
        service: { select: { name: true } }
      }
      orderBy: [{ sortOrder: 'asc' }]
    }

    productSales: {
      select: {
        id: true
        productId: true
        quantity: true
        unitPrice: true
        product: { select: { name: true } }
      }
      orderBy: [{ createdAt: 'asc' }]
    }
  }
}>

// Deposit columns live on the Booking row but aren't part of the canonical
// ClientBookingRow select, so callers that don't surface a deposit (most do not)
// keep compiling unchanged. The list route additionally selects these, and they
// flow through to the DTO when present.
type ClientBookingDepositFields = {
  depositStatus?: BookingDepositStatus | null
  depositAmount?: Prisma.Decimal | null
}

// Rebook state lives on the related AftercareSummary + the rebook chain, neither
// part of the canonical ClientBookingRow select. Optional here so callers that
// don't surface a rebook (most) keep compiling unchanged; the list route selects
// them so the native confirm CTA can light up.
type ClientBookingRebookFields = {
  aftercareSummary?: {
    rebookMode: AftercareRebookMode
    rebookedFor: Date | null
    rebookDeclinedAt: Date | null
  } | null
  rebooks?: { id: string; status: BookingStatus }[]
}

// Media-use consent lives on the Booking row but isn't part of the canonical
// ClientBookingRow select. Optional so existing callers compile unchanged; the
// list route selects it so the client can see/toggle the consent state.
type ClientBookingMediaConsentFields = {
  mediaUseConsentAt?: Date | null
}

// K11's three client-confirmation timestamps live on the Booking row but aren't
// part of the canonical ClientBookingRow select. Optional so existing callers
// compile unchanged; the list route + the booking-detail loader select them so
// the client can see the ask their pro sent and answer it in the app (K13).
type ClientBookingConfirmationFields = Partial<ClientConfirmationBookingRow>

// The agreed cancellation-policy snapshot lives on the Booking row (M15) but isn't
// part of the canonical select. Optional so existing callers compile unchanged; the
// booking-detail loader selects it so the client can see the terms they agreed to.
type ClientBookingCancellationPolicyFields = {
  cancellationPolicySnapshot?: unknown
}

// Final-bill refund/dispute + deposit-dispute columns live on the Booking row but
// aren't part of the canonical ClientBookingRow select. Optional so existing
// callers compile unchanged; the client booking-detail loader + the list route
// select them so a refunded/disputed payment can't render as a clean "paid"
// (M11 display-truth). Absent → the DTO's booleans default false / 0.
type ClientBookingRefundDisputeFields = {
  stripePaymentStatus?: StripePaymentStatus | null
  stripeAmountTotal?: number | null
  stripeAmountRefunded?: number | null
  depositDisputedAt?: Date | null
}

export async function buildClientBookingDTO(input: {
  booking: ClientBookingRow &
    ClientBookingDepositFields &
    ClientBookingRebookFields &
    ClientBookingMediaConsentFields &
    ClientBookingCancellationPolicyFields &
    ClientBookingConfirmationFields &
    ClientBookingRefundDisputeFields
  unreadAftercare: boolean
  hasPendingConsultationApproval: boolean
  /**
   * The pro's checkout payment options (accepted methods + handles + tip config)
   * for this booking. The list route resolves it per booking's pro; other callers
   * omit it and the DTO carries null.
   */
  paymentOptions?: ClientBookingPaymentOptionsDTO | null
}): Promise<ClientBookingDTO> {
  const { booking: b } = input

  // A pro-proposed next appointment is still pending when it's BOOKED_NEXT_APPOINTMENT
  // with a time, not declined, and not already confirmed (no active rebooked booking).
  const after = b.aftercareSummary
  const hasActiveRebookedBooking = (b.rebooks ?? []).some(
    (r) => String(r.status).toUpperCase() !== 'CANCELLED',
  )
  const rebookPending = Boolean(
    after &&
      after.rebookMode === AftercareRebookMode.BOOKED_NEXT_APPOINTMENT &&
      after.rebookedFor != null &&
      after.rebookDeclinedAt == null &&
      !hasActiveRebookedBooking,
  )

  const items: ClientBookingItemDTO[] = (b.serviceItems ?? []).map((it) => {
    const rawType =
      typeof it.itemType === 'string' ? it.itemType : String(it.itemType ?? '')
    const type = rawType.toUpperCase() === 'ADD_ON' ? 'ADD_ON' : 'BASE'

    return {
      id: String(it.id),
      type,
      serviceId: String(it.serviceId),
      name: it.service?.name ?? 'Service',
      price: decimalStringOrZero(it.priceSnapshot),
      durationMinutes: Number(it.durationMinutesSnapshot ?? 0),
      parentItemId: it.parentItemId ? String(it.parentItemId) : null,
      sortOrder: Number(it.sortOrder ?? 0),
    }
  })

  const productSales: ClientBookingProductSaleDTO[] = (b.productSales ?? []).map(
    (sale) => ({
      id: String(sale.id),
      productId: sale.productId ? String(sale.productId) : null,
      name: sale.product?.name ?? 'Product',
      unitPrice: decimalStringOrZero(sale.unitPrice),
      quantity:
        typeof sale.quantity === 'number' && Number.isFinite(sale.quantity)
          ? Math.max(0, Math.trunc(sale.quantity))
          : 0,
      lineTotal: multiplyMoneyString(sale.unitPrice, sale.quantity),
    }),
  )

  const baseItem = items.find((x) => x.type === 'BASE') ?? items[0] ?? null
  const baseName = baseItem?.name ?? (b.service?.name ?? 'Appointment')
  const addOnNames = items.filter((x) => x.type === 'ADD_ON').map((x) => x.name)
  // Co-equal BASE services (e.g. cut + color) all surface in the title, not
  // just the primary, then any add-ons.
  const title = formatBookingServicesLabel(
    [...items]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((x) => ({ name: x.name, itemType: x.type })),
    b.service?.name ?? null,
  )

  // Where the appointment actually happens. SALON reads the pro-location
  // snapshot, MOBILE the client-address one — the shared resolver the pro's own
  // bookings screens and the booking confirmation already use.
  const bookedPlace = resolveBookingLocationMeta({
    locationType: b.locationType ?? null,
    locationAddressSnapshot: b.locationAddressSnapshot,
    locationLatSnapshot: b.locationLatSnapshot ?? null,
    locationLngSnapshot: b.locationLngSnapshot ?? null,
    clientAddressSnapshot: b.clientAddressSnapshot,
    clientAddressLatSnapshot: b.clientAddressLatSnapshot ?? null,
    clientAddressLngSnapshot: b.clientAddressLngSnapshot ?? null,
  })

  const locationLabel = buildLocationLabel({
    bookedAddress: bookedPlace.formattedAddress,
    location: bookedPlace.isMobile
      ? null
      : b.location
        ? {
            formattedAddress: b.location.formattedAddress ?? null,
            name: b.location.name ?? null,
            city: b.location.city ?? null,
            state: b.location.state ?? null,
          }
        : null,
    proLocation: b.professional?.location ?? null,
    isMobile: bookedPlace.isMobile,
  })

  // The label can be a salon NAME or a city — neither of which a maps app can
  // find. `locationAddress` is the address itself, so every client can make the
  // place tappable (Tori's standing rule) without guessing which of the two the
  // label happens to be this time.
  const locationAddress =
    bookedPlace.formattedAddress ??
    (bookedPlace.isMobile ? null : b.location?.formattedAddress?.trim() || null)

  const tzRes = await resolveApptTimeZone({
    bookingLocationTimeZone: b.locationTimeZone ?? null,
    location: b.location
      ? { id: b.location.id, timeZone: b.location.timeZone }
      : null,
    locationId: b.locationId ?? null,
    professionalId: b.professional?.id ?? null,
    professionalTimeZone: b.professional?.timeZone ?? null,
    fallback: DEFAULT_TIME_ZONE,
    requireValid: false,
  })

  const timeZone = tzRes.ok
    ? sanitizeTimeZone(tzRes.timeZone, DEFAULT_TIME_ZONE)
    : DEFAULT_TIME_ZONE

  const timeZoneSource: ClientBookingTimeZoneSource = tzRes.ok
    ? mapTimeZoneTruthSourceToClientDtoSource(tzRes.source)
    : 'FALLBACK'

  const consultBlobNeeded =
    Boolean(b.consultationApproval) ||
    Boolean(b.consultationNotes) ||
    b.consultationPrice != null

  const consultation: ClientBookingConsultationDTO | null = consultBlobNeeded
    ? {
        consultationNotes: b.consultationNotes ?? null,
        consultationPrice: decimalToString(b.consultationPrice),
        consultationConfirmedAt: b.consultationConfirmedAt
          ? b.consultationConfirmedAt.toISOString()
          : null,

        approvalStatus: b.consultationApproval?.status
          ? String(b.consultationApproval.status)
          : null,
        approvalNotes: b.consultationApproval?.notes ?? null,
        proposedTotal: decimalToString(b.consultationApproval?.proposedTotal),
        proposedServicesJson:
          (b.consultationApproval?.proposedServicesJson ??
            null) as Prisma.JsonValue | null,
        approvedAt: b.consultationApproval?.approvedAt
          ? b.consultationApproval.approvedAt.toISOString()
          : null,
        rejectedAt: b.consultationApproval?.rejectedAt
          ? b.consultationApproval.rejectedAt.toISOString()
          : null,
      }
    : null

  // Normalised because the three columns are OPTIONAL on this input: a caller
  // that never selected them must read as "nobody asked", not crash the
  // derivation — and undefined and null mean the same thing to it.
  //
  // 🔴 Gated on the loop flag as well, and this is the CLIENT-side field's whole
  // meaning: its presence is what tells web and iOS to draw an answer control.
  // With the loop off, every answer route refuses — so a surface still offering
  // the buttons would be promising an action the server will reject. Prod never
  // stamps these columns while the flag is off, but flipping it back off after a
  // trial would otherwise strand exactly the rows that were mid-loop. The PRO's
  // own badge (calendar, list, booking detail) is deliberately NOT gated: it
  // reports what happened, and history doesn't stop being true when a switch
  // moves.
  const clientConfirmation = clientConfirmationLoopEnabled()
    ? deriveClientConfirmationBadge({
        clientConfirmationRequestedAt: b.clientConfirmationRequestedAt ?? null,
        clientConfirmedAt: b.clientConfirmedAt ?? null,
        clientConfirmationDeclinedAt: b.clientConfirmationDeclinedAt ?? null,
      })
    : null

  return {
    id: String(b.id),
    status: b.status != null ? String(b.status) : null,
    source: b.source != null ? String(b.source) : null,
    rebookOfBookingId: b.rebookOfBookingId != null ? String(b.rebookOfBookingId) : null,
    sessionStep: b.sessionStep != null ? String(b.sessionStep) : null,

    scheduledFor: b.scheduledFor.toISOString(),
    totalDurationMinutes: Number(b.totalDurationMinutes ?? 0),
    bufferMinutes: Number(b.bufferMinutes ?? 0),

    subtotalSnapshot: decimalToString(b.subtotalSnapshot),

    checkout: {
      subtotalSnapshot: decimalToString(b.subtotalSnapshot),
      serviceSubtotalSnapshot: decimalToString(
        b.serviceSubtotalSnapshot ?? b.subtotalSnapshot,
      ),
      productSubtotalSnapshot: decimalToString(b.productSubtotalSnapshot),
      tipAmount: decimalToString(b.tipAmount),
      taxAmount: decimalToString(b.taxAmount),
      discountAmount: decimalToString(b.discountAmount),
      totalAmount: decimalToString(b.totalAmount),
      checkoutStatus: b.checkoutStatus != null ? String(b.checkoutStatus) : null,
      selectedPaymentMethod:
        b.selectedPaymentMethod != null ? String(b.selectedPaymentMethod) : null,
      paymentAuthorizedAt: b.paymentAuthorizedAt
        ? b.paymentAuthorizedAt.toISOString()
        : null,
      paymentCollectedAt: b.paymentCollectedAt
        ? b.paymentCollectedAt.toISOString()
        : null,
      depositStatus: b.depositStatus != null ? String(b.depositStatus) : null,
      depositAmount: decimalToString(b.depositAmount ?? null),
      paymentDisputed:
        b.stripePaymentStatus === StripePaymentStatus.DISPUTED,
      paymentRefundedCents: b.stripeAmountRefunded ?? 0,
      paymentFullyRefunded:
        (b.stripeAmountTotal ?? 0) > 0 &&
        (b.stripeAmountRefunded ?? 0) >= (b.stripeAmountTotal ?? 0),
      depositDisputed: b.depositDisputedAt != null,
    },

    locationType: b.locationType != null ? String(b.locationType) : null,
    locationId: b.locationId ? String(b.locationId) : null,

    timeZone,
    timeZoneSource,

    locationLabel,
    locationAddress,
    locationLat: bookedPlace.lat,
    locationLng: bookedPlace.lng,

    professional: b.professional
      ? {
          id: String(b.professional.id),
          businessName: b.professional.businessName ?? null,
          firstName: b.professional.firstName ?? null,
          lastName: b.professional.lastName ?? null,
          handle: b.professional.handle ?? null,
          nameDisplay: b.professional.nameDisplay ?? null,
          location: b.professional.location ?? null,
          timeZone: b.professional.timeZone ?? null,
        }
      : null,

    bookedLocation: b.location
      ? {
          id: String(b.location.id),
          name: b.location.name ?? null,
          formattedAddress: b.location.formattedAddress ?? null,
          city: b.location.city ?? null,
          state: b.location.state ?? null,
          timeZone: b.location.timeZone ?? null,
        }
      : null,

    display: {
      title,
      baseName,
      addOnNames,
      addOnCount: addOnNames.length,
    },

    items,
    productSales,

    hasUnreadAftercare: Boolean(input.unreadAftercare),
    hasPendingConsultationApproval: Boolean(
      input.hasPendingConsultationApproval,
    ),
    hasPendingRebookConfirmation: rebookPending,
    rebookProposedFor:
      rebookPending && after?.rebookedFor
        ? after.rebookedFor.toISOString()
        : null,

    mediaUseConsent: b.mediaUseConsentAt != null,
    cancellationPolicy: (() => {
      const snapshot = parseCancellationPolicySnapshot(
        b.cancellationPolicySnapshot,
      )
      return snapshot ? formatCancellationPolicy(snapshot) : null
    })(),

    consultation,

    // K13: the client's own view of K11's state — the same badge, from the same
    // helper, that the pro sees. Present only when the pro's reminder actually
    // asked (`significant`), so a booking nobody asked about serialises exactly
    // as it did pre-K13 and the app draws no answer control it has no question
    // for. A caller that didn't select the columns reads NOT_REQUESTED and is
    // therefore also absent — the honest answer for "this payload can't say".
    ...(clientConfirmation?.significant ? { clientConfirmation } : {}),

    paymentOptions: input.paymentOptions ?? null,
  }
}