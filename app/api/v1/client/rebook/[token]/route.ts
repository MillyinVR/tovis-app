// app/api/v1/client/rebook/[token]/route.ts

import { AftercareRebookMode, Role, ServiceLocationType } from '@prisma/client'

import {
  pickIsoDate,
  pickString,
  jsonFail,
  jsonOk,
} from '@/app/api/_utils'
import { normalizeLocationType } from '@/lib/booking/locationContext'
import { withRouteIdempotency } from '@/app/api/_utils/idempotency'
import {
  markAftercareAccessTokenUsed,
  resolveAftercareAccessTokenForMutation,
  resolveAftercareAccessTokenForRead,
  type ResolvedAftercareAccessToken,
} from '@/lib/aftercare/aftercareAccessTokens'
import {
  isBookingError,
} from '@/lib/booking/errors'
import { bookingJsonFail } from '@/app/api/_utils/bookingResponses'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { createClientRebookedBookingFromAftercare } from '@/lib/booking/writeBoundary'
import { isRecord } from '@/lib/guards'
import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import { captureBookingException } from '@/lib/observability/bookingEvents'
import { enforceRateLimit } from '@/lib/rateLimit/enforce'
import { tokenActorRateLimitKey } from '@/lib/rateLimit/identity'
import { rateLimitExceededResponse } from '@/lib/rateLimit/response'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type RequestMeta = {
  requestId: string | null
}

type SecureLinkAccess = {
  accessMode: 'SECURE_LINK'
  hasPublicAccess: true
  clientAftercareHref: string
}

type RebookResponseBody = {
  ok: true
  booking: {
    id: string
    status: string
    scheduledFor: string
  }
  aftercare: {
    id: string
    rebookMode: string
    rebookedFor: string | null
  }
  meta: {
    mutated: boolean
    noOp: boolean
  }
}

type RebookIdempotencyRequestBody = {
  aftercareTokenId: string
  aftercareId: string
  sourceBookingId: string
  clientId: string
  scheduledFor: string
  locationType: ServiceLocationType | null
  clientAddressId: string | null
}

async function getRouteToken(
  ctx: RouteContext<{ token: string }>,
): Promise<string | null> {
  const params = await resolveRouteParams(ctx)
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
  }
}

function toIso(value: Date): string {
  return value.toISOString()
}

function toNullableIso(value: Date | null): string | null {
  return value ? value.toISOString() : null
}

function buildSecureLinkAccess(rawToken: string): SecureLinkAccess {
  return {
    accessMode: 'SECURE_LINK',
    hasPublicAccess: true,
    clientAftercareHref: `/client/rebook/${encodeURIComponent(rawToken)}`,
  }
}

