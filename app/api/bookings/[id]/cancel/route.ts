// app/api/bookings/[id]/cancel/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { pickString } from '@/app/api/_utils/pick'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

function isAdmin(user: any) {
  return user?.role === 'ADMIN'
}

export async function POST(_req: Request, { params }: Ctx) {
  try {
    const { user, res } = await requireUser()
    if (res) return res

    const { id } = await Promise.resolve(params)
    const bookingId = pickString(id)
    if (!bookingId) return NextResponse.json({ ok: false, error: 'Missing booking id' }, { status: 400 })

    // only allow CLIENT/PRO/ADMIN to proceed
    const role = String(user?.role || '').toUpperCase()
    const allowedRole = role === 'CLIENT' || role === 'PRO' || role === 'ADMIN'
    if (!allowedRole) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })

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

    const clientId = user.clientProfile?.id ?? null
    const proId = user.professionalProfile?.id ?? null

    const isOwnerClient = Boolean(clientId && booking.clientId === clientId)
    const isOwnerPro = Boolean(proId && booking.professionalId === proId)

    if (!isAdmin(user) && !isOwnerClient && !isOwnerPro) {
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
