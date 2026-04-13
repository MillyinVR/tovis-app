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

type Ctx = { params: { token: string } | Promise<{ token: string }> }

type PublicAccess =
  | {
      accessMode: 'SECURE_LINK'
      hasPublicAccess: true
      clientAftercareHref: string
    }
  | {
      accessMode: 'NONE'
      hasPublicAccess: false
      clientAftercareHref: null
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

async function getToken(ctx: Ctx): Promise<string | null> {
  const params = await Promise.resolve(ctx.params)
  return pickString(params?.token)
}

function readHeaderValue(req: Request, name: string): string | null {
  return pickString(req.headers.get(name))
}

function readRequestMeta(req: Request): {
  requestId: string | null
  idempotencyKey: string | null
} {
  const requestId =
    readHeaderValue(req, 'x-request-id') ??
    readHeaderValue(req, 'request-id') ??
    null

  const idempotencyKey =
    readHeaderValue(req, 'idempotency-key') ??
    readHeaderValue(req, 'x-idempotency-key') ??
    null

  return {
    requestId,
    idempotencyKey,
  }
}

function buildPublicAccess(tokenValue: string | null | undefined): PublicAccess {
  const token =
    typeof tokenValue === 'string' && tokenValue.trim().length > 0
      ? tokenValue.trim()
      : null

  if (!token) {
    return {
      accessMode: 'NONE',
      hasPublicAccess: false,
      clientAftercareHref: null,
    }
  }

  return {
    accessMode: 'SECURE_LINK',
    hasPublicAccess: true,
    clientAftercareHref: `/client/rebook/${encodeURIComponent(token)}`,
  }
}

function toGetResponse(
  resolved: Awaited<ReturnType<typeof resolveAftercareAccessByToken>>,
) {
  return {
    accessSource: resolved.accessSource,
    token: resolved.token
      ? {
          id: resolved.token.id,
          expiresAt: resolved.token.expiresAt.toISOString(),
          firstUsedAt: resolved.token.firstUsedAt
            ? resolved.token.firstUsedAt.toISOString()
            : null,
          lastUsedAt: resolved.token.lastUsedAt
            ? resolved.token.lastUsedAt.toISOString()
            : null,
          useCount: resolved.token.useCount,
          singleUse: resolved.token.singleUse,
        }
      : null,
    aftercare: {
      id: resolved.aftercare.id,
      bookingId: resolved.aftercare.bookingId,
      notes: resolved.aftercare.notes,
      rebookMode: resolved.aftercare.rebookMode,
      rebookedFor: resolved.aftercare.rebookedFor
        ? resolved.aftercare.rebookedFor.toISOString()
        : null,
      rebookWindowStart: resolved.aftercare.rebookWindowStart
        ? resolved.aftercare.rebookWindowStart.toISOString()
        : null,
      rebookWindowEnd: resolved.aftercare.rebookWindowEnd
        ? resolved.aftercare.rebookWindowEnd.toISOString()
        : null,
      draftSavedAt: resolved.aftercare.draftSavedAt
        ? resolved.aftercare.draftSavedAt.toISOString()
        : null,
      sentToClientAt: resolved.aftercare.sentToClientAt
        ? resolved.aftercare.sentToClientAt.toISOString()
        : null,
      lastEditedAt: resolved.aftercare.lastEditedAt
        ? resolved.aftercare.lastEditedAt.toISOString()
        : null,
      version: resolved.aftercare.version,
      isFinalized: Boolean(resolved.aftercare.sentToClientAt),
      publicAccess: buildPublicAccess(resolved.aftercare.publicToken),
    },
    booking: {
      id: resolved.booking.id,
      clientId: resolved.booking.clientId,
      professionalId: resolved.booking.professionalId,
      serviceId: resolved.booking.serviceId,
      offeringId: resolved.booking.offeringId,
      status: resolved.booking.status,
      scheduledFor: resolved.booking.scheduledFor.toISOString(),
      locationType: resolved.booking.locationType,
      locationId: resolved.booking.locationId,
      totalDurationMinutes: resolved.booking.totalDurationMinutes,
      subtotalSnapshot: resolved.booking.subtotalSnapshot,
      service: resolved.booking.service,
      professional: resolved.booking.professional,
    },
  }
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const token = await getToken(ctx)
    if (!token) return jsonFail(400, 'Missing token.')

    const resolved = await resolveAftercareAccessByToken({
      rawToken: token,
    })

    return jsonOk(toGetResponse(resolved), 200)
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
    const token = await getToken(ctx)
    if (!token) return jsonFail(400, 'Missing token.')

    const rawBody: unknown = await req.json().catch(() => null)
    const body = isRecord(rawBody) ? rawBody : {}

    const scheduledFor = pickIsoDate(body.scheduledFor)
    if (!scheduledFor) {
      return jsonFail(400, 'Missing or invalid scheduledFor.')
    }

    if (scheduledFor.getTime() < Date.now()) {
      return jsonFail(400, 'Pick a future time.')
    }

    const resolved = await resolveAftercareAccessByToken({
      rawToken: token,
    })

    if (
      resolved.aftercare.rebookMode === AftercareRebookMode.RECOMMENDED_WINDOW
    ) {
      const windowStart = resolved.aftercare.rebookWindowStart
      const windowEnd = resolved.aftercare.rebookWindowEnd

      if (windowStart && windowEnd) {
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
      }
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
          scheduledFor: result.booking.scheduledFor.toISOString(),
        },
        aftercare: {
          id: result.aftercare.id,
          rebookMode: result.aftercare.rebookMode,
          rebookedFor: result.aftercare.rebookedFor
            ? result.aftercare.rebookedFor.toISOString()
            : null,
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