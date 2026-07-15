// lib/looks/badges/engine.test.ts
import { describe, expect, it } from 'vitest'

import {
  LOOK_BADGE_AVAILABILITY_STAT_MAX_AGE_MS,
  LOOK_BADGE_HOLDOUT_RATE,
  LOOK_BADGE_THRESHOLDS,
  evaluateBadgePool,
  isInBadgeHoldout,
  selectLookBadge,
  type LookBadgeCandidate,
  type LookBadgeEngineContext,
  type ProBadgeSignals,
} from '@/lib/looks/badges/engine'

const NOW = new Date('2026-07-12T12:00:00Z')
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

const PRO_ID = 'pro_1'

function makeSignals(overrides: Partial<ProBadgeSignals> = {}): ProBadgeSignals {
  return {
    recentBookingCount: 0,
    completedBookingCount30d: 0,
    servedClientCount: 0,
    rebookedClientCount: 0,
    statComputedAt: new Date(NOW.getTime() - HOUR_MS),
    accountCreatedAt: new Date(NOW.getTime() - 400 * DAY_MS),
    distanceMiles: null,
    availability: null,
    ...overrides,
  }
}

/** A fresh availability signal opening `daysAhead` out, `fullness` booked. */
function makeAvailability(daysAhead: number, fullness = 0): ProBadgeSignals['availability'] {
  // Mirror the stat's storage: a start-of-local-day instant. For a same-day
  // opening (daysAhead 0) the primitive floors the window at `now`, so the
  // stored instant is the local midnight already behind `now`.
  const opening = new Date(NOW.getTime() + daysAhead * DAY_MS)
  if (daysAhead <= 0) opening.setTime(NOW.getTime() - HOUR_MS)
  return {
    nextOpeningDate: opening,
    fullness14d: fullness,
    computedAt: new Date(NOW.getTime() - HOUR_MS),
  }
}

function makeContext(
  overrides: Partial<LookBadgeEngineContext> = {},
): LookBadgeEngineContext {
  return {
    viewerKey: 'user_1',
    now: NOW,
    brandName: 'BrandCo',
    viewerEvents: [],
    bookedLast7dByLookId: new Map(),
    proSignals: new Map(),
    ...overrides,
  }
}

function makeCandidate(
  overrides: Partial<LookBadgeCandidate> = {},
): LookBadgeCandidate {
  return {
    lookPostId: 'look_1',
    professionalId: PRO_ID,
    categorySlug: 'nails', // LOW tier — nothing suppressed by default
    tagSlugs: [],
    ...overrides,
  }
}

function poolKinds(
  candidate: LookBadgeCandidate,
  ctx: LookBadgeEngineContext,
): string[] {
  return evaluateBadgePool(candidate, ctx).map((badge) => badge.kind)
}

