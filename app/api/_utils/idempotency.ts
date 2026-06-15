// app/api/_utils/idempotency.ts
import type { Prisma } from '@prisma/client'

import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import {
  beginIdempotency,
  completeIdempotency,
  failIdempotency,
  type IdempotencyActor,
  type IdempotencyRoute,
} from '@/lib/idempotency'

export type RouteIdempotencyResponseBody = Record<string, unknown>

export type RouteIdempotencyMessages = {
  missingKey?: string
  inProgress?: string
  conflict?: string
}

export type RouteIdempotencyStarted = {
  kind: 'started'
  idempotencyRecordId: string
  idempotencyKey: string
  requestHash: string
}

export type RouteIdempotencyHandled = {
  kind: 'handled'
  response: Response
}

export type RouteIdempotencyBeginResult =
  | RouteIdempotencyStarted
  | RouteIdempotencyHandled

type BeginRouteIdempotencyArgs = {
  request: Request
  actor: IdempotencyActor
  route: IdempotencyRoute
  requestBody: unknown
  requestLabel?: string
  messages?: RouteIdempotencyMessages
}

type CompleteRouteIdempotencyArgs = {
  idempotencyRecordId: string | null | undefined
  responseStatus: number
  responseBody: Prisma.InputJsonValue
}

type FailStartedRouteIdempotencyArgs = {
  idempotencyRecordId: string | null | undefined
  operation: string
}

type ResolvedRouteIdempotencyMessages = {
  missingKey: string
  inProgress: string
  conflict: string
}

const IDEMPOTENCY_KEY_REQUIRED = 'IDEMPOTENCY_KEY_REQUIRED'
const IDEMPOTENCY_REQUEST_IN_PROGRESS = 'IDEMPOTENCY_REQUEST_IN_PROGRESS'
const IDEMPOTENCY_KEY_CONFLICT = 'IDEMPOTENCY_KEY_CONFLICT'