function toGetResponse(args: {
  rawToken: string
  resolved: ResolvedAftercareAccessToken
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

/**
 * Optional client-chosen location mode. Returns null when omitted (clone the
 * original booking's location). Feasibility (mode offered, address present) is
 * enforced downstream in the write boundary.
 */
function parseRequestedLocationType(body: unknown): ServiceLocationType | null {
  if (!isRecord(body)) return null
  return normalizeLocationType(body.locationType)
}

/**
 * Optional client-chosen saved service address for a MOBILE rebook. Returns
 * null when omitted (clone the original booking's address). Ownership, kind,
 * coordinates, and mobile radius are enforced downstream in the write
 * boundary against the token's client.
 */
function parseRequestedClientAddressId(body: unknown): string | null {
  if (!isRecord(body)) return null
  return pickString(body.clientAddressId)
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
  resolved: ResolvedAftercareAccessToken
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

function buildRebookResponseBody(args: {
  result: Awaited<ReturnType<typeof createClientRebookedBookingFromAftercare>>
}): RebookResponseBody {
  return {
    ok: true,
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
    meta: {
      mutated: args.result.meta.mutated,
      noOp: args.result.meta.noOp,
    },
  }
}

function buildRebookIdempotencyRequestBody(args: {
  aftercareTokenId: string
  aftercareId: string
  sourceBookingId: string
  clientId: string
  scheduledFor: Date
  locationType: ServiceLocationType | null
  clientAddressId: string | null
}): RebookIdempotencyRequestBody {
  return {
    aftercareTokenId: args.aftercareTokenId,
    aftercareId: args.aftercareId,
    sourceBookingId: args.sourceBookingId,
    clientId: args.clientId,
    scheduledFor: args.scheduledFor.toISOString(),
    locationType: args.locationType,
    clientAddressId: args.clientAddressId,
  }
}

export async function GET(_req: Request, ctx: RouteContext<{ token: string }>) {
  try {
    const rawToken = await getRouteToken(ctx)

    if (!rawToken) {
      return bookingJsonFail('AFTERCARE_TOKEN_MISSING', {
        message: 'Aftercare access token is missing from route params.',
        userMessage: 'That aftercare link is invalid or expired.',
      })
    }

    const resolved = await resolveAftercareAccessTokenForRead({
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

    console.error('GET /api/v1/client/rebook/[token] error:', error)

    captureBookingException({
      error,
      route: 'GET /api/v1/client/rebook/[token]',
    })

    return jsonFail(500, 'Internal server error')
  }
}

export async function POST(req: Request, ctx: RouteContext<{ token: string }>) {
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

    const requestedLocationType = parseRequestedLocationType(rawBody)
    const requestedClientAddressId = parseRequestedClientAddressId(rawBody)

    const now = new Date()
    const invalidFutureTime = validateFutureScheduledFor(scheduledFor, now)

    if (invalidFutureTime) {
      return invalidFutureTime
    }

    const rateLimit = await enforceRateLimit({
      bucket: 'client:rebook:token',
      key: tokenActorRateLimitKey({
        actorKey: rawToken,
        request: req,
      }),
    })

    if (!rateLimit.allowed) {
      return rateLimitExceededResponse(rateLimit)
    }

    const resolved = await resolveAftercareAccessTokenForMutation({
      rawToken,
    })

    const outsideWindow = validateRecommendedWindow({
      scheduledFor,
      resolved,
    })

    if (outsideWindow) {
      return outsideWindow
    }

    const { requestId } = readRequestMeta(req)

    return await withRouteIdempotency<RebookResponseBody>(
      {
        request: req,
        actor: {
          actorKey: resolved.idempotencyActorKey,
          actorRole: Role.CLIENT,
        },
        route: IDEMPOTENCY_ROUTES.CLIENT_AFTERCARE_REBOOK,
        requestLabel: 'aftercare rebook',
        requestBody: buildRebookIdempotencyRequestBody({
          aftercareTokenId: resolved.token.id,
          aftercareId: resolved.aftercare.id,
          sourceBookingId: resolved.booking.id,
          clientId: resolved.booking.clientId,
          scheduledFor,
          locationType: requestedLocationType,
          clientAddressId: requestedClientAddressId,
        }),
        messages: {
          missingKey: 'Missing idempotency key.',
          inProgress: 'A matching rebook request is already in progress.',
          conflict:
            'This idempotency key was already used with a different request body.',
        },
        operation: 'POST /api/v1/client/rebook/[token]',
      },
      async (idem) => {
        const result = await createClientRebookedBookingFromAftercare({
          aftercareId: resolved.aftercare.id,
          bookingId: resolved.booking.id,
          clientId: resolved.booking.clientId,
          aftercareClientActionTokenId: resolved.token.id,
          scheduledFor,
          requestedLocationType,
          requestedClientAddressId,
          requestId,
          idempotencyKey: idem.idempotencyKey,
        })

        const responseBody = buildRebookResponseBody({ result })

        await markAftercareAccessTokenUsed({
          tokenId: resolved.token.id,
        })

        return { status: 201, body: responseBody }
      },
    )
  } catch (error: unknown) {
    if (isBookingError(error)) {
      return bookingJsonFail(error.code, {
        message: error.message,
        userMessage: error.userMessage,
      })
    }

    console.error('POST /api/v1/client/rebook/[token] error:', error)

    captureBookingException({
      error,
      route: 'POST /api/v1/client/rebook/[token]',
    })

    return jsonFail(500, 'Internal server error')
  }
}