describe('badge evaluators', () => {
  it('BOOKING_FAST needs the velocity threshold AND a fresh stat row', () => {
    const qualifying = makeContext({
      proSignals: new Map([
        [PRO_ID, makeSignals({ recentBookingCount: 3 })],
      ]),
    })
    expect(poolKinds(makeCandidate(), qualifying)).toContain('BOOKING_FAST')

    const belowThreshold = makeContext({
      proSignals: new Map([
        [PRO_ID, makeSignals({ recentBookingCount: 2 })],
      ]),
    })
    expect(poolKinds(makeCandidate(), belowThreshold)).not.toContain(
      'BOOKING_FAST',
    )

    // §5.7.4: stale stats disqualify urgency instead of rendering stale
    // scarcity — but the slow-moving trust badges still tolerate the same age.
    const stale = makeContext({
      proSignals: new Map([
        [
          PRO_ID,
          makeSignals({
            recentBookingCount: 10,
            completedBookingCount30d: 20,
            statComputedAt: new Date(NOW.getTime() - 7 * HOUR_MS),
          }),
        ],
      ]),
    })
    const kinds = poolKinds(makeCandidate(), stale)
    expect(kinds).not.toContain('BOOKING_FAST')
    expect(kinds).toContain('BOOKED_30D')
  })

  it('BOOKED_30D carries the real count in its label', () => {
    const ctx = makeContext({
      proSignals: new Map([
        [PRO_ID, makeSignals({ completedBookingCount30d: 12 })],
      ]),
    })
    const pool = evaluateBadgePool(makeCandidate(), ctx)
    const badge = pool.find((entry) => entry.kind === 'BOOKED_30D')
    expect(badge?.label).toBe('12 bookings in 30 days')

    const thin = makeContext({
      proSignals: new Map([
        [
          PRO_ID,
          makeSignals({
            completedBookingCount30d:
              LOOK_BADGE_THRESHOLDS.booked30dMin - 1,
          }),
        ],
      ]),
    })
    expect(poolKinds(makeCandidate(), thin)).not.toContain('BOOKED_30D')
  })

  it('REBOOK_RATE needs a real denominator and the minimum rate', () => {
    const qualifying = makeContext({
      proSignals: new Map([
        [
          PRO_ID,
          makeSignals({ servedClientCount: 5, rebookedClientCount: 3 }),
        ],
      ]),
    })
    const pool = evaluateBadgePool(makeCandidate(), qualifying)
    expect(pool.find((entry) => entry.kind === 'REBOOK_RATE')?.label).toBe(
      '60% of clients rebook',
    )

    const thinDenominator = makeContext({
      proSignals: new Map([
        [
          PRO_ID,
          makeSignals({ servedClientCount: 4, rebookedClientCount: 4 }),
        ],
      ]),
    })
    expect(poolKinds(makeCandidate(), thinDenominator)).not.toContain(
      'REBOOK_RATE',
    )

    const lowRate = makeContext({
      proSignals: new Map([
        [
          PRO_ID,
          makeSignals({ servedClientCount: 10, rebookedClientCount: 5 }),
        ],
      ]),
    })
    expect(poolKinds(makeCandidate(), lowRate)).not.toContain('REBOOK_RATE')
  })

  it('NEW_TO_PLATFORM uses account age and the tenant brand name', () => {
    const fresh = makeContext({
      proSignals: new Map([
        [
          PRO_ID,
          makeSignals({
            accountCreatedAt: new Date(NOW.getTime() - 30 * DAY_MS),
          }),
        ],
      ]),
    })
    const pool = evaluateBadgePool(makeCandidate(), fresh)
    expect(pool.find((entry) => entry.kind === 'NEW_TO_PLATFORM')?.label).toBe(
      'New to BrandCo',
    )

    const old = makeContext({
      proSignals: new Map([
        [
          PRO_ID,
          makeSignals({
            accountCreatedAt: new Date(NOW.getTime() - 61 * DAY_MS),
          }),
        ],
      ]),
    })
    expect(poolKinds(makeCandidate(), old)).not.toContain('NEW_TO_PLATFORM')
  })

  it('LOOK_BOOKED_RECENTLY counts remix-attributed bookings on this look', () => {
    const ctx = makeContext({
      bookedLast7dByLookId: new Map([['look_1', 3]]),
    })
    const pool = evaluateBadgePool(makeCandidate(), ctx)
    expect(
      pool.find((entry) => entry.kind === 'LOOK_BOOKED_RECENTLY')?.label,
    ).toBe('Booked 3× this week')

    const below = makeContext({
      bookedLast7dByLookId: new Map([['look_1', 1]]),
    })
    expect(poolKinds(makeCandidate(), below)).not.toContain(
      'LOOK_BOOKED_RECENTLY',
    )
  })

  it('EVENT_COUNTDOWN matches the viewer event to the look via occasion tags or category', () => {
    // 2026-08-23 is 42 days after NOW (2026-07-12).
    const events = [{ boardType: 'BRIDAL' as const, eventYmd: '2026-08-23' }]

    const tagMatch = makeCandidate({ tagSlugs: ['bridal'] })
    const ctx = makeContext({ viewerEvents: events })
    expect(
      evaluateBadgePool(tagMatch, ctx).find(
        (entry) => entry.kind === 'EVENT_COUNTDOWN',
      )?.label,
    ).toBe('42 days until your wedding')

    // Category match (makeup ∈ BRIDAL category slugs), no tag overlap.
    const categoryMatch = makeCandidate({ categorySlug: 'makeup' })
    expect(poolKinds(categoryMatch, ctx)).toContain('EVENT_COUNTDOWN')

    // No occasion overlap at all → no countdown.
    const noMatch = makeCandidate({ categorySlug: 'massage' })
    expect(poolKinds(noMatch, ctx)).not.toContain('EVENT_COUNTDOWN')
  })

  it('EVENT_COUNTDOWN never renders day-of, past, or beyond the horizon', () => {
    const candidate = makeCandidate({ tagSlugs: ['bridal'] })

    for (const eventYmd of ['2026-07-12', '2026-07-01', '2026-12-25']) {
      const ctx = makeContext({
        viewerEvents: [{ boardType: 'BRIDAL', eventYmd }],
      })
      expect(poolKinds(candidate, ctx)).not.toContain('EVENT_COUNTDOWN')
    }

    // Singular day copy on the eve.
    const eve = makeContext({
      viewerEvents: [{ boardType: 'BRIDAL', eventYmd: '2026-07-13' }],
    })
    expect(
      evaluateBadgePool(candidate, eve).find(
        (entry) => entry.kind === 'EVENT_COUNTDOWN',
      )?.label,
    ).toBe('1 day until your wedding')
  })

  it('DISTANCE renders inside the radius with mile-honest copy', () => {
    const near = makeContext({
      proSignals: new Map([[PRO_ID, makeSignals({ distanceMiles: 0.4 })]]),
    })
    expect(
      evaluateBadgePool(makeCandidate(), near).find(
        (entry) => entry.kind === 'DISTANCE',
      )?.label,
    ).toBe('Under a mile away')

    const inRadius = makeContext({
      proSignals: new Map([[PRO_ID, makeSignals({ distanceMiles: 3.4 })]]),
    })
    expect(
      evaluateBadgePool(makeCandidate(), inRadius).find(
        (entry) => entry.kind === 'DISTANCE',
      )?.label,
    ).toBe('About 3 miles away')

    const far = makeContext({
      proSignals: new Map([[PRO_ID, makeSignals({ distanceMiles: 5.1 })]]),
    })
    expect(poolKinds(makeCandidate(), far)).not.toContain('DISTANCE')
  })

  it('AVAILABLE_SOON buckets the next opening into honest copy', () => {
    const label = (daysAhead: number) => {
      const ctx = makeContext({
        proSignals: new Map([
          [PRO_ID, makeSignals({ availability: makeAvailability(daysAhead) })],
        ]),
      })
      return evaluateBadgePool(makeCandidate(), ctx).find(
        (entry) => entry.kind === 'AVAILABLE_SOON',
      )?.label
    }

    expect(label(0)).toBe('Available today')
    expect(label(1)).toBe('Available tomorrow')
    expect(label(4)).toBe('Available in 4 days')
  })

  it('AVAILABLE_SOON stays silent beyond the horizon', () => {
    const far = makeContext({
      proSignals: new Map([
        [
          PRO_ID,
          makeSignals({
            availability: makeAvailability(
              LOOK_BADGE_THRESHOLDS.availableSoonMaxDays + 1,
            ),
          }),
        ],
      ]),
    })
    expect(poolKinds(makeCandidate(), far)).not.toContain('AVAILABLE_SOON')
  })

  it('BOOKING_OUT fires only when the calendar is filling past the bar', () => {
    const full = makeContext({
      proSignals: new Map([
        [PRO_ID, makeSignals({ availability: makeAvailability(3, 0.85) })],
      ]),
    })
    expect(
      evaluateBadgePool(makeCandidate(), full).find(
        (entry) => entry.kind === 'BOOKING_OUT',
      )?.label,
    ).toBe('Almost booked out')

    const open = makeContext({
      proSignals: new Map([
        [PRO_ID, makeSignals({ availability: makeAvailability(3, 0.5) })],
      ]),
    })
    expect(poolKinds(makeCandidate(), open)).not.toContain('BOOKING_OUT')
  })

  it('availability badges disqualify on a stale stat row (§5.7.4)', () => {
    const stale = makeContext({
      proSignals: new Map([
        [
          PRO_ID,
          makeSignals({
            availability: {
              nextOpeningDate: new Date(NOW.getTime() - HOUR_MS),
              fullness14d: 0.9,
              computedAt: new Date(
                NOW.getTime() - LOOK_BADGE_AVAILABILITY_STAT_MAX_AGE_MS - HOUR_MS,
              ),
            },
          }),
        ],
      ]),
    })
    const kinds = poolKinds(makeCandidate(), stale)
    expect(kinds).not.toContain('AVAILABLE_SOON')
    expect(kinds).not.toContain('BOOKING_OUT')
  })

  it('a look with no pro signals and no viewer context earns nothing', () => {
    const decision = selectLookBadge(makeCandidate(), makeContext())
    expect(decision).toEqual({ badge: null, eligible: false, holdout: false })
  })
})

