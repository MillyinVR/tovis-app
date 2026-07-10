// lib/booking/clientBookingBuckets.ts
//
// Single source of truth for the client's bucketed bookings (Upcoming / Needs
// attention / Pre-booked / Waitlist / Past). Both the API route
// (GET /api/v1/client/bookings — consumed by iOS AppointmentsView) and the web
// SSR Appointments list (/client/bookings) load through here, so the two stay
// byte-identical instead of drifting.
import {
  ConsultationApprovalStatus,
  NotificationEventKey,
  Prisma as PrismaNamespace,
  WaitlistStatus,
  type Prisma,
} from '@prisma/client'

import { prisma } from '@/lib/prisma'
import {
  buildClientBookingDTO,
  type ClientBookingDTO,
  type ClientBookingPaymentOptionsDTO,
} from '@/lib/dto/clientBooking'
import {
  buildClientPaymentOptions,
  clientPaymentOptionsSelect,
} from '@/lib/payments/clientPaymentOptions'

/** Trim + upper a maybe-string enum value; '' when absent. */
function upper(v: unknown): string {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

function addDaysUtc(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60_000)
}

export function hasPendingConsultationApproval(booking: {
  status: unknown
  sessionStep: unknown
  finishedAt: Date | null
  consultationApproval?: { status: ConsultationApprovalStatus | null } | null
}): boolean {
  const bookingStatus = upper(booking.status)
  if (bookingStatus === 'CANCELLED' || bookingStatus === 'COMPLETED') {
    return false
  }

  if (booking.finishedAt) {
    return false
  }

  const sessionStep = upper(booking.sessionStep)
  if (sessionStep === 'CONSULTATION_PENDING_CLIENT') {
    return true
  }

  return booking.consultationApproval?.status === ConsultationApprovalStatus.PENDING
}

const bookingServiceItemsOrderBy: PrismaNamespace.BookingServiceItemOrderByWithRelationInput =
  { sortOrder: 'asc' }

export const clientBookingListSelect = {
  id: true,
  status: true,
  source: true,
  // Links a coupled aftercare rebook back to the appointment whose payment gates
  // its approval — so the native next-booking detail can label it "pending —
  // your pro will confirm after payment" (AWAITING_CONFIRMATION coupling).
  rebookOfBookingId: true,
  sessionStep: true,
  scheduledFor: true,
  finishedAt: true,

  subtotalSnapshot: true,
  serviceSubtotalSnapshot: true,
  productSubtotalSnapshot: true,
  totalAmount: true,
  tipAmount: true,
  taxAmount: true,
  discountAmount: true,
  checkoutStatus: true,
  selectedPaymentMethod: true,
  paymentAuthorizedAt: true,
  paymentCollectedAt: true,
  depositStatus: true,
  depositAmount: true,

  // Client media-use consent (B3b) — lets the client see/toggle whether the pro
  // may feature this session's media publicly.
  mediaUseConsentAt: true,

  // Rebook-confirm state: the pro's proposed next appointment + whether it's been
  // confirmed (an active rebooked booking exists) so the CTA hides after confirm.
  aftercareSummary: {
    select: { rebookMode: true, rebookedFor: true, rebookDeclinedAt: true },
  },
  rebooks: { select: { id: true, status: true } },

  totalDurationMinutes: true,
  bufferMinutes: true,

  locationType: true,
  locationId: true,
  locationTimeZone: true,
  locationAddressSnapshot: true,

  service: {
    select: {
      id: true,
      name: true,
    },
  },

  professional: {
    select: {
      id: true,
      businessName: true,
      firstName: true, // pii-plaintext-read-ok: pro public display name (pickProfessionalPublicDisplayName)
      lastName: true, // pii-plaintext-read-ok: pro public display name (pickProfessionalPublicDisplayName)
      handle: true,
      nameDisplay: true,
      location: true,
      timeZone: true,
    },
  },

  location: {
    select: {
      id: true,
      name: true,
      formattedAddress: true,
      city: true,
      state: true,
      timeZone: true,
    },
  },
  consultationNotes: true, // pii-plaintext-read-ok: client's own booking consultation notes, surfaced to that client
  consultationPrice: true,
  consultationConfirmedAt: true,

  consultationApproval: {
    select: {
      status: true,
      proposedServicesJson: true,
      proposedTotal: true,
      notes: true,
      approvedAt: true,
      rejectedAt: true,
    },
  },

  serviceItems: {
    select: {
      id: true,
      itemType: true,
      parentItemId: true,
      sortOrder: true,
      durationMinutesSnapshot: true,
      priceSnapshot: true,
      serviceId: true,
      service: {
        select: {
          name: true,
        },
      },
    },
    orderBy: bookingServiceItemsOrderBy,
  },

  productSales: {
    select: {
      id: true,
      productId: true,
      quantity: true,
      unitPrice: true,
      product: {
        select: {
          name: true,
        },
      },
    },
    orderBy: [{ createdAt: 'asc' }],
  },
} satisfies Prisma.BookingSelect

export const clientBookingWaitlistSelect = {
  id: true,
  createdAt: true,
  notes: true,
  mediaId: true,
  status: true,
  preferenceType: true,
  specificDate: true,
  timeOfDay: true,
  windowStartMin: true,
  windowEndMin: true,
  service: {
    select: {
      id: true,
      name: true,
    },
  },
  professional: {
    select: {
      id: true,
      businessName: true,
      firstName: true, // pii-plaintext-read-ok: pro public display name (pickProfessionalPublicDisplayName)
      lastName: true, // pii-plaintext-read-ok: pro public display name (pickProfessionalPublicDisplayName)
      handle: true,
      nameDisplay: true,
      location: true,
      timeZone: true,
    },
  },
} satisfies Prisma.WaitlistEntrySelect