function normalizeHeaderValue(value: string | null): string | null {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function readIdempotencyKey(request: Request): string | null {
  return (
    normalizeHeaderValue(request.headers.get('idempotency-key')) ??
    normalizeHeaderValue(request.headers.get('x-idempotency-key'))
  )
}

function buildInProgressMessage(requestLabel: string | undefined): string {
  const normalized = requestLabel?.trim()

  if (!normalized) {
    return 'A matching request is already in progress.'
  }

  return `A matching ${normalized} request is already in progress.`
}

function resolveMessages(args: {
  requestLabel: string | undefined
  messages: RouteIdempotencyMessages | undefined
}): ResolvedRouteIdempotencyMessages {
  return {
    missingKey: args.messages?.missingKey ?? 'Missing idempotency key.',
    inProgress:
      args.messages?.inProgress ?? buildInProgressMessage(args.requestLabel),
    conflict:
      args.messages?.conflict ??
      'This idempotency key was already used with a different request body.',
  }
}

function missingKeyResponse(message: string): Response {
  return jsonFail(400, message, {
    code: IDEMPOTENCY_KEY_REQUIRED,
  })
}

function inProgressResponse(message: string): Response {
  return jsonFail(409, message, {
    code: IDEMPOTENCY_REQUEST_IN_PROGRESS,
  })
}

function conflictResponse(message: string): Response {
  return jsonFail(409, message, {
    code: IDEMPOTENCY_KEY_CONFLICT,
  })
}

export function isRouteIdempotencyHandled(
  result: RouteIdempotencyBeginResult,
): result is RouteIdempotencyHandled {
  return result.kind === 'handled'
}

export async function beginRouteIdempotency<
  TResponseBody extends RouteIdempotencyResponseBody,
>(
  args: BeginRouteIdempotencyArgs,
): Promise<RouteIdempotencyBeginResult> {
  const messages = resolveMessages({
    requestLabel: args.requestLabel,
    messages: args.messages,
  })

  const idempotencyKey = readIdempotencyKey(args.request)

  if (!idempotencyKey) {
    return {
      kind: 'handled',
      response: missingKeyResponse(messages.missingKey),
    }
  }

  const idempotency = await beginIdempotency<TResponseBody>({
    actor: args.actor,
    route: args.route,
    key: idempotencyKey,
    requestBody: args.requestBody,
  })

  if (idempotency.kind === 'missing_key') {
    return {
      kind: 'handled',
      response: missingKeyResponse(messages.missingKey),
    }
  }

  if (idempotency.kind === 'in_progress') {
    return {
      kind: 'handled',
      response: inProgressResponse(messages.inProgress),
    }
  }

  if (idempotency.kind === 'conflict') {
    return {
      kind: 'handled',
      response: conflictResponse(messages.conflict),
    }
  }

  if (idempotency.kind === 'replay') {
    return {
      kind: 'handled',
      response: jsonOk(
        idempotency.responseBody,
        idempotency.responseStatus,
      ),
    }
  }

  return {
    kind: 'started',
    idempotencyRecordId: idempotency.idempotencyRecordId,
    idempotencyKey,
    requestHash: idempotency.requestHash,
  }
}

export async function completeRouteIdempotency(
  args: CompleteRouteIdempotencyArgs,
): Promise<void> {
  if (!args.idempotencyRecordId) return

  await completeIdempotency({
    idempotencyRecordId: args.idempotencyRecordId,
    responseStatus: args.responseStatus,
    responseBody: args.responseBody,
  })
}

export async function failStartedRouteIdempotency(
  args: FailStartedRouteIdempotencyArgs,
): Promise<void> {
  if (!args.idempotencyRecordId) return

  try {
    await failIdempotency({
      idempotencyRecordId: args.idempotencyRecordId,
    })
  } catch (error: unknown) {
    console.error(`${args.operation} idempotency failure update error:`, error)
  }
}

export type RouteIdempotencyContext = {
  idempotencyKey: string
  idempotencyRecordId: string
  requestHash: string
}

export type RouteIdempotencyRunResult<
  TBody extends RouteIdempotencyResponseBody,
> = {
  status: number
  body: TBody
}

export type WithRouteIdempotencyArgs = BeginRouteIdempotencyArgs & {
  /** Label used in the failure-update error log, e.g. "POST /api/bookings/finalize". */
  operation: string
}

/**
 * Owns the full route idempotency lifecycle so callers can't forget the
 * failure-side cleanup:
 *   begin -> (handled? return that response) -> run -> complete on success,
 *   or failStarted + rethrow on error.
 *
 * `run` does the route's work and returns the success status + response body.
 * On success the body is recorded for replay and returned via jsonOk. On any
 * throw the started record is marked failed (preventing spurious in-progress
 * 409s) and the error is re-thrown so the route keeps its own error->Response
 * mapping in an outer catch.
 */
export async function withRouteIdempotency<
  TBody extends RouteIdempotencyResponseBody & Prisma.InputJsonValue,
>(
  args: WithRouteIdempotencyArgs,
  run: (
    context: RouteIdempotencyContext,
  ) => Promise<RouteIdempotencyRunResult<TBody>>,
): Promise<Response> {
  const begin = await beginRouteIdempotency<TBody>(args)

  if (isRouteIdempotencyHandled(begin)) {
    return begin.response
  }

  try {
    const { status, body } = await run({
      idempotencyKey: begin.idempotencyKey,
      idempotencyRecordId: begin.idempotencyRecordId,
      requestHash: begin.requestHash,
    })

    await completeRouteIdempotency({
      idempotencyRecordId: begin.idempotencyRecordId,
      responseStatus: status,
      responseBody: body,
    })

    return jsonOk(body, status)
  } catch (error: unknown) {
    await failStartedRouteIdempotency({
      idempotencyRecordId: begin.idempotencyRecordId,
      operation: args.operation,
    })

    throw error
  }
}