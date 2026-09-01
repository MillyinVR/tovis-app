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
//
// B7 — `enhancementIds` is the second question parameter, for the same reason
// the mode is one: it names WHICH answer is wanted, and it reserves nothing.
// Absent means the floor alone, because a recommendation the client has not
// asked for is one she has not agreed to (decision 10, opt-in never
// pre-checked). Ids only; every figure in the answer is derived from the pro's
// own menu, so nothing a client can edit here decides what she is charged.

import { ServiceLocationType } from '@prisma/client'

import { jsonFail, jsonOk, requireClient } from '@/app/api/_utils'
import { pickStringArray } from '@/lib/pick'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { normalizeLocationType } from '@/lib/booking/locationContext'
import { MAX_CONSULT_ENHANCEMENT_LINE_IDS } from '@/lib/consult/enhancementOffer'
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

  const url = new URL(request.url)
  const locationType = normalizeLocationType(url.searchParams.get('locationType'))
  if (!locationType) {
    // A mode is REQUIRED, with no default. Defaulting to SALON would answer a
    // question the client did not ask and hand her a salon price for what she
    // may have meant as a mobile appointment — the exact thing this slice's
    // mode reconciliation exists to prevent.
    return jsonFail(400, 'A locationType of SALON or MOBILE is required.', {
      code: 'CONSULT_PROPOSAL_LOCATION_TYPE_REQUIRED',
    })
  }

  // Comma-separated, like every other id list this codebase puts in a query
  // string. Capped at the same ceiling the finalize accepts: a longer list
  // cannot describe more enhancements than an estimate can have, so it is a
  // script rather than a person, and truncating it beats deriving from it.
  const enhancementIds = pickStringArray(
    (url.searchParams.get('enhancementIds') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    MAX_CONSULT_ENHANCEMENT_LINE_IDS,
  )

  try {
    const proposal = await loadAuthorizedConsultBookingProposal({
      consultSessionId: id,
      clientId: auth.clientId,
      actorUserId: auth.user.id,
      locationType: locationType satisfies ServiceLocationType,
      enhancementSelection: enhancementIds,
    })
    return jsonOk<ConsultBookingProposalResponseDTO>({ proposal })
  } catch (error: unknown) {
    return proposalErrorResponse(error)
  }
}
