// app/api/pro/session/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

function fullName(first?: string | null, last?: string | null) {
  return `${first ?? ''} ${last ?? ''}`.trim()
}

type Mode = 'IDLE' | 'UPCOMING' | 'ACTIVE'
type CenterAction = 'GO_SESSION' | 'NONE'
type StepKey = 'consult' | 'session' | 'aftercare'

// Matches your Prisma enum SessionStep (allow unknowns)
type SessionStep =
  | 'NONE'
  | 'CONSULTATION'
  | 'CONSULTATION_PENDING_CLIENT'
  | 'BEFORE_PHOTOS'
  | 'SERVICE_IN_PROGRESS'
  | 'FINISH_REVIEW'
  | 'AFTER_PHOTOS'
  | 'DONE'
  | string

function toUpper(v: unknown) {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

function stepFromSessionStep(step: SessionStep | null): StepKey {
  const s = toUpper(step || 'NONE')

  if (s === 'DONE') return 'aftercare'

  if (s === 'CONSULTATION' || s === 'CONSULTATION_PENDING_CLIENT' || s === 'NONE') return 'consult'

  // BEFORE_PHOTOS .. AFTER_PHOTOS
  return 'session'
}

function centerLabelFrom(mode: Mode, step: SessionStep | null) {
  const s = toUpper(step || 'NONE')

  if (mode === 'IDLE') return 'Start'

  // UPCOMING: pro should land in consult unless already past it (rare)
  if (mode === 'UPCOMING') {
    if (s === 'DONE') return 'Aftercare'
    if (s === 'CONSULTATION_PENDING_CLIENT') return 'Waiting'
    if (s === 'CONSULTATION' || s === 'NONE') return 'Consult'
    if (s === 'BEFORE_PHOTOS' || s === 'AFTER_PHOTOS') return 'Camera'
    if (s === 'SERVICE_IN_PROGRESS' || s === 'FINISH_REVIEW') return 'Session'
    return 'Start'
  }

  // ACTIVE
  if (s === 'DONE') return 'Aftercare'
  if (s === 'CONSULTATION') return 'Consult'
  if (s === 'CONSULTATION_PENDING_CLIENT') return 'Waiting'
  if (s === 'BEFORE_PHOTOS') return 'Camera'
  if (s === 'SERVICE_IN_PROGRESS') return 'Finish'
  if (s === 'FINISH_REVIEW') return 'Finish'
  if (s === 'AFTER_PHOTOS') return 'Camera'
  return 'Session'
}

export async function GET() {
  try {
    const user = await getCurrentUser().catch(() => null)

    if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const proId = user.professionalProfile.id
    const now = new Date()

    // 1) ACTIVE session wins: started but not finished
    // IMPORTANT: only ACCEPTED should be allowed to be “active”
    const active = await prisma.booking.findFirst({
      where: {
        professionalId: proId,
        startedAt: { not: null },
        finishedAt: null,
        status: 'ACCEPTED',
      } as any,
      include: { client: true, service: true },
      orderBy: { startedAt: 'desc' },
    })

    if (active) {
      const step = (active.sessionStep as unknown as SessionStep) ?? null
      const targetStep = stepFromSessionStep(step)

      return NextResponse.json({
        mode: 'ACTIVE' as Mode,
        sessionStep: step,
        targetStep,
        centerAction: 'GO_SESSION' as CenterAction,
        centerLabel: centerLabelFrom('ACTIVE', step),
        booking: {
          id: active.id,
          status: active.status,
          sessionStep: step,
          serviceName: active.service?.name ?? '',
          clientName: fullName(active.client?.firstName, active.client?.lastName),
          scheduledFor: active.scheduledFor instanceof Date ? active.scheduledFor.toISOString() : active.scheduledFor,
          startedAt: active.startedAt instanceof Date ? active.startedAt.toISOString() : active.startedAt,
          finishedAt: active.finishedAt,
        },
      })
    }

    // 2) UPCOMING within window
    const WINDOW_BEFORE_MIN = 30
    const WINDOW_AFTER_HOURS = 3

    const windowStart = new Date(now.getTime() - WINDOW_BEFORE_MIN * 60 * 1000)
    const windowEnd = new Date(now.getTime() + WINDOW_AFTER_HOURS * 60 * 60 * 1000)

    const next = await prisma.booking.findFirst({
      where: {
        professionalId: proId,
        status: { in: ['ACCEPTED', 'PENDING'] },
        startedAt: null,
        finishedAt: null,
        scheduledFor: { gte: windowStart, lte: windowEnd },
      } as any,
      include: { client: true, service: true },
      orderBy: { scheduledFor: 'asc' },
    })

    if (next) {
      const step = (next.sessionStep as unknown as SessionStep) ?? null
      const targetStep = stepFromSessionStep(step)

      return NextResponse.json({
        mode: 'UPCOMING' as Mode,
        sessionStep: step,
        targetStep,
        centerAction: 'GO_SESSION' as CenterAction,
        centerLabel: centerLabelFrom('UPCOMING', step),
        booking: {
          id: next.id,
          status: next.status,
          sessionStep: step,
          serviceName: next.service?.name ?? '',
          clientName: fullName(next.client?.firstName, next.client?.lastName),
          scheduledFor: next.scheduledFor instanceof Date ? next.scheduledFor.toISOString() : next.scheduledFor,
          startedAt: next.startedAt,
          finishedAt: next.finishedAt,
        },
      })
    }

    return NextResponse.json({
      mode: 'IDLE' as Mode,
      sessionStep: null,
      targetStep: null,
      centerAction: 'NONE' as CenterAction,
      centerLabel: 'Start',
      booking: null,
    })
  } catch (e) {
    console.error('GET /api/pro/session error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
