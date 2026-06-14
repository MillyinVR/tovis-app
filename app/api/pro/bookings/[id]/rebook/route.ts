// app/api/pro/bookings/[id]/rebook/route.ts
import {
  AftercareRebookMode,
  BookingStatus,
  Prisma,
  Role,
} from '@prisma/client'

import {
  jsonFail,
  jsonOk,
  pickIsoDate,
  pickString,
  requirePro,
} from '@/app/api/_utils'
import {
  beginRouteIdempotency,
  completeRouteIdempotency,
  failStartedRouteIdempotency,
  isRouteIdempotencyHandled,
} from '@/app/api/_utils/idempotency'
import { isRecord } from '@/lib/guards'
import { prisma } from '@/lib/prisma'
import {
  isBookingError,
} from '@/lib/booking/errors'
import { bookingJsonFail } from '@/app/api/_utils/bookingResponses'
import { createRebookedBookingFromCompletedBooking } from '@/lib/booking/writeBoundary'
import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import { safeError, safeLogMeta } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type RebookMode = 'BOOK' | 'RECOMMEND_WINDOW' | 'CLEAR'
type Ctx = { params: { id: string } | Promise<{ id: string }> }

type RebookResponseBody = Prisma.InputJsonObject

const AFTERCARE_REBOOK_SELECT = {
  id: true,
  rebookMode: true,
  rebookWindowStart: true,
  rebookWindowEnd: true,
  rebookedFor: true,
  sentToClientAt: true,
  version: true,
} satisfies Prisma.AftercareSummarySelect

type AftercareRebookRecord = Prisma.AftercareSummaryGetPayload<{
  select: typeof AFTERCARE_REBOOK_SELECT
}>

function isMode(value: unknown): value is RebookMode {
  return value === 'BOOK' || value === 'RECOMMEND_WINDOW' || value === 'CLEAR'
}

function readRequestId(req: Request): string | null {
  return (
    pickString(req.headers.get('x-request-id')) ??
    pickString(req.headers.get('request-id')) ??
    null
  )
}

function toNullableIso(value: Date | null): string | null {
  return value ? value.toISOString() : null
}

function toAftercareResponse(aftercare: AftercareRebookRecord) {
  return {
    id: aftercare.id,
    rebookMode: aftercare.rebookMode,
    rebookWindowStart: toNullableIso(aftercare.rebookWindowStart),
    rebookWindowEnd: toNullableIso(aftercare.rebookWindowEnd),
    rebookedFor: toNullableIso(aftercare.rebookedFor),
    sentToClientAt: toNullableIso(aftercare.sentToClientAt),
    version: aftercare.version,
    isFinalized: Boolean(aftercare.sentToClientAt),
  }
}

function toRebookedAftercareResponse(aftercare: {
  id: string
  rebookMode: AftercareRebookMode
  rebookedFor: Date | null
}) {
  return {
    id: aftercare.id,
    rebookMode: aftercare.rebookMode,
    rebookedFor: toNullableIso(aftercare.rebookedFor),
  }
}

function buildIdempotencyRequestBody(args: {
  bookingId: string
  professionalId: string
  mode: RebookMode
  scheduledFor: Date | null
  windowStart: Date | null
  windowEnd: Date | null
}): Prisma.InputJsonObject {
  return {
    bookingId: args.bookingId,
    professionalId: args.professionalId,
    mode: args.mode,
    scheduledFor: toNullableIso(args.scheduledFor),
    windowStart: toNullableIso(args.windowStart),
    windowEnd: toNullableIso(args.windowEnd),
  }
}

async function upsertAftercareRebookState(args: {
  bookingId: string
  mode: AftercareRebookMode
  windowStart?: Date | null
  windowEnd?: Date | null
  rebookedFor?: Date | null
}): Promise<AftercareRebookRecord> {
  return prisma.aftercareSummary.upsert({
    where: { bookingId: args.bookingId },
    create: {
      bookingId: args.bookingId,
      rebookMode: args.mode,
      rebookWindowStart: args.windowStart ?? null,
      rebookWindowEnd: args.windowEnd ?? null,
      rebookedFor: args.rebookedFor ?? null,
    },
    update: {
      rebookMode: args.mode,
      rebookWindowStart: args.windowStart ?? null,
      rebookWindowEnd: args.windowEnd ?? null,
      rebookedFor: args.rebookedFor ?? null,
    },
    select: AFTERCARE_REBOOK_SELECT,
  })
}

