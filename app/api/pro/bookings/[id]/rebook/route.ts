// app/api/pro/bookings/[id]/rebook/route.ts
import crypto from 'node:crypto'
import { AftercareRebookMode, BookingStatus, Prisma, Role } from '@prisma/client'

import {
  jsonFail,
  jsonOk,
  pickIsoDate,
  pickString,
  requirePro,
} from '@/app/api/_utils'
import { isRecord } from '@/lib/guards'
import { prisma } from '@/lib/prisma'
import {
  getBookingFailPayload,
  isBookingError,
  type BookingErrorCode,
} from '@/lib/booking/errors'
import { createRebookedBookingFromCompletedBooking } from '@/lib/booking/writeBoundary'
import {
  beginIdempotency,
  completeIdempotency,
  failIdempotency,
} from '@/lib/idempotency'
import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency/routeMeta'

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

function createAftercarePublicToken(): string {
  return crypto.randomUUID()
}

function isMode(value: unknown): value is RebookMode {
  return value === 'BOOK' || value === 'RECOMMEND_WINDOW' || value === 'CLEAR'
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

function readRequestMeta(req: Request): {
  requestId: string | null
  idempotencyKey: string | null
} {
  const requestId =
    pickString(req.headers.get('x-request-id')) ??
    pickString(req.headers.get('request-id')) ??
    null

  const idempotencyKey =
    pickString(req.headers.get('idempotency-key')) ??
    pickString(req.headers.get('x-idempotency-key')) ??
    null

  return { requestId, idempotencyKey }
}

function replayJson(body: RebookResponseBody, status: number) {
  return Response.json(body, { status })
}

function toAftercareResponse(aftercare: AftercareRebookRecord) {
  return {
    id: aftercare.id,
    rebookMode: aftercare.rebookMode,
    rebookWindowStart: aftercare.rebookWindowStart
      ? aftercare.rebookWindowStart.toISOString()
      : null,
    rebookWindowEnd: aftercare.rebookWindowEnd
      ? aftercare.rebookWindowEnd.toISOString()
      : null,
    rebookedFor: aftercare.rebookedFor
      ? aftercare.rebookedFor.toISOString()
      : null,
    sentToClientAt: aftercare.sentToClientAt
      ? aftercare.sentToClientAt.toISOString()
      : null,
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
    rebookedFor: aftercare.rebookedFor
      ? aftercare.rebookedFor.toISOString()
      : null,
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
    scheduledFor: args.scheduledFor ? args.scheduledFor.toISOString() : null,
    windowStart: args.windowStart ? args.windowStart.toISOString() : null,
    windowEnd: args.windowEnd ? args.windowEnd.toISOString() : null,
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
      publicToken: createAftercarePublicToken(),
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
    if (!auth.ok) return auth.res

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

    const { requestId, idempotencyKey } = readRequestMeta(req)

    const idempotency = await beginIdempotency<RebookResponseBody>({
      actor: {
        actorUserId: auth.userId,
        actorRole: Role.PRO,
      },
      route: IDEMPOTENCY_ROUTES.PRO_BOOKING_REBOOK,
      key: idempotencyKey,
      requestBody: buildIdempotencyRequestBody({
        bookingId,
        professionalId,
        mode,
        scheduledFor,
        windowStart,
        windowEnd,
      }),
    })

    if (idempotency.kind === 'missing_key') {
      return jsonFail(400, 'Missing idempotency key.')
    }

    if (idempotency.kind === 'conflict') {
      return jsonFail(
        409,
        'This idempotency key was already used with a different request.',
      )
    }

    if (idempotency.kind === 'in_progress') {
      return jsonFail(409, 'A matching request is already in progress.')
    }

    if (idempotency.kind === 'replay') {
      return replayJson(idempotency.responseBody, idempotency.responseStatus)
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

      await completeIdempotency({
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

      await completeIdempotency({
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
      idempotencyKey,
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

    await completeIdempotency({
      idempotencyRecordId,
      responseStatus: 201,
      responseBody,
    })

    return jsonOk(data, 201)
  } catch (error: unknown) {
    if (idempotencyRecordId) {
      await failIdempotency({ idempotencyRecordId }).catch((failError) => {
        console.error(
          'POST /api/pro/bookings/[id]/rebook idempotency fail error',
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

    console.error('POST /api/pro/bookings/[id]/rebook error', error)
    return jsonFail(500, 'Internal server error')
  }
}