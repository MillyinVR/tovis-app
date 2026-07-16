// lib/pro/visibilityHealth.test.ts
//
// Units for the pure §6.5 evaluator. The impure loader is covered by
// tests/integration/pro-visibility-health.test.ts against a real Postgres.
import { describe, expect, it } from 'vitest'

import {
  LOOK_BADGE_AVAILABILITY_STAT_MAX_AGE_MS,
  LOOK_BADGE_THRESHOLDS,
} from '@/lib/looks/badges/engine'
import { PERSONALIZED_RANK_WEIGHTS } from '@/lib/looks/personalizedRanking'
import {
  evaluateProVisibilityHealth,
  PRO_VISIBILITY_THRESHOLDS,
  type ProVisibilityLeverKey,
  type ProVisibilitySignals,
  type ProVisibilityStatus,
} from '@/lib/pro/visibilityHealth'

const NOW = new Date('2026-07-16T12:00:00.000Z')

function healthyLooks() {
  return {
    feedEligibleCount: 12,
    pendingReviewCount: 0,
    rejectedCount: 0,
    draftCount: 0,
    distinctTagCount: 10,
    distinctServiceCount: 3,
  }
}

// A pro with every lever green — each test perturbs exactly one signal.
function healthySignals(
  overrides: Partial<ProVisibilitySignals> = {},
): ProVisibilitySignals {
  return {
    now: NOW,
    readiness: { ok: true, liveModes: ['SALON'], readyLocationIds: ['loc-1'] },
    availability: {
      nextOpeningDate: new Date('2026-07-18T00:00:00.000Z'),
      fullness14d: 0.4,
      computedAt: new Date('2026-07-16T11:30:00.000Z'),
    },
    availabilityEverComputed: true,
    looks: healthyLooks(),
    conversion: { bookingCount: 20, interestCount: 200 },
    reliability: { resolvedBookingCount: 40, completedResolvedCount: 38 },
    ...overrides,
  }
}

function leverFor(
  signals: ProVisibilitySignals,
  key: ProVisibilityLeverKey,
) {
  const lever = evaluateProVisibilityHealth(signals).levers.find(
    (candidate) => candidate.key === key,
  )
  if (!lever) throw new Error(`missing lever ${key}`)
  return lever
}

function statusFor(
  signals: ProVisibilitySignals,
  key: ProVisibilityLeverKey,
): ProVisibilityStatus {
  return leverFor(signals, key).status
}

