// app/api/bookings/[id]/cancel/route.ts

import { Role, type Prisma } from '@prisma/client'

import { requireUser } from '@/app/api/_utils/auth/requireUser'
import {
  beginRouteIdempotency,
  completeRouteIdempotency,
  failStartedRouteIdempotency,
  isRouteIdempotencyHandled,
} from '@/app/api/_utils/idempotency'
import { pickString } from '@/app/api/_utils/pick'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import {
  getBookingFailPayload,
  isBookingError,
} from '@/lib/booking/errors'
import { cancelBooking } from '@/lib/booking/writeBoundary'
import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import { enforceRateLimit } from '@/lib/rateLimit/enforce'
import { clientRateLimitKey, proRateLimitKey } from '@/lib/rateLimit/identity'
import { rateLimitExceededResponse } from '@/lib/rateLimit/response'

export const dynamic = 'force-dynamic'

type Params = { id: string }
type Ctx = { params: Params | Promise<Params> }

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
}

function bookingJsonFail(
  code: Parameters<typeof getBookingFailPayload>[0],
  overrides?: {
    message?: string
    userMessage?: string
  },
): Response {
  const fail = getBookingFailPayload(code, overrides)
  return jsonFail(fail.httpStatus, fail.userMessage, fail.extra)
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
): CancelResponseBody {
  return {
    ok: true,
    id: result.booking.id,
    status: result.booking.status,
    sessionStep: result.booking.sessionStep,
    meta: result.meta,
  }
}

export async function POST(req: Request, ctx: Ctx) {
  let idempotencyRecordId: string | null = null

  try {
    const auth = await requireUser({
      roles: [Role.CLIENT, Role.PRO, Role.ADMIN],
    })

    if (!auth.ok) {
      return auth.res
    }

    const user = auth.user
    const params = await Promise.resolve(ctx.params)
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

    const idempotency = await beginRouteIdempotency<CancelResponseBody>({
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
    })

    if (isRouteIdempotencyHandled(idempotency)) {
      return idempotency.response
    }

    idempotencyRecordId = idempotency.idempotencyRecordId

    const result = await cancelBooking({
      bookingId,
      actor,
    })

    const responseBody = toCancelResponseBody(result)

    await completeRouteIdempotency({
      idempotencyRecordId,
      responseStatus: 200,
      responseBody,
    })

    return jsonOk(responseBody, 200)
  } catch (error: unknown) {
    await failStartedRouteIdempotency({
      idempotencyRecordId,
      operation: 'POST /api/bookings/[id]/cancel',
    })

    if (isBookingError(error)) {
      return bookingJsonFail(error.code, {
        message: error.message,
        userMessage: error.userMessage,
      })
    }

    console.error('POST /api/bookings/[id]/cancel error', error)

    return jsonFail(500, 'Failed to cancel booking.')
  }
}