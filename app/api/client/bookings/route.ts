// app/api/client/bookings/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

import { requireClient } from '@/app/api/_utils/auth/requireClient'
import { upper } from '@/app/api/_utils/strings'
import { jsonFail } from '@/app/api/_utils/responses'

export const dynamic = 'force-dynamic'

function addDays(date: Date, days: number) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function decimalToString(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'string') return v
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v === 'object' && v && typeof (v as any).toString === 'function') return (v as any).toString()
  return null
}

function pickFormattedAddress(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null
  const v = (snapshot as any)?.formattedAddress
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

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
  return step === 'CONSULTATION_PENDING_CLIENT' || step === 'CONSULTATION' || !step
}

export async function GET() {
  try {
    const { clientId, res } = await requireClient()
    if (res) return res

    const now = new Date()
    const next30 = addDays(now, 30)

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

        // Option B truth
        subtotalSnapshot: true,
        totalDurationMinutes: true,
        bufferMinutes: true,

        // location truth
        locationType: true,
        locationId: true,
        locationTimeZone: true,
        locationAddressSnapshot: true,

        service: { select: { id: true, name: true } },
        professional: { select: { id: true, businessName: true, location: true } },

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

    const out = bookings.map((b) => {
      const hasPending = needsConsultationApproval(b)

      const locationLabel =
        pickFormattedAddress(b.locationAddressSnapshot) ||
        (typeof b.professional?.location === 'string' && b.professional.location.trim()
          ? b.professional.location.trim()
          : null)

      const consultBlobNeeded =
        Boolean(b.consultationApproval) || Boolean(b.consultationNotes) || b.consultationPrice != null

      return {
        id: b.id,
        status: b.status,
        source: b.source,
        sessionStep: b.sessionStep,

        scheduledFor: b.scheduledFor.toISOString(),
        totalDurationMinutes: b.totalDurationMinutes ?? 0,
        bufferMinutes: b.bufferMinutes ?? 0,
        subtotalSnapshot: b.subtotalSnapshot ?? null,

        locationType: b.locationType,
        locationId: b.locationId,
        locationTimeZone: b.locationTimeZone ?? null,
        locationLabel,

        service: b.service,
        professional: b.professional,

        hasUnreadAftercare: unreadBookingIds.has(b.id),
        hasPendingConsultationApproval: hasPending,

        consultation: consultBlobNeeded
          ? {
              consultationNotes: b.consultationNotes ?? null,
              consultationPrice: decimalToString(b.consultationPrice),
              consultationConfirmedAt: b.consultationConfirmedAt ? b.consultationConfirmedAt.toISOString() : null,

              approvalStatus: b.consultationApproval?.status ?? null,
              approvalNotes: b.consultationApproval?.notes ?? null,
              proposedTotal: decimalToString(b.consultationApproval?.proposedTotal),
              proposedServicesJson: b.consultationApproval?.proposedServicesJson ?? null,
              approvedAt: b.consultationApproval?.approvedAt ? b.consultationApproval.approvedAt.toISOString() : null,
              rejectedAt: b.consultationApproval?.rejectedAt ? b.consultationApproval.rejectedAt.toISOString() : null,
            }
          : null,
      }
    })

    // waitlist (keep minimal pro fields)
    let waitlist: any[] = []
    try {
      waitlist = await prisma.waitlistEntry.findMany({
        where: { clientId, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: {
          id: true,
          createdAt: true,
          serviceId: true,
          professionalId: true,
          notes: true,
          preferredStart: true,
          preferredEnd: true,
          preferredTimeBucket: true,
          status: true,
          mediaId: true,
          service: { select: { id: true, name: true } },
          professional: { select: { id: true, businessName: true, location: true } },
        },
      })
    } catch (e) {
      console.error('GET /api/client/bookings waitlist error:', e)
      waitlist = []
    }

    const upcoming: any[] = []
    const pending: any[] = []
    const prebooked: any[] = []
    const past: any[] = []

    for (const b of out) {
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
