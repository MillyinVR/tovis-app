// lib/finance/proFinanceSummary.ts
import 'server-only'

import type { ExpenseCategory, ExpenseSource, Prisma } from '@prisma/client'

import {
  EXPENSE_CATEGORY_BY_ID,
  resolveExpenseCategories,
  type ExpenseCategoryConfig,
  type ExpenseRiskLevel,
} from '@/lib/finance/expenseCategories'
import {
  ESTIMATED_TAX_DUE_DATES,
  mileageRateLabel,
  SELF_EMPLOYMENT_ESTIMATE_RATE,
  STANDARD_MILEAGE_RATE_CENTS,
  TAX_YEAR,
} from '@/lib/finance/taxRates'
import { formatCents } from '@/lib/money'
import {
  resolveReceiptInboxAddress,
  serializeReceiptInboxItem,
  type ProReceiptInboxItem,
} from '@/lib/finance/receiptInbox'
import { prisma } from '@/lib/prisma'
import {
  DEFAULT_TIME_ZONE,
  formatInTimeZone,
  sanitizeTimeZone,
  startOfDayUtcInTimeZone,
} from '@/lib/time'

import {
  ensureProfessionalMonthlyAnalytics,
  loadProOverviewPage,
  type ProOverviewPageData,
  type ProOverviewSearchParams,
} from '@/lib/analytics/proMonthlyAnalytics'

export type ProFinanceCardTone = 'positive' | 'negative' | 'warn' | 'neutral'

export type ProFinanceSummaryCard = {
  label: string
  value: string
  sub: string
  tone: ProFinanceCardTone
}

export type ProFinanceIncomeBreakdownItem = {
  label: string
  source: string
  value: string
  amountCents: number
}

export type ProFinanceQuarterlyReminder = {
  dueDateLabel: string
  body: string
}

export type ProFinanceExpenseItem = {
  id: string
  category: ExpenseCategory
  categoryLabel: string
  categoryRisk: ExpenseRiskLevel
  source: ExpenseSource
  amountCents: number
  amountLabel: string
  /** Logged business miles for a MILEAGE expense; null otherwise. */
  mileageMiles: number | null
  label: string
  notes: string | null
  dateLabel: string
  spentAtIso: string
  hasReceipt: boolean
  receiptMediaId: string | null
}

export type ProFinanceCategoryInfo = {
  id: ExpenseCategory
  label: string
  risk: ExpenseRiskLevel
  riskLabel: string
  tooltip: string
  examples: string[]
}

export type ProFinanceBlock = {
  taxYear: number
  incomeTotalCents: number
  expenseTotalCents: number
  netProfitCents: number
  estTaxCents: number
  expenseTotalLabel: string
  summaryCards: ProFinanceSummaryCard[]
  incomeBreakdown: ProFinanceIncomeBreakdownItem[]
  quarterlyReminder: ProFinanceQuarterlyReminder
  expenses: ProFinanceExpenseItem[]
  categories: ProFinanceCategoryInfo[]
  /** Current IRS standard mileage rate in cents/mile (e.g. 72.5) — lets the
   *  add-expense form preview a trip's deduction live. */
  mileageRateCents: number
  mileageRateLabel: string
  /** Captured receipts awaiting review (all-time PENDING, newest first). */
  receiptInbox: ProReceiptInboxItem[]
  /** The pro's forwarding address (<handle>@tovis.me) — premium only, else null. */
  receiptInboxAddress: string | null
}

// Superset of the performance Overview view-model (nothing dropped) + the new
// Finance/tax block.
export type ProFinancePageData = ProOverviewPageData & {
  finance: ProFinanceBlock
}

// ── pure math (unit-tested directly) ────────────────────────────────────────

export function computeIncomeTotalCents(snapshot: {
  serviceRevenueCents: number
  productRevenueCents: number
  tipCents: number
}): number {
  // Spec §6: income = services + tips + products. The analytics
  // `revenueTotalCents` intentionally EXCLUDES tips, so we sum the parts here
  // rather than reuse it.
  return (
    snapshot.serviceRevenueCents +
    snapshot.productRevenueCents +
    snapshot.tipCents
  )
}

