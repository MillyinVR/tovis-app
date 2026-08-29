// lib/money.ts
import type { Prisma } from '@prisma/client'
import { DISPLAY_LOCALE } from '@/lib/locale'
import { resolveChargeCurrency } from '@/lib/payments/resolveChargeCurrency'

export type MoneyInput = Prisma.Decimal | string | number

const DECIMAL_BRAND = '[object Decimal]'

/**
 * A Prisma.Decimal, recognised WITHOUT importing the class.
 *
 * `@prisma/client` declares no runtime dependencies: it bundles its own minified
 * copy of decimal.js (`Prisma.Decimal.name` is `'i'`). So `instanceof
 * Prisma.Decimal` is a VALUE import of that package, and a value import cannot
 * be erased — it drags the package's browser build (121.6 KB of ScalarFieldEnum
 * maps naming every column of every model) into every client bundle downstream.
 * That is the whole of what this file used to cost 22 routes.
 *
 * Installing decimal.js directly does not fix it: the package copy and Prisma's
 * bundled copy are DIFFERENT classes, and `instanceof` fails in both directions
 * (verified — see lib/money.test.ts). The brand does not. This is decimal.js's
 * own `Decimal.isDecimal`, which is written exactly this way for exactly this
 * reason:
 *
 *   isDecimal = (obj) => obj instanceof Decimal || obj.toStringTag === tag
 *
 * so it recognises a Decimal from ANY realm — including the one Prisma returns
 * from a query, which is the only kind this file ever sees. `moneyToNumber`
 * already carried a duck-typed fallback for the same reason; this makes the
 * whole file honest about it rather than only that one function.
 *
 * lib/money.test.ts asserts a real `Prisma.Decimal` still satisfies this. If
 * Prisma ever swaps decimal.js out, that test fails loudly rather than this
 * predicate quietly returning false for every Decimal in the app.
 *
 * It narrows to `Prisma.Decimal` — the TYPE, which `import type` erases, so it
 * still costs the browser nothing. Asserting the whole class off one branded
 * property is exactly the assertion decimal.js's own `isDecimal` makes, and
 * only decimal.js's prototype sets the brand. Narrowing to a smaller structural
 * type instead would force `MoneyInput` wider for every caller, which is a
 * bigger claim than this change needs to make.
 */
export function isDecimalLike(value: unknown): value is Prisma.Decimal {
  if (typeof value !== 'object' || value === null) return false
  if (!('toStringTag' in value)) return false
  return value.toStringTag === DECIMAL_BRAND
}

function stripTrailingZeros(value: string): string {
  return value.replace(/\.00$/, '')
}

/**
 * Single source of truth: validate a money string.
 * Accepts "80", "80.5", "80.50".
 */
export function isMoneyString(value: string): boolean {
  return /^\d+(\.\d{1,2})?$/.test(value.trim())
}

/**
 * Normalize a money-ish string to a fixed 2-decimal string.
 *
 * "80"    -> "80.00"
 * "80.5"  -> "80.50"
 * "80.50" -> "80.50"
 */
export function normalizeMoney2(value: string): string | null {
  const trimmed = value.trim()
  if (!isMoneyString(trimmed)) return null

  const [dollars, cents = ''] = trimmed.split('.')

  if (cents.length === 0) return `${dollars}.00`
  if (cents.length === 1) return `${dollars}.${cents}0`

  return `${dollars}.${cents}`
}

/**
 * Convert a valid dollar money string into integer cents.
 */
export function moneyToCentsInt(value: string): number | null {
  const normalized = normalizeMoney2(value)
  if (!normalized) return null

  const [dollars, cents] = normalized.split('.')
  if (dollars === undefined || cents === undefined) return null

  return Number.parseInt(dollars, 10) * 100 + Number.parseInt(cents, 10)
}

/**
 * Decimal dollars → integer cents (bankers-safe rounding). Single source of
 * truth for "Decimal column → cents" reads (moneyTrail, paymentBadge). null in,
 * null out — callers that want a 0 default say so at the call site.
 */
export function decimalToCents(
  value: Prisma.Decimal | null | undefined,
): number | null {
  if (value == null) return null
  return Math.round(value.toNumber() * 100)
}

/**
 * Display formatter.
 *
 * Keeps this as the single source of truth for showing money values.
 *
 * Examples:
 * 80.00 -> "80"
 * 80.50 -> "80.50"
 */
export function moneyToString(value: null | undefined): null
export function moneyToString(value: MoneyInput): string | null
export function moneyToString(value: MoneyInput | null | undefined): string | null
export function moneyToString(
  value: MoneyInput | null | undefined,
): string | null {
  if (value === null || value === undefined) return null

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null

    const normalized = normalizeMoney2(trimmed)
    if (normalized) return stripTrailingZeros(normalized)

    return stripTrailingZeros(trimmed)
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    return stripTrailingZeros(value.toFixed(2))
  }

  return stripTrailingZeros(value.toString())
}

/**
 * Fixed 2-decimal formatter.
 *
 * Examples:
 * 80    -> "80.00"
 * 80.5  -> "80.50"
 * 80.50 -> "80.50"
 */
