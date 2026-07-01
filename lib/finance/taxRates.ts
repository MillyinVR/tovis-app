// lib/finance/taxRates.ts
//
// Tax + IRS figures for the pro Finance tab, in ONE place so they're trivial to
// bump each tax year (design spec §11: "store rates in config so they're easy
// to update annually").
//
// ⚠️ The dollar figures/rates below are the 2024 values carried over from the
// original tax research. They MUST be reconfirmed against current-year IRS
// numbers before each filing season, then TAX_YEAR bumped. Nothing here is tax
// advice — the estimate is deliberately rough and labeled as such in the UI.

// The tax year these figures are believed accurate for. Surface it in the UI so
// pros know how current the guidance is.
// TODO(finance): confirm 2026 IRS figures before shipping to pros.
export const TAX_YEAR = 2026

// Rough self-employment + income blend used for the "set aside for taxes"
// estimate: estTax = max(0, netProfit * rate). Fixed for v1; spec §11 leaves
// "make this user-adjustable?" open, which this single constant keeps cheap.
export const SELF_EMPLOYMENT_ESTIMATE_RATE = 0.28

// IRS standard mileage rate, in cents per mile (2024: 67¢). Mobile pros only.
export const STANDARD_MILEAGE_RATE_CENTS = 67

// Section 179 / de minimis safe harbor — equipment under this can generally be
// deducted in full the year purchased rather than depreciated.
export const DE_MINIMIS_EQUIPMENT_CENTS = 250_000 // $2,500

// Home-office simplified method: $5 / sq ft, capped at 300 sq ft.
export const HOME_OFFICE_SIMPLIFIED_RATE_CENTS = 500 // $5 / sq ft
export const HOME_OFFICE_SIMPLIFIED_MAX_SQFT = 300

// Business gift deduction cap, per client per year.
export const CLIENT_GIFT_MAX_CENTS = 2_500 // $25

// Federal estimated-tax due dates (month, day) for a calendar-year filer. These
// are the statutory dates; the IRS shifts them to the next business day when
// they fall on a weekend/holiday — we intentionally DON'T model that here (this
// is a soft reminder, not a filing deadline), which the UI copy reflects.
export const ESTIMATED_TAX_DUE_DATES: ReadonlyArray<{ month: number; day: number }> = [
  { month: 1, day: 15 }, // Q4 of the prior year
  { month: 4, day: 15 }, // Q1
  { month: 6, day: 15 }, // Q2
  { month: 9, day: 15 }, // Q3
]

// "67¢/mi" — for interpolating the {mileageRate} token in category tooltips.
export function mileageRateLabel(): string {
  return `${STANDARD_MILEAGE_RATE_CENTS}¢/mi`
}
