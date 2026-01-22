// lib/money.ts
import { Prisma } from '@prisma/client'

type MoneyInput = Prisma.Decimal | string | number

function stripTrailingZeros(s: string) {
  // "80.00" -> "80", "80.50" -> "80.50"
  return s.replace(/\.00$/, '')
}

function isMoneyString(s: string) {
  // allow "80", "80.5", "80.50"
  return /^\d+(\.\d{1,2})?$/.test(s)
}

function normalizeToFixed2(s: string) {
  // assumes s already matches isMoneyString
  const [a, b = ''] = s.split('.')
  if (b.length === 0) return `${a}.00`
  if (b.length === 1) return `${a}.${b}0`
  return `${a}.${b}`
}

// ✅ overloads so TS knows what happens when null isn't possible
export function moneyToString(v: null | undefined): null
export function moneyToString(v: MoneyInput): string
export function moneyToString(v: MoneyInput | null | undefined): string | null {
  if (v === null || v === undefined) return null

  // API boundary / JSON often gives strings already: "80.00"
  if (typeof v === 'string') {
    const s = v.trim()
    if (!s) return null
    // if it's money-ish, normalize to 2dp first so stripping is consistent
    if (isMoneyString(s)) return stripTrailingZeros(normalizeToFixed2(s))
    // fallback: keep old behavior (trim + strip) without pretending it's valid money
    return stripTrailingZeros(s)
  }

  // If a number slips through, treat it as dollars (NOT cents)
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null
    return stripTrailingZeros(v.toFixed(2))
  }

  // Prisma.Decimal
  return stripTrailingZeros(v.toString())
}

// ✅ overloads for fixed 2dp string
export function moneyToFixed2String(v: null | undefined): null
export function moneyToFixed2String(v: MoneyInput): string
export function moneyToFixed2String(v: MoneyInput | null | undefined): string | null {
  if (v === null || v === undefined) return null

  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null
    return v.toFixed(2)
  }

  if (typeof v === 'string') {
    const s = v.trim()
    if (!s) return null
    if (!isMoneyString(s)) return null
    return normalizeToFixed2(s)
  }

  // Prisma.Decimal
  const s = v.toString().trim()
  // Decimal could include more precision, clamp to 2
  if (!/^\d+(\.\d+)?$/.test(s)) return null
  const [a, b = ''] = s.split('.')
  if (b.length === 0) return `${a}.00`
  if (b.length === 1) return `${a}.${b}0`
  return `${a}.${b.slice(0, 2)}`
}

/**
 * Parse a money input into Prisma.Decimal
 * Accepts "49.99" or 49.99, rejects junk.
 */
export function parseMoney(input: unknown): Prisma.Decimal {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error('Invalid money amount.')
    return new Prisma.Decimal(input.toFixed(2))
  }

  if (typeof input === 'string') {
    const s = input.trim()
    if (!s) throw new Error('Invalid money amount.')
    if (!isMoneyString(s)) throw new Error('Invalid money amount.')
    return new Prisma.Decimal(normalizeToFixed2(s))
  }

  // Prisma.Decimal already
  if (input instanceof Prisma.Decimal) return input

  throw new Error('Invalid money amount.')
}
