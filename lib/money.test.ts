import { describe, expect, it } from 'vitest'
import { Prisma } from '@prisma/client'
import { formatMoneyFromUnknown } from './money'

describe('formatMoneyFromUnknown', () => {
  it('returns null for nullish / empty / non-money values', () => {
    expect(formatMoneyFromUnknown(null)).toBeNull()
    expect(formatMoneyFromUnknown(undefined)).toBeNull()
    expect(formatMoneyFromUnknown('')).toBeNull()
    expect(formatMoneyFromUnknown('   ')).toBeNull()
    expect(formatMoneyFromUnknown(Number.NaN)).toBeNull()
    expect(formatMoneyFromUnknown(Number.POSITIVE_INFINITY)).toBeNull()
    expect(formatMoneyFromUnknown({})).toBeNull()
    expect(formatMoneyFromUnknown(true)).toBeNull()
  })

  it('formats finite numbers to two decimals with a leading $', () => {
    expect(formatMoneyFromUnknown(80)).toBe('$80.00')
    expect(formatMoneyFromUnknown(80.5)).toBe('$80.50')
    expect(formatMoneyFromUnknown(0)).toBe('$0.00')
  })

  it('formats numeric strings to two decimals', () => {
    expect(formatMoneyFromUnknown('80')).toBe('$80.00')
    expect(formatMoneyFromUnknown('80.5')).toBe('$80.50')
    expect(formatMoneyFromUnknown('  49.99 ')).toBe('$49.99')
  })

  it('passes through non-numeric strings, adding $ only when missing', () => {
    expect(formatMoneyFromUnknown('$50')).toBe('$50')
    expect(formatMoneyFromUnknown('Free')).toBe('$Free')
  })

  it('formats Prisma.Decimal values', () => {
    expect(formatMoneyFromUnknown(new Prisma.Decimal('49.99'))).toBe('$49.99')
    expect(formatMoneyFromUnknown(new Prisma.Decimal('50'))).toBe('$50.00')
  })
})
