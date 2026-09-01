// app/api/v1/client/consult/[id]/proposal/route.ts
//
// Book the Look, slice B4 — "what would I be booking, and what does it start
// at?" for one consult in one mode.
//
// Read-only and idempotent, so it is a GET. The mode is a query parameter
// rather than a body field because it is the QUESTION, not a choice being
// recorded: the client can ask about salon and mobile in either order, and
// neither answer reserves anything.
//
// 🔴 The answer is a PREVIEW. It is re-derived inside the finalize transaction
// before anything is written, because a pro's menu, prices and bookable
// locations can all move between the preview and the tap.

import { ServiceLocationType } from '@prisma/client'

import { jsonFail, jsonOk, requireClient } from '@/app/api/_utils'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { normalizeLocationType } from '@/lib/booking/locationContext'
import {
  ConsultProposalEntryError,
  loadAuthorizedConsultBookingProposal,
} from '@/lib/consult/proposalEntry'
import type { ConsultBookingProposalResponseDTO } from '@/lib/dto/consult'
import { enforceRateLimit } from '@/lib/rateLimit/enforce'
import { clientRateLimitKey } from '@/lib/rateLimit/identity'
import { rateLimitExceededResponse } from '@/lib/rateLimit/response'

export const dynamic = 'force-dynamic'

/**
 * Deliberately stable and content-free, mirroring the results endpoint: a
 * refusal must not distinguish "no such consult" from "not yours" from "the
 * pilot is dark for that pro".
 */
function proposalErrorResponse(error: unknown): Response {
  if (error instanceof ConsultProposalEntryError) {
    if (error.code === 'HIDDEN' || error.code === 'NOT_FOUND') {
      return jsonFail(404, 'Consult booking proposal not found.', {
        code: 'CONSULT_PROPOSAL_NOT_FOUND',
      })
    }
  }

  return jsonFail(503, 'Consult booking proposal is unavailable.', {
    code: 'CONSULT_PROPOSAL_UNAVAILABLE',
  })
}

export async function GET(request: Request, context: RouteContext) {
  const auth = await requireClient()
  if (!auth.ok) return auth.res

  const { id } = await resolveRouteParams(context)
  if (!id) {
    return proposalErrorResponse(new ConsultProposalEntryError('NOT_FOUND'))
  }

  // Every call runs an analysis-scoped authorization plus a menu read inside a
  // transaction, and a client can flip modes freely, so it is rate limited on
  // the same client bucket the rest of the consult surface uses.
  const rateLimit = await enforceRateLimit({
    bucket: 'client:consult:proposal',
    key: clientRateLimitKey({
      clientId: auth.clientId,
      userId: auth.user.id,
      request,
    }),
  })
  if (!rateLimit.allowed) return rateLimitExceededResponse(rateLimit)

  const requested = new URL(request.url).searchParams.get('locationType')
  const locationType = normalizeLocationType(requested)
  if (!locationType) {
    // A mode is REQUIRED, with no default. Defaulting to SALON would answer a
    // question the client did not ask and hand her a salon price for what she
    // may have meant as a mobile appointment — the exact thing this slice's
    // mode reconciliation exists to prevent.
    return jsonFail(400, 'A locationType of SALON or MOBILE is required.', {
      code: 'CONSULT_PROPOSAL_LOCATION_TYPE_REQUIRED',
    })
  }

  try {
    const proposal = await loadAuthorizedConsultBookingProposal({
      consultSessionId: id,
      clientId: auth.clientId,
      actorUserId: auth.user.id,
      locationType: locationType satisfies ServiceLocationType,
    })
    return jsonOk<ConsultBookingProposalResponseDTO>({ proposal })
  } catch (error: unknown) {
    return proposalErrorResponse(error)
  }
}
