// app/pro/dashboard/ProLooksInsights.tsx
//
// "Your Looks performance" — the creator-analytics surface on the pro Overview
// (social-first plan C1). Purely presentational: it renders the read-layer DTO
// assembled by lib/looks/creatorAnalytics.ts. Reuses the brand-pro-overview
// visual shell so it sits inside the dashboard body without new layout risk.
import Link from 'next/link'

import RemoteImage from '@/app/_components/media/RemoteImage'
import type { CreatorLooksAnalyticsDto } from '@/lib/looks/creatorAnalytics'
import { formatCompactCount } from '@/lib/format/compactCount'

type ProLooksInsightsProps = {
  analytics: CreatorLooksAnalyticsDto
}

type EngagementMetric = {
  label: string
  value: number
}

export default function ProLooksInsights({ analytics }: ProLooksInsightsProps) {
  const engagementMetrics: EngagementMetric[] = [
    { label: 'Views', value: analytics.totals.views },
    { label: 'Likes', value: analytics.totals.likes },
    { label: 'Comments', value: analytics.totals.comments },
    { label: 'Saves', value: analytics.totals.saves },
    { label: 'Shares', value: analytics.totals.shares },
    { label: 'Bookings', value: analytics.totals.bookings },
  ]

  return (
    <section
      className="brand-pro-overview-section"
      aria-labelledby="pro-looks-insights-title"
    >
      <div
        id="pro-looks-insights-title"
        className="brand-cap brand-pro-overview-section-title"
      >
        ◆ YOUR LOOKS PERFORMANCE
      </div>

      {analytics.publishedCount === 0 ? (
        <div className="brand-pro-overview-empty">
          Publish a look to start tracking its views, saves, and the bookings it
          inspires.
        </div>
      ) : (
        <>
          <div className="brand-pro-overview-muted brand-pro-looks-insights-sub">
            Across {analytics.publishedCount}{' '}
            {analytics.publishedCount === 1 ? 'published look' : 'published looks'}
          </div>

          <div className="brand-pro-overview-metric-grid brand-pro-looks-insights-grid">
            {engagementMetrics.map((metric) => (
              <article
                key={metric.label}
                className="brand-pro-overview-metric-card"
              >
                <div className="brand-cap brand-pro-overview-metric-label">
                  {metric.label}
                </div>
                <div className="brand-pro-overview-metric-value">
                  {formatCompactCount(metric.value)}
                </div>
              </article>
            ))}
          </div>

          <FollowerGrowthCard followers={analytics.followers} />

          <TopLooksList topLooks={analytics.topLooks} />
        </>
      )}
    </section>
  )
}

function FollowerGrowthCard({
  followers,
}: {
  followers: CreatorLooksAnalyticsDto['followers']
}) {
  const peak = followers.weekly.reduce(
    (max, bucket) => Math.max(max, bucket.count),
    0,
  )
  const new30dLabel =
    followers.new30d > 0
      ? `+${formatCompactCount(followers.new30d)} in the last 30 days`
      : 'No new followers in the last 30 days'

  return (
    <section
      className="brand-pro-looks-followers-card"
      aria-labelledby="pro-looks-followers-title"
    >
      <div className="brand-pro-looks-followers-head">
        <div>
          <div
            id="pro-looks-followers-title"
            className="brand-cap brand-pro-overview-metric-label"
          >
            Followers
          </div>
          <div className="brand-pro-overview-metric-value">
            {formatCompactCount(followers.total)}
          </div>
        </div>
        <div
          className="brand-pro-looks-followers-delta"
          data-tone={followers.new30d > 0 ? 'positive' : 'muted'}
        >
          {new30dLabel}
        </div>
      </div>

      <div
        className="brand-pro-looks-sparkline"
        role="img"
        aria-label={`New followers over the last ${followers.weekly.length} weeks`}
      >
        {followers.weekly.map((bucket) => {
          const heightPct = peak > 0 ? (bucket.count / peak) * 100 : 0
          return (
            <div
              key={bucket.weeksAgo}
              className="brand-pro-looks-sparkbar-track"
              title={`${bucket.count} new`}
            >
              <div
                className="brand-pro-looks-sparkbar-fill"
                style={{ height: `${Math.max(heightPct, bucket.count > 0 ? 8 : 0)}%` }}
              />
            </div>
          )
        })}
      </div>
    </section>
  )
}

function TopLooksList({
  topLooks,
}: {
  topLooks: CreatorLooksAnalyticsDto['topLooks']
}) {
  if (topLooks.length === 0) return null

  return (
    <div className="brand-pro-looks-top">
      <div className="brand-cap brand-pro-overview-metric-label brand-pro-looks-top-title">
        Top-performing looks
      </div>

      <div className="brand-pro-looks-top-list">
        {topLooks.map((look, index) => (
          <Link
            key={look.lookPostId}
            href={`/looks/${look.lookPostId}`}
            prefetch={false}
            className="brand-pro-looks-top-row brand-focus"
          >
            <div className="brand-pro-overview-service-rank">{index + 1}</div>

            <div className="brand-pro-looks-top-thumb">
              {look.thumbUrl ? (
                <RemoteImage
                  src={look.thumbUrl}
                  alt={look.caption ?? 'Look'}
                  width={96}
                  height={120}
                  className="brand-pro-looks-top-thumb-img"
                />
              ) : null}
            </div>

            <div className="brand-pro-looks-top-main">
              <div className="brand-pro-looks-top-caption">
                {look.caption ?? 'Untitled look'}
              </div>
              <div className="brand-pro-looks-top-stats">
                <StatChip label="views" value={look.views} />
                <StatChip label="likes" value={look.likes} />
                <StatChip label="saves" value={look.saves} />
                <StatChip label="booked" value={look.bookings} />
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

function StatChip({ label, value }: { label: string; value: number }) {
  return (
    <span className="brand-pro-looks-stat-chip">
      <strong>{formatCompactCount(value)}</strong> {label}
    </span>
  )
}
