// app/api/pro/session/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import type {
  ProSessionPayload,
  UiSessionCenterAction,
  UiSessionMode,
} from '@/lib/proSession/types'
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

  // Multiple eligible bookings must not auto-pick one.
  if (mode === 'UPCOMING_PICKER') {
    return { label: 'Choose booking', action: 'PICK_BOOKING', href: null }
  }

  // UPCOMING: footer will POST /start; consult lives in session hub.
  if (mode === 'UPCOMING') {
    return { label: 'Start', action: 'START', href: sessionHubHref(bookingId) }
  }

  // ACTIVE: if missing/unset, hub is the safe place.
  if (!sessionStep || sessionStep === SessionStep.NONE) {
    return { label: 'Consult', action: 'NAVIGATE', href: sessionHubHref(bookingId) }
  }

  if (sessionStep === SessionStep.DONE) {
    return { label: 'Aftercare', action: 'NAVIGATE', href: aftercareHref(bookingId) }
  }

  if (
    sessionStep === SessionStep.CONSULTATION ||
    sessionStep === SessionStep.CONSULTATION_PENDING_CLIENT
  ) {
    return { label: 'Camera', action: 'CAPTURE_BEFORE', href: beforePhotosHref(bookingId) }
  }

  if (sessionStep === SessionStep.BEFORE_PHOTOS) {
    if (!hasBeforeMedia) {
      return { label: 'Camera', action: 'CAPTURE_BEFORE', href: beforePhotosHref(bookingId) }
    }
    return { label: 'Continue', action: 'NAVIGATE', href: sessionHubHref(bookingId) }
  }

  if (sessionStep === SessionStep.SERVICE_IN_PROGRESS) {
    return { label: 'Finish', action: 'FINISH', href: null }
  }

  if (sessionStep === SessionStep.FINISH_REVIEW) {
    return { label: 'Continue', action: 'NAVIGATE', href: sessionHubHref(bookingId) }
  }

  if (sessionStep === SessionStep.AFTER_PHOTOS) {
    if (!hasAfterMedia) {
      return { label: 'Camera', action: 'CAPTURE_AFTER', href: afterPhotosHref(bookingId) }
    }
    return { label: 'Aftercare', action: 'NAVIGATE', href: aftercareHref(bookingId) }
  }

  return { label: 'Continue', action: 'NAVIGATE', href: sessionHubHref(bookingId) }
}

const bookingCardSelect = {
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
    orderBy: { sortOrder: 'asc' as const },
    take: 1,
  },
}

type BookingCardRecord = Awaited<
  ReturnType<typeof prisma.booking.findFirst<{ select: typeof bookingCardSelect }>>
>

function toBookingCard(
  booking: NonNullable<BookingCardRecord>,
) {
  const firstItemName = booking.serviceItems?.[0]?.service?.name ?? null
  const serviceName = firstItemName ?? booking.service?.name ?? ''

  return {
    id: booking.id,
    sessionStep: booking.sessionStep ?? null,
    serviceName,
    clientName:
      fullName(booking.client?.firstName, booking.client?.lastName) ||
      booking.client?.user?.email ||
      '',
    scheduledFor: booking.scheduledFor ? booking.scheduledFor.toISOString() : null,
  }
}

export async function GET() {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const proId = auth.professionalId

    const now = new Date()
    const windowStart = new Date(now.getTime() - 15 * 60_000)
    const windowEnd = new Date(now.getTime() + 15 * 60_000)

    // 1) ACTIVE booking wins and stays pinned until finished.
    const active = await prisma.booking.findFirst({
      where: {
        professionalId: proId,
        status: BookingStatus.ACCEPTED,
        startedAt: { not: null },
        finishedAt: null,
      },
      orderBy: { startedAt: 'desc' },
      select: bookingCardSelect,
    })

    if (active) {
      const booking = toBookingCard(active)
      const { before, after } = await getProBeforeAfterCounts(active.id)

      const payload: ProSessionPayload = {
        ok: true,
        mode: 'ACTIVE',
        targetStep:
          booking.sessionStep === SessionStep.DONE
            ? 'aftercare'
            : booking.sessionStep === SessionStep.CONSULTATION ||
                booking.sessionStep === SessionStep.CONSULTATION_PENDING_CLIENT
              ? 'consult'
              : 'session',
        booking,
        eligibleBookings: null,
        center: centerFrom({
          mode: 'ACTIVE',
          bookingId: booking.id,
          sessionStep: booking.sessionStep,
          hasBeforeMedia: before > 0,
          hasAfterMedia: after > 0,
        }),
      }

      return jsonOk(payload, 200)
    }

    // 2) Upcoming accepted bookings inside the start window.
    // Deterministic rule:
    // - exactly 1 => one-tap start
    // - more than 1 => explicit picker
    const eligibleUpcoming = await prisma.booking.findMany({
      where: {
        professionalId: proId,
        status: BookingStatus.ACCEPTED,
        startedAt: null,
        finishedAt: null,
        scheduledFor: { gte: windowStart, lte: windowEnd },
      },
      orderBy: [{ scheduledFor: 'asc' }, { id: 'asc' }],
      select: bookingCardSelect,
    })

    if (eligibleUpcoming.length === 1) {
      const booking = toBookingCard(eligibleUpcoming[0])

      const payload: ProSessionPayload = {
        ok: true,
        mode: 'UPCOMING',
        targetStep: 'consult',
        booking,
        eligibleBookings: null,
        center: centerFrom({
          mode: 'UPCOMING',
          bookingId: booking.id,
          sessionStep: booking.sessionStep,
          hasBeforeMedia: false,
          hasAfterMedia: false,
        }),
      }

      return jsonOk(payload, 200)
    }

    if (eligibleUpcoming.length > 1) {
      const eligibleBookings = eligibleUpcoming.map(toBookingCard)

      const payload: ProSessionPayload = {
        ok: true,
        mode: 'UPCOMING_PICKER',
        targetStep: 'consult',
        booking: null,
        eligibleBookings,
        center: centerFrom({
          mode: 'UPCOMING_PICKER',
          bookingId: null,
          sessionStep: null,
          hasBeforeMedia: false,
          hasAfterMedia: false,
        }),
      }

      return jsonOk(payload, 200)
    }

    // 3) Nothing relevant right now.
    const payload: ProSessionPayload = {
      ok: true,
      mode: 'IDLE',
      targetStep: null,
      booking: null,
      eligibleBookings: null,
      center: { label: 'Start', action: 'NONE', href: null },
    }

    return jsonOk(payload, 200)
  } catch (e) {
    console.error('GET /api/pro/session error', e)
    return jsonFail(500, 'Internal server error')
  }
}