// lib/looks/velocityAnomaly.test.ts
//
// Unit coverage for the PURE §5.6 detector. The impure window scan
// (detectLookVelocityAnomalies — groupBy aggregates + join) is covered against
// real Postgres in tests/integration/look-velocity-anomaly.test.ts; a mocked
// groupBy would only test the mock.
import { describe, expect, it } from 'vitest'

import {
  evaluateLookVelocityAnomaly,
  VELOCITY_ANOMALY_MIN_ENGAGEMENT,
  VELOCITY_ANOMALY_RATE_CEILING,
  VELOCITY_ANOMALY_SPIKE_CAP,
  VELOCITY_ANOMALY_SPIKE_MULTIPLE,
} from './velocityAnomaly'

const NOW = new Date('2026-03-01T00:00:00.000Z')
const WINDOW_DAYS = 7

/** A look old enough to have a pre-window baseline (spike-eligible). */
function oldLookCreatedAt(): Date {
  // 60 days before NOW → priorDays ≈ 53 ≥ the 7-day minimum.
  return new Date(NOW.getTime() - 60 * 24 * 60 * 60 * 1000)
}

describe('evaluateLookVelocityAnomaly', () => {
  it('returns null below the engagement floor (tiny-sample noise)', () => {
    const result = evaluateLookVelocityAnomaly({
      windowSaves: 3,
      windowLikes: 1, // 4 < floor (8)
      windowImpressions: 0,
      lifetimeSaveCount: 3,
      lifetimeLikeCount: 1,
      createdAt: oldLookCreatedAt(),
      now: NOW,
      windowDays: WINDOW_DAYS,
    })
    expect(result).toBeNull()
    // Sanity: the floor is what makes this null.
    expect(4).toBeLessThan(VELOCITY_ANOMALY_MIN_ENGAGEMENT)
  })

  it('returns null for healthy engagement well under impressions', () => {
    const result = evaluateLookVelocityAnomaly({
      windowSaves: 20,
      windowLikes: 30, // 50 engagement
      windowImpressions: 1000, // ratio 0.05
      lifetimeSaveCount: 200,
      lifetimeLikeCount: 300,
      createdAt: oldLookCreatedAt(),
      now: NOW,
      windowDays: WINDOW_DAYS,
    })
    expect(result).toBeNull()
  })

  it('flags RATE_ANOMALY when engagement outruns impressions', () => {
    const result = evaluateLookVelocityAnomaly({
      windowSaves: 40,
      windowLikes: 10, // 50 engagement
      windowImpressions: 10, // ratio 5.0 >= 1.5 ceiling
      // Lifetime tracks the window (no separate spike), so only the rate trips.
      lifetimeSaveCount: 40,
      lifetimeLikeCount: 10,
      createdAt: oldLookCreatedAt(),
      now: NOW,
      windowDays: WINDOW_DAYS,
    })
    expect(result).not.toBeNull()
    expect(result?.reasons).toContain('RATE_ANOMALY')
    expect(result?.rateRatio).toBeCloseTo(5)
    expect(result?.severity).toBeGreaterThan(0)
  })

  it('treats zero recorded impressions as the strongest rate signal', () => {
    const result = evaluateLookVelocityAnomaly({
      windowSaves: 25,
      windowLikes: 0,
      windowImpressions: 0, // ratio = 25 / max(0,1) = 25
      lifetimeSaveCount: 25,
      lifetimeLikeCount: 0,
      createdAt: oldLookCreatedAt(),
      now: NOW,
      windowDays: WINDOW_DAYS,
    })
    expect(result?.reasons).toContain('RATE_ANOMALY')
    expect(result?.rateRatio).toBe(25)
  })

  it('is exactly at the ceiling — inclusive flag', () => {
    const result = evaluateLookVelocityAnomaly({
      windowSaves: 12,
      windowLikes: 0, // 12 engagement
      windowImpressions: 8, // 12 / 8 = 1.5 == ceiling
      lifetimeSaveCount: 12,
      lifetimeLikeCount: 0,
      createdAt: oldLookCreatedAt(),
      now: NOW,
      windowDays: WINDOW_DAYS,
    })
    expect(result?.rateRatio).toBeCloseTo(VELOCITY_ANOMALY_RATE_CEILING)
    expect(result?.reasons).toContain('RATE_ANOMALY')
  })

  it('does NOT flag rate just below the ceiling', () => {
    const result = evaluateLookVelocityAnomaly({
      windowSaves: 10,
      windowLikes: 0, // 10 engagement
      windowImpressions: 10, // ratio 1.0 < 1.5
      // Match lifetime so prior engagement is 0 → no spike baseline either.
      lifetimeSaveCount: 10,
      lifetimeLikeCount: 0,
      createdAt: oldLookCreatedAt(),
      now: NOW,
      windowDays: WINDOW_DAYS,
    })
    expect(result).toBeNull()
  })

  it('flags HISTORICAL_SPIKE for a burst above the prior daily rate', () => {
    // Prior: 106 lifetime − 30 window = 76 engagement over ~53 prior days ≈
    // 1.43/day. Window: 30/7 ≈ 4.3/day → ~3× ... push higher to clear 5×.
    const result = evaluateLookVelocityAnomaly({
      windowSaves: 60,
      windowLikes: 0, // 60 window engagement → 8.57/day
      windowImpressions: 5000, // huge impressions → rate ratio tiny, no rate flag
      lifetimeSaveCount: 120, // prior = 120 − 60 = 60 over 53d ≈ 1.13/day
      lifetimeLikeCount: 0,
      createdAt: oldLookCreatedAt(),
      now: NOW,
      windowDays: WINDOW_DAYS,
    })
    expect(result).not.toBeNull()
    expect(result?.reasons).toContain('HISTORICAL_SPIKE')
    expect(result?.reasons).not.toContain('RATE_ANOMALY')
    expect(result?.spikeMultiple).toBeGreaterThanOrEqual(
      VELOCITY_ANOMALY_SPIKE_MULTIPLE,
    )
  })

  it('does NOT flag a spike with no prior baseline (dormant burst, impressions match)', () => {
    // Old look, but all its lifetime engagement is in the window → prior 0.
    // With honest impressions the rate check is clean too, so nothing flags:
    // a dormant look finally getting discovered is not abuse.
    const result = evaluateLookVelocityAnomaly({
      windowSaves: 30,
      windowLikes: 0,
      windowImpressions: 100000, // no rate flag
      lifetimeSaveCount: 30, // prior = 30 − 30 = 0 → no baseline
      lifetimeLikeCount: 0,
      createdAt: oldLookCreatedAt(),
      now: NOW,
      windowDays: WINDOW_DAYS,
    })
    expect(result).toBeNull()
  })

  it('caps the spike multiple when the prior baseline is tiny', () => {
    // Very old look (400d), prior = 1 engagement over ~393 days ≈ 0.0025/day;
    // window 30/7 ≈ 4.3/day → ~1685×, clamped to the display cap.
    const result = evaluateLookVelocityAnomaly({
      windowSaves: 30,
      windowLikes: 0,
      windowImpressions: 100000, // no rate flag
      lifetimeSaveCount: 31, // prior = 31 − 30 = 1
      lifetimeLikeCount: 0,
      createdAt: new Date(NOW.getTime() - 400 * 24 * 60 * 60 * 1000),
      now: NOW,
      windowDays: WINDOW_DAYS,
    })
    expect(result?.reasons).toContain('HISTORICAL_SPIKE')
    expect(result?.spikeMultiple).toBe(VELOCITY_ANOMALY_SPIKE_CAP)
  })

  it('never flags a spike for a brand-new look (no prior history)', () => {
    // Created 2 days ago → priorDays = 2 − 7 < 0 → not spike-eligible.
    const result = evaluateLookVelocityAnomaly({
      windowSaves: 100,
      windowLikes: 0,
      windowImpressions: 100000, // no rate flag
      lifetimeSaveCount: 100,
      lifetimeLikeCount: 0,
      createdAt: new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000),
      now: NOW,
      windowDays: WINDOW_DAYS,
    })
    // A launch surge on a fresh look is honest — nothing to flag.
    expect(result).toBeNull()
  })

  it('reports both reasons and a higher severity when both trip', () => {
    const both = evaluateLookVelocityAnomaly({
      windowSaves: 80,
      windowLikes: 0, // 80 engagement
      windowImpressions: 10, // ratio 8 → rate flag
      lifetimeSaveCount: 85, // prior = 85 − 80 = 5 over ~53d → big spike
      lifetimeLikeCount: 0,
      createdAt: oldLookCreatedAt(),
      now: NOW,
      windowDays: WINDOW_DAYS,
    })
    expect(both?.reasons).toEqual(
      expect.arrayContaining(['RATE_ANOMALY', 'HISTORICAL_SPIKE']),
    )

    const rateOnly = evaluateLookVelocityAnomaly({
      windowSaves: 80,
      windowLikes: 0,
      windowImpressions: 10, // same rate
      lifetimeSaveCount: 80,
      lifetimeLikeCount: 0,
      // Fresh look → no spike, so only the rate reason.
      createdAt: new Date(NOW.getTime() - 1 * 24 * 60 * 60 * 1000),
      now: NOW,
      windowDays: WINDOW_DAYS,
    })
    expect(rateOnly?.reasons).toEqual(['RATE_ANOMALY'])
    // Two reasons must outrank one for the review queue's ordering.
    expect(both!.severity).toBeGreaterThan(rateOnly!.severity)
  })

  it('normalizes/guards negative + fractional inputs', () => {
    const result = evaluateLookVelocityAnomaly({
      windowSaves: 12.9,
      windowLikes: -5, // clamped to 0
      windowImpressions: -3, // clamped to 0
      lifetimeSaveCount: 12.9,
      lifetimeLikeCount: -5,
      createdAt: oldLookCreatedAt(),
      now: NOW,
      windowDays: WINDOW_DAYS,
    })
    // 12 saves, 0 likes, 0 impressions → engagement 12, rate 12.
    expect(result?.windowSaves).toBe(12)
    expect(result?.windowLikes).toBe(0)
    expect(result?.windowImpressions).toBe(0)
    expect(result?.windowEngagement).toBe(12)
    expect(result?.rateRatio).toBe(12)
  })
})