export async function POST(req: Request, ctx: Ctx) {
  let idempotencyRecordId: string | null = null

  try {
    const auth = await requirePro()

    if (!auth.ok) {
      return auth.res
    }

    const professionalId = auth.professionalId
    const params = await Promise.resolve(ctx.params)
    const bookingId = pickString(params?.id)

    if (!bookingId) {
      return jsonFail(400, 'Missing booking id.')
    }

    const rawBody: unknown = await req.json().catch(() => null)
    const body = isRecord(rawBody) ? rawBody : {}

    const mode = isMode(body.mode) ? body.mode : 'BOOK'

    const scheduledFor = mode === 'BOOK' ? pickIsoDate(body.scheduledFor) : null
    const windowStart =
      mode === 'RECOMMEND_WINDOW' ? pickIsoDate(body.windowStart) : null
    const windowEnd =
      mode === 'RECOMMEND_WINDOW' ? pickIsoDate(body.windowEnd) : null

    if (mode === 'BOOK' && !scheduledFor) {
      return jsonFail(
        400,
        'scheduledFor is required (ISO string) for BOOK mode.',
      )
    }

    if (mode === 'RECOMMEND_WINDOW' && (!windowStart || !windowEnd)) {
      return jsonFail(
        400,
        'windowStart and windowEnd are required ISO strings for RECOMMEND_WINDOW.',
      )
    }

    if (
      mode === 'RECOMMEND_WINDOW' &&
      windowStart &&
      windowEnd &&
      windowEnd <= windowStart
    ) {
      return jsonFail(400, 'windowEnd must be after windowStart.')
    }

    const requestId = readRequestId(req)

    const idempotency = await beginRouteIdempotency<RebookResponseBody>({
      request: req,
      actor: {
        actorUserId: auth.userId,
        actorRole: Role.PRO,
      },
      route: IDEMPOTENCY_ROUTES.PRO_BOOKING_REBOOK,
      requestLabel: 'pro booking rebook',
      requestBody: buildIdempotencyRequestBody({
        bookingId,
        professionalId,
        mode,
        scheduledFor,
        windowStart,
        windowEnd,
      }),
      messages: {
        missingKey: 'Missing idempotency key.',
        inProgress: 'A matching request is already in progress.',
        conflict:
          'This idempotency key was already used with a different request.',
      },
    })

    if (isRouteIdempotencyHandled(idempotency)) {
      return idempotency.response
    }

    idempotencyRecordId = idempotency.idempotencyRecordId

    const existing = await prisma.booking.findFirst({
      where: {
        id: bookingId,
        professionalId,
      },
      select: {
        id: true,
        status: true,
      },
    })

    if (!existing) {
      return jsonFail(404, 'Booking not found.')
    }

    if (existing.status !== BookingStatus.COMPLETED) {
      return jsonFail(409, 'Only COMPLETED bookings can be rebooked.')
    }

    if (mode === 'CLEAR') {
      const aftercare = await upsertAftercareRebookState({
        bookingId: existing.id,
        mode: AftercareRebookMode.NONE,
        rebookedFor: null,
        windowStart: null,
        windowEnd: null,
      })

      const data = {
        mode,
        aftercare: toAftercareResponse(aftercare),
      }

      const responseBody = {
        ok: true,
        ...data,
      } satisfies RebookResponseBody

      await completeRouteIdempotency({
        idempotencyRecordId,
        responseStatus: 200,
        responseBody,
      })

      return jsonOk(data, 200)
    }

    if (mode === 'RECOMMEND_WINDOW') {
      const aftercare = await upsertAftercareRebookState({
        bookingId: existing.id,
        mode: AftercareRebookMode.RECOMMENDED_WINDOW,
        windowStart,
        windowEnd,
        rebookedFor: null,
      })

      const data = {
        mode,
        aftercare: toAftercareResponse(aftercare),
      }

      const responseBody = {
        ok: true,
        ...data,
      } satisfies RebookResponseBody

      await completeRouteIdempotency({
        idempotencyRecordId,
        responseStatus: 200,
        responseBody,
      })

      return jsonOk(data, 200)
    }

    const bookedFor = scheduledFor

    if (!bookedFor) {
      return jsonFail(
        400,
        'scheduledFor is required (ISO string) for BOOK mode.',
      )
    }

    const result = await createRebookedBookingFromCompletedBooking({
      bookingId: existing.id,
      professionalId,
      scheduledFor: bookedFor,
      requestId,
      idempotencyKey: idempotency.idempotencyKey,
    })

    const data = {
      mode,
      nextBookingId: result.booking.id,
      aftercare: toRebookedAftercareResponse(result.aftercare),
    }

    const responseBody = {
      ok: true,
      ...data,
    } satisfies RebookResponseBody

    await completeRouteIdempotency({
      idempotencyRecordId,
      responseStatus: 201,
      responseBody,
    })

    return jsonOk(data, 201)
  } catch (error: unknown) {
    await failStartedRouteIdempotency({
      idempotencyRecordId,
      operation: 'POST /api/pro/bookings/[id]/rebook',
    })

    if (isBookingError(error)) {
      return bookingJsonFail(error.code, {
        message: error.message,
        userMessage: error.userMessage,
      })
    }

    console.error('POST /api/pro/bookings/[id]/rebook error', {
      error: safeError(error),
      meta: safeLogMeta({
        route: 'POST /api/pro/bookings/[id]/rebook',
        idempotencyRecordId,
      }),
    })

    return jsonFail(500, 'Internal server error')
  }
}