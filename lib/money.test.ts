import { describe, expect, it } from 'vitest'
import { Prisma } from '@prisma/client'
import {
  formatCents,
  formatMoneyFromUnknown,
  formatRoundedDollars,
  isDecimalLike,
  moneyToFixed2String,
  moneyToNumber,
  moneyToString,
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

  // Booking.stripeCurrency holds both casings in production, and the pro
  // booking page hands whatever is stored straight to this formatter. What it
  // renders must not depend on which write path stamped the column.
  it('renders the same string whichever case the currency arrives in', () => {
    for (const style of ['symbol', 'code'] as const) {
      expect(formatCents(8000, { currency: 'usd', style })).toBe(
        formatCents(8000, { currency: 'USD', style }),
      )
    }
  })
})

// ── The brand check that replaced `instanceof Prisma.Decimal` ────────────────
//
// lib/money.ts no longer imports the Prisma.Decimal CLASS — that value import
// is what shipped @prisma/client's browser build to 22 routes. It recognises a
// Decimal by decimal.js's own cross-realm brand instead.
//
// Everything below reads a REAL `new Prisma.Decimal(...)`, so these are not
// tests of a mock: they are the evidence that the replacement still sees the
// exact objects Prisma hands back from a query, and formats them identically.

/**
 * The corpus. Every value is exercised against every Decimal-reading export.
 *
 * Money in this app is non-negative and 2dp (parseMoney's own regex enforces
 * that), but moneyToNumber is documented as the SSOT for non-money Decimal
 * columns too — latitude/longitude — so negatives and high precision are real
 * inputs, not hypotheticals.
 */
const DECIMAL_CORPUS = [
  '0',
  '0.00',
  '0.01',
  '0.10',
  '0.50',
  '1',
  '49.99',
  '50',
  '80.00',
  '80.50',
  '99.99',
  '100',
  '1200',
  '999999.99',
  '37.774929', // a real latitude
  '-122.419418', // a real longitude
  '-0.01',
  '-49.99',
  '0.005', // rounds at the 2dp boundary
  '0.004',
  '2.675', // the classic float-rounding trap
]

describe('isDecimalLike', () => {
  // ⚠️ This is the drift alarm for the whole change. The brand is decimal.js's
  // (`Decimal.isDecimal` is `obj instanceof Decimal || obj.toStringTag === tag`)
  // and Prisma bundles decimal.js — but it bundles it MINIFIED and privately,
  // with no runtime dependency we could pin. If Prisma ever swaps the
  // implementation, `isDecimalLike` would quietly return false for every Decimal
  // in the app and money would start rendering as null. This test is what makes
  // that loud instead.
  it('recognises a real Prisma.Decimal', () => {
    for (const raw of DECIMAL_CORPUS) {
      expect(isDecimalLike(new Prisma.Decimal(raw))).toBe(true)
    }
  })

  it('recognises a Decimal from a FOREIGN realm, which instanceof cannot', () => {
    // @prisma/client bundles its own minified decimal.js and declares no
    // runtime dependency on the package, so a Decimal built by any other copy
    // is a different class. `instanceof Prisma.Decimal` is false for it; the
    // brand is not. This stands in for that second copy.
    const foreign = {
      toStringTag: '[object Decimal]',
      toNumber: () => 49.99,
      toString: () => '49.99',
    }

    expect(foreign instanceof Prisma.Decimal).toBe(false)
    expect(isDecimalLike(foreign)).toBe(true)
    expect(moneyToNumber(foreign)).toBe(49.99)
    expect(formatMoneyFromUnknown(foreign)).toBe('$49.99')
  })

  it('does not brand ordinary values as Decimals', () => {
    for (const value of [
      null,
      undefined,
      0,
      49.99,
      '49.99',
      '',
      {},
      [],
      new Date(0),
      { toStringTag: 'Decimal' },
      { toStringTag: '[object Object]' },
      Object.create(null),
    ]) {
      expect(isDecimalLike(value)).toBe(false)
    }
  })
})

