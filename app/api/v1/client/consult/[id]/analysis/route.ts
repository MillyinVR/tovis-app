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
  asConsultAnalysisTransactionError,
  loadConsultAnalysisState,
  startConsultAnalysis,
} from '@/lib/consult/analysisContract'
import { kickConsultAnalysisRun } from '@/lib/consult/analysisRunner'
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
 * P4b: this request no longer makes a single provider call.
 *
 * It validates the prerequisites, claims the session, writes a
 * ConsultAnalysisRun and returns — a handful of queries in one short
 * transaction. The three paid calls (inspiration read, profile, direction; up
 * to 245s combined) happen in the background worker, drained by
 * /api/internal/jobs/consult-analysis/process at `maxDuration = 300`.
 *
 * The duration here is still generous, and deliberately so: `kickConsultAnalysisRun`
 * uses `waitUntil`, which keeps THIS invocation alive after the response is
 * sent for as long as the work it scheduled takes. The client is not waiting
 * on any of it — the response has already gone — but the platform ceiling
 * still bounds how much of the run a kick can finish before the cron has to
 * pick up the rest.
 *
 * ⚠️ NOT verified on Vercel. 150 was already above the Hobby ceiling, so this
 * project is on a plan whose Node.js functions allow more; 300 is the Pro
 * ceiling. If a deploy rejects this value, the response time is unaffected —
 * only the kick is, and the every-minute cron already backstops it.
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

/**
 * The client's poll while a run is in flight, and the read after it settles.
 * One request answers both "what is it doing?" (`analysis.run.stage`) and "is
 * it done?" (`analysis.result`).
 */
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

    // Paid provider calls: one analysis per session is enforced structurally
    // (partial unique index), and one LIVE RUN per session by a second one, so
    // this bucket bounds how fast repeated retries across sessions can spend.
    const limited = await enforceRateLimit({
      bucket: 'client:consult:vision',
      identity: await rateLimitIdentity(auth.user.id),
    })
    if (limited) return limited

    const result = await startConsultAnalysis({
      consultSessionId: id,
      clientId: auth.clientId,
      actor: { type: ConsultActorType.CLIENT, id: auth.user.id },
      loadInput: () => readStartInput(req),
    })

    // Start the run now rather than at the next cron tick — after the response
    // is sent, and never blocking it. The cron backstops a kick that cannot
    // run (see lib/consult/analysisRunner.ts).
    if (result.run && !result.replayed) {
      kickConsultAnalysisRun()
    }

    return jsonOk<ConsultAnalysisStartResponseDTO>({
      analysis: result.state,
      replayed: result.replayed,
    })
  } catch (error: unknown) {
    // A database transaction that expired is a named, retryable refusal — not
    // an anonymous 500. See asConsultAnalysisTransactionError.
    const response = consultWriteErrorResponse(
      asConsultAnalysisTransactionError(error) ?? error,
    )
    if (response) return response
    console.error('POST consult analysis error', { error: safeError(error) })
    return jsonFail(500, 'Internal server error')
  }
}
