// app/api/v1/bookings/[id]/money-trail/route.ts
//
// Read-only "money trail" for a booking — the data source for the Phase 2.5
// refund inspector. Assembles charges, holds-credited deposit, discovery fee,
// no-show / late-cancel fee, and every refund row into one trustworthy view
// plus the capability flags the inspector uses to gate its actions.
//
//   - PRO   sees the money trail for their OWN bookings only.
//   - ADMIN sees any booking's money trail.
// A booking owned by another pro is indistinguishable from a missing one: both
// return a uniform 404 so the API never leaks whether a foreign booking exists.

import { Role } from '@prisma/client'

import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { jsonOk, jsonFail } from '@/app/api/_utils'
import { pickString } from '@/app/api/_utils/pick'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { prisma } from '@/lib/prisma'
import { assembleMoneyTrail, MONEY_TRAIL_SELECT } from '@/lib/booking/moneyTrail'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROUTE_OPERATION = 'GET /api/v1/bookings/[id]/money-trail'

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const auth = await requireUser({ roles: [Role.PRO, Role.ADMIN] })
    if (!auth.ok) {
      return auth.res
    }

    const user = auth.user
    const params = await resolveRouteParams(ctx)
    const bookingId = pickString(params?.id)

    if (!bookingId) {
      return jsonFail(400, 'Booking id is required.', {
        code: 'BOOKING_ID_REQUIRED',
      })
    }

    const row = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: MONEY_TRAIL_SELECT,
    })

    // Uniform 404 for missing OR foreign-to-this-pro bookings (no leak). Admin
    // may view any booking.
    if (!row) {
      return jsonFail(404, 'Booking not found.', { code: 'BOOKING_NOT_FOUND' })
    }

    if (user.role === Role.PRO) {
      const professionalId = user.professionalProfile?.id ?? null
      if (!professionalId || row.professionalId !== professionalId) {
        return jsonFail(404, 'Booking not found.', {
          code: 'BOOKING_NOT_FOUND',
        })
      }
    }

    return jsonOk({ trail: assembleMoneyTrail(row) })
  } catch (error: unknown) {
    console.error(`${ROUTE_OPERATION} error`, safeError(error))
    return jsonFail(500, 'Failed to load the money trail.')
  }
}
