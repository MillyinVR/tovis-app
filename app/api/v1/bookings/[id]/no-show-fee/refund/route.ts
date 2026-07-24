// app/api/v1/bookings/[id]/no-show-fee/refund/route.ts
//
// Refund (give back) a CHARGED no-show / late-cancel fee. The money mechanics +
// state rules live in the refund service (refundNoShowFee): only a CHARGED fee is
// refundable, it rides its OWN PaymentIntent (reverse_transfer, per-PI accounting,
// GAP B discriminator), and a fee under a Stripe dispute is frozen. This route is
// auth + ownership + idempotency + result mapping — the sibling of no-show-fee/waive.
//
//   - PRO   may refund the fee on their OWN bookings.
//   - ADMIN may refund on any booking (acts on the booking's professional).
// Full-refund-only: the whole remaining fee is returned to the client.

import { Role, type Prisma } from '@prisma/client'

import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { withRouteIdempotency } from '@/app/api/_utils/idempotency'
import { pickString } from '@/app/api/_utils/pick'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { jsonFail } from '@/app/api/_utils'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { prisma } from '@/lib/prisma'
import { refundNoShowFee } from '@/lib/booking/refunds'
import { getBookingErrorMeta } from '@/lib/booking/errors'
import { kickNotificationDrain } from '@/lib/notifications/delivery/kickNotificationDrain'
import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import { enforceRateLimit } from '@/lib/rateLimit/enforce'
import { proRateLimitKey } from '@/lib/rateLimit/identity'
import { rateLimitExceededResponse } from '@/lib/rateLimit/response'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROUTE_OPERATION = 'POST /api/v1/bookings/[id]/no-show-fee/refund'

type RefundSuccessBody = {
  ok: true
  noShowFee: { status: 'REFUNDED'; refundedCents: number }
}

type RefundErrorBody = {
  ok: false
  error: string
  code: string
}

type RefundRouteBody = RefundSuccessBody | RefundErrorBody

// Stripe-side failure after the fee row was claimed: throw so withRouteIdempotency
// marks the record failed-and-retryable rather than caching a terminal response.
class NoShowFeeRefundProcessingError extends Error {}

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
    const reason = pickString(body.reason)?.slice(0, 500) ?? null

    // Resolve the professional this refund acts on. Pro acts on themselves; admin
    // acts on the booking's professional. Missing / foreign-to-this-pro bookings
    // collapse to a uniform 404.
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, professionalId: true },
    })

    if (!booking) {
      return jsonFail(404, 'Booking not found.', { code: 'BOOKING_NOT_FOUND' })
    }

    const proProfileId = user.professionalProfile?.id ?? null

    if (user.role === Role.PRO) {
      if (!proProfileId || booking.professionalId !== proProfileId) {
        return jsonFail(404, 'Booking not found.', {
          code: 'BOOKING_NOT_FOUND',
        })
      }
    }

    const professionalId =
      user.role === Role.ADMIN ? booking.professionalId : proProfileId

    if (!professionalId) {
      return jsonFail(404, 'Booking not found.', { code: 'BOOKING_NOT_FOUND' })
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
        route: IDEMPOTENCY_ROUTES.BOOKING_NO_SHOW_FEE_REFUND,
        requestLabel: 'no-show fee refund',
        requestBody: {
          bookingId,
          professionalId,
          actorUserId: user.id,
          actorRole: user.role,
        } satisfies Prisma.InputJsonObject,
        messages: {
          missingKey: 'Missing idempotency key for no-show fee refund.',
          inProgress: 'A matching refund request is already in progress.',
          conflict:
            'This idempotency key was already used with different refund details.',
        },
        operation: ROUTE_OPERATION,
      },
      async () => {
        const result = await refundNoShowFee({
          bookingId,
          reason,
          actor: { userId: user.id, role: user.role },
        })

        if (result.outcome === 'REFUNDED') {
          const okBody: RefundSuccessBody = {
            ok: true,
            noShowFee: {
              status: 'REFUNDED',
              refundedCents: result.refundAmountCents,
            },
          }
          return { status: 200, body: okBody }
        }

        // NOT_ATTEMPTED codes are deterministic client errors — safe to surface
        // and cache under the idempotency key. Map through the booking error
        // catalog so the HTTP status + user message stay in one place.
        if (result.outcome === 'NOT_ATTEMPTED') {
          const meta = getBookingErrorMeta(result.code)
          return {
            status: meta.httpStatus,
            body: { ok: false, error: meta.userMessage, code: result.code },
          }
        }

        // FAILED → throw so the idempotency record is marked retryable rather than
        // caching a terminal error response (the claim was already rolled back).
        throw new NoShowFeeRefundProcessingError(result.message)
      },
    )

    // A successful refund enqueues the client's refund receipt — deliver it now
    // (no-op for the NOT_ATTEMPTED outcomes, which enqueue nothing).
    kickNotificationDrain()

    return response
  } catch (error: unknown) {
    if (error instanceof NoShowFeeRefundProcessingError) {
      return jsonFail(
        502,
        'The refund could not be processed. Please try again.',
        { code: 'REFUND_FAILED' },
      )
    }

    console.error(`${ROUTE_OPERATION} error`, safeError(error))
    return jsonFail(500, 'Failed to refund the no-show fee.')
  }
}
