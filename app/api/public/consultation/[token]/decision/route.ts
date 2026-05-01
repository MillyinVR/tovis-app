// app/api/public/consultation/[token]/decision/route.ts
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
import { prisma } from '@/lib/prisma'
import { hashClientActionToken } from '@/lib/consultation/clientActionTokens'
import { ClientActionTokenKind, Prisma, Role } from '@prisma/client'
import {
  beginIdempotency,
  buildPublicConsultationTokenActorKey,
  completeIdempotency,
  failIdempotency,
  IDEMPOTENCY_ROUTES,
} from '@/lib/idempotency'
import { captureBookingException } from '@/lib/observability/bookingEvents'

export const dynamic = 'force-dynamic'

type Ctx = {
  params: { token: string } | Promise<{ token: string }>
}

type DecisionAction = 'APPROVE' | 'REJECT'

type RequestMeta = {
  requestId: string | null
  idempotencyKey: string | null
  ipAddress: string | null
  userAgent: string | null
}

type NestedInputJsonValue = Prisma.InputJsonValue | null

type JsonObjectPayload = {
  [key: string]: NestedInputJsonValue
}

const TOKEN_ID_SELECT = {
  id: true,
  kind: true,
} satisfies Prisma.ClientActionTokenSelect

type TokenIdRecord = Prisma.ClientActionTokenGetPayload<{
  select: typeof TOKEN_ID_SELECT
}>

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

function invalidTokenFail(): Response {
  return bookingJsonFail('FORBIDDEN', {
    message: 'Consultation action token was not found or is not usable.',
    userMessage: 'That link is invalid or expired.',
  })
}

function idempotencyMissingKeyFail(): Response {
  return jsonFail(400, 'Missing idempotency key.', {
    code: 'IDEMPOTENCY_KEY_REQUIRED',
  })
}

function idempotencyInProgressFail(): Response {
  return jsonFail(
    409,
    'A matching consultation decision request is already in progress.',
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

async function getToken(ctx: Ctx): Promise<string | null> {
  const params = await Promise.resolve(ctx.params)
  return pickString(params?.token)
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

async function resolveTokenIdForIdempotency(
  rawToken: string,
): Promise<TokenIdRecord | null> {
  const tokenHash = hashClientActionToken(rawToken)

  const token = await prisma.clientActionToken.findUnique({
    where: { tokenHash },
    select: TOKEN_ID_SELECT,
  })

  if (!token) return null
  if (token.kind !== ClientActionTokenKind.CONSULTATION_ACTION) return null

  return token
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

  if (
    value instanceof String ||
    value instanceof Number ||
    value instanceof Boolean
  ) {
    return value.valueOf()
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

function buildApproveResponseBody(args: {
  action: DecisionAction
  result: Awaited<ReturnType<typeof approveConsultationByClientActionToken>>
}): JsonObjectPayload {
  return normalizeJsonObjectPayload({
    action: args.action,
    booking: {
      id: args.result.booking.id,
      serviceId: args.result.booking.serviceId,
      offeringId: args.result.booking.offeringId,
      subtotalSnapshot: args.result.booking.subtotalSnapshot,
      totalDurationMinutes: args.result.booking.totalDurationMinutes,
      consultationConfirmedAt:
        args.result.booking.consultationConfirmedAt?.toISOString() ?? null,
    },
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
  })
}

function buildRejectResponseBody(args: {
  action: DecisionAction
  result: Awaited<ReturnType<typeof rejectConsultationByClientActionToken>>
}): JsonObjectPayload {
  return normalizeJsonObjectPayload({
    action: args.action,
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
  })
}

async function failStartedIdempotency(
  idempotencyRecordId: string | null,
): Promise<void> {
  if (!idempotencyRecordId) return

  await failIdempotency({ idempotencyRecordId }).catch((failError) => {
    console.error(
      'POST /api/public/consultation/[token]/decision idempotency failure update error:',
      failError,
    )
  })
}

export async function POST(req: Request, ctx: Ctx) {
  let idempotencyRecordId: string | null = null

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

    const tokenRecord = await resolveTokenIdForIdempotency(token)
    if (!tokenRecord) {
      return invalidTokenFail()
    }

    const idempotency = await beginIdempotency<JsonObjectPayload>({
      actor: {
        actorUserId: null,
        actorKey: buildPublicConsultationTokenActorKey(tokenRecord.id),
        actorRole: Role.CLIENT,
      },
      route: IDEMPOTENCY_ROUTES.CONSULTATION_PUBLIC_DECISION,
      key: idempotencyKey,
      requestBody: {
        clientActionTokenId: tokenRecord.id,
        action,
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

    if (action === 'APPROVE') {
      const result = await approveConsultationByClientActionToken({
        rawToken: token,
        requestId,
        idempotencyKey,
        ipAddress,
        userAgent,
      })

      const responseBody = buildApproveResponseBody({
        action,
        result,
      })

      await completeIdempotency({
        idempotencyRecordId,
        responseStatus: 200,
        responseBody,
      })

      return jsonOk(responseBody, 200)
    }

    const result = await rejectConsultationByClientActionToken({
      rawToken: token,
      requestId,
      idempotencyKey,
      ipAddress,
      userAgent,
    })

    const responseBody = buildRejectResponseBody({
      action,
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
      'POST /api/public/consultation/[token]/decision error',
      error,
    )
    captureBookingException({
      error,
      route: 'POST /api/public/consultation/[token]/decision',
    })

    return jsonFail(500, 'Internal server error')
  }
}