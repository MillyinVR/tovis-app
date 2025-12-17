// app/api/pro/session/active/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export async function GET() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db: any = prisma

  // 1) active session first
  const active = await db.booking.findFirst({
    where: {
      professionalId: user.professionalProfile.id,
      startedAt: { not: null },
      finishedAt: null,
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
        clientName: `${active.client.firstName} ${active.client.lastName}`,
        serviceName: active.service.name,
      },
    })
  }

  // 2) otherwise, find the next upcoming within, say, 60 minutes
  const now = new Date()
  const inOneHour = new Date(now.getTime() + 60 * 60 * 1000)

  const next = await db.booking.findFirst({
    where: {
      professionalId: user.professionalProfile.id,
      status: { in: ['PENDING', 'ACCEPTED'] },
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
      clientName: `${next.client.firstName} ${next.client.lastName}`,
      serviceName: next.service.name,
    },
  })
}
