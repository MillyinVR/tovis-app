// app/api/pro/session/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import type { ProSessionPayload, StepKey, UiSessionCenterAction, UiSessionMode } from '@/lib/proSession/types'
import { BookingStatus, MediaPhase, SessionStep } from '@prisma/client'

export const dynamic = 'force-dynamic'

function fullName(first?: string | null, last?: string | null) {
  return `${first ?? ''} ${last ?? ''}`.trim()
}

function stepFromSessionStep(step: SessionStep | null): StepKey {
  if (step === SessionStep.DONE) return 'aftercare'

  if (
    step === SessionStep.CONSULTATION ||
    step === SessionStep.CONSULTATION_PENDING_CLIENT ||
    step === SessionStep.NONE ||
    !step
  ) {
    return 'consult'
  }

  return 'session'
}

function hrefForStep(bookingId: string, sessionStep: SessionStep | null) {
  const base = `/pro/bookings/${encodeURIComponent(bookingId)}`

  if (sessionStep === SessionStep.DONE) return `${base}/aftercare`

  if (
    sessionStep === SessionStep.CONSULTATION ||
    sessionStep === SessionStep.CONSULTATION_PENDING_CLIENT ||
    sessionStep === SessionStep.NONE ||
    !sessionStep
  ) {
    return `${base}?step=consult`
  }

  if (sessionStep === SessionStep.BEFORE_PHOTOS) return `${base}/session/before-photos`
  if (sessionStep === SessionStep.AFTER_PHOTOS) return `${base}/session/after-photos`

  return `${base}?step=session`
}

type Center = { label: string; action: UiSessionCenterAction; href: string | null }

function centerFrom(args: {
  mode: UiSessionMode
  bookingId: string | null
  sessionStep: SessionStep | null
  hasBeforeMedia: boolean
  hasAfterMedia: boolean
}): Center {
  const { mode, bookingId, sessionStep, hasBeforeMedia, hasAfterMedia } = args

  if (mode === 'IDLE' || !bookingId) return { label: 'Start', action: 'NONE', href: null }

  const base = `/pro/bookings/${encodeURIComponent(bookingId)}`

  if (mode === 'UPCOMING') {
    return { label: 'Start', action: 'START', href: `${base}?step=consult` }
  }

  // ACTIVE
  if (sessionStep === SessionStep.BEFORE_PHOTOS) {
    if (hasBeforeMedia) return { label: 'Session', action: 'NAVIGATE', href: `${base}?step=session` }
    return { label: 'Camera', action: 'CAPTURE_BEFORE', href: `${base}/session/before-photos` }
  }

  if (sessionStep === SessionStep.AFTER_PHOTOS) {
    if (hasAfterMedia) return { label: 'Aftercare', action: 'NAVIGATE', href: `${base}/aftercare` }
    return { label: 'Camera', action: 'CAPTURE_AFTER', href: `${base}/session/after-photos` }
  }

  if (sessionStep === SessionStep.SERVICE_IN_PROGRESS || sessionStep === SessionStep.FINISH_REVIEW) {
    return { label: 'Finish', action: 'FINISH', href: null }
  }

  if (sessionStep === SessionStep.DONE) {
    return { label: 'Aftercare', action: 'NAVIGATE', href: `${base}/aftercare` }
  }

  if (
    sessionStep === SessionStep.CONSULTATION ||
    sessionStep === SessionStep.CONSULTATION_PENDING_CLIENT ||
    sessionStep === SessionStep.NONE ||
    !sessionStep
  ) {
    return { label: 'Consult', action: 'NAVIGATE', href: `${base}?step=consult` }
  }

  return { label: 'Session', action: 'NAVIGATE', href: hrefForStep(bookingId, sessionStep) }
}

async function getBeforeAfterCounts(bookingId: string) {
  // One query instead of two separate count() calls
  const groups = await prisma.mediaAsset.groupBy({
    by: ['phase'],
    where: { bookingId, phase: { in: [MediaPhase.BEFORE, MediaPhase.AFTER] } },
    _count: { _all: true },
  })

  let before = 0
  let after = 0

  for (const g of groups) {
    if (g.phase === MediaPhase.BEFORE) before = g._count._all
    if (g.phase === MediaPhase.AFTER) after = g._count._all
  }

  return { before, after }
}

