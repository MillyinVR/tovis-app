// app/pro/dashboard/ProOverviewDashboard.tsx
import Link from 'next/link'

import type { ProOverviewPageData } from '@/lib/analytics/proMonthlyAnalytics'
import type { ProRetentionInsightsDTO } from '@/lib/analytics/proRetentionInsights'
import type { CreatorLooksAnalyticsDto } from '@/lib/looks/creatorAnalytics'
import type { ProVisibilityHealthDTO } from '@/lib/pro/visibilityHealth'

import ProLooksInsights from './ProLooksInsights'
import ProPerformanceSections from './ProPerformanceSections'
import ProRetentionSection from './ProRetentionSection'
import ProVisibilitySection from './ProVisibilitySection'

type ProOverviewDashboardProps = {
  overview: ProOverviewPageData
  looksAnalytics: CreatorLooksAnalyticsDto
  visibility: ProVisibilityHealthDTO
  retention: ProRetentionInsightsDTO
}

export default function ProOverviewDashboard({
  overview,
  looksAnalytics,
  visibility,
  retention,
}: ProOverviewDashboardProps) {
  return (
    <div className="brand-pro-overview-body no-scroll">
      <MonthScroller months={overview.months} />

      <ProPerformanceSections overview={overview} />

      {/* The paid retention layer sits directly under the free monthly numbers:
          "what happened" first, then "who is coming back, and who is not". */}
      <ProRetentionSection insights={retention} />

      <ProLooksInsights analytics={looksAnalytics} />

      {/* §6.5 sits after the performance read: "what happened" first, then
          "why, and what to pull about it". */}
      <ProVisibilitySection visibility={visibility} />
    </div>
  )
}

function MonthScroller({
  months,
}: {
  months: ProOverviewPageData['months']
}) {
  return (
    <nav
      className="brand-pro-overview-months no-scroll"
      aria-label="Dashboard months"
    >
      {months.map((month) => (
        <Link
          key={month.key}
          href={month.href}
          prefetch={false}
          data-active={month.active ? 'true' : 'false'}
          aria-current={month.active ? 'page' : undefined}
          className="brand-pro-overview-month-pill brand-focus"
        >
          {month.label}
        </Link>
      ))}
    </nav>
  )
}
