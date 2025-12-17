// app/api/pro/session/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export async function GET() {
  try {
    const user = await getCurrentUser()

    if (!user || user.role !== 'PRO' || !user.professionalProfile) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const proId = user.professionalProfile.id
    const now = new Date()

    // 1) Active session wins: startedAt set, finishedAt null
    // Keep status safety tight: PENDING/ACCEPTED only.
    const active = await prisma.booking.findFirst({
      where: {
        professionalId: proId,
        startedAt: { not: null },
        finishedAt: null,
        status: { in: ['PENDING', 'ACCEPTED'] },
      },
      include: {
        client: true,
        service: true,
      },
      orderBy: { startedAt: 'desc' },
    })

    if (active) {
      return NextResponse.json({
        mode: 'ACTIVE',
        booking: {
          id: active.id,
          status: active.status,
          serviceName: active.service.name,
          clientName: `${active.client.firstName ?? ''} ${active.client.lastName ?? ''}`.trim(),
          scheduledFor: active.scheduledFor?.toISOString?.() ?? active.scheduledFor,
          startedAt: active.startedAt?.toISOString?.() ?? active.startedAt,
          finishedAt: active.finishedAt,
        },
      })
    }

    // 2) Otherwise: next upcoming within a window (30 min before -> 3 hours after)
    const WINDOW_BEFORE_MIN = 30
    const WINDOW_AFTER_HOURS = 3

    const windowStart = new Date(now.getTime() - WINDOW_BEFORE_MIN * 60 * 1000)
    const windowEnd = new Date(now.getTime() + WINDOW_AFTER_HOURS * 60 * 60 * 1000)

    const next = await prisma.booking.findFirst({
      where: {
        professionalId: proId,
        status: { in: ['PENDING', 'ACCEPTED'] },
        startedAt: null, // important: don't call started sessions "upcoming"
        finishedAt: null,
        scheduledFor: { gte: windowStart, lte: windowEnd },
      },
      include: {
        client: true,
        service: true,
      },
      orderBy: { scheduledFor: 'asc' },
    })

    if (next) {
      return NextResponse.json({
        mode: 'UPCOMING',
        booking: {
          id: next.id,
          status: next.status,
          serviceName: next.service.name,
          clientName: `${next.client.firstName ?? ''} ${next.client.lastName ?? ''}`.trim(),
          scheduledFor: next.scheduledFor?.toISOString?.() ?? next.scheduledFor,
          startedAt: next.startedAt,
          finishedAt: next.finishedAt,
        },
      })
    }

    return NextResponse.json({ mode: 'IDLE', booking: null })
  } catch (e) {
    console.error('GET /api/pro/session error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
