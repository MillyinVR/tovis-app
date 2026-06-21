import { describe, expect, it } from 'vitest'
import { Prisma } from '@prisma/client'
import { formatMoneyFromUnknown, parseTipAmount } from './money'

describe('parseTipAmount', () => {
  it('treats undefined as "not provided" and null/blank as "no tip"', () => {
    expect(parseTipAmount(undefined)).toEqual({ ok: true, tipAmount: undefined })
    expect(parseTipAmount(null)).toEqual({ ok: true, tipAmount: null })
    expect(parseTipAmount('')).toEqual({ ok: true, tipAmount: null })
    expect(parseTipAmount('   ')).toEqual({ ok: true, tipAmount: null })
  })

  it('normalizes valid numbers and numeric strings to two decimals', () => {
    expect(parseTipAmount(5)).toEqual({ ok: true, tipAmount: '5.00' })
    expect(parseTipAmount(5.5)).toEqual({ ok: true, tipAmount: '5.50' })
    expect(parseTipAmount(0)).toEqual({ ok: true, tipAmount: '0.00' })
    expect(parseTipAmount('5')).toEqual({ ok: true, tipAmount: '5.00' })
    expect(parseTipAmount(' 5.5 ')).toEqual({ ok: true, tipAmount: '5.50' })
  })

  it('rejects negative and non-finite numbers', () => {
    expect(parseTipAmount(-1)).toEqual({
      ok: false,
      error: 'tipAmount must be a non-negative number.',
    })
    expect(parseTipAmount(Number.NaN)).toEqual({
      ok: false,
      error: 'tipAmount must be a non-negative number.',
    })
    expect(parseTipAmount(Number.POSITIVE_INFINITY)).toEqual({
      ok: false,
      error: 'tipAmount must be a non-negative number.',
    })
  })

  it('rejects negative and non-numeric strings', () => {
    expect(parseTipAmount('-1')).toEqual({
      ok: false,
      error: 'tipAmount must be a non-negative amount.',
    })
    expect(parseTipAmount('abc')).toEqual({
      ok: false,
      error: 'tipAmount must be a non-negative amount.',
    })
  })

  it('rejects unsupported types', () => {
    expect(parseTipAmount({})).toEqual({
      ok: false,
      error: 'tipAmount must be a number, string, or null.',
    })
    expect(parseTipAmount(true)).toEqual({
      ok: false,
      error: 'tipAmount must be a number, string, or null.',
    })
  })
})

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