describe('evaluateProVisibilityHealth — shape', () => {
  it('returns every lever exactly once', () => {
    const result = evaluateProVisibilityHealth(healthySignals())
    expect(result.levers.map((lever) => lever.key).sort()).toEqual([
      'AVAILABILITY',
      'BOOKABLE',
      'BOOKING_CONVERSION',
      'LOOK_COVERAGE',
      'RELIABILITY',
    ])
  })

  it('reports GOOD overall for a fully healthy pro', () => {
    const result = evaluateProVisibilityHealth(healthySignals())
    expect(result.status).toBe('GOOD')
    expect(result.discoverable).toBe(true)
    expect(result.levers.every((lever) => lever.status === 'GOOD')).toBe(true)
  })

  it('never exposes a weight, score, or formula in copy (anti-gaming, §5.6)', () => {
    // Sweep several states so we cover every copy branch, not just the happy one.
    const states = [
      healthySignals(),
      healthySignals({ readiness: { ok: false, blockers: ['NO_ACTIVE_OFFERING'] } }),
      healthySignals({ availability: null }),
      healthySignals({ conversion: { bookingCount: 0, interestCount: 400 } }),
      healthySignals({
        reliability: { resolvedBookingCount: 10, completedResolvedCount: 3 },
      }),
      healthySignals({ looks: { ...healthyLooks(), feedEligibleCount: 0 } }),
    ]

    for (const signals of states) {
      for (const lever of evaluateProVisibilityHealth(signals).levers) {
        const copy = `${lever.headline} ${lever.detail}`
        // No raw numbers that could only be a weight/score/rate, and no
        // "rank"/"score"/"boost" language that invites reverse-engineering.
        expect(copy).not.toMatch(/\b(score|weight|boost|multiplier|algorithm)\b/i)
        expect(copy).not.toMatch(/\d+(\.\d+)?\s*%/)
      }
    }
  })

  it('surfaces the biggest lever first and keeps declaration order within a status', () => {
    const signals = healthySignals({
      // ACTION on reliability, ATTENTION on availability, rest GOOD.
      availability: {
        nextOpeningDate: new Date('2026-08-30T00:00:00.000Z'),
        fullness14d: 0.4,
        computedAt: new Date('2026-07-16T11:30:00.000Z'),
      },
      reliability: { resolvedBookingCount: 10, completedResolvedCount: 3 },
    })

    const result = evaluateProVisibilityHealth(signals)
    expect(result.status).toBe('ACTION')
    expect(result.levers.at(0)?.key).toBe('RELIABILITY')
    expect(result.levers.at(1)?.key).toBe('AVAILABILITY')
    // The two GOOD levers keep their funnel order relative to each other.
    const good = result.levers.filter((lever) => lever.status === 'GOOD')
    expect(good.map((lever) => lever.key)).toEqual([
      'BOOKABLE',
      'LOOK_COVERAGE',
      'BOOKING_CONVERSION',
    ])
  })

  it('sorts UNKNOWN last — nothing to act on outranks nothing to report', () => {
    const signals = healthySignals({
      conversion: null,
      reliability: null,
    })
    const result = evaluateProVisibilityHealth(signals)
    const keys = result.levers.map((lever) => lever.key)
    expect(keys.indexOf('BOOKING_CONVERSION')).toBeGreaterThan(
      keys.indexOf('BOOKABLE'),
    )
    expect(result.levers.at(-1)?.status).toBe('UNKNOWN')
  })

  it('states plainly what discovery does not read', () => {
    const result = evaluateProVisibilityHealth(healthySignals())
    expect(result.notMeasured.length).toBeGreaterThan(0)
    // §6.5 names response time, but nothing measures it — it must be disclosed
    // as unmeasured rather than rendered as a lever.
    expect(result.notMeasured.join(' ')).toMatch(/repl(y|ies)/i)
    expect(result.levers.map((lever) => lever.key)).not.toContain('RESPONSE_TIME')
  })
})

describe('BOOKABLE lever', () => {
  it('is ACTION with a fix link per blocker when the pro is not bookable', () => {
    const signals = healthySignals({
      readiness: {
        ok: false,
        blockers: ['NO_ACTIVE_OFFERING', 'NO_BOOKABLE_LOCATION'],
      },
    })
    const lever = leverFor(signals, 'BOOKABLE')

    expect(lever.status).toBe('ACTION')
    expect(lever.actions).toHaveLength(2)
    expect(lever.actions.map((action) => action.href)).toEqual([
      '/pro/services',
      '/pro/locations',
    ])
    expect(evaluateProVisibilityHealth(signals).discoverable).toBe(false)
  })

  it('dominates the ordering — an unbookable pro sees it first', () => {
    const signals = healthySignals({
      readiness: { ok: false, blockers: ['NO_ACTIVE_OFFERING'] },
      reliability: { resolvedBookingCount: 10, completedResolvedCount: 3 },
    })
    expect(evaluateProVisibilityHealth(signals).levers.at(0)?.key).toBe('BOOKABLE')
  })
})

