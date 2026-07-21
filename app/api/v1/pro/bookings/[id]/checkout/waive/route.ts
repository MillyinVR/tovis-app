// app/api/v1/pro/bookings/[id]/checkout/waive/route.ts

import { Role } from '@prisma/client'

import { jsonOk, pickString, requirePro } from '@/app/api/_utils'
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
import { isBookingError } from '@/lib/booking/errors'
import {
  bookingErrorJsonFail,
  bookingJsonFail,
} from '@/app/api/_utils/bookingResponses'
import { waiveProBookingCheckout } from '@/lib/booking/writeBoundary'
import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import { enforceRateLimit } from '@/lib/rateLimit/enforce'
import { proRateLimitKey } from '@/lib/rateLimit/identity'
import { rateLimitExceededResponse } from '@/lib/rateLimit/response'
import { safeError, safeLogMeta } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'

const ROUTE_OPERATION = 'POST /api/v1/pro/bookings/[id]/checkout/waive'

type WaiveCheckoutSuccessBody = {
  booking: {
    id: string
    checkoutStatus: string
    paymentCollectedAt: string | null
    status: string
    sessionStep: string | null
  }
  meta: {
    mutated: boolean
    noOp: boolean
    completedBooking: boolean
  }
}

function normalizeBookingId(raw: string | null | undefined): string | null {
  const value = raw?.trim()
  return value ? value : null
}

function parseWaiveReason(rawBody: unknown): string | null {
  if (!rawBody || typeof rawBody !== 'object') {
    return null
  }

  const value = 'reason' in rawBody ? rawBody.reason : null
  const reason = pickString(value)

  return reason ? reason.slice(0, 500) : null
}

function buildSuccessBody(result: {
  booking: {
    id: string
    checkoutStatus: unknown
    paymentCollectedAt: Date | string | null
    status: unknown
    sessionStep: unknown
  }
  meta: {
    mutated: boolean
    noOp: boolean
    completedBooking?: boolean
  }
}): WaiveCheckoutSuccessBody {
  const paymentCollectedAt =
    result.booking.paymentCollectedAt instanceof Date
      ? result.booking.paymentCollectedAt.toISOString()
      : typeof result.booking.paymentCollectedAt === 'string'
        ? result.booking.paymentCollectedAt
        : null

  return {
    booking: {
      id: result.booking.id,
      checkoutStatus: String(result.booking.checkoutStatus),
      paymentCollectedAt,
      status: String(result.booking.status),
      sessionStep:
        result.booking.sessionStep == null
          ? null
          : String(result.booking.sessionStep),
    },
    meta: {
      mutated: result.meta.mutated,
      noOp: result.meta.noOp,
      completedBooking: result.meta.completedBooking ?? false,
    },
  }
}

export async function POST(request: Request, context: RouteContext) {
  let idempotencyRecordId: string | null = null

  try {
    const auth = await requirePro()

    if (!auth.ok) {
      return auth.res
    }

    const { id } = await resolveRouteParams(context)
    const bookingId = normalizeBookingId(id)

    if (!bookingId) {
      return bookingJsonFail('BOOKING_ID_REQUIRED')
    }

    const rawBody = await request.json().catch(() => ({}))
    const reason = parseWaiveReason(rawBody)

    const rateLimit = await enforceRateLimit({
      bucket: 'pro:bookings:write',
      key: proRateLimitKey({
        professionalId: auth.professionalId,
        userId: auth.user.id,
        request,
      }),
    })

    if (!rateLimit.allowed) {
      return rateLimitExceededResponse(rateLimit)
    }

    const idempotency = await beginRouteIdempotency<WaiveCheckoutSuccessBody>({
      request,
      actor: {
        actorUserId: auth.user.id,
        actorRole: Role.PRO,
      },
      route: IDEMPOTENCY_ROUTES.PRO_BOOKING_CHECKOUT_WAIVE,
      requestLabel: 'pro booking checkout waive',
      requestBody: {
        bookingId,
        professionalId: auth.professionalId,
        action: 'WAIVE',
        reason,
      },
      messages: {
        missingKey: 'Missing idempotency key.',
        inProgress: 'A matching checkout waive request is already in progress.',
        conflict:
          'This idempotency key was already used with a different checkout waive request.',
      },
    })

    if (isRouteIdempotencyHandled(idempotency)) {
      return idempotency.response
    }

    idempotencyRecordId = idempotency.idempotencyRecordId

    const result = await waiveProBookingCheckout({
      bookingId,
      professionalId: auth.professionalId,
      actorUserId: auth.user.id,
      requestId: pickString(request.headers.get('x-request-id')),
      idempotencyKey: idempotency.idempotencyKey,
      reason,
    })

    const responseBody = buildSuccessBody(result)

    await completeRouteIdempotency({
      idempotencyRecordId,
      responseStatus: 200,
      responseBody,
    })

    return jsonOk(responseBody)
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
      return bookingErrorJsonFail(error)
    }

    console.error(`${ROUTE_OPERATION} error`, {
      error: safeError(error),
      meta: safeLogMeta({
        route: ROUTE_OPERATION,
        idempotencyRecordId,
      }),
    })

    const message = error instanceof Error ? error.message : 'Unknown error.'

    return bookingJsonFail('INTERNAL_ERROR', {
      message,
      userMessage: 'Internal server error',
    })
  }
}