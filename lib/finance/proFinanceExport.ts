// lib/finance/proFinanceExport.ts
import 'server-only'

import { formatCents } from '@/lib/money'
import { getZonedParts } from '@/lib/time'

import { EXPENSE_CATEGORY_BY_ID } from '@/lib/finance/expenseCategories'
import {
  exportScopeLabel,
  gatherFinanceExportData,
  isFinanceExportScope,
  monthKeysForScope,
  type FinanceExportScope,
} from '@/lib/finance/financeExportData'

// Re-exported so callers (routes, tests) keep a single import surface.
export {
  isFinanceExportScope,
  monthKeysForScope,
  type FinanceExportScope,
}

// RFC-4180-ish CSV cell: quote when it contains a comma, quote, or newline.
function csvCell(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`
  }
  return value
}

function csvRow(cells: string[]): string {
  return cells.map(csvCell).join(',')
}

function isoDateInTimeZone(instant: Date, timeZone: string): string {
  const parts = getZonedParts(instant, timeZone)
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

export type FinanceExportResult = {
  filename: string
  csv: string
}

export async function buildFinanceCsv(args: {
  professionalId: string
  timeZone: string | null | undefined
  scope: FinanceExportScope
  selectedMonthKey: string
  brandName: string
}): Promise<FinanceExportResult> {
  const data = await gatherFinanceExportData({
    professionalId: args.professionalId,
    timeZone: args.timeZone,
    scope: args.scope,
    selectedMonthKey: args.selectedMonthKey,
  })
  const {
    timeZone,
    monthKeys,
    serviceCents,
    tipCents,
    productCents,
    incomeTotalCents,
    expenses,
    expenseTotalCents,
    netProfitCents,
    estTaxCents,
  } = data

  // Per-category expense totals (Schedule C rollup).
  const categoryTotals = new Map<string, number>()
  for (const expense of expenses) {
    const label = EXPENSE_CATEGORY_BY_ID[expense.category].label
    categoryTotals.set(
      label,
      (categoryTotals.get(label) ?? 0) + expense.amountCents,
    )
  }

  const rows: string[] = []
  rows.push(csvRow([`${args.brandName} — Tax & Finance Export`]))
  rows.push(csvRow(['Scope', args.scope]))
  rows.push(csvRow(['Period', monthKeys[0] ?? '', monthKeys.at(-1) ?? '']))
  rows.push('')

  rows.push(csvRow(['INCOME']))
  rows.push(csvRow(['Services', formatCents(serviceCents)]))
  rows.push(csvRow(['Tips', formatCents(tipCents)]))
  rows.push(csvRow(['Product Sales', formatCents(productCents)]))
  rows.push(csvRow(['Total Income', formatCents(incomeTotalCents)]))
  rows.push('')

  rows.push(csvRow(['EXPENSES']))
  rows.push(csvRow(['Date', 'Category', 'Description', 'Miles', 'Amount', 'Notes']))
  for (const expense of expenses) {
    rows.push(
      csvRow([
        isoDateInTimeZone(expense.spentAt, timeZone),
        EXPENSE_CATEGORY_BY_ID[expense.category].label,
        expense.label,
        expense.mileageMiles != null ? String(expense.mileageMiles) : '',
        formatCents(expense.amountCents),
        expense.notes ?? '',
      ]),
    )
  }
  rows.push(csvRow(['Total Expenses', '', '', '', formatCents(expenseTotalCents), '']))
  rows.push('')

  rows.push(csvRow(['EXPENSES BY CATEGORY']))
  for (const [label, cents] of categoryTotals) {
    rows.push(csvRow([label, formatCents(cents)]))
  }
  rows.push('')

  rows.push(csvRow(['SUMMARY']))
  rows.push(csvRow(['Total Income', formatCents(incomeTotalCents)]))
  rows.push(csvRow(['Total Expenses', formatCents(expenseTotalCents)]))
  rows.push(csvRow(['Net Profit', formatCents(netProfitCents)]))
  rows.push(
    csvRow(['Estimated Tax Set-Aside', formatCents(estTaxCents)]),
  )
  rows.push('')
  rows.push(
    csvRow([
      'This is an estimate, not tax advice. Verify with a tax professional.',
    ]),
  )

  return {
    filename: `finance-${exportScopeLabel(args.scope, args.selectedMonthKey)}.csv`,
    csv: rows.join('\n'),
  }
}