describe('AVAILABILITY lever', () => {
  it('is UNKNOWN — never ATTENTION — when the cron has produced no rows at all', () => {
    // The false-blame case: an unpopulated table must not tell every pro they
    // have no openings.
    const signals = healthySignals({
      availability: null,
      availabilityEverComputed: false,
    })
    const lever = leverFor(signals, 'AVAILABILITY')
    expect(lever.status).toBe('UNKNOWN')
    expect(lever.actions).toEqual([])
    expect(lever.detail).not.toMatch(/no bookable|no opening/i)
  })

  it('is ATTENTION when the cron HAS run and this pro has no row', () => {
    const signals = healthySignals({
      availability: null,
      availabilityEverComputed: true,
    })
    expect(statusFor(signals, 'AVAILABILITY')).toBe('ATTENTION')
  })

  it('is UNKNOWN when this pro’s row is stale', () => {
    const staleBy = LOOK_BADGE_AVAILABILITY_STAT_MAX_AGE_MS + 60_000
    const signals = healthySignals({
      availability: {
        nextOpeningDate: new Date('2026-07-18T00:00:00.000Z'),
        fullness14d: 0.4,
        computedAt: new Date(NOW.getTime() - staleBy),
      },
    })
    expect(statusFor(signals, 'AVAILABILITY')).toBe('UNKNOWN')
  })

  it('flags booked-out at the same bar the BOOKING_OUT badge uses, and says both sides', () => {
    const signals = healthySignals({
      availability: {
        nextOpeningDate: new Date('2026-07-18T00:00:00.000Z'),
        fullness14d: LOOK_BADGE_THRESHOLDS.bookingOutMinFullness,
        computedAt: new Date('2026-07-16T11:30:00.000Z'),
      },
    })
    const lever = leverFor(signals, 'AVAILABILITY')
    expect(lever.status).toBe('ATTENTION')
    // Honesty: the pro is told the upside (badge) alongside the downside, and
    // that staying full is a legitimate choice.
    expect(lever.detail).toMatch(/badge/i)
    expect(lever.detail).toMatch(/reasonable/i)
  })

  it('stays GOOD just under the booked-out bar', () => {
    const signals = healthySignals({
      availability: {
        nextOpeningDate: new Date('2026-07-18T00:00:00.000Z'),
        fullness14d: LOOK_BADGE_THRESHOLDS.bookingOutMinFullness - 0.01,
        computedAt: new Date('2026-07-16T11:30:00.000Z'),
      },
    })
    expect(statusFor(signals, 'AVAILABILITY')).toBe('GOOD')
  })

  it('flags a far-out opening past the AVAILABLE_SOON horizon', () => {
    const beyond = LOOK_BADGE_THRESHOLDS.availableSoonMaxDays + 3
    const signals = healthySignals({
      availability: {
        nextOpeningDate: new Date(NOW.getTime() + beyond * 24 * 60 * 60 * 1000),
        fullness14d: 0.4,
        computedAt: new Date('2026-07-16T11:30:00.000Z'),
      },
    })
    const lever = leverFor(signals, 'AVAILABILITY')
    expect(lever.status).toBe('ATTENTION')
    expect(lever.headline).toContain(`${beyond} days`)
  })

  it('agrees with the badge day-count convention at the horizon edge', () => {
    // Exactly at availableSoonMaxDays the badge still fires, so we must not
    // call it "far out".
    const edge = LOOK_BADGE_THRESHOLDS.availableSoonMaxDays
    const signals = healthySignals({
      availability: {
        nextOpeningDate: new Date(NOW.getTime() + edge * 24 * 60 * 60 * 1000),
        fullness14d: 0.4,
        computedAt: new Date('2026-07-16T11:30:00.000Z'),
      },
    })
    expect(statusFor(signals, 'AVAILABILITY')).toBe('GOOD')
  })
})

describe('LOOK_COVERAGE lever', () => {
  it('is ACTION with a publish link when nothing is live', () => {
    const signals = healthySignals({
      looks: { ...healthyLooks(), feedEligibleCount: 0, distinctTagCount: 0 },
    })
    const lever = leverFor(signals, 'LOOK_COVERAGE')
    expect(lever.status).toBe('ACTION')
    expect(lever.actions.at(0)?.href).toBe('/pro/media/new')
  })

  it('calls out rejected looks specifically — a real "why" nothing else surfaces', () => {
    const signals = healthySignals({
      looks: {
        ...healthyLooks(),
        feedEligibleCount: 0,
        rejectedCount: 3,
        distinctTagCount: 0,
      },
    })
    const lever = leverFor(signals, 'LOOK_COVERAGE')
    expect(lever.status).toBe('ACTION')
    expect(lever.headline).toMatch(/approved/i)
  })

  it('is ATTENTION when looks are thin (the spec’s "widen your tag matches")', () => {
    const signals = healthySignals({
      looks: {
        ...healthyLooks(),
        feedEligibleCount: PRO_VISIBILITY_THRESHOLDS.healthyLookCount - 1,
      },
    })
    expect(statusFor(signals, 'LOOK_COVERAGE')).toBe('ATTENTION')
  })

  it('is ATTENTION when tags are thin even with plenty of looks', () => {
    const signals = healthySignals({
      looks: {
        ...healthyLooks(),
        distinctTagCount: PRO_VISIBILITY_THRESHOLDS.healthyTagCount - 1,
      },
    })
    expect(statusFor(signals, 'LOOK_COVERAGE')).toBe('ATTENTION')
  })

  it('is GOOD exactly at both bars', () => {
    const signals = healthySignals({
      looks: {
        ...healthyLooks(),
        feedEligibleCount: PRO_VISIBILITY_THRESHOLDS.healthyLookCount,
        distinctTagCount: PRO_VISIBILITY_THRESHOLDS.healthyTagCount,
      },
    })
    expect(statusFor(signals, 'LOOK_COVERAGE')).toBe('GOOD')
  })
})

