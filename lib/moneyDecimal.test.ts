import { describe, expect, it } from 'vitest'
import { Prisma } from '@prisma/client'

import { parseMoney } from './moneyDecimal'

// parseMoney had NO test anywhere in the repo before this file — the one money
// function whose result is written to the database was the one nothing pinned.
// It moved out of lib/money.ts character for character (the class import is the
// only thing that could not follow it to the client-safe half), so these tests
// are written against the behaviour as it already was. Anything here that looks
// like a wart IS a wart, faithfully recorded; changing it is a separate PR with
// its own argument.

describe('parseMoney', () => {
  it('returns a real Prisma.Decimal — the DB write depends on the class', () => {
    const result = parseMoney('49.99')
    // Not isDecimalLike: this value goes to Prisma as a Decimal column, so the
    // actual class is the thing under test.
    expect(result).toBeInstanceOf(Prisma.Decimal)
  })

  it('parses money strings to a 2dp Decimal', () => {
    for (const [input, expected] of [
      ['0', '0'],
      ['49', '49'],
      ['49.9', '49.9'],
      ['49.99', '49.99'],
      ['80.00', '80'],
      ['80.50', '80.5'],
      ['1200', '1200'],
      ['999999.99', '999999.99'],
    ] as const) {
      expect(parseMoney(input).toString(), `parseMoney("${input}")`).toBe(expected)
    }
  })

  it('parses numbers by fixing them to 2dp first', () => {
    for (const [input, expected] of [
      [0, '0'],
      [49, '49'],
      [49.99, '49.99'],
      [80.5, '80.5'],
      [0.1, '0.1'],
      [49.999, '50'], // toFixed(2) rounds — a number input is not exact
      // 2.675 is really 2.67499…9 as a double, so toFixed(2) goes DOWN. The
      // string path has no such problem — this is why money should arrive as a
      // string, and why the number path exists only for callers that cannot.
      [2.675, '2.67'],
    ] as const) {
      expect(parseMoney(input).toString(), `parseMoney(${input})`).toBe(expected)
    }
  })

  it('returns a Decimal input by identity, not a copy', () => {
    const input = new Prisma.Decimal('49.99')
    expect(parseMoney(input)).toBe(input)
  })

  it('throws on anything it cannot read as money', () => {
    for (const input of [
      undefined,
      null,
      '',
      '   ',
      'abc',
      '$49.99',
      '49.999', // 3dp: normalizeMoney2 rejects it
      '1,200',
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      {},
      [],
      true,
    ]) {
      expect(() => parseMoney(input), `parseMoney(${String(input)})`).toThrow(
        'Invalid money amount.',
      )
    }
  })

  // Recorded, not endorsed. The string path goes through normalizeMoney2, whose
  // regex is `^\d+(\.\d{1,2})?$` — no sign, so "-5" throws. The number path does
  // not: it only checks Number.isFinite. So the same amount is accepted or
  // rejected depending on which type the caller happened to have.
  it('accepts a negative NUMBER but rejects the same value as a STRING', () => {
    expect(parseMoney(-5).toString()).toBe('-5')
    expect(() => parseMoney('-5')).toThrow('Invalid money amount.')
  })
})
