// app/pro/dashboard/ProOverviewDashboard.tsx
import Link from 'next/link'

import type {
  ProOverviewMetricItem,
  ProOverviewPageData,
  ProOverviewTopServiceItem,
} from '@/lib/analytics/proMonthlyAnalytics'

type ProOverviewDashboardProps = {
  overview: ProOverviewPageData
}

export default function ProOverviewDashboard({
  overview,
}: ProOverviewDashboardProps) {
  return (
    <section className="brand-pro-overview-page">
      <header className="brand-pro-overview-header">
        <div className="brand-pro-overview-header-row">
          <div>
            <div className="brand-cap brand-pro-overview-kicker">
              ◆ PRO MODE
            </div>

            <h1 className="brand-pro-overview-title">Overview</h1>
          </div>

          <Link
            href="/pro/notifications"
            className="brand-pro-overview-bell brand-focus"
            aria-label="Notifications"
            title="Notifications"
          >
            <BellIcon />
            <span className="brand-pro-overview-bell-dot" aria-hidden />
          </Link>
        </div>

        <OverviewTabs activeHref="/pro/dashboard" />
      </header>

      <div className="brand-pro-overview-body no-scroll">
        <MonthScroller months={overview.months} />

        <RevenueCard overview={overview} />

        <MetricGrid items={overview.primaryStats} />
        <MetricGrid items={overview.secondaryStats} />

        <TopServicesSection
          activeMonthLabel={overview.activeMonth.label}
          services={overview.topServices}
        />
      </div>
    </section>
  )
}

function OverviewTabs({
  activeHref,
}: {
  activeHref: string
}) {
  const tabs = [
    { href: '/pro/dashboard', label: 'Overview' },
    { href: '/pro/reviews', label: 'Reviews' },
    { href: '/pro/aftercare', label: 'Aftercare' },
    { href: '/pro/bookings', label: 'Bookings' },
    { href: '/pro/last-minute', label: 'Last Minute' },
    { href: '/pro/store', label: 'Store' },
  ]

  return (
    <nav className="brand-pro-overview-tabs no-scroll" aria-label="Pro tabs">
      {tabs.map((tab) => {
        const active = tab.href === activeHref

        return (
          <Link
            key={tab.href}
            href={tab.href}
            data-active={active ? 'true' : 'false'}
            aria-current={active ? 'page' : undefined}
            className="brand-pro-overview-tab brand-focus"
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
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

function RevenueCard({
  overview,
}: {
  overview: ProOverviewPageData
}) {
  return (
    <section className="brand-pro-overview-revenue-card">
      <div className="brand-cap brand-pro-overview-revenue-kicker">
        ◆ {overview.activeMonth.label.toUpperCase()} REVENUE
      </div>

      <div className="brand-pro-overview-revenue-row">
        <div className="brand-pro-overview-revenue-value">
          {overview.revenue.value}
        </div>

        <div
          className="brand-pro-overview-trend"
          data-tone={overview.revenue.trendTone}
        >
          <TrendUpIcon />
          <span>{overview.revenue.trendLabel}</span>
        </div>
      </div>

      <div className="brand-pro-overview-muted brand-pro-overview-revenue-sub">
        {overview.revenue.sub}
      </div>
    </section>
  )
}

function MetricGrid({
  items,
}: {
  items: ProOverviewMetricItem[]
}) {
  return (
    <section className="brand-pro-overview-metric-grid">
      {items.map((item) => (
        <MetricCard key={item.label} item={item} />
      ))}
    </section>
  )
}

function MetricCard({
  item,
}: {
  item: ProOverviewMetricItem
}) {
  return (
    <article className="brand-pro-overview-metric-card">
      <div className="brand-cap brand-pro-overview-metric-label">
        {item.label}
      </div>

      <div className="brand-pro-overview-metric-value">
        {item.value}
      </div>

      <div className="brand-pro-overview-muted">
        {item.sub}
      </div>
    </article>
  )
}

function TopServicesSection({
  activeMonthLabel,
  services,
}: {
  activeMonthLabel: string
  services: ProOverviewTopServiceItem[]
}) {
  return (
    <section className="brand-pro-overview-section">
      <div className="brand-cap brand-pro-overview-section-title">
        ◆ TOP SERVICES · {activeMonthLabel.toUpperCase()}
      </div>

      <div className="brand-pro-overview-service-list">
        {services.length > 0 ? (
          services.map((service, index) => (
            <TopServiceRow
              key={service.id}
              service={service}
              rank={index + 1}
            />
          ))
        ) : (
          <div className="brand-pro-overview-empty">
            No completed services for this month yet.
          </div>
        )}
      </div>
    </section>
  )
}

function TopServiceRow({
  service,
  rank,
}: {
  service: ProOverviewTopServiceItem
  rank: number
}) {
  const bookingLabel = service.bookings === 1 ? 'booking' : 'bookings'

  return (
    <article className="brand-pro-overview-service-row">
      <div className="brand-pro-overview-service-rank">
        {rank}
      </div>

      <div className="brand-pro-overview-service-main">
        <div className="brand-pro-overview-service-name">
          {service.name}
        </div>

        <div className="brand-pro-overview-muted brand-pro-overview-service-bookings">
          {service.bookings} {bookingLabel}
        </div>
      </div>

      <div className="brand-pro-overview-service-revenue">
        {service.revenueLabel}
      </div>
    </article>
  )
}

function BellIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="brand-pro-overview-icon"
    >
      <path
        d="M12 22a2.4 2.4 0 0 0 2.35-1.9h-4.7A2.4 2.4 0 0 0 12 22Zm7.2-5.4-1.65-1.65V10a5.58 5.58 0 0 0-4.35-5.45V3.7a1.2 1.2 0 0 0-2.4 0v.85A5.58 5.58 0 0 0 6.45 10v4.95L4.8 16.6a1 1 0 0 0 .7 1.7h13.0a1 1 0 0 0 .7-1.7Z"
        fill="currentColor"
      />
    </svg>
  )
}

function TrendUpIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="brand-pro-overview-trend-icon"
    >
      <path
        d="M4.75 16.75a1 1 0 0 1 0-1.41l4.4-4.4a1 1 0 0 1 1.41 0l2.19 2.19 5.69-5.69H15.5a1 1 0 1 1 0-2h5.35a1 1 0 0 1 1 1v5.35a1 1 0 1 1-2 0V8.85l-6.4 6.4a1 1 0 0 1-1.41 0l-2.19-2.19-3.69 3.69a1 1 0 0 1-1.41 0Z"
        fill="currentColor"
      />
    </svg>
  )
}