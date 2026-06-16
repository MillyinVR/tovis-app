import { describe, expect, it } from 'vitest'
import {
  LastMinuteTier,
  LastMinuteVisibilityMode,
} from '@prisma/client'

import { pickPublicTierPlan, pickRecipientTierPlan } from './pickTierPlan'

type Plan = { tier: LastMinuteTier; scheduledFor: Date; label: string }

function plan(tier: LastMinuteTier, iso: string, label: string): Plan {
  return { tier, scheduledFor: new Date(iso), label }
}

const WAITLIST = plan(LastMinuteTier.WAITLIST, '2030-01-01T00:00:00.000Z', 'wl')
const REACT = plan(LastMinuteTier.REACTIVATION, '2030-01-01T12:00:00.000Z', 're')
const DISCOVERY = plan(LastMinuteTier.DISCOVERY, '2030-01-02T00:00:00.000Z', 'di')

describe('pickRecipientTierPlan', () => {
  const tierPlans = [WAITLIST, REACT, DISCOVERY]

  it('uses notifiedTier when present', () => {
    const result = pickRecipientTierPlan({
      notifiedTier: LastMinuteTier.REACTIVATION,
      firstMatchedTier: LastMinuteTier.WAITLIST,
      tierPlans,
    })
    expect(result?.label).toBe('re')
  })

  it('falls back to firstMatchedTier when notifiedTier is null', () => {
    const result = pickRecipientTierPlan({
      notifiedTier: null,
      firstMatchedTier: LastMinuteTier.WAITLIST,
      tierPlans,
    })
    expect(result?.label).toBe('wl')
  })

  it('returns null when no plan matches the tier', () => {
    const result = pickRecipientTierPlan({
      notifiedTier: LastMinuteTier.DISCOVERY,
      firstMatchedTier: LastMinuteTier.DISCOVERY,
      tierPlans: [WAITLIST, REACT],
    })
    expect(result).toBeNull()
  })
})

describe('pickPublicTierPlan', () => {
  const now = new Date('2030-01-01T18:00:00.000Z')

  it('PUBLIC_AT_DISCOVERY → the DISCOVERY plan', () => {
    const result = pickPublicTierPlan(
      {
        visibilityMode: LastMinuteVisibilityMode.PUBLIC_AT_DISCOVERY,
        tierPlans: [WAITLIST, REACT, DISCOVERY],
      },
      now,
    )
    expect(result?.label).toBe('di')
  })

  it('PUBLIC_IMMEDIATE → latest plan already started by now', () => {
    // WAITLIST (00:00) and REACT (12:00) have started by 18:00; DISCOVERY (next day) has not.
    const result = pickPublicTierPlan(
      {
        visibilityMode: LastMinuteVisibilityMode.PUBLIC_IMMEDIATE,
        tierPlans: [WAITLIST, REACT, DISCOVERY],
      },
      now,
    )
    expect(result?.label).toBe('re')
  })

  it('PUBLIC_IMMEDIATE with none started → the first plan', () => {
    const result = pickPublicTierPlan(
      {
        visibilityMode: LastMinuteVisibilityMode.PUBLIC_IMMEDIATE,
        tierPlans: [REACT, DISCOVERY],
      },
      new Date('2030-01-01T00:00:00.000Z'),
    )
    expect(result?.label).toBe('re')
  })

  it('TARGETED_ONLY → null (no public incentive)', () => {
    const result = pickPublicTierPlan(
      {
        visibilityMode: LastMinuteVisibilityMode.TARGETED_ONLY,
        tierPlans: [WAITLIST, DISCOVERY],
      },
      now,
    )
    expect(result).toBeNull()
  })

  it('empty plans → null', () => {
    const result = pickPublicTierPlan(
      {
        visibilityMode: LastMinuteVisibilityMode.PUBLIC_AT_DISCOVERY,
        tierPlans: [],
      },
      now,
    )
    expect(result).toBeNull()
  })
})
