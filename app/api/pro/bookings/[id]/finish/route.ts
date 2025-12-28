// app/api/pro/bookings/[id]/finish/route.ts
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
      return NextResponse.json({ error: 'You can only finish your own bookings.' }, { status: 403 })
    }
    if (booking.status === 'CANCELLED') {
      return NextResponse.json({ error: 'Cancelled bookings cannot be finished.' }, { status: 409 })
    }
    if (!booking.startedAt) {
      return NextResponse.json({ error: 'Session has not been started yet.' }, { status: 409 })
    }
    if (booking.status === 'COMPLETED' || booking.finishedAt) {
      return NextResponse.json({ error: 'Session already finished.' }, { status: 409 })
    }

    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: { finishedAt: new Date(), status: 'COMPLETED', sessionStep: 'DONE' },
      select: { id: true, finishedAt: true, status: true, sessionStep: true },
    })

    return NextResponse.json(updated, { status: 200 })
  } catch (err) {
    console.error('Booking finish error', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
