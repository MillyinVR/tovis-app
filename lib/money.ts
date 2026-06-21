// lib/money.ts
import { Prisma } from '@prisma/client'

export type MoneyInput = Prisma.Decimal | string | number

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

  if (value instanceof Prisma.Decimal) {
    const n = value.toNumber()
    return Number.isFinite(n) ? n : null
  }

  // Decimal-like objects (e.g. instances from a different Prisma client realm,
  // where `instanceof` fails) — fall back to their string representation.
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
 * Parse a money input into Prisma.Decimal.
 *
 * Accepts valid dollar values like:
 * - "49.99"
 * - "49"
 * - 49.99
 */
export function parseMoney(input: unknown): Prisma.Decimal {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error('Invalid money amount.')
    return new Prisma.Decimal(input.toFixed(2))
  }

  if (typeof input === 'string') {
    const normalized = normalizeMoney2(input)
    if (!normalized) throw new Error('Invalid money amount.')
    return new Prisma.Decimal(normalized)
  }

  if (input instanceof Prisma.Decimal) {
    return input
  }

  throw new Error('Invalid money amount.')
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

  if (value instanceof Prisma.Decimal) {
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