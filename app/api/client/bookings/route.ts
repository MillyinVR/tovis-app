// app/api/client/bookings/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

import { requireClient } from '@/app/api/_utils/auth/requireClient'
import { upper } from '@/app/api/_utils/strings'
import { jsonFail } from '@/app/api/_utils/responses'

import { buildClientBookingDTO, type ClientBookingDTO } from '@/lib/dto/clientBooking'
import { ClientNotificationType, WaitlistStatus, type Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

function addDaysUtc(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60_000)
}

function needsConsultationApproval(b: {
  status: unknown
  sessionStep: unknown
  finishedAt: Date | null
  consultationApproval?: { status: unknown } | null
}) {
  const status = upper(b.status)
  if (status === 'CANCELLED' || status === 'COMPLETED') return false
  if (b.finishedAt) return false

  const step = upper(b.sessionStep)
  if (step === 'CONSULTATION_PENDING_CLIENT') return true

  const approval = upper(b.consultationApproval?.status)

  const PENDING_APPROVAL = new Set([
    'PENDING',
    'PENDING_CLIENT',
    'PENDING_CLIENT_APPROVAL',
    'AWAITING_CLIENT',
    'WAITING_CLIENT',
    'NEEDS_APPROVAL',
    'SENT',
  ])

  if (PENDING_APPROVAL.has(approval)) return true

  const decided = approval === 'APPROVED' || approval === 'REJECTED'
  const consultPhase = step === 'CONSULTATION' || step === 'CONSULTATION_PENDING_CLIENT' || step === 'NONE' || !step

  if (!decided && consultPhase && approval) return true

  return false
}

// ✅ EXACTLY matches buildClientBookingDTO's expected select
const bookingSelect = {
  id: true,
  status: true,
  source: true,
  sessionStep: true,
  scheduledFor: true,
  finishedAt: true,

  subtotalSnapshot: true,
  totalDurationMinutes: true,
  bufferMinutes: true,

  locationType: true,
  locationId: true,
  locationTimeZone: true,
  locationAddressSnapshot: true,

  service: { select: { id: true, name: true } },

  professional: { select: { id: true, businessName: true, location: true, timeZone: true } },

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
      service: { select: { name: true } },
    },
    orderBy: { sortOrder: 'asc' as const },
  },
} satisfies Prisma.BookingSelect

type BookingRow = Prisma.BookingGetPayload<{ select: typeof bookingSelect }>

export async function GET() {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res
    const clientId = auth.clientId

    const now = new Date()
    const next30 = addDaysUtc(now, 30)

    const bookings: BookingRow[] = await prisma.booking.findMany({
      where: { clientId },
      orderBy: { scheduledFor: 'asc' },
      take: 300,
      select: bookingSelect,
    })

    const unread = await prisma.clientNotification.findMany({
      where: {
        clientId,
        type: ClientNotificationType.AFTERCARE,
        readAt: null,
        bookingId: { not: null },
      },
      select: { bookingId: true },
      take: 1000,
    })

    const unreadBookingIds = new Set(
      unread
        .map((n) => n.bookingId)
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0),
    )

    const dtos: ClientBookingDTO[] = await Promise.all(
      bookings.map(async (b) => {
        const hasPending = needsConsultationApproval(b)
        const unreadAftercare = unreadBookingIds.has(b.id)

        return buildClientBookingDTO({
          booking: b,
          unreadAftercare,
          hasPendingConsultationApproval: hasPending,
        })
      }),
    )

    // waitlist (typed)
    const waitlist = await prisma.waitlistEntry.findMany({
      where: { clientId, status: WaitlistStatus.ACTIVE },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        createdAt: true,
        notes: true,
        preferredStart: true,
        preferredEnd: true,
        preferredTimeBucket: true,
        mediaId: true,
        status: true,
        service: { select: { id: true, name: true } },
        professional: {
          select: {
            id: true,
            businessName: true,
            location: true,
            timeZone: true,
          },
        },
      },
    })

    // buckets
    const upcoming: ClientBookingDTO[] = []
    const pending: ClientBookingDTO[] = []
    const prebooked: ClientBookingDTO[] = []
    const past: ClientBookingDTO[] = []

    for (const b of dtos) {
      const status = upper(b.status)
      const source = upper(b.source)

      if (status === 'COMPLETED' || status === 'CANCELLED') {
        past.push(b)
        continue
      }

      if (b.hasPendingConsultationApproval || status === 'PENDING') {
        pending.push(b)
        continue
      }

      const when = new Date(b.scheduledFor)
      const isFuture = when.getTime() >= now.getTime()
      const within30 = when.getTime() < next30.getTime()

      if (source === 'AFTERCARE' && isFuture) {
        prebooked.push(b)
        continue
      }

      if (status === 'ACCEPTED' && within30) {
        upcoming.push(b)
        continue
      }

      if (isFuture) upcoming.push(b)
      else past.push(b)
    }

    return NextResponse.json(
      {
        ok: true,
        buckets: { upcoming, pending, waitlist, prebooked, past },
        meta: { now: now.toISOString(), next30: next30.toISOString() },
      },
      { status: 200 },
    )
  } catch (e) {
    console.error('GET /api/client/bookings error:', e)
    return jsonFail(500, 'Failed to load client bookings.')
  }
}

export async function POST(_req: NextRequest) {
  return NextResponse.json(
    {
      ok: false,
      error: 'This endpoint has been deprecated.',
      hint: { correctEndpoint: 'POST /api/bookings' },
    },
    { status: 410 },
  )
}