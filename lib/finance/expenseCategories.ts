// lib/finance/expenseCategories.ts
//
// Single source of truth for the pro Finance tab's expense categories: the
// guided add-expense dropdown AND the Write-Offs education section both read
// this. `id` is the persisted Prisma `ExpenseCategory` enum so the DB and the
// copy can never drift.
//
// Audit-risk lives here as a semantic key ('green' | 'yellow' | 'red'), NOT a
// color — the UI maps it to the tone utilities (toneSuccess / toneWarn /
// toneDanger) so it stays white-label + [data-mode] safe. Do NOT put hex here.
//
// Tooltip copy may contain interpolation tokens (never hardcode the brand name
// or a volatile IRS rate — both fail our guards / go stale):
//   {brand}       → the tenant-resolved brand display name (lib/brand)
//   {mileageRate} → the current standard mileage rate (lib/finance/taxRates)
// Call `resolveExpenseCategories()` at the API boundary to fill them in.

import type { ExpenseCategory } from '@prisma/client'

import { mileageRateLabel } from '@/lib/finance/taxRates'

export type ExpenseRiskLevel = 'green' | 'yellow' | 'red'

export type ExpenseCategoryConfig = {
  id: ExpenseCategory
  label: string
  risk: ExpenseRiskLevel
  riskLabel: string
  tooltip: string
  examples: string[]
}

// Risk key → the short label shown on the Write-Offs rows.
export const RISK_LABEL: Record<ExpenseRiskLevel, string> = {
  green: 'Clearly Deductible',
  yellow: 'Deductible With Conditions',
  red: 'Proceed With Caution',
}

// Where each category lands on IRS Schedule C (Form 1040), Part II — used by the
// "Schedule C Ready" PDF export to group expenses onto real form lines. These
// are honest simplifications the PDF labels as such:
//   - Licensing & Insurance → line 15 (Insurance); licenses may belong on 23.
//   - Tools & Equipment → line 22 (Supplies) as a de-minimis expense; larger
//     purchases may be depreciation / §179 (line 13).
//   - Home Office → line 30 via Form 8829 (not a simple line total).
//   - Clothing / Appearance → generally NOT deductible (line: null).
export type ScheduleCLine = { line: string | null; label: string }

export const SCHEDULE_C_LINE: Record<ExpenseCategory, ScheduleCLine> = {
  SUPPLIES_PRODUCTS: { line: '22', label: 'Supplies' },
  TOOLS_EQUIPMENT: { line: '22', label: 'Supplies' },
  BOOTH_SUITE_RENT: { line: '20b', label: 'Rent (other business property)' },
  SOFTWARE_APPS: { line: '27a', label: 'Other expenses' },
  EDUCATION_TRAINING: { line: '27a', label: 'Other expenses' },
  LICENSING_INSURANCE: { line: '15', label: 'Insurance' },
  MARKETING: { line: '8', label: 'Advertising' },
  MILEAGE: { line: '9', label: 'Car & truck expenses' },
  HOME_OFFICE: { line: '30', label: 'Home office (Form 8829)' },
  CLOTHING_APPEARANCE: { line: null, label: 'Not deductible' },
  OTHER: { line: '27a', label: 'Other expenses' },
}

