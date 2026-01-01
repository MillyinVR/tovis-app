// app/api/pro/session/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import type { ProSessionPayload, StepKey, UiSessionCenterAction, UiSessionMode } from '@/lib/proSession/types'

export const dynamic = 'force-dynamic'

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

function fullName(first?: string | null, last?: string | null) {
  return `${first ?? ''} ${last ?? ''}`.trim()
}

/**
 * Target step is what the footer uses to decide the "main place"
 * (consult/session/aftercare) when you're active.
 *
 * NOTE: We keep this based on sessionStep only.
 * The "center button" can override based on inferred readiness (media existence).
 */
function stepFromSessionStep(step: SessionStep | null): StepKey {
  const s = toUpper(step || 'NONE')
  if (s === 'DONE') return 'aftercare'
  if (s === 'CONSULTATION' || s === 'CONSULTATION_PENDING_CLIENT' || s === 'NONE') return 'consult'
  return 'session'
}

function hrefForStep(bookingId: string, sessionStep: SessionStep | null) {
  const s = toUpper(sessionStep || 'NONE')
  const base = `/pro/bookings/${encodeURIComponent(bookingId)}`

  if (s === 'DONE') return `${base}/aftercare`

  // Consultation
  if (s === 'CONSULTATION' || s === 'CONSULTATION_PENDING_CLIENT' || s === 'NONE') {
    return `${base}?step=consult`
  }

  // Photos
  if (s === 'BEFORE_PHOTOS') return `${base}/session/before-photos`
  if (s === 'AFTER_PHOTOS') return `${base}/session/after-photos`

  // Everything else is inside session
  return `${base}?step=session`
}

type Center = { label: string; action: UiSessionCenterAction; href: string | null }

/**
 * Long-term rule:
 * SessionStep alone is not enough for "Camera" steps.
 * If required media exists, center button must advance to the next step.
 */
function centerFrom(args: {
  mode: UiSessionMode
  bookingId: string | null
  sessionStep: SessionStep | null
  hasBeforeMedia: boolean
  hasAfterMedia: boolean
}): Center {
  const { mode, bookingId, sessionStep, hasBeforeMedia, hasAfterMedia } = args

  if (mode === 'IDLE' || !bookingId) {
    return { label: 'Start', action: 'NONE' as UiSessionCenterAction, href: null }
  }

  if (mode === 'UPCOMING') {
    return {
      label: 'Start',
      action: 'START' as UiSessionCenterAction,
      href: `/pro/bookings/${encodeURIComponent(bookingId)}?step=consult`,
    }
  }

  // ACTIVE behavior depends on inferred readiness + sessionStep
  const s = toUpper(sessionStep || 'NONE')
  const base = `/pro/bookings/${encodeURIComponent(bookingId)}`

  // BEFORE PHOTOS:
  // If you've already added at least one BEFORE media, advance into session flow.
  if (s === 'BEFORE_PHOTOS') {
    if (hasBeforeMedia) {
      return { label: 'Session', action: 'NAVIGATE' as UiSessionCenterAction, href: `${base}?step=session` }
    }
    return {
      label: 'Camera',
      action: 'CAPTURE_BEFORE' as UiSessionCenterAction,
      href: `${base}/session/before-photos`,
    }
  }

  // AFTER PHOTOS:
  // If you've added at least one AFTER media, advance to Aftercare immediately.
  if (s === 'AFTER_PHOTOS') {
    if (hasAfterMedia) {
      return { label: 'Aftercare', action: 'NAVIGATE' as UiSessionCenterAction, href: `${base}/aftercare` }
    }
    return {
      label: 'Camera',
      action: 'CAPTURE_AFTER' as UiSessionCenterAction,
      href: `${base}/session/after-photos`,
    }
  }

  // Finish means POST /finish (server decides nextHref)
  if (s === 'SERVICE_IN_PROGRESS' || s === 'FINISH_REVIEW') {
    return { label: 'Finish', action: 'FINISH' as UiSessionCenterAction, href: null }
  }

  if (s === 'DONE') {
    return { label: 'Aftercare', action: 'NAVIGATE' as UiSessionCenterAction, href: `${base}/aftercare` }
  }

  // Consultation-ish
  if (s === 'CONSULTATION' || s === 'CONSULTATION_PENDING_CLIENT' || s === 'NONE') {
    return { label: 'Consult', action: 'NAVIGATE' as UiSessionCenterAction, href: `${base}?step=consult` }
  }

  // Fallback
  return { label: 'Session', action: 'NAVIGATE' as UiSessionCenterAction, href: hrefForStep(bookingId, sessionStep) }
}

