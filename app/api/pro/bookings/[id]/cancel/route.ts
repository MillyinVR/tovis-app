// app/api/pro/bookings/[id]/cancel/route.ts

import { BookingStatus, Prisma, Role } from '@prisma/client'

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
import { cancelBooking } from '@/lib/booking/writeBoundary'
import { applyAutoCancelRefund } from '@/lib/booking/cancelRefund'
import { asTrimmedString, isRecord } from '@/lib/guards'
import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import { safeError, safeLogMeta } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'

const ROUTE_OPERATION = 'PATCH /api/pro/bookings/[id]/cancel'

type CancelResponseBody = Prisma.InputJsonObject

function buildCancelRequestBody(args: {
  bookingId: string
  professionalId: string
  actorUserId: string
  reason: string
}): Prisma.InputJsonObject {
  return {
    bookingId: args.bookingId,
    professionalId: args.professionalId,
    actorUserId: args.actorUserId,
    reason: args.reason,
  }
}

function buildCancelResponseBody(
  result: Awaited<ReturnType<typeof cancelBooking>>,
): CancelResponseBody {
  return {
    booking: {
      id: result.booking.id,
      status: result.booking.status,
      sessionStep: result.booking.sessionStep,
    },
    meta: result.meta,
  }
}

export async function PATCH(req: Request, ctx: RouteContext) {
  let idempotencyRecordId: string | null = null

  try {
    const auth = await requirePro()

    if (!auth.ok) {
      return auth.res
    }

    const actorUserId = auth.userId

    if (!actorUserId || !actorUserId.trim()) {
      const fail = getBookingFailPayload('FORBIDDEN', {
        message: 'Authenticated actor user id is required.',
        userMessage: 'You are not allowed to cancel this booking.',
      })

      return jsonFail(fail.httpStatus, fail.userMessage, fail.extra)
    }

    const params = await resolveRouteParams(ctx)
    const bookingId = asTrimmedString(params.id)

    if (!bookingId) {
      const fail = getBookingFailPayload('BOOKING_ID_REQUIRED')
      return jsonFail(fail.httpStatus, fail.userMessage, fail.extra)
    }

    const body: unknown = await req.json().catch(() => ({}))

    const reason = isRecord(body)
      ? (asTrimmedString(body.reason) ?? 'Cancelled by professional')
      : 'Cancelled by professional'

    const idempotency = await beginRouteIdempotency<CancelResponseBody>({
      request: req,
      actor: {
        actorUserId,
        actorRole: Role.PRO,
      },
      route: IDEMPOTENCY_ROUTES.PRO_BOOKING_CANCEL,
      requestLabel: 'pro booking cancellation',
      requestBody: buildCancelRequestBody({
        bookingId,
        professionalId: auth.professionalId,
        actorUserId,
        reason,
      }),
      messages: {
        missingKey: 'Missing idempotency key.',
        inProgress: 'A matching cancel request is already in progress.',
        conflict:
          'This idempotency key was already used with a different request body.',
      },
    })

    if (isRouteIdempotencyHandled(idempotency)) {
      return idempotency.response
    }

    idempotencyRecordId = idempotency.idempotencyRecordId

    const result = await cancelBooking({
      bookingId,
      actor: {
        kind: 'pro',
        professionalId: auth.professionalId,
      },
      notifyClient: true,
      reason,
      allowedStatuses: [BookingStatus.PENDING, BookingStatus.ACCEPTED],
    })

    // Pro cancellation → auto full refund to the client (best-effort, never throws).
    await applyAutoCancelRefund({
      bookingId,
      actorKind: 'pro',
      actorUserId,
      cancelMutated: result.meta.mutated,
      reason,
    })

    const responseBody = buildCancelResponseBody(result)

    await completeRouteIdempotency({
      idempotencyRecordId,
      responseStatus: 200,
      responseBody,
    })

    return jsonOk(responseBody, 200)
  } catch (error: unknown) {
    await failStartedRouteIdempotency({
      idempotencyRecordId,
      operation: ROUTE_OPERATION,
    }).catch((failError: unknown) => {
      console.error(`${ROUTE_OPERATION} idempotency failure update error`, {
        error: safeError(failError),
        meta: safeLogMeta({
          route: ROUTE_OPERATION,
          idempotencyRecordId,
        }),
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
      meta: safeLogMeta({
        route: ROUTE_OPERATION,
        idempotencyRecordId,
      }),
    })

    return jsonFail(500, 'Internal server error')
  }
}