export async function GET() {
  try {
    const auth = await requirePro()
    if (auth.res) return auth.res
    const proId = auth.professionalId

    const now = new Date()

    // 1) ACTIVE session wins
    const active = await prisma.booking.findFirst({
      where: {
        professionalId: proId,
        status: BookingStatus.ACCEPTED,
        startedAt: { not: null },
        finishedAt: null,
      },
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        scheduledFor: true,
        sessionStep: true,
        client: {
          select: {
            firstName: true,
            lastName: true,
            user: { select: { email: true } },
          },
        },
        service: { select: { name: true } },
        serviceItems: {
          select: { sortOrder: true, service: { select: { name: true } } },
          orderBy: { sortOrder: 'asc' },
          take: 1,
        },
      },
    })

    if (active) {
      const { before, after } = await getBeforeAfterCounts(active.id)

      const firstItemName = active.serviceItems?.[0]?.service?.name ?? null
      const serviceName = firstItemName ?? active.service?.name ?? ''

      const payload: ProSessionPayload = {
        ok: true,
        mode: 'ACTIVE',
        targetStep: stepFromSessionStep(active.sessionStep ?? null),
        booking: {
          id: active.id,
          sessionStep: active.sessionStep ?? null,
          serviceName,
          clientName: fullName(active.client?.firstName, active.client?.lastName) || active.client?.user?.email || '',
          scheduledFor: active.scheduledFor ? active.scheduledFor.toISOString() : null,
        },
        center: centerFrom({
          mode: 'ACTIVE',
          bookingId: active.id,
          sessionStep: active.sessionStep ?? null,
          hasBeforeMedia: before > 0,
          hasAfterMedia: after > 0,
        }),
      }

      return jsonOk(payload, 200)
    }

    // 2) UPCOMING in window (15 min before -> 15 min after)
    const WINDOW_BEFORE_MIN = 15
    const WINDOW_AFTER_MIN = 15
    const windowStart = new Date(now.getTime() - WINDOW_BEFORE_MIN * 60_000)
    const windowEnd = new Date(now.getTime() + WINDOW_AFTER_MIN * 60_000)

    const next = await prisma.booking.findFirst({
      where: {
        professionalId: proId,
        status: BookingStatus.ACCEPTED,
        startedAt: null,
        finishedAt: null,
        scheduledFor: { gte: windowStart, lte: windowEnd },
      },
      orderBy: { scheduledFor: 'asc' },
      select: {
        id: true,
        scheduledFor: true,
        sessionStep: true,
        client: {
          select: {
            firstName: true,
            lastName: true,
            user: { select: { email: true } },
          },
        },
        service: { select: { name: true } },
        serviceItems: {
          select: { sortOrder: true, service: { select: { name: true } } },
          orderBy: { sortOrder: 'asc' },
          take: 1,
        },
      },
    })

    if (next) {
      const firstItemName = next.serviceItems?.[0]?.service?.name ?? null
      const serviceName = firstItemName ?? next.service?.name ?? ''

      const payload: ProSessionPayload = {
        ok: true,
        mode: 'UPCOMING',
        targetStep: 'consult',
        booking: {
          id: next.id,
          sessionStep: next.sessionStep ?? null,
          serviceName,
          clientName: fullName(next.client?.firstName, next.client?.lastName) || next.client?.user?.email || '',
          scheduledFor: next.scheduledFor ? next.scheduledFor.toISOString() : null,
        },
        center: centerFrom({
          mode: 'UPCOMING',
          bookingId: next.id,
          sessionStep: next.sessionStep ?? null,
          hasBeforeMedia: false,
          hasAfterMedia: false,
        }),
      }

      return jsonOk(payload, 200)
    }

    const payload: ProSessionPayload = {
      ok: true,
      mode: 'IDLE',
      targetStep: null,
      booking: null,
      center: { label: 'Start', action: 'NONE', href: null },
    }

    return jsonOk(payload, 200)
  } catch (e) {
    console.error('GET /api/pro/session error', e)
    return jsonFail(500, 'Internal server error')
  }
}
