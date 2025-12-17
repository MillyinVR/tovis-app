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
      return NextResponse.json({ error: 'You can only finish your own bookings.' }, { status: 403 })
    }

    if (!booking.startedAt) {
      return NextResponse.json({ error: 'Session has not been started yet.' }, { status: 400 })
    }

    if (booking.finishedAt) {
      return NextResponse.json({ error: 'Session already finished.' }, { status: 400 })
    }

    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: { finishedAt: new Date(), status: 'COMPLETED' },
    })

    return NextResponse.json(
      { id: updated.id, finishedAt: updated.finishedAt, status: updated.status },
      { status: 200 },
    )
  } catch (err) {
    console.error('Booking finish error', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
