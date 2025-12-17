import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

type ActionStatus = 'ACCEPTED' | 'COMPLETED' | 'CANCELLED'

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await ctx.params
  const body = await req.json().catch(() => ({}))
  const nextStatus = String(body?.status || '') as ActionStatus

  if (!id) return NextResponse.json({ error: 'Missing booking id' }, { status: 400 })
  if (!['ACCEPTED', 'COMPLETED', 'CANCELLED'].includes(nextStatus)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  const booking = await prisma.booking.findUnique({
    where: { id },
    select: { id: true, professionalId: true, status: true },
  })

  if (!booking) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (booking.professionalId !== user.professionalProfile.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // basic guardrails so we don’t do cursed transitions
  const current = booking.status
  if (current === 'COMPLETED' || current === 'CANCELLED') {
    return NextResponse.json({ error: 'Booking is already finalized' }, { status: 400 })
  }
  if (nextStatus === 'COMPLETED' && current !== 'ACCEPTED') {
    return NextResponse.json({ error: 'Only ACCEPTED bookings can be completed' }, { status: 400 })
  }
  if (nextStatus === 'ACCEPTED' && current !== 'PENDING') {
    return NextResponse.json({ error: 'Only PENDING bookings can be accepted' }, { status: 400 })
  }

  const now = new Date()

  const updated = await prisma.booking.update({
    where: { id },
    data: {
      status: nextStatus,
      startedAt: nextStatus === 'ACCEPTED' ? (now) : undefined,
      finishedAt: nextStatus === 'COMPLETED' ? (now) : undefined,
    },
    select: { id: true, status: true },
  })

  return NextResponse.json({ id: updated.id, status: updated.status })
}
