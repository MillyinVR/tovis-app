// lib/money.ts
import { Prisma } from '@prisma/client'

export function moneyToString(v: Prisma.Decimal | string | number | null | undefined) {
  if (v === null || v === undefined) return null

  // API boundary / JSON often gives strings already: "80.00"
  if (typeof v === 'string') return v

  // If a number slips through, treat it as dollars (NOT cents)
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null
    return v.toFixed(2).replace(/\.00$/, '')
  }

  // Prisma.Decimal
  return v.toString().replace(/\.00$/, '')
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
    if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error('Invalid money amount.')
    const [a, b = ''] = s.split('.')
    const normalized = b.length === 0 ? `${a}.00` : b.length === 1 ? `${a}.${b}0` : `${a}.${b}`
    return new Prisma.Decimal(normalized)
  }

  throw new Error('Invalid money amount.')
}
