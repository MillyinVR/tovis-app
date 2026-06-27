// app/api/v1/pro/bookings/[id]/session/state/route.ts
//
// Compact read model for Pro session polling. Returns the current session
// state snapshot plus a stable hash; the Pro session UI polls this route
// and refreshes the server-rendered page only when the hash changes.

import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { requireProBooking } from '@/app/api/_utils/auth/requireProBooking'
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

    const owned = await requireProBooking(
      bookingId,
      auth.professionalId,
      PRO_SESSION_STATE_SELECT,
    )
    if (!owned.ok) return owned.res

    const state = buildProSessionState(owned.booking)

    return jsonOk(
      {
        state,
        stateHash: computeProSessionStateHash(state),
      },
      200,
    )
  } catch (error) {
    console.error(
      'GET /api/v1/pro/bookings/[id]/session/state error',
      safeError(error),
    )
    return jsonFail(500, 'Internal server error')
  }
}
