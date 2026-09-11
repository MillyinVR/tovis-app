// app/api/v1/pro/consults/[id]/follow-up/route.ts
//
// C2-4 — the professional asks the client one follow-up question from the
// Brief, and reads back what she has asked.
//
// The CLIENT never posts here. Her answer goes to the ordinary
// `POST /client/consult/{id}/follow-up`, keyed by the `pro_` question key, so
// a phone that predates this route answers a pro's question unchanged.
//
// Authorization is the shared Brief scope (`requireAuthorizedProLookScope`:
// session lock, ownership, exposure gate, anchor, live agreements, and — for
// the write — the open window). Refusals are uniform with the rest of the pro
// consult surface: a consult that is not hers reads as one that does not exist.

import { enforceProLookRateLimit } from '@/app/api/_utils/consultLookBrief'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { ConsultWriteError } from '@/lib/consult/errors'
import {
  askConsultProFollowUp,
  loadAuthorizedConsultProFollowUps,
  parseConsultProFollowUpAsk,
} from '@/lib/consult/proFollowUp'
import { kickNotificationDrain } from '@/lib/notifications/delivery/kickNotificationDrain'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'private, no-store' }

function failure(error: unknown): Response {
  if (error instanceof ConsultWriteError) {
    return jsonFail(
      error.code === 'NOT_FOUND' ? 404 : error.code === 'INVALID_REQUEST' ? 400 : 409,
      error.message,
      { code: error.code },
    )
  }
  throw error
}

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requirePro()
  if (!auth.ok) return auth.res
  const { id } = await resolveRouteParams(context)
  if (!id) return jsonFail(404, 'Consultation not found.')
  try {
    const questions = await loadAuthorizedConsultProFollowUps({
      consultSessionId: id,
      professionalId: auth.professionalId,
      actorUserId: auth.user.id,
    })
    return jsonOk({ questions }, { headers: NO_STORE })
  } catch (error) {
    return failure(error)
  }
}

export async function POST(request: Request, context: RouteContext) {
  const auth = await requirePro()
  if (!auth.ok) return auth.res
  const limited = await enforceProLookRateLimit(request, auth.professionalId, auth.user.id)
  if (limited) return limited
  const { id } = await resolveRouteParams(context)
  if (!id) return jsonFail(404, 'Consultation not found.')
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonFail(400, 'Invalid follow-up question.')
  }
  try {
    // Professional identity is server-owned; the parser never reads one.
    const ask = parseConsultProFollowUpAsk(body)
    const questions = await askConsultProFollowUp({
      consultSessionId: id,
      professionalId: auth.professionalId,
      actorUserId: auth.user.id,
      ...ask,
    })
    // The doorbell was written inside the transaction; this is what makes it
    // ring now rather than on the next cron tick.
    kickNotificationDrain()
    return jsonOk({ questions }, { headers: NO_STORE })
  } catch (error) {
    return failure(error)
  }
}