// Ordered as they appear in the Write-Offs list (spec §4). Green first, then
// the conditional/risky ones toward the bottom.
export const EXPENSE_CATEGORIES: readonly ExpenseCategoryConfig[] = [
  {
    id: 'SUPPLIES_PRODUCTS',
    label: 'Supplies & Products',
    risk: 'green',
    riskLabel: RISK_LABEL.green,
    tooltip:
      'Shampoo, color, developer, nail supplies, wax, skincare used on clients. Keep receipts. CosmoProf & Salon Centric orders land here.',
    examples: ['Color', 'Developer', 'Shampoo', 'Nail polish', 'Wax', 'Skincare'],
  },
  {
    id: 'TOOLS_EQUIPMENT',
    label: 'Tools & Equipment',
    risk: 'green',
    riskLabel: RISK_LABEL.green,
    tooltip:
      'Scissors, clippers, dryers, flat irons, nail drills, ring lights, capes. Items under $2,500 can be deducted in full the year purchased.',
    examples: ['Scissors', 'Blow dryer', 'Ring light', 'Nail drill', 'Styling chair'],
  },
  {
    id: 'BOOTH_SUITE_RENT',
    label: 'Booth Rent / Suite Rent',
    risk: 'green',
    riskLabel: RISK_LABEL.green,
    tooltip:
      'Weekly or monthly cost of your chair, suite, or studio. One of the biggest deductions — track every payment.',
    examples: ['Weekly booth rent', 'Salon suite monthly fee'],
  },
  {
    id: 'SOFTWARE_APPS',
    label: 'Software & Apps',
    risk: 'green',
    riskLabel: RISK_LABEL.green,
    tooltip:
      'Booking software (like {brand}!), accounting tools, scheduling apps, photo editing apps used for work.',
    examples: ['{brand} subscription', 'Accounting app', 'Photo editor'],
  },
  {
    id: 'EDUCATION_TRAINING',
    label: 'Education & Training',
    risk: 'green',
    riskLabel: RISK_LABEL.green,
    tooltip:
      'Classes, workshops, certifications, and trade shows that maintain or improve your skills.',
    examples: ['Color theory workshop', 'Certification course'],
  },
  {
    id: 'LICENSING_INSURANCE',
    label: 'Licensing & Insurance',
    risk: 'green',
    riskLabel: RISK_LABEL.green,
    tooltip:
      'State cosmetology license renewals, liability insurance, and professional memberships.',
    examples: ['License renewal', 'Liability insurance'],
  },
  {
    id: 'MARKETING',
    label: 'Marketing',
    risk: 'green',
    riskLabel: RISK_LABEL.green,
    tooltip:
      'Ads, business cards, branded materials, promo shoots, and website costs.',
    examples: ['Instagram ads', 'Business cards', 'Website hosting'],
  },
  {
    id: 'MILEAGE',
    label: 'Mileage (mobile pros)',
    risk: 'yellow',
    riskLabel: RISK_LABEL.yellow,
    tooltip:
      "Business miles only — driving to clients, supply runs, education. Commuting doesn't count. Log the miles; the standard mileage rate applies ({mileageRate}).",
    examples: ['Drive to a mobile client', 'Supply pickup'],
  },
  {
    id: 'HOME_OFFICE',
    label: 'Home Office',
    risk: 'yellow',
    riskLabel: RISK_LABEL.yellow,
    tooltip:
      'Only if a portion of your home is used exclusively for business (a home suite where you see clients). Simplified method: $5/sq ft up to 300 sq ft. Actual method: % of rent/mortgage/utilities. A kitchen table doesn’t count.',
    examples: ['Dedicated home salon room'],
  },
  {
    id: 'CLOTHING_APPEARANCE',
    label: 'Clothing / Appearance',
    risk: 'red',
    riskLabel: RISK_LABEL.red,
    tooltip:
      "Generally NOT deductible. Nails, hair, haircuts, and clothing you can wear outside work don’t qualify (Hynes v. Commissioner). Exception: a branded apron or uniform that can’t be worn outside work. When in doubt, ask your CPA.",
    examples: ['Branded aprons/uniforms only — not grooming or regular clothes'],
  },
  {
    id: 'OTHER',
    label: 'Other Business Expenses',
    risk: 'green',
    riskLabel: RISK_LABEL.green,
    tooltip:
      'Anything else ordinary and necessary: business bank fees, client refreshments (coffee/water in your space), professional memberships, trade magazines, client gifts (up to $25/client/yr).',
    examples: ['Bank fees', 'Client refreshments', 'Memberships', 'Trade magazines'],
  },
]

// Fast lookups by enum key.
export const EXPENSE_CATEGORY_BY_ID: Record<ExpenseCategory, ExpenseCategoryConfig> =
  Object.fromEntries(
    EXPENSE_CATEGORIES.map((category) => [category.id, category]),
  ) as Record<ExpenseCategory, ExpenseCategoryConfig>

function interpolate(text: string, brandName: string): string {
  return text
    .replaceAll('{brand}', brandName)
    .replaceAll('{mileageRate}', mileageRateLabel())
}

// Resolve all interpolation tokens for a given tenant/brand. Use this at the
// API boundary — never ship the raw {brand}/{mileageRate} tokens to a client.
export function resolveExpenseCategories(args: {
  brandName: string
}): ExpenseCategoryConfig[] {
  return EXPENSE_CATEGORIES.map((category) => ({
    ...category,
    tooltip: interpolate(category.tooltip, args.brandName),
    examples: category.examples.map((example) =>
      interpolate(example, args.brandName),
    ),
  }))
}
