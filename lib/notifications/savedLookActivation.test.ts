import { describe, expect, it } from 'vitest'

import {
  allocateSavedActivations,
  buildSavedActivationDedupeKey,
  composeSavedActivationCopy,
  selectSavedActivationCandidates,
  type AgingSaveRow,
  type SavedActivationCandidate,
} from './savedLookActivation'

const NOW = new Date('2026-07-15T12:00:00.000Z')

function save(overrides: Partial<AgingSaveRow>): AgingSaveRow {
  return {
    clientId: 'client-1',
    professionalId: 'pro-1',
    lookPostId: 'look-1',
    savedAt: new Date('2026-07-01T00:00:00.000Z'),
    ...overrides,
  }
}

const OPENING = new Date('2026-07-18T00:00:00.000Z')

describe('buildSavedActivationDedupeKey', () => {
  it('is stable within a cooldown window and rolls with the bucket', () => {
    const a = buildSavedActivationDedupeKey({
      clientId: 'c',
      professionalId: 'p',
      now: NOW,
      cooldownDays: 30,
    })
    const sameWindow = buildSavedActivationDedupeKey({
      clientId: 'c',
      professionalId: 'p',
      now: new Date(NOW.getTime() + 5 * 24 * 60 * 60 * 1000),
      cooldownDays: 30,
    })
    const nextWindow = buildSavedActivationDedupeKey({
      clientId: 'c',
      professionalId: 'p',
      now: new Date(NOW.getTime() + 40 * 24 * 60 * 60 * 1000),
      cooldownDays: 30,
    })
    expect(a).toContain('saved-activation:c:p:')
    expect(sameWindow).toBe(a)
    expect(nextWindow).not.toBe(a)
  })
})

describe('selectSavedActivationCandidates', () => {
  const openingByPro = new Map([['pro-1', OPENING]])

  it('produces one candidate per (client, pro) using the most recent save', () => {
    const candidates = selectSavedActivationCandidates({
      saves: [
        save({ lookPostId: 'old', savedAt: new Date('2026-07-01T00:00:00Z') }),
        save({ lookPostId: 'new', savedAt: new Date('2026-07-05T00:00:00Z') }),
      ],
      openingByPro,
      bookedPairs: new Set(),
      alreadyNotifiedDedupeKeys: new Set(),
      now: NOW,
    })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.lookPostId).toBe('new')
    expect(candidates[0]?.nextOpeningDate).toEqual(OPENING)
    expect(candidates[0]?.trigger).toBe('AVAILABILITY_OPENED_ON_SAVE')
  })

  it('drops pros without a near-term opening', () => {
    const candidates = selectSavedActivationCandidates({
      saves: [save({ professionalId: 'pro-closed' })],
      openingByPro,
      bookedPairs: new Set(),
      alreadyNotifiedDedupeKeys: new Set(),
      now: NOW,
    })
    expect(candidates).toHaveLength(0)
  })

  it('excludes pairs the client already booked', () => {
    const candidates = selectSavedActivationCandidates({
      saves: [save({})],
      openingByPro,
      bookedPairs: new Set(['client-1::pro-1']),
      alreadyNotifiedDedupeKeys: new Set(),
      now: NOW,
    })
    expect(candidates).toHaveLength(0)
  })

  it('excludes pairs already nudged this cooldown window', () => {
    const dedupeKey = buildSavedActivationDedupeKey({
      clientId: 'client-1',
      professionalId: 'pro-1',
      now: NOW,
    })
    const candidates = selectSavedActivationCandidates({
      saves: [save({})],
      openingByPro,
      bookedPairs: new Set(),
      alreadyNotifiedDedupeKeys: new Set([dedupeKey]),
      now: NOW,
    })
    expect(candidates).toHaveLength(0)
  })
})

describe('allocateSavedActivations', () => {
  function candidate(
    clientId: string,
    professionalId: string,
    opening: Date,
  ): SavedActivationCandidate {
    return {
      clientId,
      professionalId,
      lookPostId: `look-${professionalId}`,
      savedAt: new Date('2026-07-01T00:00:00Z'),
      nextOpeningDate: opening,
      dedupeKey: `dk-${clientId}-${professionalId}`,
      trigger: 'AVAILABILITY_OPENED_ON_SAVE',
    }
  }

  it('caps per client by the pooled weekly budget, soonest-opening first', () => {
    const soon = new Date('2026-07-16T00:00:00Z')
    const later = new Date('2026-07-20T00:00:00Z')
    const result = allocateSavedActivations({
      candidates: [
        candidate('c1', 'pA', later),
        candidate('c1', 'pB', soon),
        candidate('c1', 'pC', later),
        candidate('c1', 'pD', later),
      ],
      sentCountByClient: new Map(),
      mutedClients: new Set(),
      cap: 3,
    })
    // 4 candidates, cap 3 → 3 granted, soonest (pB) first, 1 blocked.
    expect(result.granted).toHaveLength(3)
    expect(result.granted[0]?.professionalId).toBe('pB')
    expect(result.budgetBlocked).toBe(1)
  })

  it('accounts for sends already made in the window', () => {
    const result = allocateSavedActivations({
      candidates: [
        candidate('c1', 'pA', new Date('2026-07-16T00:00:00Z')),
        candidate('c1', 'pB', new Date('2026-07-17T00:00:00Z')),
      ],
      sentCountByClient: new Map([['c1', 2]]),
      mutedClients: new Set(),
      cap: 3,
    })
    expect(result.granted).toHaveLength(1)
    expect(result.budgetBlocked).toBe(1)
  })

  it('drops muted recipients before spending budget and counts opt-outs', () => {
    const result = allocateSavedActivations({
      candidates: [
        candidate('c-muted', 'pA', new Date('2026-07-16T00:00:00Z')),
        candidate('c-ok', 'pB', new Date('2026-07-16T00:00:00Z')),
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

describe('composeSavedActivationCopy', () => {
  it('is white-label safe, non-urgent, and carries trigger data', () => {
    const copy = composeSavedActivationCopy({
      proName: 'Glow Studio',
      candidate: {
        lookPostId: 'look-9',
        professionalId: 'pro-9',
        nextOpeningDate: OPENING,
      },
    })
    expect(copy.title).toBe('Glow Studio has an opening')
    expect(copy.body).toContain('Glow Studio')
    expect(copy.body).not.toMatch(/hurry|now|last chance|reopened/i)
    expect(copy.href).toBe('/looks/look-9')
    expect(copy.data.trigger).toBe('AVAILABILITY_OPENED_ON_SAVE')
    expect(copy.data.professionalId).toBe('pro-9')
    expect(copy.data.nextOpeningDate).toBe(OPENING.toISOString())
  })

  it('falls back gracefully when the pro name is empty', () => {
    const copy = composeSavedActivationCopy({
      proName: '   ',
      candidate: {
        lookPostId: 'look-9',
        professionalId: 'pro-9',
        nextOpeningDate: OPENING,
      },
    })
    expect(copy.title).toBe('A pro you saved has an opening')
  })
})
