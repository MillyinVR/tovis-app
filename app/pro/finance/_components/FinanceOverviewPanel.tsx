// app/pro/finance/_components/FinanceOverviewPanel.tsx
//
// The Finance "Overview" sub-tab: the tax/finance summary (cards + income
// breakdown + quarterly reminder) followed by the RETAINED performance stats
// (revenue / metric grids / top services) reused from the standalone dashboard.
import ProPerformanceSections from '@/app/pro/dashboard/ProPerformanceSections'
import type { ProFinancePageData } from '@/lib/finance/proFinanceSummary'

import { AlarmIcon } from './icons'

export default function FinanceOverviewPanel({
  data,
}: {
  data: ProFinancePageData
}) {
  const { finance } = data

  return (
    <div>
      <section
        className="brand-pro-finance-summary-grid"
        aria-label="Financial summary"
      >
        {finance.summaryCards.map((card) => (
          <article key={card.label} className="brand-pro-finance-summary-card">
            <div className="brand-cap brand-pro-finance-summary-label">
              {card.label}
            </div>
            <div
              className="brand-pro-finance-summary-value"
              data-tone={card.tone}
            >
              {card.value}
            </div>
            <div className="brand-pro-finance-summary-sub">{card.sub}</div>
          </article>
        ))}
      </section>

      <div className="brand-pro-finance-overview-lower brand-pro-finance-section-gap">
        <section className="brand-pro-finance-panel">
          <div className="brand-cap brand-pro-finance-panel-title">
            ◆ INCOME BREAKDOWN
          </div>

          {finance.incomeBreakdown.map((item) => (
            <div key={item.label} className="brand-pro-finance-breakdown-row">
              <div>
                <span className="brand-pro-finance-breakdown-label">
                  {item.label}
                </span>
                <span className="brand-pro-finance-breakdown-source">
                  {item.source}
                </span>
              </div>
              <div className="brand-pro-finance-breakdown-value">
                {item.value}
              </div>
            </div>
          ))}
        </section>

        <section
          className="brand-pro-finance-reminder"
          aria-labelledby="finance-quarterly-reminder-title"
        >
          <div
            id="finance-quarterly-reminder-title"
            className="brand-cap brand-pro-finance-reminder-title"
          >
            <AlarmIcon />
            QUARTERLY TAX REMINDER
          </div>
          <p className="brand-pro-finance-reminder-body">
            Next estimated tax payment due{' '}
            <span className="brand-pro-finance-reminder-due">
              {finance.quarterlyReminder.dueDateLabel}
            </span>
            . {finance.quarterlyReminder.body}
          </p>
        </section>
      </div>

      <ProPerformanceSections overview={data} />
    </div>
  )
}
