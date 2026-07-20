// lib/dto/clientBooking.ts
import {
  Prisma,
  AftercareRebookMode,
  type BookingServiceItemType,
  type BookingDepositStatus,
  type BookingStatus,
  type ProNameDisplay,
} from '@prisma/client'
import { moneyToString } from '@/lib/money'
import { formatBookingServicesLabel } from '@/lib/booking/serviceLabel'
import {
  resolveApptTimeZone,
  type TimeZoneTruthSource,
} from '@/lib/booking/timeZoneTruth'
import { DEFAULT_TIME_ZONE, sanitizeTimeZone } from '@/lib/timeZone'
import { isRecord } from '@/lib/guards'

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

  locationLabel: string | null

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
  locationAddressSnapshot: unknown
  location: {
    formattedAddress: string | null
    name: string | null
    city: string | null
    state: string | null
  } | null
  proLocation: string | null
}): string | null {
  const snap = pickFormattedAddress(args.locationAddressSnapshot)
  if (snap) return snap

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

export async function buildClientBookingDTO(input: {
  booking: ClientBookingRow &
    ClientBookingDepositFields &
    ClientBookingRebookFields &
    ClientBookingMediaConsentFields
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

  const locationLabel = buildLocationLabel({
    locationAddressSnapshot: b.locationAddressSnapshot,
    location: b.location
      ? {
          formattedAddress: b.location.formattedAddress ?? null,
          name: b.location.name ?? null,
          city: b.location.city ?? null,
          state: b.location.state ?? null,
        }
      : null,
    proLocation: b.professional?.location ?? null,
  })

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
    },

    locationType: b.locationType != null ? String(b.locationType) : null,
    locationId: b.locationId ? String(b.locationId) : null,

    timeZone,
    timeZoneSource,

    locationLabel,

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

    consultation,

    paymentOptions: input.paymentOptions ?? null,
  }
}