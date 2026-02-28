// app/api/bookings/[id]/cancel/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { pickString } from '@/app/api/_utils/pick'
import type { Role } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Params = { id: string }
type Ctx = { params: Params | Promise<Params> }

function isAdminRole(role: Role) {
  return role === 'ADMIN'
}

export async function POST(_req: Request, ctx: Ctx) {
  try {
    // ✅ logged-in + must be one of CLIENT/PRO/ADMIN
    const auth = await requireUser({ roles: ['CLIENT', 'PRO', 'ADMIN'] })
    if (!auth.ok) return auth.res
    const user = auth.user

    const { id } = await Promise.resolve(ctx.params)
    const bookingId = pickString(id)
    if (!bookingId) {
      return NextResponse.json({ ok: false, error: 'Missing booking id' }, { status: 400 })
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        status: true,
        clientId: true,
        professionalId: true,
      },
    })
    if (!booking) {
      return NextResponse.json({ ok: false, error: 'Booking not found' }, { status: 404 })
    }

    const clientId = user.clientProfile?.id ?? null
    const proId = user.professionalProfile?.id ?? null

    const isOwnerClient = Boolean(clientId && booking.clientId === clientId)
    const isOwnerPro = Boolean(proId && booking.professionalId === proId)
    const isAdmin = isAdminRole(user.role)

    // ✅ Must be admin OR owner (client/pro)
    if (!isAdmin && !isOwnerClient && !isOwnerPro) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
    }

    // ✅ business rules
    if (booking.status === 'COMPLETED') {
      return NextResponse.json(
        { ok: false, error: 'Completed bookings cannot be cancelled.' },
        { status: 409 },
      )
    }

    // ✅ idempotent success
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