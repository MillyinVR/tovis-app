import { ConsultActorType } from '@prisma/client'

import { jsonFail, jsonOk, pickNonEmptyString, requireClient } from '@/app/api/_utils'
import { enforceRateLimit, rateLimitIdentity } from '@/app/api/_utils/rateLimit'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import {
  consultNotFoundResponse,
  consultWriteErrorResponse,
} from '@/lib/consult/apiErrors'
import { ConsultWriteError } from '@/lib/consult/errors'
import { readConsultInspiration } from '@/lib/consult/inspirationAnalysisContract'
import { loadConsultInspirationState } from '@/lib/consult/inspirationContract'
import type { ConsultInspirationReadResponseDTO } from '@/lib/dto/consult'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
/**
 * One paid vision call, measured at 5.9s and capped at 50s by the provider
 * client's own timeout (CONSULT_INSPIRATION_REQUEST_TIMEOUT_MS). Unlike the
 * analysis, this fits comfortably in a request, so it stays synchronous and
 * needs no run row or worker: the client asks, waits a moment, and has an
 * answer or a reason.
 */
export const maxDuration = 60

/**
 * P5b — POST: read the client's inspiration reference now.
 *
 * Called once she has attached a reference and `inspiration.source.
 * analysisReady` is false. Idempotent by construction: a second call finds the
 * stored reading by request hash and makes no provider call, so a double-tap,
 * a re-mounted screen and a resumed app all cost nothing.
 *
 * Failure is SURFACED, never swallowed and never degraded to the old static
 * question list (Part 0 rule 4). Two distinct answers, both from
 * `lib/consult/apiErrors.ts`:
 *   * 422 CONSULT_INSPIRATION_ANALYSIS_UNREADABLE — this photograph could not
 *     be read. The client is asked for a clearer one.
 *   * 503 CONSULT_INSPIRATION_ANALYSIS_UNAVAILABLE — the provider. Retry.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    // The same bucket the analysis start uses, deliberately: what it bounds is
    // total provider spend per client per day (40), and this call is part of
    // that spend. A new bucket would let a client spend twice as much by
    // splitting it across two endpoints.
    const limited = await enforceRateLimit({
      bucket: 'client:consult:vision',
      identity: await rateLimitIdentity(auth.user.id),
    })
    if (limited) return limited

    const { id } = await resolveRouteParams(context)
    if (!id) return consultNotFoundResponse()
    const body = await readJsonRecord(request)
    const idempotencyKey = pickNonEmptyString(body.idempotencyKey)
    if (!idempotencyKey) {
      throw new ConsultWriteError('INVALID_REQUEST', 'Invalid request.')
    }

    const before = await readInspirationAnalysisReady({
      consultSessionId: id,
      clientId: auth.clientId,
      actorUserId: auth.user.id,
    })
    await readConsultInspiration({
      consultSessionId: id,
      clientId: auth.clientId,
      actor: { type: ConsultActorType.CLIENT, id: auth.user.id },
      idempotencyKey,
    })
    const inspiration = await loadConsultInspirationState({
      consultSessionId: id,
      clientId: auth.clientId,
      actorUserId: auth.user.id,
    })

    return jsonOk<ConsultInspirationReadResponseDTO>({
      inspiration,
      // Whether THIS request paid for the reading. Derived from the state
      // before and after rather than reported by the contract, so it cannot
      // claim a call that a stored artefact actually served.
      read: !before && Boolean(inspiration.source?.analysisReady),
    })
  } catch (error) {
    const known = consultWriteErrorResponse(error)
    if (known) return known
    console.error('POST consult inspiration read error', { error: safeError(error) })
    return jsonFail(500, 'Internal server error')
  }
}

/** `source.analysisReady` before the read, for the `read` flag above. */
async function readInspirationAnalysisReady(args: {
  consultSessionId: string
  clientId: string
  actorUserId: string
}): Promise<boolean> {
  const state = await loadConsultInspirationState(args)
  return Boolean(state.source?.analysisReady)
}
