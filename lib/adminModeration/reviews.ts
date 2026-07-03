// lib/adminModeration/reviews.ts
//
// Admin soft-moderation actions for reviews (SUPER_ADMIN routes only): hide /
// unhide a review, and remove an abusive pro reply cross-tenant. Hide keeps
// the row but drops it from every review list + rating aggregate via
// lib/reviews/visibility — so hide/unhide also refreshes the pro's
// search-index rollup to keep ratingAvg/ratingCount from going stale.
// Repeat actions are forgiving no-ops (mirrors the memberships comp lib's
// `hadComp` pattern) so the admin UI never has to pre-check state.
import { prisma } from '@/lib/prisma'
import { refreshProfessional } from '@/lib/search/index/refreshSearchIndex'

const REVIEW_MODERATION_SELECT = {
  id: true,
  professionalId: true,
  hiddenAt: true,
  proReplyBody: true,
} as const

export type HideReviewByAdminResult =
  | { found: false }
  | { found: true; alreadyHidden: true; professionalId: string }
  | {
      found: true
      alreadyHidden: false
      professionalId: string
      hiddenAt: Date
    }

export async function hideReviewByAdmin(args: {
  reviewId: string
  adminUserId: string
  reason: string | null
}): Promise<HideReviewByAdminResult> {
  const review = await prisma.review.findUnique({
    where: { id: args.reviewId },
    select: REVIEW_MODERATION_SELECT,
  })
  if (!review) return { found: false }

  if (review.hiddenAt) {
    return {
      found: true,
      alreadyHidden: true,
      professionalId: review.professionalId,
    }
  }

  const hiddenAt = new Date()
  await prisma.review.update({
    where: { id: review.id },
    data: {
      hiddenAt,
      hiddenByAdminUserId: args.adminUserId,
      hiddenReason: args.reason,
    },
  })

  await refreshProfessional(review.professionalId, 'review.moderation')

  return {
    found: true,
    alreadyHidden: false,
    professionalId: review.professionalId,
    hiddenAt,
  }
}

export type UnhideReviewByAdminResult =
  | { found: false }
  | { found: true; wasHidden: boolean; professionalId: string }

export async function unhideReviewByAdmin(args: {
  reviewId: string
}): Promise<UnhideReviewByAdminResult> {
  const review = await prisma.review.findUnique({
    where: { id: args.reviewId },
    select: REVIEW_MODERATION_SELECT,
  })
  if (!review) return { found: false }

  if (!review.hiddenAt) {
    return {
      found: true,
      wasHidden: false,
      professionalId: review.professionalId,
    }
  }

  await prisma.review.update({
    where: { id: review.id },
    data: {
      hiddenAt: null,
      hiddenByAdminUserId: null,
      hiddenReason: null,
    },
  })

  await refreshProfessional(review.professionalId, 'review.moderation')

  return {
    found: true,
    wasHidden: true,
    professionalId: review.professionalId,
  }
}

export type ClearReviewProReplyByAdminResult =
  | { found: false }
  | { found: true; hadReply: boolean; professionalId: string }

/**
 * Admin-authorized, cross-tenant version of the pro's own
 * DELETE /api/v1/pro/reviews/[id]/reply — clears the same two columns, but
 * without the ownership constraint. Reply removal doesn't touch rating
 * aggregates, so no index refresh is needed.
 */
export async function clearReviewProReplyByAdmin(args: {
  reviewId: string
}): Promise<ClearReviewProReplyByAdminResult> {
  const review = await prisma.review.findUnique({
    where: { id: args.reviewId },
    select: REVIEW_MODERATION_SELECT,
  })
  if (!review) return { found: false }

  if (!review.proReplyBody) {
    return {
      found: true,
      hadReply: false,
      professionalId: review.professionalId,
    }
  }

  await prisma.review.update({
    where: { id: review.id },
    data: { proReplyBody: null, proReplyAt: null },
  })

  return {
    found: true,
    hadReply: true,
    professionalId: review.professionalId,
  }
}
