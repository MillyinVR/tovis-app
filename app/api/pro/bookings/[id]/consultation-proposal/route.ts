// app/api/pro/bookings/[id]/consultation-proposal/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

function pickString(v: unknown) {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function pickOptionalString(v: unknown) {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function moneyStringToCents(raw: string): number {
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

function parseMoneyToCents(v: unknown): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 0) return null
    return Math.round(v * 100)
  }
  if (typeof v === 'string') {
    const cents = moneyStringToCents(v)
    return cents >= 0 ? cents : null
  }
  const s = (v as any)?.toString?.()
  if (typeof s === 'string') return moneyStringToCents(s)
  return null
}

function centsToMoneyString(cents: number): string {
  const c = Math.max(0, Math.trunc(cents))
  const dollars = Math.trunc(c / 100)
  const rem = c % 100
  return `${dollars}.${String(rem).padStart(2, '0')}`
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
    }

    const { id } = await Promise.resolve(ctx.params)
    const bookingId = pickString(id)
    if (!bookingId) return NextResponse.json({ error: 'Missing booking id.' }, { status: 400 })

    const body = (await req.json().catch(() => ({}))) as {
      proposedServicesJson?: unknown
      proposedTotal?: unknown
      notes?: unknown
    }

    if (!body?.proposedServicesJson || typeof body.proposedServicesJson !== 'object') {
      return NextResponse.json({ error: 'Missing proposed services.' }, { status: 400 })
    }

    const proposedCents = parseMoneyToCents(body.proposedTotal)
    if (proposedCents == null) return NextResponse.json({ error: 'Enter a valid total.' }, { status: 400 })

    const notes = pickOptionalString(body.notes)

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        professionalId: true,
        clientId: true,
        status: true,
        finishedAt: true,
      },
    })

    if (!booking) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 })
    if (booking.professionalId !== user.professionalProfile.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (booking.status === 'CANCELLED' || booking.status === 'COMPLETED' || booking.finishedAt) {
      return NextResponse.json({ error: 'This booking is finalized.' }, { status: 409 })
    }

    const proposedTotalMoney = centsToMoneyString(proposedCents)

    const result = await prisma.$transaction(async (tx) => {
      const approval = await tx.consultationApproval.upsert({
        where: { bookingId: booking.id },
        create: {
          bookingId: booking.id,
          clientId: booking.clientId,
          proId: booking.professionalId,
          status: 'PENDING',
          proposedServicesJson: body.proposedServicesJson as any,
          proposedTotal: proposedTotalMoney as any, // Decimal string
          notes: notes || null,
          approvedAt: null,
          rejectedAt: null,
        },
        update: {
          status: 'PENDING',
          proposedServicesJson: body.proposedServicesJson as any,
          proposedTotal: proposedTotalMoney as any,
          notes: notes || null,
          approvedAt: null,
          rejectedAt: null,
        },
        select: {
          id: true,
          status: true,
          proposedTotal: true,
          updatedAt: true,
        },
      })

      const updatedBooking = await tx.booking.update({
        where: { id: booking.id },
        data: {
          sessionStep: 'CONSULTATION_PENDING_CLIENT' as any,
          // ❌ Do NOT write consultationPrice/consultationNotes here.
          // Those were causing the “price as a note” confusion.
        },
        select: { id: true, sessionStep: true },
      })

      // Notify client (optional but recommended)
      try {
        await tx.clientNotification.create({
          data: {
            clientId: booking.clientId,
            type: 'BOOKING' as any,
            title: 'Consultation proposal ready',
            body: 'Your professional sent an updated service total for approval.',
            bookingId: booking.id,
            dedupeKey: `CONSULTATION_PROPOSED:${booking.id}:${approval.updatedAt.toISOString()}`,
          } as any,
        })
      } catch (e) {
        console.error('Client notification failed (consultation proposal):', e)
      }

      return { approval, sessionStep: updatedBooking.sessionStep, proposedCents }
    })

    return NextResponse.json(
      {
        ok: true,
        approval: result.approval,
        sessionStep: result.sessionStep,
        proposedCents: result.proposedCents,
      },
      { status: 200 },
    )
  } catch (e) {
    console.error('POST /api/pro/bookings/[id]/consultation-proposal error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