export function computeEstimatedTaxCents(netProfitCents: number): number {
  if (netProfitCents <= 0) return 0
  return Math.round(netProfitCents * SELF_EMPLOYMENT_ESTIMATE_RATE)
}

// Next federal estimated-tax due date strictly after `now`, formatted in the
// pro's timezone (e.g. "June 16, 2026"). Statutory dates only — see taxRates.
export function nextQuarterlyDueLabel(args: {
  now: Date
  timeZone: string
}): string {
  const tz = sanitizeTimeZone(args.timeZone, DEFAULT_TIME_ZONE)
  const startYear = args.now.getUTCFullYear()

  for (let yearOffset = 0; yearOffset <= 1; yearOffset += 1) {
    const year = startYear + yearOffset
    for (const due of ESTIMATED_TAX_DUE_DATES) {
      // Noon UTC keeps the calendar day stable across US timezones.
      const candidate = new Date(
        Date.UTC(year, due.month - 1, due.day, 12, 0, 0),
      )
      if (candidate.getTime() > args.now.getTime()) {
        return formatInTimeZone(
          candidate,
          tz,
          { month: 'long', day: 'numeric', year: 'numeric' },
          'en-US',
        )
      }
    }
  }

  // Unreachable (the loop always finds a future date within 2 years), but keep
  // the return type total.
  return ''
}

// Derived write fields for an expense from a picked calendar date. Shared by the
// create/update routes so month grouping matches how Finance reads it back.
export function expenseDateFields(args: {
  dateInput: { year: number; month: number; day: number }
  timeZone: string
}): { spentAt: Date; monthKey: string } {
  const tz = sanitizeTimeZone(args.timeZone, DEFAULT_TIME_ZONE)
  const { year, month, day } = args.dateInput

  const anchor = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
  const spentAt = startOfDayUtcInTimeZone(anchor, tz)
  const monthKey = `${year}-${String(month).padStart(2, '0')}`

  return { spentAt, monthKey }
}

// ── view-model assembly ─────────────────────────────────────────────────────

// Row → wire item. Exported so the create/update routes return the same shape
// the Finance page renders, keeping serialization in one place.
export function serializeProFinanceExpense(
  row: {
    id: string
    category: ExpenseCategory
    source: ExpenseSource
    amountCents: number
    mileageMiles: Prisma.Decimal | null
    label: string
    notes: string | null
    spentAt: Date
    receiptMediaId: string | null
  },
  timeZone: string,
): ProFinanceExpenseItem {
  const config = EXPENSE_CATEGORY_BY_ID[row.category]

  return {
    id: row.id,
    category: row.category,
    categoryLabel: config.label,
    categoryRisk: config.risk,
    source: row.source,
    amountCents: row.amountCents,
    amountLabel: formatCents(row.amountCents),
    mileageMiles: row.mileageMiles != null ? row.mileageMiles.toNumber() : null,
    label: row.label,
    notes: row.notes,
    dateLabel: formatInTimeZone(
      row.spentAt,
      timeZone,
      { month: 'short', day: 'numeric' },
      'en-US',
    ),
    spentAtIso: row.spentAt.toISOString(),
    hasReceipt: row.receiptMediaId != null,
    receiptMediaId: row.receiptMediaId,
  }
}

function toCategoryInfo(config: ExpenseCategoryConfig): ProFinanceCategoryInfo {
  return {
    id: config.id,
    label: config.label,
    risk: config.risk,
    riskLabel: config.riskLabel,
    tooltip: config.tooltip,
    examples: config.examples,
  }
}

