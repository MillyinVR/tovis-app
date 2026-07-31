// app/api/v1/public/appointment/[token]/cancel/route.ts
//
// K12: cancel from the reminder link. NOT a shortcut write — the token only
// substitutes for the session (it supplies the clientId, the K10-B pattern);
// everything after that is the authed client cancel exactly: the same
// cancelBooking boundary call (actor kind 'client', same lock, same lifecycle
// contract, same pro notification) and the same shared refund orchestration
// (service refund → discovery deposit policy → late-cancel fee → honest
// summary), so a token cancel structurally cannot produce a different refund
// outcome than an in-app cancel (the K12 DoD).
//
// Sits behind the same route-idempotency ledger as the authed cancel (keyed on
// the token actor), because a cancel is not naturally replayable: the refund
// legs must not be re-entered by a double tap.

import { Role, type Prisma } from '@prisma/client'
import { kickNotificationDrain } from '@/lib/notifications/delivery/kickNotificationDrain'

import { jsonFail, pickString } from '@/app/api/_utils'
import {
  bookingErrorJsonFail,
  bookingJsonFail,
} from '@/app/api/_utils/bookingResponses'
import { withRouteIdempotency } from '@/app/api/_utils/idempotency'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import {
  markAppointmentConfirmationTokenUsed,
  resolveAppointmentConfirmationTokenForMutation,
} from '@/lib/booking/appointmentConfirmationTokens'
import { type CancelRefundSummary } from '@/lib/booking/cancelRefund'
import { runCancelRefundOrchestration } from '@/lib/booking/cancelRefundOrchestration'
import { clientConfirmationLoopEnabled } from '@/lib/booking/clientConfirmationLoop'
import { isBookingError } from '@/lib/booking/errors'
import { cancelBooking } from '@/lib/booking/writeBoundary'
import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import { enforceRateLimit } from '@/lib/rateLimit/enforce'
import { tokenActorRateLimitKey } from '@/lib/rateLimit/identity'
import { rateLimitExceededResponse } from '@/lib/rateLimit/response'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROUTE_OPERATION = 'POST /api/v1/public/appointment/[token]/cancel'

type CancelResponseBody = {
  ok: true
  id: string
  status: string
  refund: CancelRefundSummary
}

export async function POST(req: Request, ctx: RouteContext<{ token: string }>) {
  try {
    if (!clientConfirmationLoopEnabled()) {
      return bookingJsonFail('APPOINTMENT_TOKEN_INVALID', {
        message: 'Client confirmation loop is disabled.',
        userMessage: 'That appointment link is invalid or expired.',
      })
    }

    const params = await resolveRouteParams(ctx)
    const rawToken = pickString(params?.token)

    if (!rawToken) {
      return bookingJsonFail('APPOINTMENT_TOKEN_MISSING')
    }

    const rateLimit = await enforceRateLimit({
      bucket: 'client:appointment:token',
      key: tokenActorRateLimitKey({
        actorKey: rawToken,
        request: req,
      }),
    })

    if (!rateLimit.allowed) {
      return rateLimitExceededResponse(rateLimit)
    }

    const resolved = await resolveAppointmentConfirmationTokenForMutation({
      rawToken,
    })

    const bookingId = resolved.booking.id
    const clientId = resolved.booking.clientId

    const response = await withRouteIdempotency<CancelResponseBody>(
      {
        request: req,
        actor: {
          actorKey: resolved.idempotencyActorKey,
          actorRole: Role.CLIENT,
        },
        route: IDEMPOTENCY_ROUTES.PUBLIC_APPOINTMENT_CANCEL,
        requestLabel: 'booking cancellation',
        requestBody: {
          appointmentTokenId: resolved.token.id,
          bookingId,
          clientId,
        } satisfies Prisma.InputJsonObject,
        messages: {
          missingKey: 'Missing idempotency key for booking cancellation.',
          inProgress:
            'A matching booking cancellation request is already in progress.',
          conflict:
            'This idempotency key was already used with different cancellation details.',
        },
        operation: ROUTE_OPERATION,
      },
      async () => {
        const result = await cancelBooking({
          bookingId,
          actor: { kind: 'client', clientId },
        })

        // Identical policy to the authed route — ONE shared orchestration.
        // actorUserId is null: the token actor may be an unclaimed client with
        // no user account.
        const refund = await runCancelRefundOrchestration({
          bookingId,
          actorKind: 'client',
          actorUserId: null,
          cancelMutated: result.meta.mutated,
          priorStatus: result.priorStatus,
          operation: ROUTE_OPERATION,
        })

        // Usage stamped after the cancel + refund legs settled — the token is
        // not single-use and is never burned, only counted.
        await markAppointmentConfirmationTokenUsed({
          tokenId: resolved.token.id,
        })

        return {
          status: 200,
          body: {
            ok: true,
            id: result.booking.id,
            status: result.booking.status,
            refund,
          },
        }
      },
    )

    // Cancellation (and any auto-refund) committed — deliver the notices now.
    kickNotificationDrain()

    return response
  } catch (error: unknown) {
    if (isBookingError(error)) {
      return bookingErrorJsonFail(error)
    }

    console.error(`${ROUTE_OPERATION} error`, safeError(error))

    return jsonFail(500, 'Failed to cancel booking.')
  }
}
