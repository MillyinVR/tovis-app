// app/api/v1/pro/bookings/[id]/session/step/route.ts

import { Role, SessionStep } from '@prisma/client'

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
import { SESSION_STEP_TRANSITIONS } from '@/lib/booking/lifecycleContract'
import { transitionSessionStep } from '@/lib/booking/writeBoundary'
import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import { captureBookingException } from '@/lib/observability/bookingEvents'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'

function readRequestId(request: Request): string | null {
  return (
    pickString(request.headers.get('x-request-id')) ??
    pickString(request.headers.get('request-id')) ??
    null
  )
}

function parseStep(value: unknown): SessionStep | null {
  if (typeof value !== 'string') return null

  const normalized = value.trim().toUpperCase()

  return (Object.values(SessionStep) as string[]).includes(normalized)
    ? (normalized as SessionStep)
    : null
}

/**
 * Returns true if `to` is a valid destination step from any source step in
 * the PRO-allowed transition matrix. This blocks globally illegal targets,
 * such as DONE and NONE, before we hit the DB.
 */
function isReachableByPro(to: SessionStep): boolean {
  if (to === SessionStep.NONE) return false
  if (to === SessionStep.DONE) return false

  for (const [, toMap] of SESSION_STEP_TRANSITIONS) {
    const allowedActors = toMap.get(to)

    if (allowedActors?.includes('PRO')) {
      return true
    }
  }

  return false
}

export async function POST(req: Request, ctx: RouteContext) {
  let idempotencyRecordId: string | null = null
  const requestId = readRequestId(req)

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
        userMessage: 'You are not allowed to update this session.',
      })
    }

    const params = await resolveRouteParams(ctx)
    const bookingId = pickString(params?.id)

    if (!bookingId) {
      return bookingJsonFail('BOOKING_ID_REQUIRED')
    }

    const rawBody: unknown = await req.json().catch(() => ({}))
    const body: Record<string, unknown> =
      rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody)
        ? (rawBody as Record<string, unknown>)
        : {}

    const nextStep = parseStep(body.step)

    if (!nextStep) {
      return jsonFail(400, 'Missing or invalid step.', {
        code: 'INVALID_SESSION_STEP',
      })
    }

    if (!isReachableByPro(nextStep)) {
      return jsonFail(
        422,
        `Step "${nextStep}" cannot be set directly by this route.`,
        {
          code: 'SESSION_STEP_NOT_REACHABLE_BY_PRO',
        },
      )
    }

    const idempotency = await beginRouteIdempotency<JsonObjectPayload>({
      request: req,
      actor: {
        actorUserId,
        actorRole: Role.PRO,
      },
      route: IDEMPOTENCY_ROUTES.BOOKING_SESSION_STEP,
      requestLabel: 'session step',
      requestBody: {
        professionalId,
        actorUserId,
        bookingId,
        nextStep,
      },
      messages: {
        missingKey: 'Missing idempotency key.',
        inProgress: 'A matching session step request is already in progress.',
        conflict:
          'This idempotency key was already used with a different request body.',
      },
    })

    if (isRouteIdempotencyHandled(idempotency)) {
      return idempotency.response
    }

    idempotencyRecordId = idempotency.idempotencyRecordId

    const result = await transitionSessionStep({
      bookingId,
      professionalId,
      nextStep,
      requestId,
      idempotencyKey: idempotency.idempotencyKey,
    })

    if (!result.ok) {
      await failStartedRouteIdempotency({
        idempotencyRecordId,
        operation: 'POST /api/v1/pro/bookings/[id]/session/step',
      })

      idempotencyRecordId = null

      return jsonFail(result.status, result.error, {
        forcedStep: result.forcedStep ?? null,
      })
    }

    const responseBody = normalizeJsonObjectPayload({
      booking: result.booking,
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
      operation: 'POST /api/v1/pro/bookings/[id]/session/step',
    })

    if (isBookingError(error)) {
      return bookingJsonFail(error.code, {
        message: error.message,
        userMessage: error.userMessage,
      })
    }

    console.error('POST /api/v1/pro/bookings/[id]/session/step error', {
      requestId,
      error: safeError(error),
    })

    captureBookingException({
      error,
      route: 'POST /api/v1/pro/bookings/[id]/session/step',
    })

    return jsonFail(500, 'Internal server error')
  }
}