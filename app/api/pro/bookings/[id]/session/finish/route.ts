// app/api/pro/bookings/[id]/session/finish/route.ts

import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
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
import { Role, SessionStep } from '@prisma/client'
import {
  isBookingError,
} from '@/lib/booking/errors'
import { bookingJsonFail } from '@/app/api/_utils/bookingResponses'
import {
  normalizeJsonObjectPayload,
  type JsonObjectPayload,
} from '@/app/api/_utils/jsonPayload'
import { finishBookingSession } from '@/lib/booking/writeBoundary'
import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import { safeError, safeLogMeta } from '@/lib/security/logging'
export const dynamic = 'force-dynamic'

function bookingBase(bookingId: string): string {
  return `/pro/bookings/${encodeURIComponent(bookingId)}`
}

function sessionHubHref(bookingId: string): string {
  return `${bookingBase(bookingId)}/session`
}

function afterPhotosHref(bookingId: string): string {
  return `${bookingBase(bookingId)}/session/after-photos`
}

function aftercareHref(bookingId: string): string {
  return `${bookingBase(bookingId)}/aftercare`
}

function nextHrefFromState(args: {
  bookingId: string
  sessionStep: SessionStep
  afterCount: number
}): string {
  if (args.sessionStep === SessionStep.DONE) {
    return aftercareHref(args.bookingId)
  }

  if (args.sessionStep === SessionStep.AFTER_PHOTOS) {
    return args.afterCount > 0
      ? aftercareHref(args.bookingId)
      : afterPhotosHref(args.bookingId)
  }

  return sessionHubHref(args.bookingId)
}

function readRequestId(request: Request): string | null {
  return (
    pickString(request.headers.get('x-request-id')) ??
    pickString(request.headers.get('request-id')) ??
    null
  )
}

/**
 * Finish session.
 *
 * Important:
 * - Does not complete the booking. Aftercare send does that later.
 * - Requires startedAt inside writeBoundary.
 * - Canonical behavior: move session into FINISH_REVIEW.
 * - Idempotent: if already in FINISH_REVIEW / AFTER_PHOTOS / DONE,
 *   returns a stable nextHref.
 */
export async function POST(req: Request, ctx: RouteContext) {
  let idempotencyRecordId: string | null = null

  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId
    const actorUserId = auth.user.id

    if (!actorUserId || !actorUserId.trim()) {
      return bookingJsonFail('FORBIDDEN', {
        message: 'Authenticated actor user id is required.',
        userMessage: 'You are not allowed to finish this booking session.',
      })
    }

    const params = await resolveRouteParams(ctx)
    const bookingId = pickString(params?.id)

    if (!bookingId) {
      return bookingJsonFail('BOOKING_ID_REQUIRED')
    }

    const requestId = readRequestId(req)

    const idempotency = await beginRouteIdempotency<JsonObjectPayload>({
      request: req,
      actor: {
        actorUserId,
        actorRole: Role.PRO,
      },
      route: IDEMPOTENCY_ROUTES.BOOKING_FINISH_SESSION,
      requestLabel: 'booking finish',
      requestBody: {
        professionalId,
        actorUserId,
        bookingId,
      },
      messages: {
        missingKey: 'Missing idempotency key.',
        inProgress:
          'A matching booking finish request is already in progress.',
        conflict:
          'This idempotency key was already used with a different request body.',
      },
    })

    if (isRouteIdempotencyHandled(idempotency)) {
      return idempotency.response
    }

    idempotencyRecordId = idempotency.idempotencyRecordId

    const result = await finishBookingSession({
      bookingId,
      professionalId,
      requestId,
      idempotencyKey: idempotency.idempotencyKey,
    })

    const responseBody = normalizeJsonObjectPayload({
      booking: result.booking,
      nextHref: nextHrefFromState({
        bookingId: result.booking.id,
        sessionStep: result.booking.sessionStep,
        afterCount: result.afterCount,
      }),
      afterCount: result.afterCount,
      meta: result.meta,
    })

    await completeRouteIdempotency({
      idempotencyRecordId,
      responseStatus: 200,
      responseBody,
    })

    return jsonOk(responseBody, 200)
  } catch (error: unknown) {
    await failStartedRouteIdempotency({
      idempotencyRecordId,
      operation: 'POST /api/pro/bookings/[id]/session/finish',
    })

    if (isBookingError(error)) {
      return bookingJsonFail(error.code, {
        message: error.message,
        userMessage: error.userMessage,
      })
    }

    console.error('POST /api/pro/bookings/[id]/session/finish error', {
      error: safeError(error),
      meta: safeLogMeta({
        route: 'POST /api/pro/bookings/[id]/session/finish',
        idempotencyRecordId,
      }),
    })
    return jsonFail(500, 'Internal server error')
  }
}