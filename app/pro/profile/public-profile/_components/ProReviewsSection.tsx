// app/pro/profile/public-profile/_components/ProReviewSection.tsx
import ReviewsPanel from '../../ReviewsPanel'

import type { ProProfileManagementReviews } from '../_data/proProfileManagementTypes'

type ProReviewSectionProps = {
  reviews: ProProfileManagementReviews
}

export default function ProReviewSection({ reviews }: ProReviewSectionProps) {
  if (reviews.reviewCount === 0) {
    return (
      <section className="brand-pro-profile-reviews" aria-label="Reviews">
        <div className="brand-pro-profile-empty">No reviews yet.</div>
      </section>
    )
  }

  return (
    <section className="brand-pro-profile-reviews" aria-label="Reviews">
      <ReviewSummary reviews={reviews} />

      <div className="brand-profile-review-card">
        <ReviewsPanel reviews={reviews.items} />
      </div>
    </section>
  )
}

function ReviewSummary({ reviews }: { reviews: ProProfileManagementReviews }) {
  return (
    <div className="brand-profile-review-card">
      <div className="brand-profile-rating-large">
        {reviews.averageRatingLabel ?? '–'}
      </div>

      <div className="brand-cap brand-pro-profile-review-count">
        {formatReviewCount(reviews.reviewCount)}
      </div>
    </div>
  )
}

function formatReviewCount(count: number): string {
  return count === 1 ? '1 review' : `${count} reviews`
}