// app/api/pro/bookings/[id]/session/step/route.ts

import { Prisma, Role, SessionStep } from '@prisma/client'

import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import {
  getBookingFailPayload,
  isBookingError,
  type BookingErrorCode,
} from '@/lib/booking/errors'
import { SESSION_STEP_TRANSITIONS } from '@/lib/booking/lifecycleContract'
import { transitionSessionStep } from '@/lib/booking/writeBoundary'
import {
  beginIdempotency,
  completeIdempotency,
  failIdempotency,
  IDEMPOTENCY_ROUTES,
} from '@/lib/idempotency'
import { captureBookingException } from '@/lib/observability/bookingEvents'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

type RequestMeta = {
  requestId: string | null
  idempotencyKey: string | null
}

type NestedInputJsonValue = Prisma.InputJsonValue | null

type JsonObjectPayload = {
  [key: string]: NestedInputJsonValue
}

function bookingJsonFail(
  code: BookingErrorCode,
  overrides?: {
    message?: string
    userMessage?: string
  },
) {
  const fail = getBookingFailPayload(code, overrides)
  return jsonFail(fail.httpStatus, fail.userMessage, fail.extra)
}

function idempotencyMissingKeyFail(): Response {
  return jsonFail(400, 'Missing idempotency key.', {
    code: 'IDEMPOTENCY_KEY_REQUIRED',
  })
}

function idempotencyInProgressFail(): Response {
  return jsonFail(
    409,
    'A matching session step request is already in progress.',
    {
      code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    },
  )
}

function idempotencyConflictFail(): Response {
  return jsonFail(
    409,
    'This idempotency key was already used with a different request body.',
    {
      code: 'IDEMPOTENCY_KEY_CONFLICT',
    },
  )
}

function readRequestMeta(request: Request): RequestMeta {
  const requestId =
    pickString(request.headers.get('x-request-id')) ??
    pickString(request.headers.get('request-id')) ??
    null

  const idempotencyKey =
    pickString(request.headers.get('idempotency-key')) ??
    pickString(request.headers.get('x-idempotency-key')) ??
    null

  return { requestId, idempotencyKey }
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
 * the PRO-allowed transition matrix. This is a coarse pre-filter that blocks
 * obviously illegal targets, such as DONE and NONE, before we hit the DB.
 */
function isReachableByPro(to: SessionStep): boolean {
  if (to === SessionStep.NONE) return false
  if (to === SessionStep.DONE) return false

  for (const [, toMap] of SESSION_STEP_TRANSITIONS) {
    const allowedActors = toMap.get(to)

    if (allowedActors && allowedActors.includes('PRO')) {
      return true
    }
  }

  return false
}

function normalizeNestedJsonValue(value: unknown): NestedInputJsonValue {
  if (value === null || value === undefined) {
    return null
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (value instanceof Prisma.Decimal) {
    return value.toString()
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeNestedJsonValue(item))
  }

  if (typeof value === 'object') {
    const input = value as Record<string, unknown>
    const out: JsonObjectPayload = {}

    for (const key of Object.keys(input).sort()) {
      out[key] = normalizeNestedJsonValue(input[key])
    }

    return out
  }

  return String(value)
}

function normalizeJsonObjectPayload(value: unknown): JsonObjectPayload {
  if (value === null || value === undefined) {
    return {}
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    return {
      value: normalizeNestedJsonValue(value),
    }
  }

  const input = value as Record<string, unknown>
  const out: JsonObjectPayload = {}

  for (const key of Object.keys(input).sort()) {
    out[key] = normalizeNestedJsonValue(input[key])
  }

  return out
}

export async function POST(req: Request, ctx: Ctx) {
  let idempotencyRecordId: string | null = null

  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId
    const actorUserId = auth.user.id

    if (!actorUserId || !actorUserId.trim()) {
      return bookingJsonFail('FORBIDDEN', {
        message: 'Authenticated actor user id is required.',
        userMessage: 'You are not allowed to update this session.',
      })
    }

    const params = await Promise.resolve(ctx.params)
    const bookingId = pickString(params?.id)

    if (!bookingId) {
      return bookingJsonFail('BOOKING_ID_REQUIRED')
    }

    const rawBody: unknown = await req.json().catch(() => ({}))
    const body =
      rawBody && typeof rawBody === 'object'
        ? (rawBody as Record<string, unknown>)
        : {}

    const nextStep = parseStep(body.step)

    if (!nextStep) {
      return jsonFail(400, 'Missing or invalid step.', {
        code: 'INVALID_SESSION_STEP',
      })
    }

    // Server-side lifecycle contract pre-check: reject steps that PROs are never
    // allowed to transition to directly. The fine-grained from-to check is
    // enforced inside transitionSessionStep / writeBoundary.
    if (!isReachableByPro(nextStep)) {
      return jsonFail(
        422,
        `Step "${nextStep}" cannot be set directly by this route.`,
        {
          code: 'SESSION_STEP_NOT_REACHABLE_BY_PRO',
        },
      )
    }

    const { requestId, idempotencyKey } = readRequestMeta(req)

    const idempotency = await beginIdempotency<JsonObjectPayload>({
      actor: {
        actorUserId,
        actorRole: Role.PRO,
      },
      route: IDEMPOTENCY_ROUTES.BOOKING_SESSION_STEP,
      key: idempotencyKey,
      requestBody: {
        professionalId,
        actorUserId,
        bookingId,
        nextStep,
      },
    })

    if (idempotency.kind === 'missing_key') {
      return idempotencyMissingKeyFail()
    }

    if (idempotency.kind === 'in_progress') {
      return idempotencyInProgressFail()
    }

    if (idempotency.kind === 'conflict') {
      return idempotencyConflictFail()
    }

    if (idempotency.kind === 'replay') {
      return jsonOk(idempotency.responseBody, idempotency.responseStatus)
    }

    idempotencyRecordId = idempotency.idempotencyRecordId

    const result = await transitionSessionStep({
      bookingId,
      professionalId,
      nextStep,
      requestId,
      idempotencyKey,
    })

    if (!result.ok) {
      await failIdempotency({ idempotencyRecordId })
      idempotencyRecordId = null

      return jsonFail(result.status, result.error, {
        forcedStep: result.forcedStep ?? null,
      })
    }

    const responseBody = normalizeJsonObjectPayload({
      booking: result.booking,
    })

    await completeIdempotency({
      idempotencyRecordId,
      responseStatus: 200,
      responseBody,
    })

    return jsonOk(responseBody, 200)
  } catch (error: unknown) {
    if (idempotencyRecordId) {
      await failIdempotency({ idempotencyRecordId }).catch((failError) => {
        console.error(
          'POST /api/pro/bookings/[id]/session/step idempotency failure update error:',
          failError,
        )
      })
    }

    if (isBookingError(error)) {
      return bookingJsonFail(error.code, {
        message: error.message,
        userMessage: error.userMessage,
      })
    }

    console.error('POST /api/pro/bookings/[id]/session/step error', error)
    captureBookingException({
      error,
      route: 'POST /api/pro/bookings/[id]/session/step',
    })

    return jsonFail(500, 'Internal server error')
  }
}