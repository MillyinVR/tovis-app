// app/api/client/bookings/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

function addDays(date: Date, days: number) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function upper(v: unknown) {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

function decimalToString(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'string') return v
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v === 'object' && v && typeof (v as any).toString === 'function') return (v as any).toString()
  return null
}

function moneyNumber(v: unknown): number | null {
  if (v == null) return null
  const s = typeof v === 'string' ? v : typeof v === 'number' ? String(v) : String((v as any)?.toString?.() ?? '')
  const n = Number(String(s).replace(/[^0-9.]/g, ''))
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100) / 100
}

type BookingRow = {
  id: string
  status: string | null
  source: string | null
  sessionStep: string | null
  scheduledFor: Date
  durationMinutesSnapshot: number | null
  priceSnapshot: unknown

  consultationNotes: string | null
  consultationPrice: unknown
  consultationConfirmedAt: Date | null

  service: { id: string; name: string } | null
  professional: {
    id: string
    businessName: string | null
    location: string | null
    city: string | null
    state: string | null
  } | null

  consultationApproval: {
    status: string
    proposedServicesJson: unknown
    proposedTotal: unknown
    notes: string | null
    approvedAt: Date | null
    rejectedAt: Date | null
  } | null
}

type BookingOut = {
  id: string
  status: string | null
  source: string | null
  sessionStep: string | null
  scheduledFor: string
  durationMinutesSnapshot: number | null
  priceSnapshot: unknown
  service: { id: string; name: string } | null
  professional: {
    id: string
    businessName: string | null
    location: string | null
    city: string | null
    state: string | null
  } | null

  hasUnreadAftercare: boolean
  hasPendingConsultationApproval: boolean

  consultation: null | {
    consultationNotes: string | null
    consultationPrice: string | null
    consultationConfirmedAt: string | null

    approvalStatus: string | null
    approvalNotes: string | null
    proposedTotal: string | null
    proposedServicesJson: unknown
    approvedAt: string | null
    rejectedAt: string | null
  }
}

function needsConsultationApproval(b: BookingRow) {
  const approval = upper(b.consultationApproval?.status)
  if (approval !== 'PENDING') return false

  const status = upper(b.status)
  if (status === 'CANCELLED' || status === 'COMPLETED') return false

  const step = upper(b.sessionStep)
  return step === 'CONSULTATION_PENDING_CLIENT' || step === 'CONSULTATION' || !step
}

export async function GET() {
  try {
    const user = await getCurrentUser().catch(() => null)
    const clientId = user?.role === 'CLIENT' ? user.clientProfile?.id : null
    if (!clientId) return NextResponse.json({ ok: false, error: 'Only clients can view bookings.' }, { status: 401 })

    const now = new Date()
    const next30 = addDays(now, 30)

    const bookings = (await prisma.booking.findMany({
      where: { clientId },
      orderBy: { scheduledFor: 'asc' },
      take: 300,
      select: {
        id: true,
        status: true,
        source: true,
        sessionStep: true,
        scheduledFor: true,
        durationMinutesSnapshot: true,
        priceSnapshot: true,

        consultationNotes: true,
        consultationPrice: true,
        consultationConfirmedAt: true,

        service: { select: { id: true, name: true } },
        professional: { select: { id: true, businessName: true, location: true, city: true, state: true } },

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
    })) as BookingRow[]

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

    const out: BookingOut[] = bookings.map((b) => {
      const hasPending = needsConsultationApproval(b)

      const approvalStatus = upper(b.consultationApproval?.status)
      const approvedTotalNum = approvalStatus === 'APPROVED' ? moneyNumber(b.consultationApproval?.proposedTotal) : null

      // ✅ Critical: if consult is approved, show that price everywhere in client dashboards/cards
      const effectivePriceSnapshot = approvedTotalNum != null ? approvedTotalNum : b.priceSnapshot

      const shouldSendConsultationBlob =
        Boolean(b.consultationApproval) || Boolean(b.consultationNotes) || b.consultationPrice != null

      return {
        id: b.id,
        status: b.status,
        source: b.source,
        sessionStep: b.sessionStep,

        scheduledFor: b.scheduledFor.toISOString(),
        durationMinutesSnapshot: b.durationMinutesSnapshot,
        priceSnapshot: effectivePriceSnapshot,

        service: b.service,
        professional: b.professional,

        hasUnreadAftercare: unreadBookingIds.has(b.id),
        hasPendingConsultationApproval: hasPending,

        consultation: shouldSendConsultationBlob
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

    // waitlist (leave as-is)
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
          professional: { select: { id: true, businessName: true, location: true, city: true, state: true } },
        },
      })
    } catch (e) {
      console.error('GET /api/client/bookings waitlist error:', e)
      waitlist = []
    }

    const upcoming: BookingOut[] = []
    const pending: BookingOut[] = []
    const prebooked: BookingOut[] = []
    const past: BookingOut[] = []

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

      if (b.hasPendingConsultationApproval) {
        pending.push(b)
        continue
      }

      if (status === 'PENDING') {
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
    return NextResponse.json({ ok: false, error: 'Failed to load client bookings.' }, { status: 500 })
  }
}

