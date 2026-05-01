// app/api/client/rebook/[token]/route.ts
import { NextRequest } from 'next/server'
import {
  pickIsoDate,
  pickString,
  jsonFail,
  jsonOk,
} from '@/app/api/_utils'
import { isRecord } from '@/lib/guards'
import {
  getBookingFailPayload,
  isBookingError,
  type BookingErrorCode,
} from '@/lib/booking/errors'
import { createClientRebookedBookingFromAftercare } from '@/lib/booking/writeBoundary'
import { resolveAftercareAccessByToken } from '@/lib/aftercare/unclaimedAftercareAccess'
import { AftercareRebookMode, Prisma, Role } from '@prisma/client'
import {
  beginIdempotency,
  buildPublicAftercareTokenActorKey,
  completeIdempotency,
  failIdempotency,
  IDEMPOTENCY_ROUTES,
} from '@/lib/idempotency'
import { captureBookingException } from '@/lib/observability/bookingEvents'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = {
  params: { token: string } | Promise<{ token: string }>
}

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
    'A matching rebook request is already in progress.',
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

async function getRouteToken(ctx: Ctx): Promise<string | null> {
  const params = await Promise.resolve(ctx.params)
  return pickString(params?.token)
}

function readHeaderValue(req: Request, name: string): string | null {
  return pickString(req.headers.get(name))
}

function readRequestMeta(req: Request): RequestMeta {
  return {
    requestId:
      readHeaderValue(req, 'x-request-id') ??
      readHeaderValue(req, 'request-id') ??
      null,
    idempotencyKey:
      readHeaderValue(req, 'idempotency-key') ??
      readHeaderValue(req, 'x-idempotency-key') ??
      null,
  }
}

function toIso(value: Date): string {
  return value.toISOString()
}

function toNullableIso(value: Date | null): string | null {
  return value ? value.toISOString() : null
}

function buildSecureLinkAccess(rawToken: string) {
  return {
    accessMode: 'SECURE_LINK' as const,
    hasPublicAccess: true,
    clientAftercareHref: `/client/rebook/${encodeURIComponent(rawToken)}`,
  }
}

function toGetResponse(args: {
  rawToken: string
  resolved: Awaited<ReturnType<typeof resolveAftercareAccessByToken>>
}) {
  const { rawToken, resolved } = args

  return {
    accessSource: resolved.accessSource,
    token: {
      id: resolved.token.id,
      expiresAt: toIso(resolved.token.expiresAt),
      firstUsedAt: toNullableIso(resolved.token.firstUsedAt),
      lastUsedAt: toNullableIso(resolved.token.lastUsedAt),
      useCount: resolved.token.useCount,
      singleUse: resolved.token.singleUse,
    },
    aftercare: {
      id: resolved.aftercare.id,
      bookingId: resolved.aftercare.bookingId,
      notes: resolved.aftercare.notes,
      rebookMode: resolved.aftercare.rebookMode,
      rebookedFor: toNullableIso(resolved.aftercare.rebookedFor),
      rebookWindowStart: toNullableIso(resolved.aftercare.rebookWindowStart),
      rebookWindowEnd: toNullableIso(resolved.aftercare.rebookWindowEnd),
      draftSavedAt: toNullableIso(resolved.aftercare.draftSavedAt),
      sentToClientAt: toNullableIso(resolved.aftercare.sentToClientAt),
      lastEditedAt: toNullableIso(resolved.aftercare.lastEditedAt),
      version: resolved.aftercare.version,
      isFinalized: Boolean(resolved.aftercare.sentToClientAt),
      publicAccess: buildSecureLinkAccess(rawToken),
    },
    booking: {
      id: resolved.booking.id,
      clientId: resolved.booking.clientId,
      professionalId: resolved.booking.professionalId,
      serviceId: resolved.booking.serviceId,
      offeringId: resolved.booking.offeringId,
      status: resolved.booking.status,
      scheduledFor: toIso(resolved.booking.scheduledFor),
      locationType: resolved.booking.locationType,
      locationId: resolved.booking.locationId,
      totalDurationMinutes: resolved.booking.totalDurationMinutes,
      subtotalSnapshot: resolved.booking.subtotalSnapshot.toString(),
      service: resolved.booking.service,
      professional: resolved.booking.professional,
    },
  }
}

function parseScheduledFor(body: unknown): Date | null {
  if (!isRecord(body)) return null
  return pickIsoDate(body.scheduledFor)
}

function validateFutureScheduledFor(
  scheduledFor: Date,
  now: Date,
): Response | null {
  if (scheduledFor.getTime() < now.getTime()) {
    return jsonFail(400, 'Pick a future time.')
  }

  return null
}

