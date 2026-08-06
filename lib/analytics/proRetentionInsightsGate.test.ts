// The entitlement gate on the paid retention surface, proved in isolation.
//
// Separate from proRetentionInsights.test.ts (which covers the pure maths with no
// mocks) because this file has to mock the module's whole dependency surface to
// assert the ORDER of the gate — specifically that a non-entitled pro's dashboard
// never reaches the database.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enforcementEnabled: vi.fn(),
  hasEntitlement: vi.fn(),
  findManyAnalytics: vi.fn(),
  findManyClients: vi.fn(),
}))

vi.mock('@/lib/membership/enforcement', () => ({
  membershipEnforcementEnabled: mocks.enforcementEnabled,
}))
vi.mock('@/lib/pro/entitlements', () => ({
  hasEntitlement: mocks.hasEntitlement,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    professionalMonthlyAnalytics: { findMany: mocks.findManyAnalytics },
    clientProfile: { findMany: mocks.findManyClients },
  },
}))

import { proClientVisibilityWhere } from '@/lib/clientVisibility'

import { loadProRetentionInsights } from './proRetentionInsights'

const NOW = new Date('2026-08-04T17:00:00Z')

const ARGS = {
  professionalId: 'pro-1',
  professionalTimeZone: 'America/Los_Angeles',
  now: NOW,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.findManyAnalytics.mockResolvedValue([])
  mocks.findManyClients.mockResolvedValue([])
})

describe('loadProRetentionInsights gate', () => {
  it('locks a non-entitled pro once enforcement is on', async () => {
    mocks.enforcementEnabled.mockReturnValue(true)
    mocks.hasEntitlement.mockResolvedValue(false)

    expect(await loadProRetentionInsights(ARGS)).toEqual({ state: 'locked' })
  })

  // 🔴 The gate must short-circuit, not just hide the output. A free pro's
  // dashboard render must not pay for a roster scan whose result is discarded.
  it('does not touch the database when locked', async () => {
    mocks.enforcementEnabled.mockReturnValue(true)
    mocks.hasEntitlement.mockResolvedValue(false)

    await loadProRetentionInsights(ARGS)

    expect(mocks.findManyAnalytics).not.toHaveBeenCalled()
    expect(mocks.findManyClients).not.toHaveBeenCalled()
  })

  it('serves an entitled pro', async () => {
    mocks.enforcementEnabled.mockReturnValue(true)
    mocks.hasEntitlement.mockResolvedValue(true)

    const result = await loadProRetentionInsights(ARGS)

    expect(result.state).not.toBe('locked')
    expect(mocks.findManyAnalytics).toHaveBeenCalledTimes(1)
  })

  // 🔴 Today's production state. ENABLE_MEMBERSHIP_ENFORCEMENT is off, so every
  // pro sees the section and the entitlement is never even consulted — the same
  // shape as the tax-export gate, so this goes live WITH the flag rather than
  // needing a second decision at flip time.
  it('serves everyone while enforcement is off, without an entitlement lookup', async () => {
    mocks.enforcementEnabled.mockReturnValue(false)

    const result = await loadProRetentionInsights(ARGS)

    expect(result.state).not.toBe('locked')
    expect(mocks.hasEntitlement).not.toHaveBeenCalled()
  })

  // An entitled pro with no history must read as "nothing yet", never as a wall
  // of confident zeroes that says their retention is 0%.
  it('reports empty rather than zeroes when there is no history', async () => {
    mocks.enforcementEnabled.mockReturnValue(false)

    const result = await loadProRetentionInsights(ARGS)

    expect(result.state).toBe('empty')
  })

  // 🔴 The link contract behind ProRetentionSection. Every client this section
  // names is rendered as an unconditional `/pro/clients/[id]` link, with no
  // public-profile fallback — correct ONLY while the roster is scoped by the
  // very predicate the page gate re-runs (getProClientVisibility). Widen this
  // where-clause and the "slipping away" bucket, whose whole population is
  // clients drifting past their usual gap, starts linking to a refusal.
  it('scopes the roster to clients the page gate would still admit', async () => {
    mocks.enforcementEnabled.mockReturnValue(false)

    await loadProRetentionInsights(ARGS)

    const where = mocks.findManyClients.mock.calls[0]?.[0]?.where
    expect(where?.bookings?.some).toEqual({
      professionalId: 'pro-1',
      ...proClientVisibilityWhere(NOW),
    })
  })

  it('reads exactly the six months ending at the current month, in the pro zone', async () => {
    mocks.enforcementEnabled.mockReturnValue(false)

    await loadProRetentionInsights(ARGS)

    const where = mocks.findManyAnalytics.mock.calls[0]?.[0]?.where
    expect(where?.professionalId).toBe('pro-1')
    expect(where?.monthKey?.in).toEqual([
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
    ])
  })
})
