// app/api/pro/bookings/[id]/cancel/route.ts
import { requirePro, jsonFail, jsonOk } from '@/app/api/_utils'
import { BookingStatus, Prisma, Role } from '@prisma/client'
import { cancelBooking } from '@/lib/booking/writeBoundary'
import { getBookingFailPayload, isBookingError } from '@/lib/booking/errors'
import {
  beginIdempotency,
  completeIdempotency,
  failIdempotency,
  IDEMPOTENCY_ROUTES,
} from '@/lib/idempotency'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

type CancelResponseBody = Prisma.InputJsonObject

function asTrimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readRequestMeta(req: Request): {
  idempotencyKey: string | null
} {
  return {
    idempotencyKey:
      asTrimmedString(req.headers.get('idempotency-key')) ??
      asTrimmedString(req.headers.get('x-idempotency-key')) ??
      null,
  }
}

function idempotencyMissingKeyFail(): Response {
  return jsonFail(400, 'Missing idempotency key.', {
    code: 'IDEMPOTENCY_KEY_REQUIRED',
  })
}

function idempotencyInProgressFail(): Response {
  return jsonFail(
    409,
    'A matching cancel request is already in progress.',
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

export async function PATCH(req: Request, ctx: Ctx) {
  let idempotencyRecordId: string | null = null

  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const actorUserId = auth.userId
    if (!actorUserId || !actorUserId.trim()) {
      const fail = getBookingFailPayload('FORBIDDEN', {
        message: 'Authenticated actor user id is required.',
        userMessage: 'You are not allowed to cancel this booking.',
      })
      return jsonFail(fail.httpStatus, fail.userMessage, fail.extra)
    }

    const params = await Promise.resolve(ctx.params)
    const bookingId = asTrimmedString(params.id)

    if (!bookingId) {
      const fail = getBookingFailPayload('BOOKING_ID_REQUIRED')
      return jsonFail(fail.httpStatus, fail.userMessage, fail.extra)
    }

    const body: unknown = await req.json().catch(() => ({}))
    const reason = isRecord(body)
      ? (asTrimmedString(body.reason) ?? 'Cancelled by professional')
      : 'Cancelled by professional'

    const { idempotencyKey } = readRequestMeta(req)

    const idempotency = await beginIdempotency<CancelResponseBody>({
      actor: {
        actorUserId,
        actorRole: Role.PRO,
      },
      route: IDEMPOTENCY_ROUTES.PRO_BOOKING_CANCEL,
      key: idempotencyKey,
      requestBody: {
        bookingId,
        professionalId: auth.professionalId,
        actorUserId,
        reason,
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

    const result = await cancelBooking({
      bookingId,
      actor: {
        kind: 'pro',
        professionalId: auth.professionalId,
      },
      notifyClient: true,
      reason,
      allowedStatuses: [BookingStatus.PENDING, BookingStatus.ACCEPTED],
    })

    const responseBody = {
      booking: {
        id: result.booking.id,
        status: result.booking.status,
        sessionStep: result.booking.sessionStep,
      },
      meta: result.meta,
    } satisfies CancelResponseBody

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
          'PATCH /api/pro/bookings/[id]/cancel idempotency failure update error:',
          failError,
        )
      })
    }

    if (isBookingError(error)) {
      const fail = getBookingFailPayload(error.code, {
        message: error.message,
        userMessage: error.userMessage,
      })
      return jsonFail(fail.httpStatus, fail.userMessage, fail.extra)
    }

    console.error('PATCH /api/pro/bookings/[id]/cancel error', error)
    return jsonFail(500, 'Internal server error')
  }
}
