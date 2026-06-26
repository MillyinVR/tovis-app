import { describe, expect, it } from 'vitest'
import { Prisma } from '@prisma/client'
import {
  formatCents,
  formatMoneyFromUnknown,
  formatRoundedDollars,
  moneyToNumber,
  parseTipAmount,
} from './money'

describe('moneyToNumber', () => {
  it('returns null for nullish, non-finite, or uninterpretable input', () => {
    expect(moneyToNumber(null)).toBeNull()
    expect(moneyToNumber(undefined)).toBeNull()
    expect(moneyToNumber(Number.NaN)).toBeNull()
    expect(moneyToNumber(Number.POSITIVE_INFINITY)).toBeNull()
    expect(moneyToNumber('abc')).toBeNull()
    expect(moneyToNumber({})).toBeNull()
    expect(moneyToNumber(true)).toBeNull()
  })

  it('passes through finite numbers, including zero', () => {
    expect(moneyToNumber(0)).toBe(0)
    expect(moneyToNumber(80.5)).toBe(80.5)
    expect(moneyToNumber(-122.42)).toBe(-122.42)
  })

  it('parses numeric strings', () => {
    expect(moneyToNumber('80')).toBe(80)
    expect(moneyToNumber('80.50')).toBe(80.5)
  })

  it('converts Prisma.Decimal without rounding or reformatting', () => {
    expect(moneyToNumber(new Prisma.Decimal('80.00'))).toBe(80)
    expect(moneyToNumber(new Prisma.Decimal('80.50'))).toBe(80.5)
    // full coordinate precision is preserved (no money rounding)
    expect(moneyToNumber(new Prisma.Decimal('37.774929'))).toBe(37.774929)
    expect(moneyToNumber(new Prisma.Decimal('0'))).toBe(0)
  })
})

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

describe('formatRoundedDollars', () => {
  it('returns null for nullish / uninterpretable input', () => {
    expect(formatRoundedDollars(null)).toBeNull()
    expect(formatRoundedDollars(undefined)).toBeNull()
    expect(formatRoundedDollars(Number.NaN)).toBeNull()
    expect(formatRoundedDollars('abc')).toBeNull()
  })

  it('rounds to whole dollars with a leading $', () => {
    expect(formatRoundedDollars(80)).toBe('$80')
    expect(formatRoundedDollars(80.4)).toBe('$80')
    expect(formatRoundedDollars(80.5)).toBe('$81')
    expect(formatRoundedDollars(0)).toBe('$0')
  })

  it('groups thousands', () => {
    expect(formatRoundedDollars(1200)).toBe('$1,200')
    expect(formatRoundedDollars(12345.67)).toBe('$12,346')
  })

  it('accepts money strings and Prisma.Decimal', () => {
    expect(formatRoundedDollars('45')).toBe('$45')
    expect(formatRoundedDollars(new Prisma.Decimal('99.99'))).toBe('$100')
  })
})

describe('formatCents', () => {
  it('formats cents as locale currency by default', () => {
    expect(formatCents(8000)).toBe('$80.00')
    expect(formatCents(4999)).toBe('$49.99')
    expect(formatCents(0)).toBe('$0.00')
  })

  it('supports the bare amount + code form', () => {
    expect(formatCents(8000, { style: 'code' })).toBe('80.00 USD')
    expect(formatCents(8000, { currency: 'eur', style: 'code' })).toBe('80.00 EUR')
  })

  it('defaults a nullish currency to USD', () => {
    expect(formatCents(8000, { currency: null, style: 'code' })).toBe('80.00 USD')
  })
})
