// lib/dto/proReviewReply.ts
//
// Wire contract for the pro review-reply endpoints
// (PUT/DELETE /api/v1/pro/reviews/[id]/reply).

/** The pro's public response to a review, as rendered on review surfaces. */
export type ProReviewReplyDTO = {
  /** Reply text (trimmed, 1–1000 chars). */
  body: string
  /** When the reply was last written/edited (ISO-8601). */
  repliedAtISO: string
}

export type ProReviewReplyUpsertResponseDTO = {
  reviewId: string
  reply: ProReviewReplyDTO
}

export type ProReviewReplyDeleteResponseDTO = {
  reviewId: string
  deleted: true
}
