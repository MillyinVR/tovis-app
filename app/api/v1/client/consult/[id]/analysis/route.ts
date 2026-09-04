import { ConsultActorType } from '@prisma/client'

import {
  jsonFail,
  jsonOk,
  pickNonEmptyString,
  requireClient,
} from '@/app/api/_utils'
import { enforceRateLimit, rateLimitIdentity } from '@/app/api/_utils/rateLimit'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import {
  loadConsultAnalysisState,
  runConsultAnalysis,
} from '@/lib/consult/analysisContract'
import {
  consultNotFoundResponse,
  consultWriteErrorResponse,
} from '@/lib/consult/apiErrors'
import { ConsultWriteError } from '@/lib/consult/errors'
import type {
  ConsultAnalysisStartResponseDTO,
  ConsultAnalysisStateResponseDTO,
} from '@/lib/dto/consult'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
/**
 * This ONE request makes three sequential provider calls: the inspiration read
 * (50s ceiling) and then the two analysis calls (45s and 150s — see
 * CONSULT_ANALYSIS_PROFILE_TIMEOUT_MS / _DIRECTION_TIMEOUT_MS, both measured).
 * Worst case 245s of provider time before any database work — so the previous
 * 150s was below the floor from the moment the analysis became two calls, and
 * would have surfaced as an intermittent gateway timeout AFTER the client had
 * been billed for the model calls.
 *
 * That 230s holds only because both of those clients run with `maxRetries: 0`.
 * The SDK retries a timeout by default, which doubled a single slow direction
 * call to 180s in a measured run — more than this whole budget, for one call.
 *
 * Measured end to end on 2026-09-04 across a dozen live look-anchored consults
 * with a four-image partial pack: the inspiration read 5.5s and the profile
 * call 5.0-8.6s are steady, while the direction call ranged 29s to over 90s.
 * That tail is the reason for the budget, not the median.
 *
 * ⚠️ NOT verified on Vercel. 150 was already above the Hobby ceiling, so this
 * project is on a plan whose Node.js functions allow more; 300 is the Pro
 * ceiling. If a deploy rejects this value, the alternative is not a smaller
 * number — 150 cannot fit three calls — it is moving the analysis off the
 * request path.
 */
export const maxDuration = 300

async function readStartInput(req: Request) {
  const body = await readJsonRecord(req)
  const idempotencyKey = pickNonEmptyString(body.idempotencyKey)
  const promptVersion = pickNonEmptyString(body.promptVersion)
  if (
    !idempotencyKey ||
    !promptVersion ||
    typeof body.schemaVersion !== 'number' ||
    !Number.isInteger(body.schemaVersion)
  ) {
    throw new ConsultWriteError('INVALID_REQUEST', 'Invalid request.')
  }
  return {
    idempotencyKey,
    schemaVersion: body.schemaVersion,
    promptVersion,
  }
}

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res
    const { id } = await resolveRouteParams(ctx)
    if (!id) return consultNotFoundResponse()
    const analysis = await loadConsultAnalysisState({
      consultSessionId: id,
      clientId: auth.clientId,
      actorUserId: auth.user.id,
    })
    return jsonOk<ConsultAnalysisStateResponseDTO>({ analysis })
  } catch (error: unknown) {
    const response = consultWriteErrorResponse(error)
    if (response) return response
    console.error('GET consult analysis error', { error: safeError(error) })
    return jsonFail(500, 'Internal server error')
  }
}

export async function POST(req: Request, ctx: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res
    const { id } = await resolveRouteParams(ctx)
    if (!id) return consultNotFoundResponse()

    // Paid provider call: one analysis per session is enforced structurally
    // (partial unique index); the vision bucket bounds how fast repeated
    // attempts across sessions can spend.
    const limited = await enforceRateLimit({
      bucket: 'client:consult:vision',
      identity: await rateLimitIdentity(auth.user.id),
    })
    if (limited) return limited

    const result = await runConsultAnalysis({
      consultSessionId: id,
      clientId: auth.clientId,
      actor: { type: ConsultActorType.CLIENT, id: auth.user.id },
      loadInput: () => readStartInput(req),
    })
    return jsonOk<ConsultAnalysisStartResponseDTO>({
      analysis: result.state,
      replayed: result.replayed,
    })
  } catch (error: unknown) {
    const response = consultWriteErrorResponse(error)
    if (response) return response
    console.error('POST consult analysis error', { error: safeError(error) })
    return jsonFail(500, 'Internal server error')
  }
}
