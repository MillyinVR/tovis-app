import { describe, expect, it } from 'vitest'

import {
  REBOOK_CADENCE,
  allocateRebookCadences,
  buildRebookCadenceDedupeKey,
  composeRebookCadenceCopy,
  computeMeanCadenceDays,
  selectRebookCadenceCandidates,
  type CompletedVisitRow,
  type RebookCadenceCandidate,
} from './rebookCadenceNotifications'

const NOW = new Date('2026-07-15T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
const OPENING = new Date('2026-07-20T00:00:00.000Z')

/** A completed visit `daysAgo` before NOW, with an optional offering interval. */
function visit(overrides: {
  daysAgo: number
  clientId?: string
  professionalId?: string
  rebookIntervalDays?: number | null
}): CompletedVisitRow {
  return {
    clientId: overrides.clientId ?? 'client-1',
    professionalId: overrides.professionalId ?? 'pro-1',
    visitInstant: new Date(NOW.getTime() - overrides.daysAgo * DAY_MS),
    rebookIntervalDays: overrides.rebookIntervalDays ?? null,
  }
}

describe('computeMeanCadenceDays', () => {
  it('returns the mean consecutive gap in days (order-independent)', () => {
    const t0 = new Date('2026-01-01T00:00:00Z').getTime()
    const instants = [t0, t0 + 20 * DAY_MS, t0 + 40 * DAY_MS]
    expect(computeMeanCadenceDays(instants)).toBe(20)
    // Same result if unsorted.
    expect(computeMeanCadenceDays([instants[2]!, instants[0]!, instants[1]!])).toBe(20)
  })

  it('needs at least two visits', () => {
    expect(computeMeanCadenceDays([])).toBeNull()
    expect(computeMeanCadenceDays([123])).toBeNull()
  })
})

describe('buildRebookCadenceDedupeKey', () => {
  it('is stable within a cooldown window and rolls with the bucket', () => {
    const a = buildRebookCadenceDedupeKey({
      clientId: 'c',
      professionalId: 'p',
      now: NOW,
      cooldownDays: 30,
    })
    const sameWindow = buildRebookCadenceDedupeKey({
      clientId: 'c',
      professionalId: 'p',
      now: new Date(NOW.getTime() + 5 * DAY_MS),
      cooldownDays: 30,
    })
    const nextWindow = buildRebookCadenceDedupeKey({
      clientId: 'c',
      professionalId: 'p',
      now: new Date(NOW.getTime() + 40 * DAY_MS),
      cooldownDays: 30,
    })
    expect(a).toContain('rebook-cadence:c:p:')
    expect(sameWindow).toBe(a)
    expect(nextWindow).not.toBe(a)
  })
})

describe('selectRebookCadenceCandidates', () => {
  const openingByPro = new Map([['pro-1', OPENING]])
  const base = {
    openingByPro,
    upcomingPairs: new Set<string>(),
    alreadyNotifiedDedupeKeys: new Set<string>(),
    now: NOW,
  }

  it('produces a due candidate from a learned cadence', () => {
    // Two visits 20 days apart; last visit 25 days ago → cadence 20, due (25 ≥ 20).
    const candidates = selectRebookCadenceCandidates({
      ...base,
      visits: [visit({ daysAgo: 45 }), visit({ daysAgo: 25 })],
    })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.cadenceSource).toBe('learned')
    expect(candidates[0]?.cadenceDays).toBe(20)
    expect(candidates[0]?.daysSinceLastVisit).toBe(25)
    expect(candidates[0]?.nextOpeningDate).toEqual(OPENING)
    expect(candidates[0]?.trigger).toBe('REBOOK_CADENCE')
  })

  it('falls back to the offering interval for a single-visit pair', () => {
    // One visit 35 days ago, offering rebook interval 30 → due via offering.
    const candidates = selectRebookCadenceCandidates({
      ...base,
      visits: [visit({ daysAgo: 35, rebookIntervalDays: 30 })],
    })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.cadenceSource).toBe('offering')
    expect(candidates[0]?.cadenceDays).toBe(30)
  })

  it('skips a pair with no cadence signal (single visit, no offering interval)', () => {
    const candidates = selectRebookCadenceCandidates({
      ...base,
      visits: [visit({ daysAgo: 200 })],
    })
    expect(candidates).toHaveLength(0)
  })

  it('skips a pair that is not due yet', () => {
    // Cadence 20, last visit only 10 days ago → below cadence, not due.
    const candidates = selectRebookCadenceCandidates({
      ...base,
      visits: [visit({ daysAgo: 30 }), visit({ daysAgo: 10 })],
    })
    expect(candidates).toHaveLength(0)
  })

  it('skips a churned pair past maxOverdueMultiple × cadence', () => {
    // Cadence 20, last visit 70 days ago → 70 > 60 (20 × 3) → churned.
    const candidates = selectRebookCadenceCandidates({
      ...base,
      visits: [visit({ daysAgo: 90 }), visit({ daysAgo: 70 })],
    })
    expect(candidates).toHaveLength(0)
  })

  it('floors a very short learned cadence at minCadenceDays', () => {
    // Two visits 2 days apart; last visit 8 days ago. Without the floor cadence
    // would be 2 (→ churned at 8 > 6); floored to 7 it is due (8 ≥ 7, ≤ 21).
    const candidates = selectRebookCadenceCandidates({
      ...base,
      visits: [visit({ daysAgo: 10 }), visit({ daysAgo: 8 })],
    })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.cadenceDays).toBe(REBOOK_CADENCE.minCadenceDays)
  })

  it('requires the pro to have a near-term opening', () => {
    const candidates = selectRebookCadenceCandidates({
      ...base,
      visits: [
        visit({ daysAgo: 45, professionalId: 'pro-closed' }),
        visit({ daysAgo: 25, professionalId: 'pro-closed' }),
      ],
    })
    expect(candidates).toHaveLength(0)
  })

  it('excludes pairs with an upcoming booking', () => {
    const candidates = selectRebookCadenceCandidates({
      ...base,
      upcomingPairs: new Set(['client-1::pro-1']),
      visits: [visit({ daysAgo: 45 }), visit({ daysAgo: 25 })],
    })
    expect(candidates).toHaveLength(0)
  })

  it('excludes pairs already nudged this cooldown window', () => {
    const dedupeKey = buildRebookCadenceDedupeKey({
      clientId: 'client-1',
      professionalId: 'pro-1',
      now: NOW,
    })
    const candidates = selectRebookCadenceCandidates({
      ...base,
      alreadyNotifiedDedupeKeys: new Set([dedupeKey]),
      visits: [visit({ daysAgo: 45 }), visit({ daysAgo: 25 })],
    })
    expect(candidates).toHaveLength(0)
  })
})