function validateRecommendedWindow(args: {
  scheduledFor: Date
  resolved: Awaited<ReturnType<typeof resolveAftercareAccessByToken>>
}): Response | null {
  const { scheduledFor, resolved } = args

  if (resolved.aftercare.rebookMode !== AftercareRebookMode.RECOMMENDED_WINDOW) {
    return null
  }

  const windowStart = resolved.aftercare.rebookWindowStart
  const windowEnd = resolved.aftercare.rebookWindowEnd

  if (!windowStart || !windowEnd) {
    return null
  }

  const requestedTime = scheduledFor.getTime()

  if (
    requestedTime < windowStart.getTime() ||
    requestedTime > windowEnd.getTime()
  ) {
    return jsonFail(
      409,
      'Selected time is outside the recommended rebook window.',
    )
  }

  return null
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

function buildRebookResponseBody(args: {
  result: Awaited<ReturnType<typeof createClientRebookedBookingFromAftercare>>
}): JsonObjectPayload {
  return normalizeJsonObjectPayload({
    booking: {
      id: args.result.booking.id,
      status: args.result.booking.status,
      scheduledFor: toIso(args.result.booking.scheduledFor),
    },
    aftercare: {
      id: args.result.aftercare.id,
      rebookMode: args.result.aftercare.rebookMode,
      rebookedFor: toNullableIso(args.result.aftercare.rebookedFor),
    },
    meta: args.result.meta,
  })
}

async function failStartedIdempotency(
  idempotencyRecordId: string | null,
): Promise<void> {
  if (!idempotencyRecordId) return

  await failIdempotency({ idempotencyRecordId }).catch((failError) => {
    console.error(
      'POST /api/client/rebook/[token] idempotency failure update error:',
      failError,
    )
  })
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const rawToken = await getRouteToken(ctx)

    if (!rawToken) {
      return bookingJsonFail('AFTERCARE_TOKEN_MISSING', {
        message: 'Aftercare access token is missing from route params.',
        userMessage: 'That aftercare link is invalid or expired.',
      })
    }

    const resolved = await resolveAftercareAccessByToken({
      rawToken,
    })

    return jsonOk(
      toGetResponse({
        rawToken,
        resolved,
      }),
      200,
    )
  } catch (error: unknown) {
    if (isBookingError(error)) {
      return bookingJsonFail(error.code, {
        message: error.message,
        userMessage: error.userMessage,
      })
    }

    console.error('GET /api/client/rebook/[token] error:', error)
    captureBookingException({
      error,
      route: 'GET /api/client/rebook/[token]',
    })

    return jsonFail(500, 'Internal server error')
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  let idempotencyRecordId: string | null = null

  try {
    const rawToken = await getRouteToken(ctx)

    if (!rawToken) {
      return bookingJsonFail('AFTERCARE_TOKEN_MISSING', {
        message: 'Aftercare access token is missing from route params.',
        userMessage: 'That aftercare link is invalid or expired.',
      })
    }

    const rawBody: unknown = await req.json().catch(() => null)
    const scheduledFor = parseScheduledFor(rawBody)

    if (!scheduledFor) {
      return jsonFail(400, 'Missing or invalid scheduledFor.')
    }

    const now = new Date()
    const invalidFutureTime = validateFutureScheduledFor(scheduledFor, now)

    if (invalidFutureTime) {
      return invalidFutureTime
    }

    const resolved = await resolveAftercareAccessByToken({
      rawToken,
    })

    const outsideWindow = validateRecommendedWindow({
      scheduledFor,
      resolved,
    })

    if (outsideWindow) {
      return outsideWindow
    }

    const { requestId, idempotencyKey } = readRequestMeta(req)

    const idempotency = await beginIdempotency<JsonObjectPayload>({
      actor: {
        actorUserId: null,
        actorKey: buildPublicAftercareTokenActorKey(resolved.token.id),
        actorRole: Role.CLIENT,
      },
      route: IDEMPOTENCY_ROUTES.CLIENT_AFTERCARE_REBOOK,
      key: idempotencyKey,
      requestBody: {
        aftercareTokenId: resolved.token.id,
        aftercareId: resolved.aftercare.id,
        sourceBookingId: resolved.booking.id,
        clientId: resolved.booking.clientId,
        scheduledFor,
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

    const result = await createClientRebookedBookingFromAftercare({
      aftercareId: resolved.aftercare.id,
      bookingId: resolved.booking.id,
      clientId: resolved.booking.clientId,
      scheduledFor,
      requestId,
      idempotencyKey,
    })

    const responseBody = buildRebookResponseBody({ result })

    await completeIdempotency({
      idempotencyRecordId,
      responseStatus: 201,
      responseBody,
    })

    return jsonOk(responseBody, 201)
  } catch (error: unknown) {
    if (idempotencyRecordId) {
      await failStartedIdempotency(idempotencyRecordId)
    }

    if (isBookingError(error)) {
      return bookingJsonFail(error.code, {
        message: error.message,
        userMessage: error.userMessage,
      })
    }

    console.error('POST /api/client/rebook/[token] error:', error)
    captureBookingException({
      error,
      route: 'POST /api/client/rebook/[token]',
    })

    return jsonFail(500, 'Internal server error')
  }
}