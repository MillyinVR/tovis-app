// lib/looks/personalizationMetrics.test.ts
//
// Unit coverage for the PURE §9 metric derivations. The impure window scan
// (computePersonalizationMetrics — findMany/groupBy/aggregate) is covered
// against real Postgres in tests/integration/personalization-metrics.test.ts; a
// mocked query would only test the mock.
import { NotificationEventKey } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import {
  deriveRebookMetric,
  deriveSaveToBookFunnel,
  median,
  safeRate,
  summarizeCategoryOptOuts,
} from './personalizationMetrics'

describe('safeRate', () => {
  it('divides normally', () => {
    expect(safeRate(1, 4)).toBe(0.25)
  })

  it('returns 0 for a zero or negative denominator (never NaN/Infinity)', () => {
    expect(safeRate(5, 0)).toBe(0)
    expect(safeRate(5, -3)).toBe(0)
    expect(Number.isFinite(safeRate(1, 0))).toBe(true)
  })
})

describe('median', () => {
  it('returns null for an empty list', () => {
    expect(median([])).toBeNull()
  })

  it('returns the middle value for an odd count', () => {
    expect(median([3, 1, 2])).toBe(2)
  })

  it('averages the two middle values for an even count', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })
})

describe('deriveSaveToBookFunnel', () => {
  it('computes conversion and the saved-not-booked gap', () => {
    const funnel = deriveSaveToBookFunnel({
      savedPairs: 10,
      bookedPairs: 3,
      savesScanned: 12,
      scanCapped: false,
    })
    expect(funnel.savedPairs).toBe(10)
    expect(funnel.bookedPairs).toBe(3)
    expect(funnel.conversionRate).toBeCloseTo(0.3)
    expect(funnel.notBookedPairs).toBe(7)
    expect(funnel.notBookedRate).toBeCloseTo(0.7)
  })

  it('clamps booked to saved so conversion never exceeds 100% or the gap goes negative', () => {
    const funnel = deriveSaveToBookFunnel({
      savedPairs: 4,
      bookedPairs: 9, // impossible race — more booked than saved
      savesScanned: 4,
      scanCapped: false,
    })
    expect(funnel.bookedPairs).toBe(4)
    expect(funnel.conversionRate).toBe(1)
    expect(funnel.notBookedPairs).toBe(0)
    expect(funnel.notBookedRate).toBe(0)
  })

  it('is all-zero (no NaN) when nothing was saved', () => {
    const funnel = deriveSaveToBookFunnel({
      savedPairs: 0,
      bookedPairs: 0,
      savesScanned: 0,
      scanCapped: false,
    })
    expect(funnel.conversionRate).toBe(0)
    expect(funnel.notBookedRate).toBe(0)
  })

  it('passes the scan-cap flag through', () => {
    expect(
      deriveSaveToBookFunnel({
        savedPairs: 1,
        bookedPairs: 0,
        savesScanned: 20001,
        scanCapped: true,
      }).scanCapped,
    ).toBe(true)
  })
})

describe('deriveRebookMetric', () => {
  it('counts booked (≥1) vs repeat (≥2) clients from per-client completed counts', () => {
    const metric = deriveRebookMetric([1, 1, 2, 5, 1])
    expect(metric.bookedClients).toBe(5)
    expect(metric.repeatClients).toBe(2)
    expect(metric.rebookRate).toBeCloseTo(0.4)
  })

  it('is zero-safe with no booked clients', () => {
    const metric = deriveRebookMetric([])
    expect(metric.bookedClients).toBe(0)
    expect(metric.repeatClients).toBe(0)
    expect(metric.rebookRate).toBe(0)
  })
})

describe('summarizeCategoryOptOuts', () => {
  const SAVED = NotificationEventKey.SAVED_LOOK_AVAILABILITY_OPENED
  const REBOOK = NotificationEventKey.REBOOK_CADENCE_DUE
  const REVIEW = NotificationEventKey.REVIEW_RECEIVED
  const FOLLOW = NotificationEventKey.CLIENT_FOLLOW

  it('counts a single-key category as opted-out when that key is muted', () => {
    const mutedByClient = new Map<string, Set<NotificationEventKey>>([
      ['c1', new Set([SAVED])],
      ['c2', new Set([REBOOK])], // muted a different category
    ])
    const [savedCat] = summarizeCategoryOptOuts({
      mutedByClient,
      categories: [{ key: 'SAVED_LOOKS', label: 'Saved looks', eventKeys: [SAVED] }],
      totalClients: 10,
    })
    expect(savedCat?.mutedClients).toBe(1)
    expect(savedCat?.rate).toBeCloseTo(0.1)
  })

  it('requires ALL of a multi-key category to be muted', () => {
    const mutedByClient = new Map<string, Set<NotificationEventKey>>([
      ['c1', new Set([REVIEW, FOLLOW])], // both → opted out
      ['c2', new Set([REVIEW])], // only one → NOT opted out
    ])
    const [social] = summarizeCategoryOptOuts({
      mutedByClient,
      categories: [
        { key: 'SOCIAL', label: 'Social', eventKeys: [REVIEW, FOLLOW] },
      ],
      totalClients: 4,
    })
    expect(social?.mutedClients).toBe(1)
    expect(social?.rate).toBeCloseTo(0.25)
  })

  it('reports zero (not NaN) when there are no clients', () => {
    const [cat] = summarizeCategoryOptOuts({
      mutedByClient: new Map(),
      categories: [{ key: 'SAVED_LOOKS', label: 'Saved looks', eventKeys: [SAVED] }],
      totalClients: 0,
    })
    expect(cat?.mutedClients).toBe(0)
    expect(cat?.rate).toBe(0)
  })

  it('treats an empty category as un-opt-out-able', () => {
    const [cat] = summarizeCategoryOptOuts({
      mutedByClient: new Map([['c1', new Set([SAVED])]]),
      categories: [{ key: 'SAVED_LOOKS', label: 'Saved looks', eventKeys: [] }],
      totalClients: 3,
    })
    expect(cat?.mutedClients).toBe(0)
  })
})
