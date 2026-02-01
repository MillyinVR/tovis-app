// app/api/client/bookings/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

import { requireClient } from '@/app/api/_utils/auth/requireClient'
import { upper } from '@/app/api/_utils/strings'
import { jsonFail } from '@/app/api/_utils/responses'

import { buildClientBookingDTO } from '@/lib/dto/clientBooking'

export const dynamic = 'force-dynamic'

function addDays(date: Date, days: number) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

/**
 * Consultation approval gate:
 * If approval is pending, and booking isn't final, and session step indicates consult phase,
 * then client needs to approve/reject.
 */
function needsConsultationApproval(b: {
  status: unknown
  sessionStep: unknown
  finishedAt: Date | null
  consultationApproval?: { status: unknown } | null
}) {
  const approval = upper(b.consultationApproval?.status)
  if (approval !== 'PENDING') return false

  const status = upper(b.status)
  if (status === 'CANCELLED' || status === 'COMPLETED') return false
  if (b.finishedAt) return false

  const step = upper(b.sessionStep)
  return step === 'CONSULTATION_PENDING_CLIENT' || step === 'CONSULTATION' || !step || step === 'NONE'
}

export async function GET() {
  try {
    const { clientId, res } = await requireClient()
    if (res) return res

    const now = new Date()
    const next30 = addDays(now, 30)

    // 1) Load bookings (schema-aligned selects)
    const bookings = await prisma.booking.findMany({
      where: { clientId },
      orderBy: { scheduledFor: 'asc' },
      take: 300,
      select: {
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

        serviceItems: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
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
      },
    })

    // 2) Unread aftercare notifications (badge support)
    const unread = await prisma.clientNotification.findMany({
      where: {
        clientId,
        type: 'AFTERCARE',
        readAt: null,
        bookingId: { not: null },
      } as any,
      select: { bookingId: true },
      take: 1000,
    })

    const unreadBookingIds = new Set(
      unread
        .map((n: { bookingId: string | null }) => (typeof n.bookingId === 'string' ? n.bookingId : null))
        .filter((x): x is string => Boolean(x)),
    )

    // 3) Build DTOs (single source of truth) ✅ MUST await because buildClientBookingDTO is async now
    const dtos = await Promise.all(
      bookings.map(async (b) => {
        const hasPending = needsConsultationApproval(b)
        const unreadAftercare = unreadBookingIds.has(b.id)

        return await buildClientBookingDTO({
          booking: b as any,
          unreadAftercare,
          hasPendingConsultationApproval: hasPending,
        })
      }),
    )

    // 4) Waitlist (schema-aligned selects)
    // Note: WaitlistEntry.professional is ProfessionalProfile (no city/state).
    let waitlist: any[] = []
    try {
      waitlist = await prisma.waitlistEntry.findMany({
        where: { clientId, status: 'ACTIVE' },
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
    } catch (e) {
      console.error('GET /api/client/bookings waitlist error:', e)
      waitlist = []
    }

    // 5) Bucket bookings
    const upcoming: any[] = []
    const pending: any[] = []
    const prebooked: any[] = []
    const past: any[] = []

    for (const b of dtos) {
      const when = new Date(b.scheduledFor)
      const isFuture = when.getTime() >= now.getTime()
      const within30 = when.getTime() < next30.getTime()

      const status = upper(b.status)
      const source = upper(b.source)

      if (!isFuture || status === 'COMPLETED' || status === 'CANCELLED') {
        past.push(b)
        continue
      }

      if (b.hasPendingConsultationApproval || status === 'PENDING') {
        pending.push(b)
        continue
      }

      if (source === 'AFTERCARE' && isFuture) {
        prebooked.push(b)
        continue
      }

      if (status === 'ACCEPTED' && within30) {
        upcoming.push(b)
        continue
      }

      // default: keep future accepted beyond 30 days as upcoming too
      upcoming.push(b)
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

/**
 * POST: deprecated — use POST /api/bookings
 */
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
