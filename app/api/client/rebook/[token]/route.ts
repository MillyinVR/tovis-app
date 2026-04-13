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
import { AftercareRebookMode } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = {
  params: { token: string } | Promise<{ token: string }>
}

type RequestMeta = {
  requestId: string | null
  idempotencyKey: string | null
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

function validateFutureScheduledFor(scheduledFor: Date, now: Date): Response | null {
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
    return jsonFail(500, 'Internal server error')
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
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

    const result = await createClientRebookedBookingFromAftercare({
      aftercareId: resolved.aftercare.id,
      bookingId: resolved.booking.id,
      clientId: resolved.booking.clientId,
      scheduledFor,
      requestId,
      idempotencyKey,
    })

    return jsonOk(
      {
        booking: {
          id: result.booking.id,
          status: result.booking.status,
          scheduledFor: toIso(result.booking.scheduledFor),
        },
        aftercare: {
          id: result.aftercare.id,
          rebookMode: result.aftercare.rebookMode,
          rebookedFor: toNullableIso(result.aftercare.rebookedFor),
        },
        meta: result.meta,
      },
      201,
    )
  } catch (error: unknown) {
    if (isBookingError(error)) {
      return bookingJsonFail(error.code, {
        message: error.message,
        userMessage: error.userMessage,
      })
    }

    console.error('POST /api/client/rebook/[token] error:', error)
    return jsonFail(500, 'Internal server error')
  }
}