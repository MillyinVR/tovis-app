import { jsonFail } from '@/app/api/_utils'

import { ProProposalReviewError } from './proProposalReview'

/**
 * Book the Look, B5. Shaped exactly like `proConsultBriefApi`'s mapper, and for
 * the same reason: HIDDEN and NOT_FOUND answer identically, so a pro outside the
 * founder pilot cannot tell a dark feature from a booking that is not hers.
 */
export function proProposalReviewErrorResponse(error: unknown): Response {
  if (error instanceof ProProposalReviewError) {
    switch (error.code) {
      case 'HIDDEN':
      case 'NOT_FOUND':
        return jsonFail(404, 'Consult proposal not found.', {
          code: 'CONSULT_PROPOSAL_REVIEW_NOT_FOUND',
        })
      case 'INVALID_REQUEST':
        return jsonFail(400, 'Invalid consult proposal review.', {
          code: 'CONSULT_PROPOSAL_REVIEW_INVALID_REQUEST',
        })
      case 'NOT_EDITABLE':
        return jsonFail(409, 'This booking can no longer be reviewed.', {
          code: 'CONSULT_PROPOSAL_REVIEW_NOT_EDITABLE',
        })
      case 'UNAVAILABLE':
        return jsonFail(503, 'Consult proposal review is unavailable.', {
          code: 'CONSULT_PROPOSAL_REVIEW_UNAVAILABLE',
        })
    }
  }

  // Content-free on purpose: nothing about the consult, the analysis or the
  // pro's menu escapes through an error on a founder-gated surface.
  return jsonFail(503, 'Consult proposal review is unavailable.', {
    code: 'CONSULT_PROPOSAL_REVIEW_UNAVAILABLE',
  })
}
