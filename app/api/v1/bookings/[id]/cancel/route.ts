// app/api/v1/bookings/[id]/cancel/route.ts

import { Role, type Prisma } from '@prisma/client'
import { kickNotificationDrain } from '@/lib/notifications/delivery/kickNotificationDrain'

import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { withRouteIdempotency } from '@/app/api/_utils/idempotency'
import { pickString } from '@/app/api/_utils/pick'
import { jsonFail } from '@/app/api/_utils/responses'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import {
  isBookingError,
} from '@/lib/booking/errors'
import {
  bookingErrorJsonFail,
  bookingJsonFail,
} from '@/app/api/_utils/bookingResponses'
import { cancelBooking } from '@/lib/booking/writeBoundary'
import { type CancelRefundSummary } from '@/lib/booking/cancelRefund'
import { runCancelRefundOrchestration } from '@/lib/booking/cancelRefundOrchestration'
import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import { enforceRateLimit } from '@/lib/rateLimit/enforce'
import { safeError } from '@/lib/security/logging'
import { clientRateLimitKey, proRateLimitKey } from '@/lib/rateLimit/identity'
import { rateLimitExceededResponse } from '@/lib/rateLimit/response'

export const dynamic = 'force-dynamic'

type CancelActor =
  | {
      kind: 'admin'
      professionalId: string | null
    }
  | {
      kind: 'client'
      clientId: string
    }
  | {
      kind: 'pro'
      professionalId: string
    }

type CancelResponseBody = {
  ok: true
  id: string
  status: string
  sessionStep: string
  meta: Prisma.InputJsonValue
  /**
   * Honest, client-facing summary of what happened to the client's money on this
   * cancel (M6). Present so the acting client's UI can tell them the truth instead
   * of silence — never a refund promise the ledger can't back.
   */
  refund: CancelRefundSummary
}

function toCancelActor(args: {
  role: Role
  clientId: string | null
  professionalId: string | null
}): CancelActor | null {
  if (args.role === Role.ADMIN) {
    return {
      kind: 'admin',
      professionalId: args.professionalId,
    }
  }

  if (args.role === Role.CLIENT && args.clientId) {
    return {
      kind: 'client',
      clientId: args.clientId,
    }
  }

  if (args.role === Role.PRO && args.professionalId) {
    return {
      kind: 'pro',
      professionalId: args.professionalId,
    }
  }

  return null
}

function buildCancelRateLimitKey(args: {
  actor: CancelActor
  userId: string
  request: Request
}): string {
  if (args.actor.kind === 'client') {
    return clientRateLimitKey({
      clientId: args.actor.clientId,
      userId: args.userId,
      request: args.request,
    })
  }

  if (args.actor.kind === 'pro') {
    return proRateLimitKey({
      professionalId: args.actor.professionalId,
      userId: args.userId,
      request: args.request,
    })
  }

  return proRateLimitKey({
    professionalId: args.actor.professionalId,
    userId: args.userId,
    request: args.request,
  })
}

function buildCancelIdempotencyBody(args: {
  bookingId: string
  actorUserId: string
  actorRole: Role
  clientId: string | null
  professionalId: string | null
  cancelActorKind: CancelActor['kind']
}): Prisma.InputJsonObject {
  return {
    bookingId: args.bookingId,
    actorUserId: args.actorUserId,
    actorRole: args.actorRole,
    clientId: args.clientId,
    professionalId: args.professionalId,
    cancelActorKind: args.cancelActorKind,
  }
}

function toCancelResponseBody(
  result: Awaited<ReturnType<typeof cancelBooking>>,
  refund: CancelRefundSummary,
): CancelResponseBody {
  return {
    ok: true,
    id: result.booking.id,
    status: result.booking.status,
    sessionStep: result.booking.sessionStep,
    meta: result.meta,
    refund,
  }
}

export async function POST(req: Request, ctx: RouteContext) {
  try {
    const auth = await requireUser({
      roles: [Role.CLIENT, Role.PRO, Role.ADMIN],
    })

    if (!auth.ok) {
      return auth.res
    }

    const user = auth.user
    const params = await resolveRouteParams(ctx)
    const bookingId = pickString(params?.id)

    if (!bookingId) {
      return bookingJsonFail('BOOKING_ID_REQUIRED')
    }

    const clientId = user.clientProfile?.id ?? null
    const professionalId = user.professionalProfile?.id ?? null

    const actor = toCancelActor({
      role: user.role,
      clientId,
      professionalId,
    })

    if (!actor) {
      return bookingJsonFail('FORBIDDEN', {
        message: 'Authenticated user is missing the required booking profile.',
        userMessage: 'You are not allowed to cancel this booking.',
      })
    }

    const rateLimit = await enforceRateLimit({
      bucket: 'bookings:cancel',
      key: buildCancelRateLimitKey({
        actor,
        userId: user.id,
        request: req,
      }),
    })

    if (!rateLimit.allowed) {
      return rateLimitExceededResponse(rateLimit)
    }

    const response = await withRouteIdempotency<CancelResponseBody>(
      {
        request: req,
        actor: {
          actorUserId: user.id,
          actorRole: user.role,
        },
        route: IDEMPOTENCY_ROUTES.BOOKING_CANCEL,
        requestLabel: 'booking cancellation',
        requestBody: buildCancelIdempotencyBody({
          bookingId,
          actorUserId: user.id,
          actorRole: user.role,
          clientId,
          professionalId,
          cancelActorKind: actor.kind,
        }),
        messages: {
          missingKey: 'Missing idempotency key for booking cancellation.',
          inProgress:
            'A matching booking cancellation request is already in progress.',
          conflict:
            'This idempotency key was already used with different cancellation details.',
        },
        operation: 'POST /api/v1/bookings/[id]/cancel',
      },
      async () => {
        const result = await cancelBooking({
          bookingId,
          actor,
        })

        // The post-cancel refund policy (service refund → discovery deposit →
        // late-cancel fee → honest summary) lives in ONE place, shared with the
        // K12 token-cancel route so the two can never drift.
        const refund = await runCancelRefundOrchestration({
          bookingId,
          actorKind: actor.kind,
          actorUserId: user.id,
          cancelMutated: result.meta.mutated,
          priorStatus: result.priorStatus,
          operation: 'POST /api/v1/bookings/[id]/cancel',
        })

        return { status: 200, body: toCancelResponseBody(result, refund) }
      },
    )

    // Cancellation (and any auto-refund) committed — deliver the notices now.
    kickNotificationDrain()

    return response
  } catch (error: unknown) {
    if (isBookingError(error)) {
      return bookingErrorJsonFail(error)
    }

    console.error('POST /api/v1/bookings/[id]/cancel error', safeError(error))

    return jsonFail(500, 'Failed to cancel booking.')
  }
}