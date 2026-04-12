import { jsonFail, jsonOk, pickString, upper } from '@/app/api/_utils'
import {
  getBookingFailPayload,
  isBookingError,
  type BookingErrorCode,
} from '@/lib/booking/errors'
import {
  approveConsultationByClientActionToken,
  rejectConsultationByClientActionToken,
} from '@/lib/booking/writeBoundary'

export const dynamic = 'force-dynamic'

type Ctx = {
  params: { token: string } | Promise<{ token: string }>
}

type DecisionAction = 'APPROVE' | 'REJECT'

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
  ipAddress: string | null
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

  const forwardedFor = readHeaderValue(req, 'x-forwarded-for')
  const realIp = readHeaderValue(req, 'x-real-ip')

  const forwardedIp = forwardedFor
    ? pickString(forwardedFor.split(',')[0] ?? null)
    : null

  const ipAddress = forwardedIp ?? realIp ?? null
  const userAgent = readHeaderValue(req, 'user-agent') ?? null

  return {
    requestId,
    idempotencyKey,
    ipAddress,
    userAgent,
  }
}

function parseDecisionAction(value: unknown): DecisionAction | null {
  const normalized = upper(value)
  if (normalized === 'APPROVE') return 'APPROVE'
  if (normalized === 'REJECT') return 'REJECT'
  return null
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const token = await getToken(ctx)
    if (!token) return jsonFail(400, 'Missing token.')

    const rawBody: unknown = await req.json().catch(() => ({}))
    const action = parseDecisionAction(
      typeof rawBody === 'object' && rawBody !== null && 'action' in rawBody
        ? (rawBody as { action?: unknown }).action
        : undefined,
    )

    if (!action) {
      return jsonFail(400, 'Invalid action.')
    }

    const { requestId, idempotencyKey, ipAddress, userAgent } =
      readRequestMeta(req)

    if (action === 'APPROVE') {
      const result = await approveConsultationByClientActionToken({
        rawToken: token,
        requestId,
        idempotencyKey,
        ipAddress,
        userAgent,
      })

      return jsonOk(
        {
          action,
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
          meta: result.meta,
        },
        200,
      )
    }

    const result = await rejectConsultationByClientActionToken({
      rawToken: token,
      requestId,
      idempotencyKey,
      ipAddress,
      userAgent,
    })

    return jsonOk(
      {
        action,
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
      'POST /api/public/consultation/[token]/decision error',
      error,
    )
    return jsonFail(500, 'Internal server error')
  }
}