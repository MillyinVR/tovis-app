// app/pro/finance/_components/FinanceExportPanel.tsx
//
// The Finance "Export" sub-tab. CSV (monthly/YTD/full-year) + the Schedule-C
// PDF download from /pro/finance/export; receipt-forwarding is still a stub.
// When the pro's plan lacks tax_export (membership enforcement on), the
// download buttons give way to an upgrade CTA — the route 403s anyway.
import Link from 'next/link'

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
  receiptInboxAddress,
  canExportTaxDocs,
}: {
  activeMonthLabel: string
  monthKey: string
  year: string
  brandName: string
  receiptInboxAddress: string | null
  canExportTaxDocs: boolean
}) {
  const exportHref = (
    scope: 'month' | 'ytd' | 'year',
    format: 'csv' | 'pdf' = 'csv',
  ) =>
    `/api/v1/pro/finance/export?scope=${scope}&month=${encodeURIComponent(monthKey)}&format=${format}`

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
      sub: 'Mapped to form lines for your CPA or tax software',
      format: 'PDF',
      href: exportHref('year', 'pdf'),
    },
  ]

  return (
    <div>
      <p className="brand-pro-finance-export-intro">
        Export your income and expense data for your accountant or to fill out
        Schedule C yourself.
      </p>

      {!canExportTaxDocs ? (
        <div className="brand-pro-finance-export-card">
          <div>
            <div className="brand-pro-finance-export-title">
              Exports are a membership feature
            </div>
            <div className="brand-pro-finance-export-sub">
              Your numbers stay right here for free — upgrade to download CSV
              and Schedule&nbsp;C files for your CPA or tax software.
            </div>
          </div>
          <Link
            href="/pro/membership"
            className="brand-pro-finance-export-btn brand-focus"
          >
            Upgrade
          </Link>
        </div>
      ) : null}

      <div className="brand-pro-finance-export-list">
        {rows.map((row) => (
          <div key={row.title} className="brand-pro-finance-export-card">
            <div>
              <div className="brand-pro-finance-export-title">{row.title}</div>
              <div className="brand-pro-finance-export-sub">{row.sub}</div>
            </div>
            {row.href && canExportTaxDocs ? (
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
                aria-label={
                  canExportTaxDocs
                    ? `Export ${row.title} as ${row.format} — coming soon`
                    : `Export ${row.title} as ${row.format} — membership required`
                }
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
        {receiptInboxAddress ? (
          <>
            <p className="brand-pro-finance-forward-body">
              Forward receipts to{' '}
              <span className="brand-pro-finance-forward-email">
                {receiptInboxAddress}
              </span>{' '}
              — or set it as your receipt email in CosmoProf / Salon Centric — and
              they&rsquo;ll appear in your review inbox automatically.
            </p>
          </>
        ) : (
          <p className="brand-pro-finance-forward-body">
            Claim your {brandName} handle to get a personal receipt-forwarding
            address — forward or auto-send receipts and they land in your review
            inbox.
          </p>
        )}
      </div>
    </div>
  )
}