export async function loadProFinancePage(args: {
  professionalId: string
  professionalTimeZone: string | null | undefined
  searchParams: ProOverviewSearchParams | undefined
  now: Date
  brandName: string
}): Promise<ProFinancePageData> {
  // Reuse the existing Overview loader wholesale — the Finance screen is a
  // superset, so revenue/stats/topServices come through unchanged.
  const overview = await loadProOverviewPage({
    professionalId: args.professionalId,
    professionalTimeZone: args.professionalTimeZone,
    searchParams: args.searchParams,
    now: args.now,
  })

  const timeZone = overview.activeMonth.timeZone
  const monthKey = overview.activeMonth.key

  const [snapshot, expenseRows, receiptRows, proMeta] = await Promise.all([
    ensureProfessionalMonthlyAnalytics({
      professionalId: args.professionalId,
      monthKey,
      timeZone,
    }),
    prisma.professionalExpense.findMany({
      where: { professionalId: args.professionalId, monthKey },
      orderBy: [{ spentAt: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        category: true,
        source: true,
        amountCents: true,
        mileageMiles: true,
        label: true,
        notes: true,
        spentAt: true,
        receiptMediaId: true,
      },
    }),
    prisma.professionalReceiptInbox.findMany({
      where: { professionalId: args.professionalId, status: 'PENDING' },
      orderBy: { receivedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        source: true,
        parsedAmountCents: true,
        parsedVendor: true,
        parsedDate: true,
        emailFrom: true,
        emailSubject: true,
        receivedAt: true,
        receiptMediaId: true,
      },
    }),
    prisma.professionalProfile.findUnique({
      where: { id: args.professionalId },
      select: { handle: true, isPremium: true },
    }),
  ])

  const incomeTotalCents = computeIncomeTotalCents(snapshot)
  const expenseTotalCents = expenseRows.reduce(
    (sum, row) => sum + row.amountCents,
    0,
  )
  const netProfitCents = incomeTotalCents - expenseTotalCents
  const estTaxCents = computeEstimatedTaxCents(netProfitCents)

  const ratePctLabel = `~${Math.round(SELF_EMPLOYMENT_ESTIMATE_RATE * 100)}% self-employed rate`

  const summaryCards: ProFinanceSummaryCard[] = [
    {
      label: 'INCOME',
      value: formatCents(incomeTotalCents),
      sub: 'services + tips + products',
      tone: 'positive',
    },
    {
      label: 'EXPENSES',
      value: formatCents(expenseTotalCents),
      sub: 'tracked this month',
      tone: 'negative',
    },
    {
      label: 'NET PROFIT',
      value: formatCents(netProfitCents),
      sub: 'before tax',
      tone: 'neutral',
    },
    {
      label: 'EST. TAX OWED',
      value: formatCents(estTaxCents),
      sub: ratePctLabel,
      tone: 'warn',
    },
  ]

  const incomeBreakdown: ProFinanceIncomeBreakdownItem[] = [
    {
      label: 'Services',
      source: 'auto-pulled from bookings',
      value: formatCents(snapshot.serviceRevenueCents),
      amountCents: snapshot.serviceRevenueCents,
    },
    {
      label: 'Tips',
      source: 'auto-pulled from bookings',
      value: formatCents(snapshot.tipCents),
      amountCents: snapshot.tipCents,
    },
    {
      label: 'Product Sales',
      source: 'auto-pulled from checkout',
      value: formatCents(snapshot.productRevenueCents),
      amountCents: snapshot.productRevenueCents,
    },
  ]

  const quarterlyReminder: ProFinanceQuarterlyReminder = {
    dueDateLabel: nextQuarterlyDueLabel({ now: args.now, timeZone }),
    body: 'Set aside 25–30% of net income each month to avoid surprises. Consider a separate savings account just for taxes.',
  }

  const categories = resolveExpenseCategories({
    brandName: args.brandName,
  }).map(toCategoryInfo)

  return {
    ...overview,
    finance: {
      taxYear: TAX_YEAR,
      incomeTotalCents,
      expenseTotalCents,
      netProfitCents,
      estTaxCents,
      expenseTotalLabel: formatCents(expenseTotalCents),
      summaryCards,
      incomeBreakdown,
      quarterlyReminder,
      expenses: expenseRows.map((row) =>
        serializeProFinanceExpense(row, timeZone),
      ),
      categories,
      mileageRateCents: STANDARD_MILEAGE_RATE_CENTS,
      mileageRateLabel: mileageRateLabel(),
      receiptInbox: receiptRows.map((row) =>
        serializeReceiptInboxItem(row, timeZone),
      ),
      receiptInboxAddress: resolveReceiptInboxAddress({
        handle: proMeta?.handle,
        isPremium: proMeta?.isPremium ?? false,
      }),
    },
  }
}