describe('allocateRebookCadences', () => {
  function candidate(
    clientId: string,
    professionalId: string,
    daysSinceLastVisit: number,
    cadenceDays: number,
  ): RebookCadenceCandidate {
    return {
      clientId,
      professionalId,
      lastVisitAt: new Date(NOW.getTime() - daysSinceLastVisit * DAY_MS),
      daysSinceLastVisit,
      cadenceDays,
      cadenceSource: 'learned',
      nextOpeningDate: OPENING,
      dedupeKey: `dk-${clientId}-${professionalId}`,
      trigger: 'REBOOK_CADENCE',
    }
  }

  it('caps per client by the pooled weekly budget, most-overdue first', () => {
    const result = allocateRebookCadences({
      candidates: [
        candidate('c1', 'pA', 30, 28), // overdue 2
        candidate('c1', 'pB', 60, 20), // overdue 40 (most)
        candidate('c1', 'pC', 35, 30), // overdue 5
        candidate('c1', 'pD', 40, 38), // overdue 2
      ],
      sentCountByClient: new Map(),
      mutedClients: new Set(),
      cap: 3,
    })
    expect(result.granted).toHaveLength(3)
    expect(result.granted[0]?.professionalId).toBe('pB')
    expect(result.budgetBlocked).toBe(1)
  })

  it('accounts for sends already made in the window', () => {
    const result = allocateRebookCadences({
      candidates: [
        candidate('c1', 'pA', 40, 20),
        candidate('c1', 'pB', 30, 20),
      ],
      sentCountByClient: new Map([['c1', 2]]),
      mutedClients: new Set(),
      cap: 3,
    })
    expect(result.granted).toHaveLength(1)
    expect(result.budgetBlocked).toBe(1)
  })

  it('drops muted recipients before spending budget and counts opt-outs', () => {
    const result = allocateRebookCadences({
      candidates: [
        candidate('c-muted', 'pA', 40, 20),
        candidate('c-ok', 'pB', 40, 20),
      ],
      sentCountByClient: new Map(),
      mutedClients: new Set(['c-muted']),
      cap: 3,
    })
    expect(result.granted.map((c) => c.clientId)).toEqual(['c-ok'])
    expect(result.mutedOptOut).toBe(1)
    expect(result.budgetBlocked).toBe(0)
  })
})

describe('composeRebookCadenceCopy', () => {
  it('is white-label safe, non-urgent, and carries trigger data', () => {
    const copy = composeRebookCadenceCopy({
      proName: 'Glow Studio',
      candidate: { professionalId: 'pro-9', nextOpeningDate: OPENING },
    })
    expect(copy.title).toBe('Time for a refresh with Glow Studio?')
    expect(copy.body).toContain('Glow Studio')
    expect(copy.body).not.toMatch(/hurry|now|last chance|reopened/i)
    expect(copy.href).toBe('/professionals/pro-9')
    expect(copy.data.trigger).toBe('REBOOK_CADENCE')
    expect(copy.data.professionalId).toBe('pro-9')
    expect(copy.data.nextOpeningDate).toBe(OPENING.toISOString())
  })

  it('falls back gracefully when the pro name is empty', () => {
    const copy = composeRebookCadenceCopy({
      proName: '   ',
      candidate: { professionalId: 'pro-9', nextOpeningDate: OPENING },
    })
    expect(copy.title).toBe('Time for a refresh with your pro?')
  })
})
