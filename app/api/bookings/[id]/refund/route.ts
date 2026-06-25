// app/api/bookings/[id]/refund/route.ts
//
// Discretionary refund endpoint for a booking's captured Stripe payment.
//   - PRO   may refund their OWN bookings (partial or full).
//   - ADMIN may refund ANY booking (partial or full) — full override.
// Clients cannot issue discretionary refunds (the automatic ≥24h client refund
// is handled in the cancel flow). The money mechanics live in the refund service
// (reverse_transfer, idempotent reserve, partial accounting); this route is auth
// + input validation + result mapping.

import { BookingRefundTrigger, Role, type Prisma } from '@prisma/client'

import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { withRouteIdempotency } from '@/app/api/_utils/idempotency'
import { pickString } from '@/app/api/_utils/pick'
import { jsonFail } from '@/app/api/_utils/responses'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { prisma } from '@/lib/prisma'
import { refundBookingPayment, type RefundSkipReason } from '@/lib/booking/refunds'
import { kickNotificationDrain } from '@/lib/notifications/delivery/kickNotificationDrain'
import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import { enforceRateLimit } from '@/lib/rateLimit/enforce'
import { proRateLimitKey } from '@/lib/rateLimit/identity'
import { rateLimitExceededResponse } from '@/lib/rateLimit/response'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROUTE_OPERATION = 'POST /api/bookings/[id]/refund'

type RefundResponseBody = {
  ok: true
  refund: {
    id: string
    bookingId: string
    amountCents: number
    currency: string
    status: string
    bookingFullyRefunded: boolean
  }
}

type RefundErrorBody = {
  ok: false
  error: string
  code: string
}

type RefundRouteBody = RefundResponseBody | RefundErrorBody

// Stripe-side failure after a row was reserved: throw so withRouteIdempotency
// marks the record failed-and-retryable (vs caching a terminal error response).
class RefundProcessingError extends Error {}

function parseAmountCents(
  value: unknown,
): { ok: true; amountCents: number | null } | { ok: false; error: string } {
  if (value === undefined || value === null) {
    return { ok: true, amountCents: null }
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return {
      ok: false,
      error: 'amountCents must be a positive integer number of cents.',
    }
  }

  return { ok: true, amountCents: value }
}

function skippedResponse(
  reason: RefundSkipReason,
): { status: number; body: RefundErrorBody } {
  if (reason === 'NOTHING_TO_REFUND') {
    return {
      status: 409,
      body: {
        ok: false,
        error: 'This booking is already fully refunded.',
        code: reason,
      },
    }
  }

  if (reason === 'PAYMENT_DISPUTED') {
    return {
      status: 409,
      body: {
        ok: false,
        error:
          'This booking has an open or lost payment dispute. Refunds are blocked until the dispute resolves.',
        code: reason,
      },
    }
  }

  if (reason === 'PAYMENT_NOT_CAPTURED') {
    return {
      status: 409,
      body: {
        ok: false,
        error: 'This booking has no captured payment to refund.',
        code: reason,
      },
    }
  }

  return {
    status: 422,
    body: {
      ok: false,
      error: 'This booking has no Stripe payment to refund.',
      code: reason,
    },
  }
}

export async function POST(req: Request, ctx: RouteContext) {
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

    const body = await readJsonRecord(req)

    const parsedAmount = parseAmountCents(body.amountCents)
    if (!parsedAmount.ok) {
      return jsonFail(400, parsedAmount.error, { code: 'INVALID_AMOUNT' })
    }

    const reason = pickString(body.reason)?.slice(0, 500) ?? null

    // Authorization: pro may only refund their own bookings; admin may refund any.
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, professionalId: true },
    })

    if (!booking) {
      return jsonFail(404, 'Booking not found.', { code: 'BOOKING_NOT_FOUND' })
    }

    const professionalId = user.professionalProfile?.id ?? null

    if (user.role === Role.PRO) {
      if (!professionalId || booking.professionalId !== professionalId) {
        return jsonFail(403, 'You are not allowed to refund this booking.', {
          code: 'FORBIDDEN',
        })
      }
    }

    const rateLimit = await enforceRateLimit({
      bucket: 'bookings:refund',
      key: proRateLimitKey({
        professionalId,
        userId: user.id,
        request: req,
      }),
    })

    if (!rateLimit.allowed) {
      return rateLimitExceededResponse(rateLimit)
    }

    const response = await withRouteIdempotency<RefundRouteBody>(
      {
        request: req,
        actor: {
          actorUserId: user.id,
          actorRole: user.role,
        },
        route: IDEMPOTENCY_ROUTES.BOOKING_REFUND,
        requestLabel: 'booking refund',
        requestBody: {
          bookingId,
          actorUserId: user.id,
          actorRole: user.role,
          amountCents: parsedAmount.amountCents,
        } satisfies Prisma.InputJsonObject,
        messages: {
          missingKey: 'Missing idempotency key for booking refund.',
          inProgress: 'A matching refund request is already in progress.',
          conflict:
            'This idempotency key was already used with different refund details.',
        },
        operation: ROUTE_OPERATION,
      },
      async () => {
        const result = await refundBookingPayment({
          bookingId,
          trigger: BookingRefundTrigger.DISCRETIONARY,
          amountCents: parsedAmount.amountCents,
          reason,
          actor: { userId: user.id, role: user.role },
        })

        if (result.outcome === 'REFUNDED') {
          const responseBody: RefundResponseBody = {
            ok: true,
            refund: {
              id: result.refund.id,
              bookingId: result.refund.bookingId,
              amountCents: result.refund.amountCents,
              currency: result.refund.currency,
              status: result.refund.status,
              bookingFullyRefunded: result.bookingFullyRefunded,
            },
          }
          return { status: 200, body: responseBody }
        }

        // SKIPPED / INVALID are deterministic client errors — safe to surface
        // (and cache under the idempotency key).
        if (result.outcome === 'SKIPPED') {
          return skippedResponse(result.reason)
        }

        if (result.outcome === 'INVALID') {
          const status = result.code === 'BOOKING_NOT_FOUND' ? 404 : 400
          return {
            status,
            body: { ok: false, error: result.message, code: result.code },
          }
        }

        // FAILED → throw so the idempotency record is marked retryable rather
        // than caching a terminal error response.
        throw new RefundProcessingError(result.message)
      },
    )

    // A successful refund enqueues the client's refund notification — deliver
    // it now (no-op for skipped/invalid outcomes, which enqueue nothing).
    kickNotificationDrain()

    return response
  } catch (error: unknown) {
    if (error instanceof RefundProcessingError) {
      return jsonFail(
        502,
        'The refund could not be processed. Please try again.',
        { code: 'REFUND_FAILED' },
      )
    }

    console.error(`${ROUTE_OPERATION} error`, safeError(error))
    return jsonFail(500, 'Failed to process refund.')
  }
}
