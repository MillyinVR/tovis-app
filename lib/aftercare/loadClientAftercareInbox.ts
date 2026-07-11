// lib/aftercare/loadClientAftercareInbox.ts
//
// Single source of truth for the client's aftercare inbox — the reverse-chrono
// list of every aftercare summary a client has received. Both the API route
// (GET /api/v1/client/aftercare — consumed by the native iOS Aftercare inbox)
// and the web SSR inbox (/client/aftercare) load through here, so the two stay
// byte-identical instead of drifting.
//
// The "inbox" is literally the client's AFTERCARE_READY notification rows (the
// notification a pro's `.../aftercare/send` mints), each enriched with its
// booking's canonical title / pro display name / timezone via the shared
// `buildClientBookingDTO`, plus the pro-chosen before/after pair from the shared
// `loadBookingBeforeAfterThumbs` SSOT. We never create an AftercareSummary here
// — this is a pure read (see the existence-keyed-summary rule).
import {
  AftercareRebookMode,
  ConsultationApprovalStatus,
  NotificationEventKey,
  Prisma,
} from '@prisma/client'

import { prisma } from '@/lib/prisma'
import {
  buildClientBookingDTO,
  type ClientBookingDTO,
} from '@/lib/dto/clientBooking'
import { loadBookingBeforeAfterThumbs } from '@/lib/media/bookingBeforeAfter'
import { formatProfessionalPublicDisplayName } from '@/lib/privacy/professionalDisplayName'
import { DEFAULT_TIME_ZONE, sanitizeTimeZone } from '@/lib/timeZone'
import type { ClientAftercareInboxItemDTO } from '@/lib/dto/clientAftercareInbox'

/** How many aftercare notifications back the inbox shows (matches the web page). */
export const AFTERCARE_INBOX_PAGE_SIZE = 300

/** Fallback labels for a row whose booking DTO couldn't be built. */
const TITLE_FALLBACK = 'Aftercare'
const PRO_FALLBACK = 'Your pro'

function safeText(v: unknown, fallback: string): string {
  const s = typeof v === 'string' ? v.trim() : ''
  return s ? s : fallback
}

function safeId(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return s ? s : null
}

// Booking shape feeding buildClientBookingDTO — the canonical ClientBookingRow
// fields the inbox needs (title / pro display name / timezone / scheduledFor).
const bookingSelect = Prisma.validator<Prisma.BookingSelect>()({
  id: true,
  status: true,
  source: true,
  rebookOfBookingId: true,
  sessionStep: true,
  scheduledFor: true,
  finishedAt: true,

  subtotalSnapshot: true,
  serviceSubtotalSnapshot: true,
  productSubtotalSnapshot: true,
  tipAmount: true,
  taxAmount: true,
  discountAmount: true,
  totalAmount: true,
  checkoutStatus: true,
  selectedPaymentMethod: true,
  paymentAuthorizedAt: true,
  paymentCollectedAt: true,
  totalDurationMinutes: true,
  bufferMinutes: true,

  locationType: true,
  locationId: true,
  locationTimeZone: true,
  locationAddressSnapshot: true,

  service: { select: { id: true, name: true } },

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

  serviceItems: {
    orderBy: { sortOrder: 'asc' },
    take: 80,
    select: {
      id: true,
      itemType: true,
      parentItemId: true,
      sortOrder: true,
      durationMinutesSnapshot: true,
      priceSnapshot: true,
      serviceId: true,
      service: { select: { name: true } },
    },
  },

  productSales: {
    orderBy: { createdAt: 'asc' },
    take: 80,
    select: {
      id: true,
      productId: true,
      quantity: true,
      unitPrice: true,
      product: { select: { name: true } },
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
})

const inboxSelect = Prisma.validator<Prisma.ClientNotificationSelect>()({
  id: true,
  title: true,
  body: true,
  readAt: true,
  createdAt: true,
  bookingId: true,
  aftercareId: true,
  booking: { select: bookingSelect },
  aftercare: { select: { rebookMode: true, rebookedFor: true } },
})

type InboxItem = Prisma.ClientNotificationGetPayload<{ select: typeof inboxSelect }>

/**
 * Load the client's aftercare inbox rows, resolved to JSON-safe wire shapes
 * (ISO strings, public pro display name, sanitized timezone, before/after pair).
 * Reverse-chronological, capped at {@link AFTERCARE_INBOX_PAGE_SIZE}.
 */
export async function loadClientAftercareInbox(
  clientId: string,
): Promise<ClientAftercareInboxItemDTO[]> {
  const items: InboxItem[] = await prisma.clientNotification.findMany({
    where: {
      clientId,
      eventKey: NotificationEventKey.AFTERCARE_READY,
    },
    orderBy: { createdAt: 'desc' },
    take: AFTERCARE_INBOX_PAGE_SIZE,
    select: inboxSelect,
  })

  const enriched = await Promise.all(
    items.map(async (n) => {
      const raw = n.booking

      let dto: ClientBookingDTO | null = null
      if (raw) {
        const hasPendingConsultationApproval =
          raw.consultationApproval?.status === ConsultationApprovalStatus.PENDING

        try {
          dto = await buildClientBookingDTO({
            booking: raw,
            unreadAftercare: !n.readAt,
            hasPendingConsultationApproval,
          })
        } catch {
          dto = null
        }
      }

      return { n, raw, dto }
    }),
  )

  // Before/after photos for every visit linked from this inbox, loaded in one
  // batch via the shared SSOT.
  const beforeAfterByBooking = await loadBookingBeforeAfterThumbs(
    enriched
      .map(({ n, raw, dto }) => safeId(dto?.id ?? raw?.id ?? n.bookingId))
      .filter((id): id is string => Boolean(id)),
  )

  return enriched.map(({ n, raw, dto }) => {
    const bookingId = safeId(dto?.id ?? raw?.id ?? n.bookingId)
    const proName = formatProfessionalPublicDisplayName(
      dto?.professional ?? raw?.professional ?? null,
      PRO_FALLBACK,
    )
    const timeZone = sanitizeTimeZone(dto?.timeZone, DEFAULT_TIME_ZONE)
    const scheduledFor = dto?.scheduledFor ?? raw?.scheduledFor?.toISOString() ?? null
    const beforeAfter = bookingId ? beforeAfterByBooking.get(bookingId) ?? null : null

    return {
      notificationId: n.id,
      bookingId,
      aftercareId: n.aftercareId,
      title: dto?.display?.title || safeText(n.title, TITLE_FALLBACK),
      proId: dto?.professional?.id ?? raw?.professional?.id ?? null,
      proName,
      scheduledFor,
      timeZone,
      beforeAfter,
      rebookMode: n.aftercare?.rebookMode ?? null,
      rebookedFor: n.aftercare?.rebookedFor?.toISOString() ?? null,
      body: n.body,
      unread: !n.readAt,
      createdAt: n.createdAt.toISOString(),
    }
  })
}

/** Web page hint discriminator — kept in sync with the DTO's rebook fields. */
export function aftercareInboxHintMode(item: {
  rebookMode: AftercareRebookMode | null
  rebookedFor: string | null
}): 'RECOMMENDED_WINDOW' | 'RECOMMENDED_DATE' | 'NOTES' {
  if (item.rebookMode === AftercareRebookMode.RECOMMENDED_WINDOW) {
    return 'RECOMMENDED_WINDOW'
  }
  return item.rebookedFor ? 'RECOMMENDED_DATE' : 'NOTES'
}
