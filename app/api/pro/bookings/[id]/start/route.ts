// app/api/pro/bookings/[id]/start/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

export async function POST(_request: Request, ctx: Ctx) {
  try {
    const { id } = await Promise.resolve(ctx.params)
    if (!id?.trim()) return NextResponse.json({ error: 'Missing booking id.' }, { status: 400 })

    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
    }

    const booking = await prisma.booking.findUnique({
      where: { id },
      select: {
        id: true,
        professionalId: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        sessionStep: true,
      },
    })

    if (!booking) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 })
    if (booking.professionalId !== user.professionalProfile.id) {
      return NextResponse.json({ error: 'You can only start your own bookings.' }, { status: 403 })
    }

    if (booking.status === 'CANCELLED') {
      return NextResponse.json({ error: 'Cancelled bookings cannot be started.' }, { status: 409 })
    }

    if (booking.status === 'COMPLETED' || booking.finishedAt) {
      return NextResponse.json({ error: 'This session is already finished.' }, { status: 409 })
    }

    const now = new Date()

    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: {
        startedAt: booking.startedAt ?? now,
        status: booking.status === 'PENDING' ? 'ACCEPTED' : booking.status,
        // ✅ Start always begins the session wizard at consultation
        sessionStep: booking.sessionStep === 'NONE' ? 'CONSULTATION' : booking.sessionStep,
      },
      select: { id: true, startedAt: true, status: true, sessionStep: true },
    })

    return NextResponse.json(updated, { status: 200 })
  } catch (err) {
    console.error('Booking start error', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
