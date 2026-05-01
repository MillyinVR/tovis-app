// app/api/pro/bookings/[id]/consultation/in-person-decision/route.ts
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
import { ConsultationDecision, Prisma, Role } from '@prisma/client'
import {
  beginIdempotency,
  completeIdempotency,
  failIdempotency,
  IDEMPOTENCY_ROUTES,
} from '@/lib/idempotency'
import { captureBookingException } from '@/lib/observability/bookingEvents'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

type InPersonDecisionRequestBody = {
  action?: unknown
}

type RequestMeta = {
  requestId: string | null
  idempotencyKey: string | null
  userAgent: string | null
}

type NestedInputJsonValue = Prisma.InputJsonValue | null

type JsonObjectPayload = {
  [key: string]: NestedInputJsonValue
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

function idempotencyMissingKeyFail(): Response {
  return jsonFail(400, 'Missing idempotency key.', {
    code: 'IDEMPOTENCY_KEY_REQUIRED',
  })
}

function idempotencyInProgressFail(): Response {
  return jsonFail(
    409,
    'A matching in-person consultation decision request is already in progress.',
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

function readRequestMeta(req: Request): RequestMeta {
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

function buildDecisionResponseBody(args: {
  decision: ConsultationDecision
  bookingId: string
  result: Awaited<ReturnType<typeof recordInPersonConsultationDecision>>
}): JsonObjectPayload {
  const common = {
    action: args.decision,
    approval: {
      id: args.result.approval.id,
      status: args.result.approval.status,
      approvedAt: args.result.approval.approvedAt?.toISOString() ?? null,
      rejectedAt: args.result.approval.rejectedAt?.toISOString() ?? null,
    },
    proof: {
      id: args.result.proof.id,
      decision: args.result.proof.decision,
      method: args.result.proof.method,
      actedAt: args.result.proof.actedAt.toISOString(),
      recordedByUserId: args.result.proof.recordedByUserId,
      clientActionTokenId: args.result.proof.clientActionTokenId,
      contactMethod: args.result.proof.contactMethod,
      destinationSnapshot: args.result.proof.destinationSnapshot,
    },
    meta: args.result.meta,
  }

  if ('booking' in args.result) {
    return normalizeJsonObjectPayload({
      ...common,
      booking: {
        id: args.result.booking.id,
        serviceId: args.result.booking.serviceId,
        offeringId: args.result.booking.offeringId,
        subtotalSnapshot: args.result.booking.subtotalSnapshot,
        totalDurationMinutes: args.result.booking.totalDurationMinutes,
        consultationConfirmedAt:
          args.result.booking.consultationConfirmedAt?.toISOString() ?? null,
      },
      nextHref: sessionHubHref(args.result.booking.id),
    })
  }

  return normalizeJsonObjectPayload({
    ...common,
    nextHref: sessionHubHref(args.bookingId),
  })
}

async function failStartedIdempotency(
  idempotencyRecordId: string | null,
): Promise<void> {
  if (!idempotencyRecordId) return

  await failIdempotency({ idempotencyRecordId }).catch((failError) => {
    console.error(
      'POST /api/pro/bookings/[id]/consultation/in-person-decision idempotency failure update error:',
      failError,
    )
  })
}

export async function POST(req: Request, ctx: Ctx) {
  let idempotencyRecordId: string | null = null

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
      return bookingJsonFail('BOOKING_ID_REQUIRED')
    }

    const rawBody: unknown = await req.json().catch(() => ({}))
    const body: InPersonDecisionRequestBody = isRecord(rawBody) ? rawBody : {}

    const decision = parseDecisionAction(body.action)
    if (!decision) {
      return jsonFail(400, 'Invalid action. Use APPROVED or REJECTED.')
    }

    const { requestId, idempotencyKey, userAgent } = readRequestMeta(req)

    const idempotency = await beginIdempotency<JsonObjectPayload>({
      actor: {
        actorUserId: recordedByUserId,
        actorRole: Role.PRO,
      },
      route: IDEMPOTENCY_ROUTES.CONSULTATION_IN_PERSON_DECISION,
      key: idempotencyKey,
      requestBody: {
        professionalId,
        recordedByUserId,
        bookingId,
        decision,
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

    const result = await recordInPersonConsultationDecision({
      bookingId,
      professionalId,
      recordedByUserId,
      decision,
      requestId,
      idempotencyKey,
      userAgent,
    })

    const responseBody = buildDecisionResponseBody({
      decision,
      bookingId,
      result,
    })

    await completeIdempotency({
      idempotencyRecordId,
      responseStatus: 200,
      responseBody,
    })

    return jsonOk(responseBody, 200)
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

    console.error(
      'POST /api/pro/bookings/[id]/consultation/in-person-decision error',
      error,
    )
    captureBookingException({
      error,
      route: 'POST /api/pro/bookings/[id]/consultation/in-person-decision',
    })

    return jsonFail(500, 'Internal server error')
  }
}