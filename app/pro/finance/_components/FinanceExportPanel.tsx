// app/pro/finance/_components/FinanceExportPanel.tsx
//
// The Finance "Export" sub-tab. CSV / Schedule-C export + receipt-forwarding are
// v1.5 (endpoints not built yet), so the actions render as clearly-labeled
// "coming soon" stubs rather than dead buttons.
import { DownloadIcon } from './icons'

type ExportRow = {
  title: string
  sub: string
  format: 'CSV' | 'PDF'
  href?: string
}

export default function FinanceExportPanel({
  activeMonthLabel,
  monthKey,
  year,
  brandName,
}: {
  activeMonthLabel: string
  monthKey: string
  year: string
  brandName: string
}) {
  const exportHref = (scope: 'month' | 'ytd' | 'year') =>
    `/api/v1/pro/finance/export?scope=${scope}&month=${encodeURIComponent(monthKey)}`

  const rows: ExportRow[] = [
    {
      title: 'Monthly Summary',
      sub: `${activeMonthLabel} — income + expenses`,
      format: 'CSV',
      href: exportHref('month'),
    },
    {
      title: 'Year-to-Date Summary',
      sub: `${year}`,
      format: 'CSV',
      href: exportHref('ytd'),
    },
    {
      title: 'Full Year Export',
      sub: `${year} — all months`,
      format: 'CSV',
      href: exportHref('year'),
    },
    {
      title: 'Schedule C Ready',
      sub: 'Formatted for your CPA or tax software',
      format: 'PDF',
    },
  ]

  return (
    <div>
      <p className="brand-pro-finance-export-intro">
        Export your income and expense data for your accountant or to fill out
        Schedule C yourself.
      </p>

      <div className="brand-pro-finance-export-list">
        {rows.map((row) => (
          <div key={row.title} className="brand-pro-finance-export-card">
            <div>
              <div className="brand-pro-finance-export-title">{row.title}</div>
              <div className="brand-pro-finance-export-sub">{row.sub}</div>
            </div>
            {row.href ? (
              <a
                href={row.href}
                className="brand-pro-finance-export-btn brand-focus"
                aria-label={`Export ${row.title} as ${row.format}`}
              >
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <DownloadIcon /> {row.format}
                </span>
              </a>
            ) : (
              <button
                type="button"
                className="brand-pro-finance-export-btn brand-focus"
                disabled
                aria-label={`Export ${row.title} as ${row.format} — coming soon`}
              >
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <DownloadIcon /> {row.format}
                </span>
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="brand-pro-finance-forward">
        <div className="brand-cap brand-pro-finance-forward-title">
          ◆ FORWARD RECEIPTS
        </div>
        <p className="brand-pro-finance-forward-body">
          Soon you&rsquo;ll be able to forward receipts to your {brandName}{' '}
          inbox and we&rsquo;ll automatically parse and categorize them as
          expenses.
        </p>
        <span className="brand-pro-finance-forward-soon">Coming soon</span>
      </div>
    </div>
  )
}
