// app/api/client/bookings/[id]/consultation/approve/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { ConsultationApprovalStatus, SessionStep, BookingStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

function pickString(v: unknown) {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function snap5(n: number) {
  const x = Math.round(n / 5) * 5
  return x < 0 ? 0 : x
}

function moneyStringToCents(raw: string): number {
  // Accept: "123", "123.4", "123.45", "$1,234.50"
  const cleaned = raw.replace(/\$/g, '').replace(/,/g, '').trim()
  if (!cleaned) return 0
  const m = /^(\d+)(?:\.(\d{0,}))?$/.exec(cleaned)
  if (!m) return 0
  const whole = m[1] || '0'
  let frac = (m[2] || '').slice(0, 2)
  while (frac.length < 2) frac += '0'
  const cents = Number(whole) * 100 + Number(frac || '0')
  return Number.isFinite(cents) ? Math.max(0, cents) : 0
}

function moneyToCents(v: unknown): number {
  if (v == null) return 0
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return 0
    return Math.max(0, Math.round(v * 100))
  }
  if (typeof v === 'string') return moneyStringToCents(v)
  const s = (v as any)?.toString?.()
  if (typeof s === 'string') return moneyStringToCents(s)
  return 0
}

function centsToMoneyString(cents: number): string {
  const c = Math.max(0, Math.trunc(cents))
  const dollars = Math.trunc(c / 100)
  const rem = c % 100
  return `${dollars}.${String(rem).padStart(2, '0')}`
}

type ProposedItem = {
  serviceId?: string
  offeringId?: string | null
  label?: string
  categoryName?: string | null
  price?: unknown
  durationMinutes?: unknown
  notes?: string | null
}

