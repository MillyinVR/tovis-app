import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import {
  loadAuthorizedProProposalReview,
  parseProposalReviewSubmission,
  ProProposalReviewError,
  recordProProposalReview,
} from '@/lib/consult/proProposalReview'
import { proProposalReviewErrorResponse } from '@/lib/consult/proProposalReviewApi'
import { pickString } from '@/lib/pick'

export const dynamic = 'force-dynamic'

/**
 * Book the Look, B5 — the API twin of the pro's proposal review.
 *
 * It shares the loader with `/pro/bookings/[id]`'s server component, which is
 * the stated anti-drift rule for a pro-facing read: the page and the endpoint
 * answer the same question exactly once.
 */
export async function GET(_request: Request, context: RouteContext) {
  const auth = await requirePro()
  if (!auth.ok) return auth.res

  const params = await resolveRouteParams(context)
  const bookingId = pickString(params.id)
  if (!bookingId) {
    return jsonFail(400, 'Invalid consult proposal review.', {
      code: 'CONSULT_PROPOSAL_REVIEW_INVALID_REQUEST',
    })
  }

  try {
    const review = await loadAuthorizedProProposalReview({
      professionalId: auth.professionalId,
      bookingId,
    })
    if (!review) {
      return proProposalReviewErrorResponse(
        new ProProposalReviewError('NOT_FOUND'),
      )
    }
    return jsonOk({ review })
  } catch (error: unknown) {
    return proProposalReviewErrorResponse(error)
  }
}

/**
 * Record the pro's numbers against the lines she was asked to accept.
 *
 * 🔴 Changes nothing the client can see: no booking field, no slot width, no
 * notification. The revision-notice threshold is still Tori's call (the
 * direction doc's "Still open"), and this slice deliberately stops short of it.
 */
export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requirePro()
  if (!auth.ok) return auth.res

  const params = await resolveRouteParams(context)
  const bookingId = pickString(params.id)
  if (!bookingId) {
    return jsonFail(400, 'Invalid consult proposal review.', {
      code: 'CONSULT_PROPOSAL_REVIEW_INVALID_REQUEST',
    })
  }

  try {
    const body = await readJsonRecord(request)
    const lines = parseProposalReviewSubmission(body)
    const review = await recordProProposalReview({
      professionalId: auth.professionalId,
      bookingId,
      lines,
    })
    return jsonOk({ review })
  } catch (error: unknown) {
    return proProposalReviewErrorResponse(error)
  }
}