describe('BOOKING_CONVERSION lever', () => {
  it('stays UNKNOWN below the interest floor rather than judge on noise', () => {
    const signals = healthySignals({
      conversion: {
        bookingCount: 0,
        interestCount: PRO_VISIBILITY_THRESHOLDS.conversionMinInterest - 1,
      },
    })
    expect(statusFor(signals, 'BOOKING_CONVERSION')).toBe('UNKNOWN')
  })

  it('is UNKNOWN when no conversion row exists at all', () => {
    expect(statusFor(healthySignals({ conversion: null }), 'BOOKING_CONVERSION')).toBe(
      'UNKNOWN',
    )
  })

  it('is ATTENTION with real interest but zero bookings', () => {
    const signals = healthySignals({
      conversion: { bookingCount: 0, interestCount: 400 },
    })
    const lever = leverFor(signals, 'BOOKING_CONVERSION')
    expect(lever.status).toBe('ATTENTION')
    expect(lever.actions.at(0)?.href).toBe('/pro/services')
  })

  it('is ATTENTION below the rank engine’s target rate and GOOD at it', () => {
    const target = PERSONALIZED_RANK_WEIGHTS.conversionTargetRate
    const interestCount = 1000

    const below = healthySignals({
      conversion: {
        interestCount,
        bookingCount: Math.floor(target * interestCount) - 1,
      },
    })
    expect(statusFor(below, 'BOOKING_CONVERSION')).toBe('ATTENTION')

    const at = healthySignals({
      conversion: { interestCount, bookingCount: Math.ceil(target * interestCount) },
    })
    expect(statusFor(at, 'BOOKING_CONVERSION')).toBe('GOOD')
  })
})

describe('RELIABILITY lever', () => {
  it('is UNKNOWN with no resolved bookings, and says it is not held against them', () => {
    // Ranking gates the term on resolvedBookingCount > 0 — no history is no
    // evidence, not a penalty. The copy must not imply otherwise.
    const signals = healthySignals({
      reliability: { resolvedBookingCount: 0, completedResolvedCount: 0 },
    })
    const lever = leverFor(signals, 'RELIABILITY')
    expect(lever.status).toBe('UNKNOWN')
    expect(lever.detail).toMatch(/does not count against you/i)
  })

  it('is UNKNOWN when no badge-stat row exists', () => {
    expect(statusFor(healthySignals({ reliability: null }), 'RELIABILITY')).toBe(
      'UNKNOWN',
    )
  })

  it('is ACTION below the rank engine’s floor rate', () => {
    const signals = healthySignals({
      reliability: { resolvedBookingCount: 10, completedResolvedCount: 5 },
    })
    const lever = leverFor(signals, 'RELIABILITY')
    expect(lever.status).toBe('ACTION')
    // No-shows are excluded from the underlying counts by design; the copy says
    // so, because "you're penalised for client no-shows" is the wrong takeaway.
    expect(lever.detail).toMatch(/no-show/i)
  })

  it('is GOOD exactly at the floor rate', () => {
    const floor = PERSONALIZED_RANK_WEIGHTS.reliabilityFloorRate
    const resolvedBookingCount = 100
    const signals = healthySignals({
      reliability: {
        resolvedBookingCount,
        completedResolvedCount: floor * resolvedBookingCount,
      },
    })
    expect(statusFor(signals, 'RELIABILITY')).toBe('GOOD')
  })
})
