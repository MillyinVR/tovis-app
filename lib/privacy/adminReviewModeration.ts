// lib/privacy/adminReviewModeration.ts
//
// PII boundary for the admin review-moderation dashboard (SUPER_ADMIN support
// surface). Showing the reviewer's name next to their review is a legitimate
// moderation need, but plaintext-PII reads must cross HERE — inside
// lib/privacy — so the crossing stays audited and the route/UI never touch raw
// `firstName`/`lastName` fields themselves. Output PII is limited to one
// reviewer display label.
//
// Unlike the public review surfaces this list deliberately INCLUDES hidden
// reviews — moderators need to see what's hidden to unhide it.

import { prisma } from '@/lib/prisma'
import { platformCrossTenantProVisibilityFilter } from '@/lib/tenant'

export type AdminReviewModerationRow = {
  reviewId: string
  rating: number
  headline: string | null
  body: string | null
  createdAt: string
  /** Reviewer's name, for moderation context only. */
  clientLabel: string
  professionalId: string
  /** businessName, else the pro's personal name, else the handle. */
  proLabel: string
  proHandle: string | null
  hidden: boolean
  hiddenAt: string | null
  hiddenReason: string | null
  proReplyBody: string | null
  proReplyAt: string | null
}

const MAX_RESULTS = 50

export async function listAdminReviewModeration(
  q: string,
): Promise<AdminReviewModerationRow[]> {
  const query = q.trim()

  const reviews = await prisma.review.findMany({
    where: {
      professional: {
        // Platform-operator surface: admins intentionally moderate reviews
        // across ALL tenants (the explicit cross-tenant opt-out, not a
        // discovery leak).
        ...platformCrossTenantProVisibilityFilter(),
        ...(query.length >= 2
          ? {
              OR: [
                { businessName: { contains: query, mode: 'insensitive' } },
                { handle: { contains: query, mode: 'insensitive' } },
                { firstName: { contains: query, mode: 'insensitive' } },
                { lastName: { contains: query, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
    },
    orderBy: { createdAt: 'desc' },
    take: MAX_RESULTS,
    select: {
      id: true,
      rating: true,
      headline: true,
      body: true,
      createdAt: true,
      hiddenAt: true,
      hiddenReason: true,
      proReplyBody: true,
      proReplyAt: true,
      client: { select: { firstName: true, lastName: true } },
      professional: {
        select: {
          id: true,
          businessName: true,
          firstName: true,
          lastName: true,
          handle: true,
        },
      },
    },
  })

  return reviews.map((review) => {
    const clientName = [review.client?.firstName, review.client?.lastName]
      .filter(Boolean)
      .join(' ')
      .trim()
    const proPersonalName = [
      review.professional.firstName,
      review.professional.lastName,
    ]
      .filter(Boolean)
      .join(' ')
      .trim()

    return {
      reviewId: review.id,
      rating: review.rating,
      headline: review.headline,
      body: review.body,
      createdAt: review.createdAt.toISOString(),
      clientLabel: clientName || 'Client',
      professionalId: review.professional.id,
      proLabel:
        review.professional.businessName?.trim() ||
        proPersonalName ||
        review.professional.handle ||
        review.professional.id,
      proHandle: review.professional.handle,
      hidden: Boolean(review.hiddenAt),
      hiddenAt: review.hiddenAt?.toISOString() ?? null,
      hiddenReason: review.hiddenReason,
      proReplyBody: review.proReplyBody,
      proReplyAt: review.proReplyAt?.toISOString() ?? null,
    }
  })
}
