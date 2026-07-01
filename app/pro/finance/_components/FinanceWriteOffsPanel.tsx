// app/pro/finance/_components/FinanceWriteOffsPanel.tsx
//
// The Finance "Write-Offs" sub-tab: an educational guide to each expense
// category color-coded by IRS audit risk, expandable to the plain-English rule
// + examples. Content comes from the server-resolved category config.
'use client'

import { useState } from 'react'

import type { ProFinanceCategoryInfo } from '@/lib/finance/proFinanceSummary'

import { ChevronDownIcon, WarnTriangleIcon } from './icons'

const LEGEND: ReadonlyArray<{
  risk: 'green' | 'yellow' | 'red'
  label: string
}> = [
  { risk: 'green', label: '✓ Clear' },
  { risk: 'yellow', label: '⚡ Conditional' },
  { risk: 'red', label: '⚠ Risky' },
]

export default function FinanceWriteOffsPanel({
  categories,
  brandName,
}: {
  categories: ProFinanceCategoryInfo[]
  brandName: string
}) {
  const [openId, setOpenId] = useState<string | null>(null)

  return (
    <div>
      <p className="brand-pro-finance-writeoff-intro">
        Every category below is color-coded by IRS risk level. Tap any one to see
        exactly what qualifies and what documentation to keep.
      </p>

      <div className="brand-pro-finance-legend">
        {LEGEND.map((item) => (
          <span
            key={item.risk}
            className="brand-pro-finance-legend-item"
            data-risk={item.risk}
          >
            <span className="brand-pro-finance-risk-dot" data-risk={item.risk} />
            {item.label}
          </span>
        ))}
      </div>

      <div className="brand-pro-finance-writeoff-list">
        {categories.map((category) => {
          const open = openId === category.id
          return (
            <div
              key={category.id}
              className="brand-pro-finance-writeoff-row"
              data-open={open ? 'true' : 'false'}
            >
              <button
                type="button"
                className="brand-pro-finance-writeoff-head brand-focus"
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : category.id)}
              >
                <span
                  className="brand-pro-finance-risk-dot"
                  data-risk={category.risk}
                />
                <span className="brand-pro-finance-writeoff-name">
                  {category.label}
                </span>
                <span
                  className="brand-pro-finance-writeoff-badge"
                  data-risk={category.risk}
                >
                  {category.riskLabel}
                </span>
                <ChevronDownIcon className="brand-pro-finance-writeoff-chevron" />
              </button>

              {open && (
                <div className="brand-pro-finance-writeoff-detail">
                  {category.tooltip}
                  {category.examples.length > 0 && (
                    <div className="brand-pro-finance-writeoff-examples">
                      Examples: {category.examples.join(', ')}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="brand-pro-finance-disclaimer" role="note">
        <WarnTriangleIcon />
        <span>
          {brandName} helps you track and organize — but we&rsquo;re not a CPA.
          Tax laws change. Always verify deductions with a tax professional
          before filing, especially for home office, appearance, and meals.
        </span>
      </div>
    </div>
  )
}
