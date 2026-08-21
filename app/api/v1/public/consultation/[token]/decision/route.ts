// app/api/v1/public/consultation/[token]/decision/route.ts
import { jsonFail, jsonOk, pickString, upper } from '@/app/api/_utils'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import {
  enforceRateLimit,
  rateLimitIdentity,
  tokenRateLimitIdentity,
} from '@/app/api/_utils/rateLimit'
import {
  isBookingError,
} from '@/lib/booking/errors'
import {
  bookingErrorJsonFail,
  bookingJsonFail,
} from '@/app/api/_utils/bookingResponses'
import {
  normalizeJsonObjectPayload,
  type JsonObjectPayload,
} from '@/app/api/_utils/jsonPayload'
import {
  approveConsultationByClientActionToken,
  rejectConsultationByClientActionToken,
} from '@/lib/booking/writeBoundary'
import { broadcastBookingChange } from '@/lib/live/broadcastBooking'
import { prisma } from '@/lib/prisma'
import { getTrustedClientIpFromRequest } from '@/lib/trustedClientIp'
import {
  clientActionTokenRateLimitPrefix,
  hashClientActionToken,
} from '@/lib/consultation/clientActionTokens'
import { ClientActionTokenKind, Prisma, Role } from '@prisma/client'
import {
  beginRouteIdempotency,
  completeRouteIdempotency,
  failStartedRouteIdempotency,
  isRouteIdempotencyHandled,
} from '@/app/api/_utils/idempotency'
import { captureBookingException } from '@/lib/observability/bookingEvents'
import {
  buildPublicConsultationTokenActorKey,
  IDEMPOTENCY_ROUTES,
} from '@/lib/idempotency'
export const dynamic = 'force-dynamic'

type DecisionAction = 'APPROVE' | 'REJECT'

type RequestMeta = {
  requestId: string | null
  idempotencyKey: string | null
  ipAddress: string | null
  userAgent: string | null
}

const TOKEN_ID_SELECT = {
  id: true,
  kind: true,
  // Carried so the live-sync ping after the decision knows which booking
  // changed. The token is resolved before the write anyway (for idempotency),
  // and `bookingId` is non-nullable on ClientActionToken, so this costs nothing
  // extra and never needs the write's result shape to grow a field.
  bookingId: true,
} satisfies Prisma.ClientActionTokenSelect

type TokenIdRecord = Prisma.ClientActionTokenGetPayload<{
  select: typeof TOKEN_ID_SELECT
}>

function invalidTokenFail(): Response {
  return bookingJsonFail('FORBIDDEN', {
    message: 'Consultation action token was not found or is not usable.',
    userMessage: 'That link is invalid or expired.',
  })
}




async function getToken(ctx: RouteContext<{ token: string }>): Promise<string | null> {
  const params = await resolveRouteParams(ctx)
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

  // Use the trusted-IP resolver so a spoofed x-forwarded-for can't forge the
  // consent-proof audit trail — only the platform-trusted edge header is honored.
  const ipAddress = getTrustedClientIpFromRequest(req)
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
      // Internal audit fields (recordedByUserId, clientActionTokenId) and
      // counterparty contact (contactMethod, destinationSnapshot) are NOT
      // returned to the token bearer — see the GET route for the same redaction.
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
      // Internal audit fields (recordedByUserId, clientActionTokenId) and
      // counterparty contact (contactMethod, destinationSnapshot) are NOT
      // returned to the token bearer — see the GET route for the same redaction.
    },
    meta: args.result.meta,
  })
}

async function failStartedIdempotency(
  idempotencyRecordId: string | null,
): Promise<void> {
  if (!idempotencyRecordId) return

  await failStartedRouteIdempotency({
    idempotencyRecordId,
    operation: 'POST /api/v1/public/consultation/[token]/decision',
  }).catch((failError) => {
    console.error(
      'POST /api/v1/public/consultation/[token]/decision idempotency failure update error:',
      failError,
    )
  })
}

export async function POST(req: Request, ctx: RouteContext<{ token: string }>) {
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

    // Brute-force guard: rate-limit by IP and by token-prefix BEFORE any DB
    // lookup. The token-prefix bucket caps attempts against a leaked
    // partial token across many IPs.
    const ipIdentity = await rateLimitIdentity()
    const ipLimited = await enforceRateLimit({
      bucket: 'consultation:decision',
      identity: ipIdentity,
    })
    if (ipLimited) return ipLimited

    const tokenLimited = await enforceRateLimit({
      bucket: 'consultation:decision:token',
      identity: tokenRateLimitIdentity(clientActionTokenRateLimitPrefix(token)),
    })
    if (tokenLimited) return tokenLimited

    const { requestId, idempotencyKey, ipAddress, userAgent } =
      readRequestMeta(req)

    const tokenRecord = await resolveTokenIdForIdempotency(token)
    if (!tokenRecord) {
      return invalidTokenFail()
    }

    const idempotency = await beginRouteIdempotency<JsonObjectPayload>({
      request: req,
      actor: {
        actorUserId: null,
        actorKey: buildPublicConsultationTokenActorKey(tokenRecord.id),
        actorRole: Role.CLIENT,
      },
      route: IDEMPOTENCY_ROUTES.CONSULTATION_PUBLIC_DECISION,
      requestLabel: 'public consultation decision',
      requestBody: {
        clientActionTokenId: tokenRecord.id,
        action,
      },
      messages: {
        missingKey: 'Missing idempotency key.',
        inProgress:
          'A matching consultation decision request is already in progress.',
        conflict:
          'This idempotency key was already used with a different request body.',
      },
    })

    if (isRouteIdempotencyHandled(idempotency)) {
      return idempotency.response
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

      await completeRouteIdempotency({
        idempotencyRecordId,
        responseStatus: 200,
        responseBody,
      })

      // Live-sync: the client approved from the emailed/texted link, so the pro
      // is on another device entirely. Without this the pro's calendar and
      // session screens sat stale until a manual reload — the authed in-app
      // decision route has always pinged, this second door never did.
      await broadcastBookingChange(tokenRecord.bookingId, 'consultation')

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

    await completeRouteIdempotency({
      idempotencyRecordId,
      responseStatus: 200,
      responseBody,
    })

    // A decline is news the pro needs just as fast as an approval.
    await broadcastBookingChange(tokenRecord.bookingId, 'consultation')

    return jsonOk(responseBody, 200)
  } catch (error: unknown) {
    if (idempotencyRecordId) {
      await failStartedIdempotency(idempotencyRecordId)
    }

    if (isBookingError(error)) {
      return bookingErrorJsonFail(error)
    }

    console.error(
      'POST /api/v1/public/consultation/[token]/decision error',
      error,
    )
    captureBookingException({
      error,
      route: 'POST /api/v1/public/consultation/[token]/decision',
    })

    return jsonFail(500, 'Internal server error')
  }
}