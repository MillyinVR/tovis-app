// lib/finance/proFinanceExport.ts
import 'server-only'

import { formatCents } from '@/lib/money'
import { prisma } from '@/lib/prisma'
import {
  DEFAULT_TIME_ZONE,
  getZonedParts,
  sanitizeTimeZone,
} from '@/lib/time'

import {
  ensureProfessionalMonthlyAnalytics,
  monthKey as buildMonthKey,
} from '@/lib/analytics/proMonthlyAnalytics'
import {
  computeEstimatedTaxCents,
  computeIncomeTotalCents,
} from '@/lib/finance/proFinanceSummary'
import { EXPENSE_CATEGORY_BY_ID } from '@/lib/finance/expenseCategories'

export type FinanceExportScope = 'month' | 'ytd' | 'year'

export function isFinanceExportScope(value: string): value is FinanceExportScope {
  return value === 'month' || value === 'ytd' || value === 'year'
}

// The list of monthKeys a scope covers, given the selected month ("YYYY-MM").
export function monthKeysForScope(
  scope: FinanceExportScope,
  selectedMonthKey: string,
): string[] {
  const [yearRaw, monthRaw] = selectedMonthKey.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)

  if (scope === 'month') return [selectedMonthKey]

  const lastMonth = scope === 'ytd' ? month : 12
  const keys: string[] = []
  for (let m = 1; m <= lastMonth; m += 1) {
    keys.push(buildMonthKey({ y: year, m }))
  }
  return keys
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
  const timeZone = sanitizeTimeZone(args.timeZone, DEFAULT_TIME_ZONE)
  const monthKeys = monthKeysForScope(args.scope, args.selectedMonthKey)

  const [snapshots, expenses] = await Promise.all([
    Promise.all(
      monthKeys.map((monthKey) =>
        ensureProfessionalMonthlyAnalytics({
          professionalId: args.professionalId,
          monthKey,
          timeZone,
        }),
      ),
    ),
    prisma.professionalExpense.findMany({
      where: { professionalId: args.professionalId, monthKey: { in: monthKeys } },
      orderBy: [{ spentAt: 'asc' }, { createdAt: 'asc' }],
      select: {
        category: true,
        amountCents: true,
        label: true,
        notes: true,
        spentAt: true,
      },
    }),
  ])

  let serviceCents = 0
  let tipCents = 0
  let productCents = 0
  for (const snapshot of snapshots) {
    serviceCents += snapshot.serviceRevenueCents
    tipCents += snapshot.tipCents
    productCents += snapshot.productRevenueCents
  }
  const incomeTotalCents = computeIncomeTotalCents({
    serviceRevenueCents: serviceCents,
    productRevenueCents: productCents,
    tipCents,
  })

  const expenseTotalCents = expenses.reduce(
    (sum, expense) => sum + expense.amountCents,
    0,
  )
  const netProfitCents = incomeTotalCents - expenseTotalCents
  const estTaxCents = computeEstimatedTaxCents(netProfitCents)

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
  rows.push(csvRow(['Date', 'Category', 'Description', 'Amount', 'Notes']))
  for (const expense of expenses) {
    rows.push(
      csvRow([
        isoDateInTimeZone(expense.spentAt, timeZone),
        EXPENSE_CATEGORY_BY_ID[expense.category].label,
        expense.label,
        formatCents(expense.amountCents),
        expense.notes ?? '',
      ]),
    )
  }
  rows.push(csvRow(['Total Expenses', '', '', formatCents(expenseTotalCents), '']))
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

  const scopeLabel =
    args.scope === 'month'
      ? args.selectedMonthKey
      : args.scope === 'ytd'
        ? `${args.selectedMonthKey.slice(0, 4)}-ytd`
        : args.selectedMonthKey.slice(0, 4)

  return {
    filename: `finance-${scopeLabel}.csv`,
    csv: rows.join('\n'),
  }
}
