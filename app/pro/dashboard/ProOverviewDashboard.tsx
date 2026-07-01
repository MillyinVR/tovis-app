// app/pro/dashboard/ProOverviewDashboard.tsx
import Link from 'next/link'

import type { ProOverviewPageData } from '@/lib/analytics/proMonthlyAnalytics'

import ProPerformanceSections from './ProPerformanceSections'

type ProOverviewDashboardProps = {
  overview: ProOverviewPageData
}

export default function ProOverviewDashboard({
  overview,
}: ProOverviewDashboardProps) {
  return (
    <div className="brand-pro-overview-body no-scroll">
      <MonthScroller months={overview.months} />

      <ProPerformanceSections overview={overview} />
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