export function moneyToFixed2String(value: null | undefined): null
export function moneyToFixed2String(value: MoneyInput): string | null
export function moneyToFixed2String(
  value: MoneyInput | null | undefined,
): string | null
export function moneyToFixed2String(
  value: MoneyInput | null | undefined,
): string | null {
  if (value === null || value === undefined) return null

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    return value.toFixed(2)
  }

  if (typeof value === 'string') {
    return normalizeMoney2(value)
  }

  const decimalString = value.toString().trim()

  if (!/^\d+(\.\d+)?$/.test(decimalString)) return null

  const [dollars, cents = ''] = decimalString.split('.')

  if (cents.length === 0) return `${dollars}.00`
  if (cents.length === 1) return `${dollars}.${cents}0`

  return `${dollars}.${cents.slice(0, 2)}`
}

/**
 * Faithfully convert a Decimal / number / money-string into a JS number without
 * any rounding. Returns null for nullish, non-finite, or uninterpretable input.
 *
 * This is the single source of truth for "Decimal column -> number". It is used
 * both for money amounts and for other non-money Prisma.Decimal columns (e.g.
 * latitude / longitude), so it deliberately does NOT round or reformat — it
 * preserves the value's full precision.
 */
export function moneyToNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'string') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }

  if (isDecimalLike(value)) {
    const n = value.toNumber()
    return Number.isFinite(n) ? n : null
  }

  // Anything else that can describe itself as a number — fall back to its string
  // representation. A Decimal from another realm no longer lands here (the brand
  // check above catches it, which `instanceof` could not), so this is now the
  // last resort for genuinely unbranded values rather than the Decimal path.
  if (typeof value === 'object') {
    const maybeToString = (value as { toString?: unknown }).toString
    if (typeof maybeToString === 'function') {
      const n = Number(String(maybeToString.call(value)))
      return Number.isFinite(n) ? n : null
    }
  }

  return null
}

export type ParseTipAmountResult =
  | { ok: true; tipAmount: string | null | undefined }
  | { ok: false; error: string }

/**
 * Single source of truth for parsing an optional tip amount off request input.
 *
 * Accepts a number, a money-ish string, null, or undefined and rejects negative
 * or non-finite values. Mirrors the lenient checkout semantics: `undefined`
 * means "not provided", `null` / blank string means "explicitly no tip", and a
 * valid value is normalized to a fixed 2-decimal string.
 */
export function parseTipAmount(value: unknown): ParseTipAmountResult {
  if (value === undefined) return { ok: true, tipAmount: undefined }
  if (value === null) return { ok: true, tipAmount: null }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      return { ok: false, error: 'tipAmount must be a non-negative number.' }
    }
    return { ok: true, tipAmount: value.toFixed(2) }
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return { ok: true, tipAmount: null }

    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed) || parsed < 0) {
      return { ok: false, error: 'tipAmount must be a non-negative amount.' }
    }
    return { ok: true, tipAmount: parsed.toFixed(2) }
  }

  return { ok: false, error: 'tipAmount must be a number, string, or null.' }
}

/**
 * Display an untyped value (Prisma.Decimal, number, or money string) as "$X.XX".
 * Single source of truth for showing a money value whose type isn't known at the
 * call site (e.g. snapshot fields). Returns null when it can't be interpreted as
 * money. A non-numeric string is returned with a leading "$" if it lacks one, so
 * already-formatted values pass through unchanged.
 */
export function formatMoneyFromUnknown(value: unknown): string | null {
  if (value === null || value === undefined) return null

  if (isDecimalLike(value)) {
    const fixed = moneyToFixed2String(value)
    return fixed === null ? null : `$${fixed}`
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? `$${value.toFixed(2)}` : null
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null

    const parsed = Number(trimmed)
    if (Number.isFinite(parsed)) return `$${parsed.toFixed(2)}`

    return trimmed.startsWith('$') ? trimmed : `$${trimmed}`
  }

  return null
}

/**
 * Display a money value as whole dollars with a leading `$` and grouped
 * thousands — the marketing / price-badge form ("$80", "$1,200"). Rounds to the
 * nearest dollar (no cents). Built on `moneyToNumber`, so it accepts a
 * Prisma.Decimal, number, or money string. Returns null for nullish or
 * uninterpretable input. Single source of truth for the rounded-price badges
 * across discover, booking, and pro surfaces; callers add their own surrounding
 * copy ("From ", "+").
 */
export function formatRoundedDollars(value: MoneyInput | null | undefined): string | null {
  const amount = moneyToNumber(value)
  if (amount === null) return null

  return `$${Math.round(amount).toLocaleString(DISPLAY_LOCALE)}`
}

/**
 * Display an integer-cents amount (the unit Stripe works in) as currency.
 * Single source of truth for "cents → on-screen money" in payment surfaces.
 *
 * - style 'symbol' (default): locale currency, e.g. 8000 → "$80.00".
 * - style 'code': bare amount + uppercase currency code, e.g. 8000 → "80.00 USD"
 *   (the form used in refund confirmations).
 *
 * Falls back to the 'code' form if `Intl.NumberFormat` rejects the currency.
 */
export function formatCents(
  amountCents: number,
  options: { currency?: string | null; style?: 'symbol' | 'code' } = {},
): string {
  const dollars = amountCents / 100
  const code = resolveChargeCurrency(options.currency).toUpperCase()

  if (options.style === 'code') {
    return `${dollars.toFixed(2)} ${code}`
  }

  try {
    return new Intl.NumberFormat(DISPLAY_LOCALE, { style: 'currency', currency: code }).format(dollars)
  } catch {
    return `${dollars.toFixed(2)} ${code}`
  }
}