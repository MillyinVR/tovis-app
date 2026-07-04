import { describe, expect, it } from 'vitest'
import { NoShowFeeType, Prisma } from '@prisma/client'

import {
  computeNoShowFeeAmount,
  isWithinCancelWindow,
  noShowFeeAmountToCents,
} from '@/lib/noShowProtection/fee'

const D = (v: string | number) => new Prisma.Decimal(v)

describe('computeNoShowFeeAmount', () => {
  it('returns the flat amount for a FLAT policy', () => {
    const amount = computeNoShowFeeAmount(
      { feeType: NoShowFeeType.FLAT, feeFlatAmount: D('25'), feePercent: null },
      D('120'),
    )
    expect(amount?.toFixed(2)).toBe('25.00')
  })

  it('caps a flat fee at the service price', () => {
    const amount = computeNoShowFeeAmount(
      { feeType: NoShowFeeType.FLAT, feeFlatAmount: D('200'), feePercent: null },
      D('120'),
    )
    expect(amount?.toFixed(2)).toBe('120.00')
  })

  it('computes a percent of the base amount, rounded to cents', () => {
    const amount = computeNoShowFeeAmount(
      { feeType: NoShowFeeType.PERCENT, feeFlatAmount: null, feePercent: 50 },
      D('99.99'),
    )
    // 99.99 * 0.5 = 49.995 -> 50.00 (2dp round half up)
    expect(amount?.toFixed(2)).toBe('50.00')
  })

  it('clamps a percent above 100 to 100%', () => {
    const amount = computeNoShowFeeAmount(
      { feeType: NoShowFeeType.PERCENT, feeFlatAmount: null, feePercent: 150 },
      D('80'),
    )
    expect(amount?.toFixed(2)).toBe('80.00')
  })

  it('returns null when the flat amount is missing or non-positive', () => {
    expect(
      computeNoShowFeeAmount(
        { feeType: NoShowFeeType.FLAT, feeFlatAmount: null, feePercent: null },
        D('120'),
      ),
    ).toBeNull()
    expect(
      computeNoShowFeeAmount(
        { feeType: NoShowFeeType.FLAT, feeFlatAmount: D('0'), feePercent: null },
        D('120'),
      ),
    ).toBeNull()
  })

  it('returns null when the percent is missing or non-positive', () => {
    expect(
      computeNoShowFeeAmount(
        { feeType: NoShowFeeType.PERCENT, feeFlatAmount: null, feePercent: null },
        D('120'),
      ),
    ).toBeNull()
    expect(
      computeNoShowFeeAmount(
        { feeType: NoShowFeeType.PERCENT, feeFlatAmount: null, feePercent: 0 },
        D('120'),
      ),
    ).toBeNull()
  })

  it('returns null for a zero or missing base amount', () => {
    expect(
      computeNoShowFeeAmount(
        { feeType: NoShowFeeType.FLAT, feeFlatAmount: D('25'), feePercent: null },
        D('0'),
      ),
    ).toBeNull()
    expect(
      computeNoShowFeeAmount(
        { feeType: NoShowFeeType.FLAT, feeFlatAmount: D('25'), feePercent: null },
        null,
      ),
    ).toBeNull()
  })
})

describe('noShowFeeAmountToCents', () => {
  it('converts a money Decimal to integer cents', () => {
    expect(noShowFeeAmountToCents(D('25.00'))).toBe(2500)
    expect(noShowFeeAmountToCents(D('49.99'))).toBe(4999)
    expect(noShowFeeAmountToCents(D('0.10'))).toBe(10)
  })
})

describe('isWithinCancelWindow', () => {
  const scheduledFor = new Date('2026-07-10T18:00:00.000Z')

  it('is true when now is inside the window before the start', () => {
    // 12h before start, window is 24h → inside.
    const now = new Date('2026-07-10T06:00:00.000Z')
    expect(isWithinCancelWindow({ scheduledFor, windowHours: 24, now })).toBe(true)
  })

  it('is true at or after the scheduled start', () => {
    const now = new Date('2026-07-10T18:30:00.000Z')
    expect(isWithinCancelWindow({ scheduledFor, windowHours: 24, now })).toBe(true)
  })

  it('is false when now is comfortably before the window opens', () => {
    // 48h before start, window 24h → outside.
    const now = new Date('2026-07-08T18:00:00.000Z')
    expect(isWithinCancelWindow({ scheduledFor, windowHours: 24, now })).toBe(false)
  })

  it('treats the window boundary as inclusive', () => {
    const now = new Date('2026-07-09T18:00:00.000Z') // exactly 24h before
    expect(isWithinCancelWindow({ scheduledFor, windowHours: 24, now })).toBe(true)
  })
})