describe('commitment-tier suppression (§5.3)', () => {
  const everythingQualifies = () =>
    makeContext({
      proSignals: new Map([
        [
          PRO_ID,
          makeSignals({
            recentBookingCount: 10,
            completedBookingCount30d: 20,
            servedClientCount: 10,
            rebookedClientCount: 9,
            distanceMiles: 2,
          }),
        ],
      ]),
      bookedLast7dByLookId: new Map([['look_1', 5]]),
      viewerEvents: [{ boardType: 'BRIDAL', eventYmd: '2026-08-23' }],
    })

  it('HIGH commitment suppresses urgency, trend, AND event pressure outright', () => {
    const candidate = makeCandidate({
      categorySlug: 'permanent-makeup',
      tagSlugs: ['bridal'],
    })
    const kinds = poolKinds(candidate, everythingQualifies())

    expect(kinds).not.toContain('BOOKING_FAST')
    expect(kinds).not.toContain('LOOK_BOOKED_RECENTLY')
    expect(kinds).not.toContain('EVENT_COUNTDOWN')
    // Trust and convenience survive — and trust outranks convenience.
    expect(kinds[0]).toBe('REBOOK_RATE')
    expect(kinds).toContain('DISTANCE')
  })

  it('LOW commitment leads with urgency', () => {
    const candidate = makeCandidate({ tagSlugs: ['bridal'] })
    const kinds = poolKinds(candidate, everythingQualifies())
    expect(kinds[0]).toBe('BOOKING_FAST')
  })

  it('HIGH commitment keeps AVAILABLE_SOON but suppresses the BOOKING_OUT scarcity', () => {
    const ctx = makeContext({
      proSignals: new Map([
        // Near opening AND a filling calendar → both availability badges earned.
        [PRO_ID, makeSignals({ availability: makeAvailability(2, 0.9) })],
      ]),
    })
    const candidate = makeCandidate({ categorySlug: 'permanent-makeup' })
    const kinds = poolKinds(candidate, ctx)
    expect(kinds).toContain('AVAILABLE_SOON')
    expect(kinds).not.toContain('BOOKING_OUT')
  })

  it('the §5.4 event override wins on non-HIGH tiers', () => {
    const candidate = makeCandidate({
      categorySlug: 'hair-color', // MEDIUM
      tagSlugs: ['bridal'],
    })
    const decision = selectLookBadge(candidate, everythingQualifies())
    expect(decision.badge?.kind).toBe('EVENT_COUNTDOWN')
    expect(decision.badge?.label).toBe('42 days until your wedding')
  })
})

