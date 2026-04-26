// app/api/pro/session/route.ts
import { BookingStatus, MediaPhase, Prisma, Role } from '@prisma/client'

import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { prisma } from '@/lib/prisma'
import {
  getProSessionStartWindow,
  getSessionCenterState,
  targetStepFromSessionStep,
} from '@/lib/proSession/sessionFlow'
import type { ProSessionPayload, SessionBooking } from '@/lib/proSession/types'

export const dynamic = 'force-dynamic'

const bookingCardSelect = Prisma.validator<Prisma.BookingSelect>()({
  id: true,
  scheduledFor: true,
  sessionStep: true,
  client: {
    select: {
      firstName: true,
      lastName: true,
      user: {
        select: {
          email: true,
        },
      },
    },
  },
  service: {
    select: {
      name: true,
    },
  },
  serviceItems: {
    select: {
      sortOrder: true,
      service: {
        select: {
          name: true,
        },
      },
    },
    orderBy: {
      sortOrder: 'asc',
    },
    take: 1,
  },
})

type BookingCardRecord = Prisma.BookingGetPayload<{
  select: typeof bookingCardSelect
}>

type ProBeforeAfterCounts = {
  before: number
  after: number
}

function fullName(first?: string | null, last?: string | null): string {
  return `${first ?? ''} ${last ?? ''}`.trim()
}

/**
 * For the footer we only care about PRO-captured before/after media.
 * Clients attaching media to reviews should NOT unlock pro steps.
 */
async function getProBeforeAfterCounts(
  bookingId: string,
): Promise<ProBeforeAfterCounts> {
  const groups = await prisma.mediaAsset.groupBy({
    by: ['phase'],
    where: {
      bookingId,
      phase: {
        in: [MediaPhase.BEFORE, MediaPhase.AFTER],
      },
      uploadedByRole: Role.PRO,
    },
    _count: {
      _all: true,
    },
  })

  let before = 0
  let after = 0

  for (const group of groups) {
    if (group.phase === MediaPhase.BEFORE) {
      before = group._count._all
    }

    if (group.phase === MediaPhase.AFTER) {
      after = group._count._all
    }
  }

  return { before, after }
}

function toBookingCard(booking: BookingCardRecord): SessionBooking {
  const firstItemName = booking.serviceItems[0]?.service.name ?? null
  const serviceName = firstItemName ?? booking.service?.name ?? ''

  return {
    id: booking.id,
    sessionStep: booking.sessionStep ?? null,
    serviceName,
    clientName:
      fullName(booking.client?.firstName, booking.client?.lastName) ||
      booking.client?.user?.email ||
      '',
    scheduledFor: booking.scheduledFor
      ? booking.scheduledFor.toISOString()
      : null,
  }
}

function idlePayload(): ProSessionPayload {
  return {
    ok: true,
    mode: 'IDLE',
    targetStep: null,
    booking: null,
    eligibleBookings: null,
    center: getSessionCenterState({
      mode: 'IDLE',
      bookingId: null,
      sessionStep: null,
      hasBeforeMedia: false,
      hasAfterMedia: false,
    }),
  }
}

export async function GET() {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const proId = auth.professionalId
    const { windowStart, windowEnd } = getProSessionStartWindow()

    /**
     * 1) ACTIVE booking wins and stays pinned until finished.
     */
    const active = await prisma.booking.findFirst({
      where: {
        professionalId: proId,
        status: BookingStatus.ACCEPTED,
        startedAt: {
          not: null,
        },
        finishedAt: null,
      },
      orderBy: {
        startedAt: 'desc',
      },
      select: bookingCardSelect,
    })

    if (active) {
      const booking = toBookingCard(active)
      const counts = await getProBeforeAfterCounts(active.id)

      const payload: ProSessionPayload = {
        ok: true,
        mode: 'ACTIVE',
        targetStep: targetStepFromSessionStep(active.sessionStep),
        booking,
        eligibleBookings: null,
        center: getSessionCenterState({
          mode: 'ACTIVE',
          bookingId: booking.id,
          sessionStep: active.sessionStep,
          hasBeforeMedia: counts.before > 0,
          hasAfterMedia: counts.after > 0,
        }),
      }

      return jsonOk(payload, 200)
    }

    /**
     * 2) Upcoming accepted bookings inside the start window.
     *
     * Deterministic rule:
     * - exactly 1 => one-tap start
     * - more than 1 => explicit picker
     */
    const eligibleUpcoming = await prisma.booking.findMany({
      where: {
        professionalId: proId,
        status: BookingStatus.ACCEPTED,
        startedAt: null,
        finishedAt: null,
        scheduledFor: {
          gte: windowStart,
          lte: windowEnd,
        },
      },
      orderBy: [
        {
          scheduledFor: 'asc',
        },
        {
          id: 'asc',
        },
      ],
      select: bookingCardSelect,
    })

    if (eligibleUpcoming.length === 1) {
      const upcoming = eligibleUpcoming[0]
      const booking = toBookingCard(upcoming)

      const payload: ProSessionPayload = {
        ok: true,
        mode: 'UPCOMING',
        targetStep: 'consult',
        booking,
        eligibleBookings: null,
        center: getSessionCenterState({
          mode: 'UPCOMING',
          bookingId: booking.id,
          sessionStep: upcoming.sessionStep,
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
        center: getSessionCenterState({
          mode: 'UPCOMING_PICKER',
          bookingId: null,
          sessionStep: null,
          hasBeforeMedia: false,
          hasAfterMedia: false,
        }),
      }

      return jsonOk(payload, 200)
    }

    /**
     * 3) Nothing relevant right now.
     */
    return jsonOk(idlePayload(), 200)
  } catch (error) {
    console.error('GET /api/pro/session error', error)
    return jsonFail(500, 'Internal server error')
  }
}