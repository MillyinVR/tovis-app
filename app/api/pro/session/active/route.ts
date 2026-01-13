// app/api/pro/session/active/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const professionalId = user.professionalProfile.id

  // 1) active session first (started, not finished)
  const active = await prisma.booking.findFirst({
    where: {
      professionalId,
      startedAt: { not: null },
      finishedAt: null,
      status: 'ACCEPTED',
    },
    include: {
      client: true,
      service: true,
    },
    orderBy: { scheduledFor: 'asc' },
  })

  if (active) {
    return NextResponse.json({
      mode: 'active',
      booking: {
        id: active.id,
        scheduledFor: active.scheduledFor,
        clientName: `${active.client.firstName} ${active.client.lastName}`.trim(),
        serviceName: active.service?.name ?? 'Appointment',
      },
    })
  }

  // 2) otherwise, find the next upcoming within 60 minutes
  // IMPORTANT: PENDING is NOT startable. Only ACCEPTED should appear here.
  const now = new Date()
  const inOneHour = new Date(now.getTime() + 60 * 60 * 1000)

  const next = await prisma.booking.findFirst({
    where: {
      professionalId,
      status: 'ACCEPTED',
      startedAt: null,
      finishedAt: null,
      scheduledFor: {
        gte: now,
        lte: inOneHour,
      },
    },
    include: {
      client: true,
      service: true,
    },
    orderBy: { scheduledFor: 'asc' },
  })

  if (!next) {
    return NextResponse.json({ mode: 'idle', booking: null })
  }

  return NextResponse.json({
    mode: 'upcoming',
    booking: {
      id: next.id,
      scheduledFor: next.scheduledFor,
      clientName: `${next.client.firstName} ${next.client.lastName}`.trim(),
      serviceName: next.service?.name ?? 'Appointment',
    },
  })
}
