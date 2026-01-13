// lib/money/serializeMoney.ts

/**
 * Convert Decimal-ish / number / string into a safe "0.00" style string.
 * Never throws, never returns NaN, never returns null.
 */
export function moneyToFixed2String(v: unknown): string {
  if (v == null) return '0.00'

  // Prisma Decimal: has toFixed/toNumber/toString
  if (typeof (v as any)?.toFixed === 'function') {
    try {
      return String((v as any).toFixed(2))
    } catch {}
  }

  if (typeof (v as any)?.toNumber === 'function') {
    try {
      const n = (v as any).toNumber()
      return Number.isFinite(n) ? n.toFixed(2) : '0.00'
    } catch {}
  }

  if (typeof v === 'number') return Number.isFinite(v) ? v.toFixed(2) : '0.00'

  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isFinite(n) ? n.toFixed(2) : '0.00'
  }

  // last resort
  const n = Number(String(v))
  return Number.isFinite(n) ? n.toFixed(2) : '0.00'
}

/**
 * Parse a user-entered money value into a number rounded to 2 decimals.
 * Use ONLY for input handling at the boundary (request parsing).
 */
export function parseMoneyInputToNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? Math.round(raw * 100) / 100 : null
  if (typeof raw !== 'string') return null

  const cleaned = raw.replace(/\$/g, '').replace(/,/g, '').trim()
  if (!cleaned) return null
  const normalized = cleaned.startsWith('.') ? `0${cleaned}` : cleaned

  // allow up to 2 decimals
  if (!/^\d*\.?\d{0,2}$/.test(normalized)) return null

  const n = Number(normalized)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100) / 100
}

/**
 * If you want to do deterministic math, do it in cents.
 */
export function dollarsToCents(n: number): number {
  return Math.round(n * 100)
}

export function centsToFixed2(cents: number): string {
  if (!Number.isFinite(cents)) return '0.00'
  return (Math.round(cents) / 100).toFixed(2)
}
