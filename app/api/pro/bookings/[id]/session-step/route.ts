// app/api/pro/bookings/[id]/session-step/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { upper, ensureNotTerminal, ensureConsultApproved, getProOwnedBooking } from '@/lib/booking/guards'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status })
}

function asTrimmedString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

type Step =
  | 'CONSULTATION'
  | 'CONSULTATION_PENDING_CLIENT'
  | 'BEFORE_PHOTOS'
  | 'SERVICE_IN_PROGRESS'
  | 'FINISH_REVIEW'
  | 'AFTER_PHOTOS'
  | 'DONE'
  | 'NONE'
  | string

function requiresApprovedConsultation(step: Step) {
  const s = upper(step)
  return (
    s === 'BEFORE_PHOTOS' ||
    s === 'SERVICE_IN_PROGRESS' ||
    s === 'FINISH_REVIEW' ||
    s === 'AFTER_PHOTOS' ||
    s === 'DONE'
  )
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    // Auth
    const user = await getCurrentUser().catch(() => null)
    const proId = user?.role === 'PRO' ? user.professionalProfile?.id : null
    if (!proId) return jsonError('Not authorized', 401)

    // Params
    const { id } = await Promise.resolve(ctx.params)
    const bookingId = asTrimmedString(id)
    if (!bookingId) return jsonError('Missing booking id', 400)

    // Body
    const body = (await req.json().catch(() => ({}))) as { step?: unknown }
    const nextStep = upper(body.step) as Step
    if (!nextStep) return jsonError('Missing step', 400)

    // Load booking
    const owned = await getProOwnedBooking({
      bookingId,
      proId,
      select: {
        id: true,
        professionalId: true,
        status: true,
        finishedAt: true,
        startedAt: true,
        sessionStep: true,
        consultationApproval: { select: { status: true } },
      },
    })

    if (!owned.ok) return jsonError(owned.error, owned.status)

    const booking = owned.booking
    const st = upper(booking.status)

    // Terminal guard
    const nt = ensureNotTerminal({ status: booking.status, finishedAt: booking.finishedAt })
    if (!nt.ok) return jsonError(nt.error, 409)

    // Booking-status gate: PENDING => consultation only
    if (st === 'PENDING') {
      if (nextStep !== 'CONSULTATION' && nextStep !== 'NONE') {
        await prisma.booking.update({
          where: { id: booking.id },
          data: { sessionStep: 'CONSULTATION' as any },
          select: { id: true },
        })
        return NextResponse.json({ ok: true, forced: 'CONSULTATION' }, { status: 200 })
      }
    }

    // Consultation approval gate
    const appr = upper(booking.consultationApproval?.status)
    if (requiresApprovedConsultation(nextStep)) {
      const ca = ensureConsultApproved(appr)
      if (!ca.ok) {
        await prisma.booking.update({
          where: { id: booking.id },
          data: { sessionStep: 'CONSULTATION' as any },
          select: { id: true },
        })
        return jsonError(ca.error, 409)
      }
    }

    // If moving into SERVICE_IN_PROGRESS, optionally set startedAt
    const shouldSetStartedAt = nextStep === 'SERVICE_IN_PROGRESS' && !booking.startedAt

    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: {
        sessionStep: nextStep as any,
        ...(shouldSetStartedAt ? { startedAt: new Date() } : {}),
      },
      select: { id: true, status: true, sessionStep: true, startedAt: true },
    })

    return NextResponse.json({ ok: true, booking: updated }, { status: 200 })
  } catch (e) {
    console.error('POST /api/pro/bookings/[id]/session-step error', e)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