export async function GET() {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const proId = user.professionalProfile.id
    const now = new Date()

    // 1) ACTIVE session wins
    const active = await prisma.booking.findFirst({
      where: {
        professionalId: proId,
        startedAt: { not: null },
        finishedAt: null,
        status: 'ACCEPTED',
      },
      include: { client: true, service: true },
      orderBy: { startedAt: 'desc' },
    })

    if (active) {
      const step = (active.sessionStep as unknown as SessionStep) ?? null

      // Infer readiness from actual media state (long-term: reality > string enums)
      const [beforeCount, afterCount] = await Promise.all([
        prisma.mediaAsset.count({ where: { bookingId: active.id, phase: 'BEFORE' } }),
        prisma.mediaAsset.count({ where: { bookingId: active.id, phase: 'AFTER' } }),
      ])

      const payload: ProSessionPayload = {
        ok: true,
        mode: 'ACTIVE',
        targetStep: stepFromSessionStep(step),
        booking: {
          id: active.id,
          sessionStep: step,
          serviceName: active.service?.name ?? '',
          clientName: fullName(active.client?.firstName, active.client?.lastName),
          scheduledFor: active.scheduledFor instanceof Date ? active.scheduledFor.toISOString() : null,
        },
        center: centerFrom({
          mode: 'ACTIVE',
          bookingId: active.id,
          sessionStep: step,
          hasBeforeMedia: beforeCount > 0,
          hasAfterMedia: afterCount > 0,
        }),
      }

      return NextResponse.json(payload, { status: 200 })
    }

    // 2) UPCOMING within start window (15 min before -> 15 min after)
    const WINDOW_BEFORE_MIN = 15
    const WINDOW_AFTER_MIN = 15
    const windowStart = new Date(now.getTime() - WINDOW_BEFORE_MIN * 60 * 1000)
    const windowEnd = new Date(now.getTime() + WINDOW_AFTER_MIN * 60 * 1000)

    const next = await prisma.booking.findFirst({
      where: {
        professionalId: proId,
        status: 'ACCEPTED',
        startedAt: null,
        finishedAt: null,
        scheduledFor: { gte: windowStart, lte: windowEnd },
      },
      include: { client: true, service: true },
      orderBy: { scheduledFor: 'asc' },
    })

    if (next) {
      const step = (next.sessionStep as unknown as SessionStep) ?? null

      const payload: ProSessionPayload = {
        ok: true,
        mode: 'UPCOMING',
        targetStep: 'consult',
        booking: {
          id: next.id,
          sessionStep: step,
          serviceName: next.service?.name ?? '',
          clientName: fullName(next.client?.firstName, next.client?.lastName),
          scheduledFor: next.scheduledFor instanceof Date ? next.scheduledFor.toISOString() : null,
        },
        // In UPCOMING we don't care about media existence yet.
        center: centerFrom({
          mode: 'UPCOMING',
          bookingId: next.id,
          sessionStep: step,
          hasBeforeMedia: false,
          hasAfterMedia: false,
        }),
      }

      return NextResponse.json(payload, { status: 200 })
    }

    const payload: ProSessionPayload = {
      ok: true,
      mode: 'IDLE',
      targetStep: null,
      booking: null,
      center: { label: 'Start', action: 'NONE', href: null },
    }

    return NextResponse.json(payload, { status: 200 })
  } catch (e) {
    console.error('GET /api/pro/session error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
