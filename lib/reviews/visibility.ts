// lib/reviews/visibility.ts
//
// Admin soft-moderation filter for reviews. A hidden review (Review.hiddenAt
// set) keeps its row but must vanish from every review list AND every rating
// aggregate — spread this fragment into the where clause of any such query.
// The one deliberate exception: the review's author still sees their own
// review on their own booking page (client-owned surfaces don't filter).
import type { Prisma } from '@prisma/client'

export const visibleReviewsWhere = {
  hiddenAt: null,
} satisfies Prisma.ReviewWhereInput