describe('rotation (§5.5) and holdout (§9)', () => {
  const twoBadgeContext = () =>
    makeContext({
      proSignals: new Map([
        [
          PRO_ID,
          makeSignals({
            recentBookingCount: 10,
            completedBookingCount30d: 20,
          }),
        ],
      ]),
    })

  it('selection is deterministic for the same viewer, look, and day', () => {
    const candidate = makeCandidate()
    const first = selectLookBadge(candidate, twoBadgeContext())
    const second = selectLookBadge(candidate, twoBadgeContext())
    expect(first).toEqual(second)
  })

  it('rotates across the qualifying set over successive days', () => {
    // Pick a non-holdout viewer so a badge actually renders each day.
    let viewerKey = 'viewer_rotation'
    let suffix = 0
    while (isInBadgeHoldout(viewerKey, 'look_1')) {
      suffix += 1
      viewerKey = `viewer_rotation_${suffix}`
    }

    const seen = new Set<string>()
    for (let day = 0; day < 14; day += 1) {
      const ctx = makeContext({
        ...twoBadgeContext(),
        viewerKey,
        now: new Date(NOW.getTime() + day * DAY_MS),
        proSignals: new Map([
          [
            PRO_ID,
            makeSignals({
              recentBookingCount: 10,
              completedBookingCount30d: 20,
              statComputedAt: new Date(
                NOW.getTime() + day * DAY_MS - HOUR_MS,
              ),
            }),
          ],
        ]),
      })
      const decision = selectLookBadge(makeCandidate(), ctx)
      if (decision.badge) seen.add(decision.badge.kind)
    }

    expect(seen.has('BOOKING_FAST')).toBe(true)
    expect(seen.has('BOOKED_30D')).toBe(true)
  })

  it('the holdout is sticky per (viewer, look) and near the configured rate', () => {
    let holdouts = 0
    const samples = 2000
    for (let i = 0; i < samples; i += 1) {
      if (isInBadgeHoldout(`viewer_${i}`, 'look_1')) holdouts += 1
    }
    const rate = holdouts / samples
    expect(rate).toBeGreaterThan(LOOK_BADGE_HOLDOUT_RATE * 0.4)
    expect(rate).toBeLessThan(LOOK_BADGE_HOLDOUT_RATE * 2)

    // Determinism: same pair, same bucket.
    expect(isInBadgeHoldout('viewer_7', 'look_1')).toBe(
      isInBadgeHoldout('viewer_7', 'look_1'),
    )
  })

  it('a holdout exposure suppresses the earned badge but stays eligible', () => {
    let viewerKey = 'viewer_holdout'
    let suffix = 0
    while (!isInBadgeHoldout(viewerKey, 'look_1')) {
      suffix += 1
      viewerKey = `viewer_holdout_${suffix}`
    }

    const decision = selectLookBadge(
      makeCandidate(),
      makeContext({ ...twoBadgeContext(), viewerKey }),
    )
    expect(decision).toEqual({ badge: null, eligible: true, holdout: true })
  })

  it('anonymous viewers still get universal badges deterministically', () => {
    const ctx = makeContext({ ...twoBadgeContext(), viewerKey: 'anon' })
    const first = selectLookBadge(makeCandidate(), ctx)
    const second = selectLookBadge(makeCandidate(), ctx)
    expect(first).toEqual(second)
    expect(first.eligible).toBe(true)
  })
})
