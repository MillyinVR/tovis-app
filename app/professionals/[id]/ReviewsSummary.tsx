// app/professionals/[id]/ReviewsSummary.tsx
import ReviewsPanel from '@/app/pro/profile/ReviewsPanel'
import type {
  PublicProfileStatsDto,
  PublicReviewDto,
} from '@/lib/profiles/publicProfileMappers'

type ReviewsSummaryProps = {
  professionalId: string
  stats: PublicProfileStatsDto
  reviews: PublicReviewDto[]
  emptyMessage: string
}

export default function ReviewsSummary({
  professionalId,
  stats,
  reviews,
  emptyMessage,
}: ReviewsSummaryProps) {
  // A single mono line replaces the old three-row stats card: on a page whose
  // whole argument is the work, a second summary of the same two numbers was
  // furniture. The rating and the count still lead the section.
  const summary = [
    stats.averageRatingLabel ? `★ ${stats.averageRatingLabel}` : null,
    `${stats.reviewCountLabel} reviews`,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <section className="grid gap-3 py-5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-textMuted">
          Reviews
        </div>
        <div className="font-mono text-[11px] tracking-[0.1em] text-textSecondary">
          {summary}
        </div>
      </div>

      {reviews.length === 0 ? (
        <div className="brand-pp-card p-4 text-[13px] text-textSecondary">
          {emptyMessage}
        </div>
      ) : (
        <div className="brand-pp-card p-3 sm:p-4">
          <ReviewsPanel reviews={reviews} professionalId={professionalId} />
        </div>
      )}
    </section>
  )
}