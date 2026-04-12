import {
  jsonFail,
  jsonOk,
  pickString,
  requirePro,
  upper,
} from '@/app/api/_utils'
import { isRecord } from '@/lib/guards'
import {
  getBookingFailPayload,
  isBookingError,
  type BookingErrorCode,
} from '@/lib/booking/errors'
import { recordInPersonConsultationDecision } from '@/lib/booking/writeBoundary'
import { ConsultationDecision } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

type InPersonDecisionRequestBody = {
  action?: unknown
}

function bookingBase(bookingId: string): string {
  return `/pro/bookings/${encodeURIComponent(bookingId)}`
}

function sessionHubHref(bookingId: string): string {
  return `${bookingBase(bookingId)}/session`
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

function parseDecisionAction(value: unknown): ConsultationDecision | null {
  const normalized = upper(value)

  if (normalized === ConsultationDecision.APPROVED) {
    return ConsultationDecision.APPROVED
  }

  if (normalized === ConsultationDecision.REJECTED) {
    return ConsultationDecision.REJECTED
  }

  return null
}

function readHeaderValue(req: Request, name: string): string | null {
  return pickString(req.headers.get(name))
}

function readRequestMeta(req: Request): {
  requestId: string | null
  idempotencyKey: string | null
  userAgent: string | null
} {
  const requestId =
    readHeaderValue(req, 'x-request-id') ??
    readHeaderValue(req, 'request-id') ??
    null

  const idempotencyKey =
    readHeaderValue(req, 'idempotency-key') ??
    readHeaderValue(req, 'x-idempotency-key') ??
    null

  const userAgent = readHeaderValue(req, 'user-agent') ?? null

  return {
    requestId,
    idempotencyKey,
    userAgent,
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId
    const recordedByUserId = pickString(auth.user?.id)

    if (!recordedByUserId) {
      return bookingJsonFail('FORBIDDEN', {
        message: 'Authenticated actor user id is required.',
        userMessage: 'You are not allowed to record this consultation decision.',
      })
    }

    const params = await Promise.resolve(ctx.params)
    const bookingId = pickString(params?.id)

    if (!bookingId) {
      return jsonFail(400, 'Missing booking id.')
    }

    const rawBody: unknown = await req.json().catch(() => ({}))
    const body: InPersonDecisionRequestBody = isRecord(rawBody) ? rawBody : {}

    const decision = parseDecisionAction(body.action)
    if (!decision) {
      return jsonFail(400, 'Invalid action. Use APPROVED or REJECTED.')
    }

    const { requestId, idempotencyKey, userAgent } = readRequestMeta(req)

    const result = await recordInPersonConsultationDecision({
      bookingId,
      professionalId,
      recordedByUserId,
      decision,
      requestId,
      idempotencyKey,
      userAgent,
    })

    if ('booking' in result) {
      return jsonOk(
        {
          action: decision,
          booking: {
            id: result.booking.id,
            serviceId: result.booking.serviceId,
            offeringId: result.booking.offeringId,
            subtotalSnapshot: result.booking.subtotalSnapshot,
            totalDurationMinutes: result.booking.totalDurationMinutes,
            consultationConfirmedAt:
              result.booking.consultationConfirmedAt?.toISOString() ?? null,
          },
          approval: {
            id: result.approval.id,
            status: result.approval.status,
            approvedAt: result.approval.approvedAt?.toISOString() ?? null,
            rejectedAt: result.approval.rejectedAt?.toISOString() ?? null,
          },
          proof: {
            id: result.proof.id,
            decision: result.proof.decision,
            method: result.proof.method,
            actedAt: result.proof.actedAt.toISOString(),
            recordedByUserId: result.proof.recordedByUserId,
            clientActionTokenId: result.proof.clientActionTokenId,
            contactMethod: result.proof.contactMethod,
            destinationSnapshot: result.proof.destinationSnapshot,
          },
          nextHref: sessionHubHref(result.booking.id),
          meta: result.meta,
        },
        200,
      )
    }

    return jsonOk(
      {
        action: decision,
        approval: {
          id: result.approval.id,
          status: result.approval.status,
          approvedAt: result.approval.approvedAt?.toISOString() ?? null,
          rejectedAt: result.approval.rejectedAt?.toISOString() ?? null,
        },
        proof: {
          id: result.proof.id,
          decision: result.proof.decision,
          method: result.proof.method,
          actedAt: result.proof.actedAt.toISOString(),
          recordedByUserId: result.proof.recordedByUserId,
          clientActionTokenId: result.proof.clientActionTokenId,
          contactMethod: result.proof.contactMethod,
          destinationSnapshot: result.proof.destinationSnapshot,
        },
        nextHref: sessionHubHref(bookingId),
        meta: result.meta,
      },
      200,
    )
  } catch (error: unknown) {
    if (isBookingError(error)) {
      return bookingJsonFail(error.code, {
        message: error.message,
        userMessage: error.userMessage,
      })
    }

    console.error(
      'POST /api/pro/bookings/[id]/consultation/in-person-decision error',
      error,
    )
    return jsonFail(500, 'Internal server error')
  }
}