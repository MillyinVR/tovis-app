// app/pro/dashboard/ProPerformanceSections.tsx
//
// The performance half of the pro Overview (revenue + trend, the two metric
// grids, top services) WITHOUT the month scroller. Shared by the standalone
// dashboard (ProOverviewDashboard) and the folded Finance tab's Overview
// sub-tab, so the retained stats render identically in both without duplication.
import type {
  ProOverviewMetricItem,
  ProOverviewPageData,
  ProOverviewTopServiceItem,
} from '@/lib/analytics/proMonthlyAnalytics'

export default function ProPerformanceSections({
  overview,
}: {
  overview: ProOverviewPageData
}) {
  return (
    <>
      <RevenueCard
        activeMonthLabel={overview.activeMonth.label}
        revenue={overview.revenue}
      />

      <MetricGrid items={overview.primaryStats} />
      <MetricGrid items={overview.secondaryStats} />

      <TopServicesSection
        activeMonthLabel={overview.activeMonth.label}
        services={overview.topServices}
      />
    </>
  )
}

function RevenueCard({
  activeMonthLabel,
  revenue,
}: {
  activeMonthLabel: string
  revenue: ProOverviewPageData['revenue']
}) {
  return (
    <section
      className="brand-pro-overview-revenue-card"
      aria-labelledby="pro-overview-revenue-title"
    >
      <div
        id="pro-overview-revenue-title"
        className="brand-cap brand-pro-overview-revenue-kicker"
      >
        ◆ {activeMonthLabel.toUpperCase()} REVENUE
      </div>

      <div className="brand-pro-overview-revenue-row">
        <div className="brand-pro-overview-revenue-value">{revenue.value}</div>

        <RevenueTrend label={revenue.trendLabel} tone={revenue.trendTone} />
      </div>

      <div className="brand-pro-overview-muted brand-pro-overview-revenue-sub">
        {revenue.sub}
      </div>
    </section>
  )
}

function RevenueTrend({
  label,
  tone,
}: {
  label: string
  tone: ProOverviewPageData['revenue']['trendTone']
}) {
  return (
    <div className="brand-pro-overview-trend" data-tone={tone}>
      <TrendUpIcon />
      <span>{label}</span>
    </div>
  )
}

function MetricGrid({ items }: { items: ProOverviewMetricItem[] }) {
  if (items.length === 0) return null

  return (
    <section className="brand-pro-overview-metric-grid">
      {items.map((item) => (
        <MetricCard key={item.label} item={item} />
      ))}
    </section>
  )
}

function MetricCard({ item }: { item: ProOverviewMetricItem }) {
  return (
    <article className="brand-pro-overview-metric-card">
      <div className="brand-cap brand-pro-overview-metric-label">
        {item.label}
      </div>

      <div className="brand-pro-overview-metric-value">{item.value}</div>

      <div className="brand-pro-overview-muted">{item.sub}</div>
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
    <section
      className="brand-pro-overview-section"
      aria-labelledby="pro-overview-top-services-title"
    >
      <div
        id="pro-overview-top-services-title"
        className="brand-cap brand-pro-overview-section-title"
      >
        ◆ TOP SERVICES · {activeMonthLabel.toUpperCase()}
      </div>

      <div className="brand-pro-overview-service-list">
        {services.length > 0 ? (
          services.map((service, index) => (
            <TopServiceRow key={service.id} service={service} rank={index + 1} />
          ))
        ) : (
          <TopServicesEmptyState />
        )}
      </div>
    </section>
  )
}

function TopServicesEmptyState() {
  return (
    <div className="brand-pro-overview-empty">
      No completed services for this month yet.
    </div>
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
      <div className="brand-pro-overview-service-rank">{rank}</div>

      <div className="brand-pro-overview-service-main">
        <div className="brand-pro-overview-service-name">{service.name}</div>

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
