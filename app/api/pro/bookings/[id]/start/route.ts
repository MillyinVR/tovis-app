import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

export async function POST(_request: Request, ctx: Ctx) {
  try {
    const { id } = await Promise.resolve(ctx.params)

    const user = await getCurrentUser()
    if (!user || user.role !== 'PRO' || !user.professionalProfile) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
    }

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: { professional: true },
    })

    if (!booking) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 })

    if (booking.professionalId !== user.professionalProfile.id) {
      return NextResponse.json({ error: 'You can only start your own bookings.' }, { status: 403 })
    }

    if (booking.finishedAt) {
      return NextResponse.json({ error: 'This session is already finished.' }, { status: 400 })
    }

    const now = new Date()

    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: {
        startedAt: booking.startedAt ?? now,
        status: booking.status === 'PENDING' ? 'ACCEPTED' : booking.status,
      },
    })

    return NextResponse.json(
      { id: updated.id, startedAt: updated.startedAt, status: updated.status },
      { status: 200 },
    )
  } catch (err) {
    console.error('Booking start error', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
