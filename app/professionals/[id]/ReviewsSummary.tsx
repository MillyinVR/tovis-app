// app/professionals/[id]/ReviewsSummary.tsx
import ReviewsPanel from '@/app/pro/profile/ReviewsPanel'
import type {
  PublicProfileStatsDto,
  PublicReviewDto,
} from '@/lib/profiles/publicProfileMappers'

type ReviewsSummaryProps = {
  stats: PublicProfileStatsDto
  reviews: PublicReviewDto[]
  emptyMessage: string
}

export default function ReviewsSummary({
  stats,
  reviews,
  emptyMessage,
}: ReviewsSummaryProps) {
  return (
    <section className="grid gap-3 px-4 py-4">
      <ReviewStatsCard stats={stats} />

      {reviews.length === 0 ? (
        <div className="brand-profile-card p-4 text-[13px] text-textSecondary">
          {emptyMessage}
        </div>
      ) : (
        <div className="brand-profile-card p-3 sm:p-4">
          <ReviewsPanel reviews={reviews} />
        </div>
      )}
    </section>
  )
}

function ReviewStatsCard({ stats }: { stats: PublicProfileStatsDto }) {
  return (
    <div className="brand-profile-card p-4">
      <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-4">
        <div className="text-center">
          <div className="brand-profile-rating-large">
            {stats.averageRatingLabel ?? '—'}
          </div>
          <div className="brand-cap mt-1">
            {stats.reviewCountLabel} reviews
          </div>
        </div>

        <div className="grid gap-2">
          <ReviewSummaryLine label="Reviews" value={stats.reviewCountLabel} />
          <ReviewSummaryLine label="Rating" value={stats.averageRatingLabel ?? '—'} />
          <ReviewSummaryLine label="Saved" value={stats.favoritesLabel} />
        </div>
      </div>
    </div>
  )
}

function ReviewSummaryLine({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-2 last:border-b-0 last:pb-0">
      <span className="brand-cap">{label}</span>
      <span className="text-[13px] font-black text-textPrimary">{value}</span>
    </div>
  )
}