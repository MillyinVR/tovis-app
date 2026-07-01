// app/pro/finance/ProFinanceScreen.tsx
//
// Client orchestrator for the Pro Finance & Tax tab. Owns the active month +
// sub-tab, refetches the month view-model (a superset of Overview) on change,
// and routes expense CRUD through the API (refetching the month after each
// mutation so all totals stay consistent).
'use client'

import { useState } from 'react'

import { useBrand } from '@/lib/brand/BrandProvider'
import type { ProFinancePageData } from '@/lib/finance/proFinanceSummary'

import FinanceExpensesPanel, {
  type ExpenseFormPayload,
  type ExpenseMutationResult,
} from './_components/FinanceExpensesPanel'
import FinanceExportPanel from './_components/FinanceExportPanel'
import FinanceOverviewPanel from './_components/FinanceOverviewPanel'
import FinanceWriteOffsPanel from './_components/FinanceWriteOffsPanel'
import { ChevronLeftIcon, ChevronRightIcon } from './_components/icons'

type FinanceTab = 'overview' | 'expenses' | 'writeoffs' | 'export'

const TABS: ReadonlyArray<{ id: FinanceTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'expenses', label: 'Expenses' },
  { id: 'writeoffs', label: 'Write-Offs' },
  { id: 'export', label: 'Export' },
]

function shiftMonthKey(key: string, delta: number): string {
  const parts = key.split('-')
  const year = Number(parts[0])
  const month = Number(parts[1])
  // Date used purely for calendar arithmetic (not formatting) — guard-safe.
  const date = new Date(Date.UTC(year, month - 1 + delta, 1, 12, 0, 0))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function readError(raw: unknown): string | undefined {
  if (raw && typeof raw === 'object' && 'error' in raw) {
    const value = (raw as { error?: unknown }).error
    if (typeof value === 'string') return value
  }
  return undefined
}

export default function ProFinanceScreen({
  initialData,
}: {
  initialData: ProFinancePageData
}) {
  const { brand } = useBrand()
  const [data, setData] = useState<ProFinancePageData>(initialData)
  const [activeTab, setActiveTab] = useState<FinanceTab>('overview')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The latest month the pro can view (no navigating into the future). Captured
  // once from the initial load.
  const [maxMonthKey] = useState(() => {
    const keys = [
      ...initialData.months.map((month) => month.key),
      initialData.activeMonth.key,
    ]
    return keys.sort().at(-1) ?? initialData.activeMonth.key
  })

  const activeKey = data.activeMonth.key
  const canGoNext = activeKey < maxMonthKey

  async function goToMonth(monthKey: string) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/pro/finance?month=${monthKey}`, {
        cache: 'no-store',
      })
      if (!res.ok) throw new Error('bad status')
      const raw: unknown = await res.json()
      setData(raw as ProFinancePageData)
    } catch {
      setError('Could not load this month. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function refetchCurrent() {
    await goToMonth(activeKey)
  }

  async function createExpense(
    payload: ExpenseFormPayload,
  ): Promise<ExpenseMutationResult> {
    const res = await fetch('/api/v1/pro/finance/expenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => null)

    if (res?.ok) {
      await refetchCurrent()
      return { ok: true }
    }
    const raw: unknown = res ? await res.json().catch(() => null) : null
    return { ok: false, error: readError(raw) }
  }

  async function updateExpense(
    id: string,
    payload: ExpenseFormPayload,
  ): Promise<ExpenseMutationResult> {
    const res = await fetch(
      `/api/v1/pro/finance/expenses/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    ).catch(() => null)

    if (res?.ok) {
      await refetchCurrent()
      return { ok: true }
    }
    const raw: unknown = res ? await res.json().catch(() => null) : null
    return { ok: false, error: readError(raw) }
  }

  async function deleteExpense(id: string) {
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm('Delete this expense?')
      if (!confirmed) return
    }
    const res = await fetch(
      `/api/v1/pro/finance/expenses/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    ).catch(() => null)
    if (res?.ok) await refetchCurrent()
  }

  const year = activeKey.slice(0, 4)

  return (
    <section
      className="brand-pro-finance-page brand-pro-page-with-fixed-header"
      aria-labelledby="pro-page-title"
    >
      <nav className="brand-pro-finance-monthnav" aria-label="Select month">
        <button
          type="button"
          className="brand-pro-finance-month-btn brand-focus"
          onClick={() => goToMonth(shiftMonthKey(activeKey, -1))}
          disabled={loading}
          aria-label="Previous month"
        >
          <ChevronLeftIcon />
        </button>

        <span className="brand-pro-finance-month-label" aria-live="polite">
          {data.activeMonth.label}
        </span>

        <button
          type="button"
          className="brand-pro-finance-month-btn brand-focus"
          onClick={() => goToMonth(shiftMonthKey(activeKey, 1))}
          disabled={loading || !canGoNext}
          aria-label="Next month"
        >
          <ChevronRightIcon />
        </button>
      </nav>

      <div className="brand-pro-finance-subtabs" role="tablist" aria-label="Finance sections">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            data-active={activeTab === tab.id ? 'true' : 'false'}
            className="brand-pro-finance-subtab brand-focus"
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="brand-pro-finance-form-error" role="alert">
          {error}
        </div>
      )}

      {activeTab === 'overview' && <FinanceOverviewPanel data={data} />}

      {activeTab === 'expenses' && (
        <FinanceExpensesPanel
          expenses={data.finance.expenses}
          expenseTotalLabel={data.finance.expenseTotalLabel}
          categories={data.finance.categories}
          onCreate={createExpense}
          onUpdate={updateExpense}
          onDelete={deleteExpense}
        />
      )}

      {activeTab === 'writeoffs' && (
        <FinanceWriteOffsPanel
          categories={data.finance.categories}
          brandName={brand.displayName}
        />
      )}

      {activeTab === 'export' && (
        <FinanceExportPanel
          activeMonthLabel={data.activeMonth.label}
          monthKey={activeKey}
          year={year}
          brandName={brand.displayName}
        />
      )}
    </section>
  )
}
