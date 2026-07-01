// lib/finance/financeExportData.ts
//
// Shared data-gathering for the Finance exports (CSV + Schedule-C PDF): resolves
// the scope's months, sums income from the cached analytics snapshots, loads the
// expense rows, and derives net profit + estimated tax. Both exporters format
// this same payload differently, so the query/aggregation lives here once.
import 'server-only'

import type { ExpenseCategory, Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { DEFAULT_TIME_ZONE, sanitizeTimeZone } from '@/lib/time'

import {
  ensureProfessionalMonthlyAnalytics,
  monthKey as buildMonthKey,
} from '@/lib/analytics/proMonthlyAnalytics'
import {
  computeEstimatedTaxCents,
  computeIncomeTotalCents,
} from '@/lib/finance/proFinanceSummary'

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

export type FinanceExportExpense = {
  category: ExpenseCategory
  amountCents: number
  mileageMiles: Prisma.Decimal | null
  label: string
  notes: string | null
  spentAt: Date
}

export type FinanceExportData = {
  timeZone: string
  monthKeys: string[]
  serviceCents: number
  tipCents: number
  productCents: number
  incomeTotalCents: number
  expenses: FinanceExportExpense[]
  expenseTotalCents: number
  netProfitCents: number
  estTaxCents: number
}

export async function gatherFinanceExportData(args: {
  professionalId: string
  timeZone: string | null | undefined
  scope: FinanceExportScope
  selectedMonthKey: string
}): Promise<FinanceExportData> {
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
        mileageMiles: true,
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

  return {
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
  }
}

// The filename stem for an export, e.g. "2026", "2026-ytd", "2026-04".
export function exportScopeLabel(
  scope: FinanceExportScope,
  selectedMonthKey: string,
): string {
  if (scope === 'month') return selectedMonthKey
  if (scope === 'ytd') return `${selectedMonthKey.slice(0, 4)}-ytd`
  return selectedMonthKey.slice(0, 4)
}