describe('Decimal readers: brand check vs instanceof Prisma.Decimal', () => {
  // The pre-change implementations, transcribed from lib/money.ts as it stood
  // before the split (git 66957d65). The ONLY difference is the type test:
  // `value instanceof Prisma.Decimal` where the shipped code now says
  // `isDecimalLike(value)`. Running both over the corpus is the proof that
  // swapping the test changed no output.
  function moneyToNumberBefore(value: unknown): number | null {
    if (value === null || value === undefined) return null
    if (typeof value === 'number') return Number.isFinite(value) ? value : null
    if (typeof value === 'string') {
      const n = Number(value)
      return Number.isFinite(n) ? n : null
    }
    if (value instanceof Prisma.Decimal) {
      const n = value.toNumber()
      return Number.isFinite(n) ? n : null
    }
    if (typeof value === 'object') {
      const maybeToString = (value as { toString?: unknown }).toString
      if (typeof maybeToString === 'function') {
        const n = Number(String(maybeToString.call(value)))
        return Number.isFinite(n) ? n : null
      }
    }
    return null
  }

  function formatMoneyFromUnknownBefore(value: unknown): string | null {
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

  it('moneyToNumber is identical for every value in the corpus', () => {
    for (const raw of DECIMAL_CORPUS) {
      const before = moneyToNumberBefore(new Prisma.Decimal(raw))
      const after = moneyToNumber(new Prisma.Decimal(raw))
      // Object.is, not toBe's loose zero handling: 0 and -0 must not pass for
      // each other in a comparison whose whole job is proving nothing moved.
      expect(Object.is(after, before), `moneyToNumber("${raw}")`).toBe(true)
    }
  })

  it('formatMoneyFromUnknown is identical for every value in the corpus', () => {
    for (const raw of DECIMAL_CORPUS) {
      expect(
        formatMoneyFromUnknown(new Prisma.Decimal(raw)),
        `formatMoneyFromUnknown("${raw}")`,
      ).toBe(formatMoneyFromUnknownBefore(new Prisma.Decimal(raw)))
    }
  })

  // The other three Decimal readers never type-tested a Decimal at all — they
  // call .toString() / .toNumber() on it — so the split could not have touched
  // them, and `git show 66957d65:lib/money.ts` says their source is character
  // for character what it was. Pinned anyway, because they are on the
  // client-reachable surface and "obviously unaffected" is how a regression
  // ships.
  //
  // Every expectation below was READ OFF the running code, not predicted, and
  // several are warts worth having written down:
  //   • a Decimal normalises its own trailing zeros, so moneyToString(0.10) is
  //     "0.1" where moneyToString("0.10") is "0.10" — the two branches of the
  //     same function disagree, and always have;
  //   • moneyToFixed2String TRUNCATES rather than rounds (37.774929 -> "37.77");
  //   • it rejects negatives outright (regex `^\d+(\.\d+)?$`), which is why
  //     formatMoneyFromUnknown returns null for a negative Decimal while
  //     formatRoundedDollars happily renders "$-122".
  it.each([
    // raw            toString      fixed2      rounded        number        money
    ['0',            '0',          '0.00',     '$0',                0,       '$0.00'],
    ['0.00',         '0',          '0.00',     '$0',                0,       '$0.00'],
    ['0.01',         '0.01',       '0.01',     '$0',             0.01,       '$0.01'],
    ['0.10',         '0.1',        '0.10',     '$0',              0.1,       '$0.10'],
    ['0.50',         '0.5',        '0.50',     '$1',              0.5,       '$0.50'],
    ['1',            '1',          '1.00',     '$1',                1,       '$1.00'],
    ['49.99',        '49.99',      '49.99',    '$50',           49.99,       '$49.99'],
    ['50',           '50',         '50.00',    '$50',              50,       '$50.00'],
    ['80.00',        '80',         '80.00',    '$80',              80,       '$80.00'],
    ['80.50',        '80.5',       '80.50',    '$81',            80.5,       '$80.50'],
    ['99.99',        '99.99',      '99.99',    '$100',          99.99,       '$99.99'],
    ['100',          '100',        '100.00',   '$100',            100,       '$100.00'],
    ['1200',         '1200',       '1200.00',  '$1,200',         1200,       '$1200.00'],
    ['999999.99',    '999999.99',  '999999.99','$1,000,000', 999999.99,      '$999999.99'],
    ['37.774929',    '37.774929',  '37.77',    '$38',       37.774929,       '$37.77'],
    ['-122.419418',  '-122.419418', null,      '$-122',   -122.419418,        null],
    ['-0.01',        '-0.01',       null,      '$-0',           -0.01,        null],
    ['-49.99',       '-49.99',      null,      '$-50',         -49.99,        null],
    ['0.005',        '0.005',      '0.00',     '$0',            0.005,       '$0.00'],
    ['0.004',        '0.004',      '0.00',     '$0',            0.004,       '$0.00'],
    ['2.675',        '2.675',      '2.67',     '$3',            2.675,       '$2.67'],
  ])(
    'reads Prisma.Decimal("%s") identically through every export',
    (raw, asString, asFixed2, asRounded, asNumber, asMoney) => {
      const d = new Prisma.Decimal(raw)
      expect(moneyToString(d)).toBe(asString)
      expect(moneyToFixed2String(d)).toBe(asFixed2)
      expect(formatRoundedDollars(d)).toBe(asRounded)
      expect(moneyToNumber(d)).toBe(asNumber)
      expect(formatMoneyFromUnknown(d)).toBe(asMoney)
    },
  )
})
