// app/api/v1/pro/bookings/[id]/no-show/route.ts
//
// Pro marks a confirmed booking as a no-show (Phase 2 revenue protection). The
// booking transitions to BookingStatus.NO_SHOW, then — if the pro has fee
// protection on and the client has a saved card — a no-show fee is charged
// off-session and routed to the pro's connected account. Dark unless
// ENABLE_NO_SHOW_PROTECTION is on.
import { NoShowFeeReason, Prisma, Role } from '@prisma/client'
import { kickNotificationDrain } from '@/lib/notifications/delivery/kickNotificationDrain'

import { requirePro, jsonFail, jsonOk } from '@/app/api/_utils'
import {
  beginRouteIdempotency,
  completeRouteIdempotency,
  failStartedRouteIdempotency,
  isRouteIdempotencyHandled,
} from '@/app/api/_utils/idempotency'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { getBookingFailPayload, isBookingError } from '@/lib/booking/errors'
import { markBookingNoShow } from '@/lib/booking/writeBoundary'
import { assessAndChargeNoShowFee } from '@/lib/noShowProtection/charge'
import { noShowProtectionEnabled } from '@/lib/noShowProtection/flag'
import { asTrimmedString } from '@/lib/guards'
import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import { safeError, safeLogMeta } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'

const ROUTE_OPERATION = 'POST /api/v1/pro/bookings/[id]/no-show'

type NoShowResponseBody = Prisma.InputJsonObject

export async function POST(req: Request, ctx: RouteContext) {
  if (!noShowProtectionEnabled()) return jsonFail(404, 'Not found.')

  let idempotencyRecordId: string | null = null

  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const actorUserId = auth.userId
    if (!actorUserId || !actorUserId.trim()) {
      const fail = getBookingFailPayload('FORBIDDEN', {
        message: 'Authenticated actor user id is required.',
        userMessage: 'You are not allowed to update this booking.',
      })
      return jsonFail(fail.httpStatus, fail.userMessage, fail.extra)
    }

    const params = await resolveRouteParams(ctx)
    const bookingId = asTrimmedString(params.id)
    if (!bookingId) {
      const fail = getBookingFailPayload('BOOKING_ID_REQUIRED')
      return jsonFail(fail.httpStatus, fail.userMessage, fail.extra)
    }

    const idempotency = await beginRouteIdempotency<NoShowResponseBody>({
      request: req,
      actor: { actorUserId, actorRole: Role.PRO },
      route: IDEMPOTENCY_ROUTES.PRO_BOOKING_NO_SHOW,
      requestLabel: 'pro mark no-show',
      requestBody: {
        bookingId,
        professionalId: auth.professionalId,
        actorUserId,
      },
      messages: {
        missingKey: 'Missing idempotency key.',
        inProgress: 'A matching no-show request is already in progress.',
        conflict:
          'This idempotency key was already used with a different request body.',
      },
    })

    if (isRouteIdempotencyHandled(idempotency)) {
      return idempotency.response
    }

    idempotencyRecordId = idempotency.idempotencyRecordId

    const result = await markBookingNoShow({
      bookingId,
      professionalId: auth.professionalId,
      actorUserId,
    })

    // Assess + charge the fee out of band from the status write (Stripe I/O).
    // Best-effort: a charge failure never blocks the no-show itself.
    const fee = await assessAndChargeNoShowFee({
      bookingId,
      reason: NoShowFeeReason.NO_SHOW,
    }).catch((error: unknown) => {
      console.error(`${ROUTE_OPERATION} fee charge error`, {
        error: safeError(error),
        meta: safeLogMeta({ route: ROUTE_OPERATION, bookingId }),
      })
      return null
    })

    const responseBody: NoShowResponseBody = {
      booking: { id: result.booking.id, status: result.booking.status },
      meta: result.meta,
      fee: fee
        ? {
            kind: fee.kind,
            status: fee.kind === 'ATTEMPTED' ? fee.status : null,
            amount:
              fee.kind === 'ATTEMPTED' || fee.kind === 'SKIPPED'
                ? fee.amount
                : null,
          }
        : null,
    }

    await completeRouteIdempotency({
      idempotencyRecordId,
      responseStatus: 200,
      responseBody,
    })

    // A charged fee enqueues a client receipt notification — deliver it now.
    kickNotificationDrain()

    return jsonOk(responseBody, 200)
  } catch (error: unknown) {
    await failStartedRouteIdempotency({
      idempotencyRecordId,
      operation: ROUTE_OPERATION,
    }).catch((failError: unknown) => {
      console.error(`${ROUTE_OPERATION} idempotency failure update error`, {
        error: safeError(failError),
        meta: safeLogMeta({ route: ROUTE_OPERATION, idempotencyRecordId }),
      })
    })

    if (isBookingError(error)) {
      const fail = getBookingFailPayload(error.code, {
        message: error.message,
        userMessage: error.userMessage,
      })
      return jsonFail(fail.httpStatus, fail.userMessage, fail.extra)
    }

    console.error(`${ROUTE_OPERATION} error`, {
      error: safeError(error),
      meta: safeLogMeta({ route: ROUTE_OPERATION, idempotencyRecordId }),
    })

    return jsonFail(500, 'Internal server error')
  }
}
