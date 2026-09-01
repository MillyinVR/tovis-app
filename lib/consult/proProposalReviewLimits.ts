// lib/consult/proProposalReviewLimits.ts
//
// Book the Look, B5. One constant, in its own module for one reason: the server
// validator (`lib/consult/proProposalReview.ts`) is `server-only`, and the pro's
// review surface is a client component. A client that imported the limit from
// the validator would pull the whole server module into the browser bundle; a
// client that hardcoded its own copy would drift the moment either side moved.

/**
 * The longest per-line note the review will store. Long enough for a real
 * sentence or three about one line, short enough that the column is never a
 * document. Enforced on the server; the textarea's `maxLength` is the courtesy.
 */
export const CONSULT_PROPOSAL_REVIEW_NOTE_MAX_LENGTH = 500
