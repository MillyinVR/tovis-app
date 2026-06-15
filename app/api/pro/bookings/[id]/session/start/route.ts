// app/api/pro/bookings/[id]/start/route.ts

import { Role } from '@prisma/client'

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
import {
  isBookingError,
} from '@/lib/booking/errors'
import { bookingJsonFail } from '@/app/api/_utils/bookingResponses'
import {
  normalizeJsonObjectPayload,
  type JsonObjectPayload,
} from '@/app/api/_utils/jsonPayload'
import { startBookingSession } from '@/lib/booking/writeBoundary'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'

type RequestMeta = {
  requestId: string | null
}

type StartSessionResponseBody = JsonObjectPayload

function bookingBase(bookingId: string): string {
  return `/pro/bookings/${encodeURIComponent(bookingId)}`
}

function sessionHubHref(bookingId: string): string {
  return `${bookingBase(bookingId)}/session`
}

function readRequestMeta(request: Request): RequestMeta {
  return {
    requestId:
      pickString(request.headers.get('x-request-id')) ??
      pickString(request.headers.get('request-id')) ??
      null,
  }
}

function buildStartSessionIdempotencyBody(args: {
  professionalId: string
  actorUserId: string
  bookingId: string
  explicitSelection: boolean
}): JsonObjectPayload {
  return {
    professionalId: args.professionalId,
    actorUserId: args.actorUserId,
    bookingId: args.bookingId,
    explicitSelection: args.explicitSelection,
  }
}

function buildStartSessionResponseBody(
  result: Awaited<ReturnType<typeof startBookingSession>>,
): StartSessionResponseBody {
  return normalizeJsonObjectPayload({
    booking: result.booking,
    nextHref: sessionHubHref(result.booking.id),
    meta: result.meta,
  })
}

export async function POST(request: Request, ctx: RouteContext) {
  let idempotencyRecordId: string | null = null
  const { requestId } = readRequestMeta(request)

  try {
    const auth = await requirePro()

    if (!auth.ok) {
      return auth.res
    }

    const professionalId = auth.professionalId
    const actorUserId = auth.user.id

    if (!actorUserId || !actorUserId.trim()) {
      return bookingJsonFail('FORBIDDEN', {
        message: 'Authenticated actor user id is required.',
        userMessage: 'You are not allowed to start this booking.',
      })
    }

    const params = await resolveRouteParams(ctx)
    const bookingId = pickString(params.id)

    if (!bookingId) {
      return bookingJsonFail('BOOKING_ID_REQUIRED')
    }

    const body = await readJsonRecord(request)
    const explicitSelection = body.explicitSelection === true

    const idempotency = await beginRouteIdempotency<StartSessionResponseBody>({
      request,
      actor: {
        actorUserId,
        actorRole: Role.PRO,
      },
      route: IDEMPOTENCY_ROUTES.BOOKING_START_SESSION,
      requestLabel: 'booking start',
      requestBody: buildStartSessionIdempotencyBody({
        professionalId,
        actorUserId,
        bookingId,
        explicitSelection,
      }),
      messages: {
        missingKey: 'Missing idempotency key.',
        inProgress:
          'A matching booking start request is already in progress.',
        conflict:
          'This idempotency key was already used with a different request body.',
      },
    })

    if (isRouteIdempotencyHandled(idempotency)) {
      return idempotency.response
    }

    idempotencyRecordId = idempotency.idempotencyRecordId

    const result = await startBookingSession({
      bookingId,
      professionalId,
      requestId,
      idempotencyKey: idempotency.idempotencyKey,
      explicitSelection,
      actorUserId,
    })

    const responseBody = buildStartSessionResponseBody(result)

    await completeRouteIdempotency({
      idempotencyRecordId,
      responseStatus: 200,
      responseBody,
    })

    return jsonOk(responseBody, 200)
  } catch (error: unknown) {
    await failStartedRouteIdempotency({
      idempotencyRecordId,
      operation: 'POST /api/pro/bookings/[id]/start',
    })

    if (isBookingError(error)) {
      return bookingJsonFail(error.code, {
        message: error.message,
        userMessage: error.userMessage,
      })
    }

    console.error('POST /api/pro/bookings/[id]/start error', {
      requestId,
      error: safeError(error),
    })

    return jsonFail(500, 'Internal server error')
  }
}