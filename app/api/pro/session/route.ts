// app/api/pro/session/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import type { ProSessionPayload, UiSessionCenterAction, UiSessionMode } from '@/lib/proSession/types'
import { BookingStatus, MediaPhase, Role, SessionStep } from '@prisma/client'

export const dynamic = 'force-dynamic'

function fullName(first?: string | null, last?: string | null) {
  return `${first ?? ''} ${last ?? ''}`.trim()
}

function bookingBase(bookingId: string) {
  return `/pro/bookings/${encodeURIComponent(bookingId)}`
}

function sessionHubHref(bookingId: string) {
  return `${bookingBase(bookingId)}/session`
}

function beforePhotosHref(bookingId: string) {
  return `${bookingBase(bookingId)}/session/before-photos`
}

function afterPhotosHref(bookingId: string) {
  return `${bookingBase(bookingId)}/session/after-photos`
}

function aftercareHref(bookingId: string) {
  return `${bookingBase(bookingId)}/aftercare`
}

/**
 * For the footer we only care about PRO-captured before/after media.
 * Clients attaching media to reviews should NOT unlock pro steps.
 */
async function getProBeforeAfterCounts(bookingId: string) {
  const groups = await prisma.mediaAsset.groupBy({
    by: ['phase'],
    where: {
      bookingId,
      phase: { in: [MediaPhase.BEFORE, MediaPhase.AFTER] },
      uploadedByRole: Role.PRO,
    },
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

type Center = { label: string; action: UiSessionCenterAction; href: string | null }

function centerFrom(args: {
  mode: UiSessionMode
  bookingId: string | null
  sessionStep: SessionStep | null
  hasBeforeMedia: boolean
  hasAfterMedia: boolean
}): Center {
  const { mode, bookingId, sessionStep, hasBeforeMedia, hasAfterMedia } = args

  if (mode === 'IDLE' || !bookingId) {
    return { label: 'Start', action: 'NONE', href: null }
  }

  // UPCOMING: footer will POST /start; consult lives in session hub.
  if (mode === 'UPCOMING') {
    return { label: 'Start', action: 'START', href: sessionHubHref(bookingId) }
  }

  // ACTIVE: if missing/unset, hub is the safe place.
  if (!sessionStep || sessionStep === SessionStep.NONE) {
    return { label: 'Consult', action: 'NAVIGATE', href: sessionHubHref(bookingId) }
  }

  // DONE always routes to aftercare
  if (sessionStep === SessionStep.DONE) {
    return { label: 'Aftercare', action: 'NAVIGATE', href: aftercareHref(bookingId) }
  }

  // Consultation + pending client approval: hub is source of truth
  if (sessionStep === SessionStep.CONSULTATION || sessionStep === SessionStep.CONSULTATION_PENDING_CLIENT) {
    // While waiting on approval, pro should still be able to take before photos.
    return { label: 'Camera', action: 'CAPTURE_BEFORE', href: beforePhotosHref(bookingId) }
  }

  // Before photos step
  if (sessionStep === SessionStep.BEFORE_PHOTOS) {
    if (!hasBeforeMedia) return { label: 'Camera', action: 'CAPTURE_BEFORE', href: beforePhotosHref(bookingId) }
    return { label: 'Continue', action: 'NAVIGATE', href: sessionHubHref(bookingId) }
  }

  // Service in progress: center button should be Finish (POST /finish)
  if (sessionStep === SessionStep.SERVICE_IN_PROGRESS) {
    return { label: 'Finish', action: 'FINISH', href: null }
  }

  // Finish review lives in hub today (can be a dedicated page later)
  if (sessionStep === SessionStep.FINISH_REVIEW) {
    return { label: 'Continue', action: 'NAVIGATE', href: sessionHubHref(bookingId) }
  }

  // Wrap-up: after photos + aftercare
  if (sessionStep === SessionStep.AFTER_PHOTOS) {
    if (!hasAfterMedia) return { label: 'Camera', action: 'CAPTURE_AFTER', href: afterPhotosHref(bookingId) }
    return { label: 'Aftercare', action: 'NAVIGATE', href: aftercareHref(bookingId) }
  }

  // Fallback: hub is safe
  return { label: 'Continue', action: 'NAVIGATE', href: sessionHubHref(bookingId) }
}

export async function GET() {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const proId = auth.professionalId

    const now = new Date()

    // 1) ACTIVE session wins: ACCEPTED + startedAt present + not finishedAt
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
      const { before, after } = await getProBeforeAfterCounts(active.id)

      const firstItemName = active.serviceItems?.[0]?.service?.name ?? null
      const serviceName = firstItemName ?? active.service?.name ?? ''

      const sessionStep = active.sessionStep ?? null

      const payload: ProSessionPayload = {
        ok: true,
        mode: 'ACTIVE',
        targetStep: sessionStep === SessionStep.DONE ? 'aftercare' : sessionStep === SessionStep.CONSULTATION || sessionStep === SessionStep.CONSULTATION_PENDING_CLIENT ? 'consult' : 'session',
        booking: {
          id: active.id,
          sessionStep,
          serviceName,
          clientName: fullName(active.client?.firstName, active.client?.lastName) || active.client?.user?.email || '',
          scheduledFor: active.scheduledFor ? active.scheduledFor.toISOString() : null,
        },
        center: centerFrom({
          mode: 'ACTIVE',
          bookingId: active.id,
          sessionStep,
          hasBeforeMedia: before > 0,
          hasAfterMedia: after > 0,
        }),
      }

      return jsonOk(payload, 200)
    }

    // 2) UPCOMING in window (15 min before -> 15 min after)
    const windowStart = new Date(now.getTime() - 15 * 60_000)
    const windowEnd = new Date(now.getTime() + 15 * 60_000)

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

      const sessionStep = next.sessionStep ?? null

      const payload: ProSessionPayload = {
        ok: true,
        mode: 'UPCOMING',
        targetStep: 'consult',
        booking: {
          id: next.id,
          sessionStep,
          serviceName,
          clientName: fullName(next.client?.firstName, next.client?.lastName) || next.client?.user?.email || '',
          scheduledFor: next.scheduledFor ? next.scheduledFor.toISOString() : null,
        },
        center: centerFrom({
          mode: 'UPCOMING',
          bookingId: next.id,
          sessionStep,
          hasBeforeMedia: false,
          hasAfterMedia: false,
        }),
      }

      return jsonOk(payload, 200)
    }

    // 3) Nothing relevant right now
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