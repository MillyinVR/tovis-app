// app/api/pro/bookings/[id]/session/state/route.ts
//
// Compact read model for Pro session polling. Returns the current session
// state snapshot plus a stable hash; the Pro session UI polls this route
// and refreshes the server-rendered page only when the hash changes.

import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import {
  PRO_SESSION_STATE_SELECT,
  buildProSessionState,
  computeProSessionStateHash,
} from '@/lib/proSession/sessionState'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, ctx: RouteContext) {
  try {
    const auth = await requirePro()

    if (!auth.ok) {
      return auth.res
    }

    const params = await resolveRouteParams(ctx)
    const bookingId = pickString(params?.id)

    if (!bookingId) {
      return jsonFail(400, 'Missing booking id.')
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: PRO_SESSION_STATE_SELECT,
    })

    if (!booking) {
      return jsonFail(404, 'Booking not found.')
    }

    if (booking.professionalId !== auth.professionalId) {
      return jsonFail(403, 'You are not allowed to view this booking.')
    }

    const state = buildProSessionState(booking)

    return jsonOk(
      {
        state,
        stateHash: computeProSessionStateHash(state),
      },
      200,
    )
  } catch (error) {
    console.error(
      'GET /api/pro/bookings/[id]/session/state error',
      safeError(error),
    )
    return jsonFail(500, 'Internal server error')
  }
}
