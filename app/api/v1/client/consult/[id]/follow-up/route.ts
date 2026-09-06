// app/api/v1/client/consult/[id]/follow-up/route.ts
//
// P5g — answering one adaptive follow-up question.
//
// ONE route for both vocabularies. The client posts a question key and the
// option enum she tapped; the SERVER decides where that answer is filed, using
// the home the round already recorded (lib/consult/followUpVocabulary.ts). A
// client that had to know an intake answer goes to the intake revision and a
// follow-up-pack answer goes to the round would be a client that can get it
// wrong, on two platforms, in two ways.
//
// Refusals are deliberately uniform with the rest of the consult surface: a
// consult that is not yours is indistinguishable from one that does not exist.

import { ConsultActorType } from '@prisma/client'

import { jsonFail, jsonOk, pickNonEmptyString, requireClient } from '@/app/api/_utils'
import { enforceRateLimit, rateLimitIdentity } from '@/app/api/_utils/rateLimit'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { isAiConsultEnabledForPro } from '@/lib/consult/access'
import { consultNotFoundResponse, consultWriteErrorResponse } from '@/lib/consult/apiErrors'
import {
  answerConsultFollowUpQuestion,
  ConsultFollowUpAnswerError,
} from '@/lib/consult/followUpContract'
import { prisma } from '@/lib/prisma'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * The answer, plus (when it closed a round) the next round's model call.
 *
 * 🔴 `maxDuration` covers the follow-up call's own 20-second timeout plus the
 * intake write around it. It is a single text-only request, not the analysis's
 * three: the analysis has its own runner route at 300 for that reason.
 */
export const maxDuration = 60

export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res
    const limited = await enforceRateLimit({
      bucket: 'client:consult:write',
      identity: await rateLimitIdentity(auth.user.id),
    })
    if (limited) return limited

    const { id } = await resolveRouteParams(context)
    if (!id) return consultNotFoundResponse()

    // The founder gate is re-checked here exactly as the thread read does it:
    // toggling the pilot off must darken writes on already-created sessions.
    const session = await prisma.consultSession.findUnique({
      where: { id },
      select: { clientId: true, professionalId: true },
    })
    if (
      !session ||
      session.clientId !== auth.clientId ||
      !isAiConsultEnabledForPro(session.professionalId)
    ) {
      return consultNotFoundResponse()
    }

    const body = await readJsonRecord(request)
    const idempotencyKey = pickNonEmptyString(body.idempotencyKey)
    const questionKey = pickNonEmptyString(body.questionKey)
    const selectedValues = Array.isArray(body.selectedValues)
      ? body.selectedValues.filter((v): v is string => typeof v === 'string')
      : null
    if (!idempotencyKey || !questionKey || !selectedValues) {
      return jsonFail(400, 'Invalid request.')
    }

    const result = await answerConsultFollowUpQuestion({
      consultSessionId: id,
      clientId: auth.clientId,
      actor: { type: ConsultActorType.CLIENT, id: auth.user.id },
      questionKey,
      selectedValues,
      idempotencyKey,
    })
    return jsonOk({ followUp: result.state, nextRoundCreated: result.nextRoundCreated })
  } catch (error) {
    if (error instanceof ConsultFollowUpAnswerError) {
      // NOT_OPEN covers a replayed tap and an answer to a superseded plan's
      // question. Both are the client being behind, not the client being wrong,
      // so they read as a conflict rather than as a validation failure.
      return jsonFail(error.code === 'NOT_OPEN' ? 409 : 400, 'Invalid request.')
    }
    const known = consultWriteErrorResponse(error)
    if (known) return known
    console.error('POST consult follow-up answer error', { error: safeError(error) })
    return jsonFail(500, 'Internal server error')
  }
}