export type ClientBookingRow = Prisma.BookingGetPayload<{
  select: typeof clientBookingListSelect
}>
export type ClientBookingWaitlistRow = Prisma.WaitlistEntryGetPayload<{
  select: typeof clientBookingWaitlistSelect
}>

export type ClientBookingBuckets = {
  upcoming: ClientBookingDTO[]
  pending: ClientBookingDTO[]
  waitlist: ClientBookingWaitlistRow[]
  prebooked: ClientBookingDTO[]
  past: ClientBookingDTO[]
}

export function bucketClientBookings(args: {
  bookings: ClientBookingDTO[]
  waitlist: ClientBookingWaitlistRow[]
  now: Date
  next30: Date
}): ClientBookingBuckets {
  const { bookings, waitlist, now, next30 } = args

  const buckets: ClientBookingBuckets = {
    upcoming: [],
    pending: [],
    waitlist,
    prebooked: [],
    past: [],
  }

  for (const booking of bookings) {
    const status = upper(booking.status)
    const source = upper(booking.source)
    const scheduledFor = new Date(booking.scheduledFor)
    const isFuture = scheduledFor.getTime() >= now.getTime()
    const withinNext30Days = scheduledFor.getTime() < next30.getTime()

    if (status === 'COMPLETED' || status === 'CANCELLED') {
      buckets.past.push(booking)
      continue
    }

    if (booking.hasPendingConsultationApproval || status === 'PENDING') {
      buckets.pending.push(booking)
      continue
    }

    if (source === 'AFTERCARE' && isFuture) {
      buckets.prebooked.push(booking)
      continue
    }

    if (status === 'ACCEPTED' && isFuture && withinNext30Days) {
      buckets.upcoming.push(booking)
      continue
    }

    if (isFuture) {
      buckets.upcoming.push(booking)
      continue
    }

    buckets.past.push(booking)
  }

  return buckets
}

export type LoadedClientBookingBuckets = {
  buckets: ClientBookingBuckets
  meta: { now: string; next30: string }
}

/**
 * Resolve each distinct pro's client checkout payment options in one query, keyed
 * by professionalId. Pros without a saved settings row simply have no map entry
 * (the caller falls back to the Cash-only default per booking).
 */
async function loadPaymentOptionsByPro(
  professionalIds: string[],
): Promise<Map<string, ClientBookingPaymentOptionsDTO>> {
  const distinctIds = Array.from(new Set(professionalIds))
  const byPro = new Map<string, ClientBookingPaymentOptionsDTO>()
  if (distinctIds.length === 0) return byPro

  const rows = await prisma.professionalPaymentSettings.findMany({
    where: { professionalId: { in: distinctIds } },
    select: { professionalId: true, ...clientPaymentOptionsSelect },
  })
  const rowByPro = new Map(rows.map((row) => [row.professionalId, row]))

  // Emit an entry for every pro that has a booking — a pro with no settings row
  // gets the Cash-only default (buildClientPaymentOptions(null)), matching the web
  // page's fallback so the client is never left with "no way to pay".
  for (const professionalId of distinctIds) {
    byPro.set(
      professionalId,
      buildClientPaymentOptions(rowByPro.get(professionalId) ?? null),
    )
  }

  return byPro
}

/**
 * Load the full bucketed set for a client — bookings (with unread-aftercare +
 * pending-consultation flags folded into each DTO) plus active waitlist entries.
 * Used by the API route and the SSR Appointments page so both share one query.
 */
export async function loadClientBookingBuckets(
  clientId: string,
): Promise<LoadedClientBookingBuckets> {
  const now = new Date()
  const next30 = addDaysUtc(now, 30)

  const bookings: ClientBookingRow[] = await prisma.booking.findMany({
    where: { clientId },
    orderBy: { scheduledFor: 'asc' },
    take: 300,
    select: clientBookingListSelect,
  })

  const unreadNotifications = await prisma.clientNotification.findMany({
    where: {
      clientId,
      eventKey: NotificationEventKey.AFTERCARE_READY,
      readAt: null,
      bookingId: { not: null },
    },
    select: { bookingId: true },
    take: 1000,
  })

  const unreadBookingIds = new Set(
    unreadNotifications
      .map((notification) => notification.bookingId)
      .filter(
        (bookingId): bookingId is string =>
          typeof bookingId === 'string' && bookingId.trim().length > 0,
      ),
  )

  // The native client checkout renders the pro's accepted methods (with handles)
  // + tip config natively, so we resolve each booking's pro's payment options and
  // fold them into the DTO. One batched query for the distinct pros in the set;
  // handles stay gated to the client's own bookings. A pro with no settings row
  // gets the Cash-only default (buildClientPaymentOptions(null)).
  const paymentOptionsByPro = await loadPaymentOptionsByPro(
    bookings
      .map((booking) => booking.professional?.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  )

  const bookingDtos: ClientBookingDTO[] = await Promise.all(
    bookings.map((booking) =>
      buildClientBookingDTO({
        booking,
        unreadAftercare: unreadBookingIds.has(booking.id),
        hasPendingConsultationApproval: hasPendingConsultationApproval(booking),
        paymentOptions: booking.professional?.id
          ? paymentOptionsByPro.get(booking.professional.id) ?? null
          : null,
      }),
    ),
  )

  const waitlist: ClientBookingWaitlistRow[] = await prisma.waitlistEntry.findMany({
    where: {
      clientId,
      status: WaitlistStatus.ACTIVE,
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: clientBookingWaitlistSelect,
  })

  const buckets = bucketClientBookings({
    bookings: bookingDtos,
    waitlist,
    now,
    next30,
  })

  return {
    buckets,
    meta: {
      now: now.toISOString(),
      next30: next30.toISOString(),
    },
  }
}