function parseProposedItems(proposedServicesJson: unknown): ProposedItem[] {
  const j: any = proposedServicesJson
  const items = Array.isArray(j?.items) ? j.items : []
  return items
    .map((it: any) => ({
      serviceId: typeof it?.serviceId === 'string' ? it.serviceId.trim() : undefined,
      offeringId: typeof it?.offeringId === 'string' ? it.offeringId.trim() : null,
      label: typeof it?.label === 'string' ? it.label : undefined,
      categoryName: typeof it?.categoryName === 'string' ? it.categoryName : null,
      price: it?.price,
      durationMinutes: it?.durationMinutes,
      notes: typeof it?.notes === 'string' ? it.notes : null,
    }))
    .filter((it: ProposedItem) => Boolean(it.serviceId))
}

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
    }

    const { id } = await Promise.resolve(ctx.params)
    const bookingId = pickString(id)
    if (!bookingId) return NextResponse.json({ error: 'Missing booking id.' }, { status: 400 })

    const clientId = user.clientProfile.id

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        clientId: true,
        professionalId: true,
        status: true,
        sessionStep: true,
        finishedAt: true,
        locationType: true,

        // consultation approval
        consultationApproval: {
          select: { id: true, status: true, proposedTotal: true, proposedServicesJson: true, notes: true },
        },
      },
    })

    if (!booking) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 })
    if (booking.clientId !== clientId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    if (booking.status === BookingStatus.CANCELLED) {
      return NextResponse.json({ error: 'This booking is cancelled.' }, { status: 409 })
    }
    if (booking.status === BookingStatus.COMPLETED || booking.finishedAt) {
      return NextResponse.json({ error: 'This booking is completed.' }, { status: 409 })
    }

    const approvalRec = booking.consultationApproval
    if (!approvalRec?.id) return NextResponse.json({ error: 'Missing consultation approval record.' }, { status: 409 })
    if (approvalRec.status !== ConsultationApprovalStatus.PENDING) {
      return NextResponse.json({ error: 'This consultation is not pending.' }, { status: 409 })
    }

    // Must be in a state where approval makes sense
    if (
      booking.sessionStep !== SessionStep.CONSULTATION_PENDING_CLIENT &&
      booking.sessionStep !== SessionStep.CONSULTATION
    ) {
      return NextResponse.json({ error: 'No consultation approval is pending for this booking.' }, { status: 409 })
    }

    const proposedItems = parseProposedItems(approvalRec.proposedServicesJson)
    if (!proposedItems.length) {
      return NextResponse.json({ error: 'Proposed services are missing or invalid.' }, { status: 409 })
    }

    const proposedTotalCents = moneyToCents(approvalRec.proposedTotal)
    if (!proposedTotalCents || proposedTotalCents <= 0) {
      return NextResponse.json({ error: 'Proposed total is missing or invalid.' }, { status: 409 })
    }

    const now = new Date()

    const result = await prisma.$transaction(async (tx) => {
      // Validate offerings belong to this pro + build service item snapshots
      const serviceIds = Array.from(new Set(proposedItems.map((i) => i.serviceId!).filter(Boolean))).slice(0, 10)

      const offerings = await tx.professionalServiceOffering.findMany({
        where: {
          professionalId: booking.professionalId,
          serviceId: { in: serviceIds },
          isActive: true,
        },
        select: {
          id: true,
          serviceId: true,
          // keep in case you want to validate duration or fill defaults
          salonDurationMinutes: true,
          mobileDurationMinutes: true,
        },
        take: 50,
      })

      const offeringByServiceId = new Map<string, string>()
      const offeringIdsSet = new Set<string>()
      for (const o of offerings) {
        offeringByServiceId.set(o.serviceId, o.id)
        offeringIdsSet.add(o.id)
      }

      // If an item supplies offeringId, ensure it belongs to the pro. Otherwise select by serviceId.
      const normalizedItems = proposedItems.map((it, idx) => {
        const serviceId = it.serviceId!.trim()
        const offeringId =
          it.offeringId && offeringIdsSet.has(it.offeringId)
            ? it.offeringId
            : offeringByServiceId.get(serviceId) || null

        if (!offeringId) {
          throw new Error('One or more proposed services are not available for this professional.')
        }

        const cents = moneyToCents(it.price)
        // duration: require something reasonable; default to 60 if missing
        const durRaw = Number(it.durationMinutes ?? 60)
        const dur = clamp(snap5(Number.isFinite(durRaw) ? durRaw : 60), 5, 12 * 60)

        return {
          serviceId,
          offeringId,
          priceCents: cents,
          durationMinutes: dur,
          sortOrder: idx,
          notes: it.notes ?? null,
        }
      })

      // Sum up cents and durations
      const subtotalCents = normalizedItems.reduce((sum, i) => sum + i.priceCents, 0)
      const totalDurationMinutes = normalizedItems.reduce((sum, i) => sum + i.durationMinutes, 0)

      // Sanity: proposedTotal should match subtotal within reason.
      // Don’t block it if you plan to support tax/tip later, but also don’t let it be wildly off.
      const diff = Math.abs(proposedTotalCents - subtotalCents)
      const allowedDiff = 500 // $5.00 wiggle room (rounding/human error)
      if (diff > allowedDiff) {
        // If you later add tax/discount fields, adjust this logic.
        throw new Error('Proposed total does not match the sum of proposed services.')
      }

      // Delete old serviceItems, then recreate from proposal
      await tx.bookingServiceItem.deleteMany({ where: { bookingId: booking.id } })

      await tx.bookingServiceItem.createMany({
        data: normalizedItems.map((i) => ({
          bookingId: booking.id,
          serviceId: i.serviceId,
          offeringId: i.offeringId,
          priceSnapshot: centsToMoneyString(i.priceCents) as any,
          durationMinutesSnapshot: i.durationMinutes,
          sortOrder: i.sortOrder,
          notes: i.notes,
        })),
      })

      // Approve record
      const approval = await tx.consultationApproval.update({
        where: { id: approvalRec.id },
        data: {
          status: ConsultationApprovalStatus.APPROVED,
          approvedAt: now,
          rejectedAt: null,
          clientId,
          proId: booking.professionalId,
        },
        select: { id: true, status: true, approvedAt: true, rejectedAt: true },
      })

      const first = normalizedItems[0]

      // Update booking canonical snapshots (Option B + legacy)
      const updatedBooking = await tx.booking.update({
        where: { id: booking.id },
        data: {
          // session progression
          sessionStep: SessionStep.BEFORE_PHOTOS,
          consultationConfirmedAt: now,

          // ✅ Option B truth
          subtotalSnapshot: centsToMoneyString(subtotalCents) as any,
          totalDurationMinutes,

          // ✅ Legacy: keep old UI from lying
          serviceId: first.serviceId,
          offeringId: first.offeringId,
          durationMinutesSnapshot: first.durationMinutes,
          priceSnapshot: centsToMoneyString(proposedTotalCents) as any,

          // If you want totalAmount to remain meaningful until you implement taxes/tips:
          totalAmount: centsToMoneyString(proposedTotalCents) as any,

          // Stop using these “consultation price note” fields as a display mechanism.
          consultationPrice: null,

          status: booking.status === BookingStatus.PENDING ? BookingStatus.ACCEPTED : booking.status,
        } as any,
        select: { id: true, sessionStep: true, status: true },
      })

      // optional: notify pro
      try {
        await tx.clientNotification.create({
          data: {
            clientId,
            type: 'BOOKING' as any,
            title: 'Consultation approved',
            body: 'You approved the updated services and pricing.',
            bookingId: booking.id,
            dedupeKey: `CONSULTATION_APPROVED:${booking.id}:${now.toISOString()}`,
          } as any,
        })
      } catch {
        // don’t fail approval over a notification
      }

      return { approval, booking: updatedBooking }
    })

    return NextResponse.json({ ok: true, approval: result.approval, booking: result.booking }, { status: 200 })
  } catch (e: any) {
    console.error('POST /api/client/bookings/[id]/consultation/approve error', e)
    const msg = typeof e?.message === 'string' && e.message.trim() ? e.message : 'Internal server error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
