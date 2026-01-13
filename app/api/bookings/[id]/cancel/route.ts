// app/api/bookings/[id]/cancel/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

function pickString(v: unknown) {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function canBypassOwnership(user: any) {
  return user?.role === 'ADMIN'
}

export async function POST(_req: Request, { params }: Ctx) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const { id } = await Promise.resolve(params)
    const bookingId = pickString(id)
    if (!bookingId) return NextResponse.json({ ok: false, error: 'Missing booking id' }, { status: 400 })

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        status: true,
        clientId: true,
        professionalId: true,
      },
    })
    if (!booking) return NextResponse.json({ ok: false, error: 'Booking not found' }, { status: 404 })

    const isClient = user.role === 'CLIENT' && !!user.clientProfile?.id
    const isPro = user.role === 'PRO' && !!user.professionalProfile?.id

    const clientId = user.clientProfile?.id ?? null
    const proId = user.professionalProfile?.id ?? null

    const isOwnerClient = Boolean(clientId && booking.clientId === clientId)
    const isOwnerPro = Boolean(proId && booking.professionalId === proId)

    if (!canBypassOwnership(user) && !isOwnerClient && !isOwnerPro) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
    }

    if (!isClient && !isPro && !canBypassOwnership(user)) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
    }

    if (booking.status === 'COMPLETED') {
      return NextResponse.json({ ok: false, error: 'Completed bookings cannot be cancelled.' }, { status: 409 })
    }

    if (booking.status === 'CANCELLED') {
      return NextResponse.json({ ok: true, id: booking.id, status: booking.status }, { status: 200 })
    }

    const updated = await prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: 'CANCELLED',
        sessionStep: 'NONE' as any,
        startedAt: null,
        finishedAt: null,
      } as any,
      select: { id: true, status: true },
    })

    return NextResponse.json({ ok: true, id: updated.id, status: updated.status }, { status: 200 })
  } catch (e) {
    console.error('POST /api/bookings/[id]/cancel error', e)
    return NextResponse.json({ ok: false, error: 'Failed to cancel booking.' }, { status: 500 })
  }
}
