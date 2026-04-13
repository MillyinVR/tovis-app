// app/api/client/bookings/route.ts
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'

import { requireClient } from '@/app/api/_utils/auth/requireClient'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import { upper } from '@/app/api/_utils/strings'

import {
  buildClientBookingDTO,
  type ClientBookingDTO,
} from '@/lib/dto/clientBooking'

import {
  ConsultationApprovalStatus,
  NotificationEventKey,
  Prisma as PrismaNamespace,
  WaitlistStatus,
  type Prisma,
} from '@prisma/client'

export const dynamic = 'force-dynamic'

function addDaysUtc(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60_000)
}

function hasPendingConsultationApproval(booking: {
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

const bookingSelect = {
  id: true,
  status: true,
  source: true,
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

  consultationNotes: true,
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

const waitlistSelect = {
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
      location: true,
      timeZone: true,
    },
  },
} satisfies Prisma.WaitlistEntrySelect

type BookingRow = Prisma.BookingGetPayload<{ select: typeof bookingSelect }>
type WaitlistRow = Prisma.WaitlistEntryGetPayload<{ select: typeof waitlistSelect }>

type ClientBookingBuckets = {
  upcoming: ClientBookingDTO[]
  pending: ClientBookingDTO[]
  waitlist: WaitlistRow[]
  prebooked: ClientBookingDTO[]
  past: ClientBookingDTO[]
}

function bucketClientBookings(args: {
  bookings: ClientBookingDTO[]
  waitlist: WaitlistRow[]
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

export async function GET() {
  try {
    const auth = await requireClient()
    if (!auth.ok) {
      return auth.res
    }

    const clientId = auth.clientId
    const now = new Date()
    const next30 = addDaysUtc(now, 30)

    const bookings: BookingRow[] = await prisma.booking.findMany({
      where: { clientId },
      orderBy: { scheduledFor: 'asc' },
      take: 300,
      select: bookingSelect,
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

    const bookingDtos: ClientBookingDTO[] = await Promise.all(
      bookings.map((booking) =>
        buildClientBookingDTO({
          booking,
          unreadAftercare: unreadBookingIds.has(booking.id),
          hasPendingConsultationApproval:
            hasPendingConsultationApproval(booking),
        }),
      ),
    )

    const waitlist: WaitlistRow[] = await prisma.waitlistEntry.findMany({
      where: {
        clientId,
        status: WaitlistStatus.ACTIVE,
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: waitlistSelect,
    })

    const buckets = bucketClientBookings({
      bookings: bookingDtos,
      waitlist,
      now,
      next30,
    })

    return jsonOk(
      {
        buckets,
        meta: {
          now: now.toISOString(),
          next30: next30.toISOString(),
        },
      },
      200,
    )
  } catch (error) {
    console.error('GET /api/client/bookings error:', error)
    return jsonFail(500, 'Failed to load client bookings.')
  }
}

export async function POST(_req: NextRequest) {
  return jsonFail(410, 'This endpoint has been deprecated.', {
    code: 'DEPRECATED_ENDPOINT',
    hint: {
      correctEndpoint: 'POST /api/bookings',
    },
  })
}