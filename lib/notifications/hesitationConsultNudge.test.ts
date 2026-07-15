// lib/notifications/hesitationConsultNudge.test.ts
//
// Pure-core coverage for the §6.8 hesitation-consult trigger: candidate selection
// (consult-worthy gate, one-per-pair freshest-hook, exclusions), per-client budget
// allocation (mute + pooled cap + freshest-first order), the copy contract, and the
// cooldown-bucketed dedupeKey.

import { describe, expect, it } from 'vitest'

import {
  HESITATION_CONSULT,
  HESITATION_CONSULT_TRIGGER,
  allocateConsultNudges,
  buildConsultNudgeDedupeKey,
  composeConsultNudgeCopy,
  selectConsultNudgeCandidates,
  type ConsultNudgeCandidate,
  type ConsultSaveRow,
} from './hesitationConsultNudge'

const NOW = new Date('2026-07-15T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * DAY_MS)
}

function save(overrides: Partial<ConsultSaveRow> = {}): ConsultSaveRow {
  return {
    clientId: 'client-1',
    professionalId: 'pro-1',
    lookPostId: 'look-1',
    savedAt: daysAgo(10),
    categorySlug: 'permanent-makeup', // HIGH — consult-worthy
    ...overrides,
  }
}

describe('buildConsultNudgeDedupeKey', () => {
  it('is stable inside a cooldown window and rolls to a new bucket after it', () => {
    // Buckets are floor(epochMs / cooldown) — aligned to the epoch, not to NOW —
    // so build times relative to the bucket start to test stability deterministically.
    const cooldownMs = HESITATION_CONSULT.cooldownDays * DAY_MS
    const bucketStart = Math.floor(NOW.getTime() / cooldownMs) * cooldownMs

    const key = (offsetMs: number) =>
      buildConsultNudgeDedupeKey({
        clientId: 'c',
        professionalId: 'p',
        now: new Date(bucketStart + offsetMs),
      })

    const early = key(1000)
    const late = key(cooldownMs - 1000)
    const nextWindow = key(cooldownMs)

    expect(early).toContain('saved-consult:c:p:')
    expect(late).toBe(early) // same window → same key
    expect(nextWindow).not.toBe(early) // rolled to the next window
  })
})

describe('selectConsultNudgeCandidates', () => {
  it('produces one candidate per (client, pro) — the freshest consult-worthy save', () => {
    const candidates = selectConsultNudgeCandidates({
      saves: [
        save({ lookPostId: 'older', savedAt: daysAgo(30) }),
        save({ lookPostId: 'newest', savedAt: daysAgo(6) }),
      ],
      bookedPairs: new Set(),
      alreadyNotifiedDedupeKeys: new Set(),
      now: NOW,
    })

    expect(candidates).toHaveLength(1)
    expect(candidates[0]!.lookPostId).toBe('newest')
    expect(candidates[0]!.commitmentTier).toBe('HIGH')
    expect(candidates[0]!.trigger).toBe(HESITATION_CONSULT_TRIGGER)
  })

  it('accepts MEDIUM categories and rejects LOW / uncategorized', () => {
    const candidates = selectConsultNudgeCandidates({
      saves: [
        save({ clientId: 'c-med', professionalId: 'p-med', categorySlug: 'hair-color' }), // MEDIUM ✓
        save({ clientId: 'c-low', professionalId: 'p-low', categorySlug: 'haircut' }), // LOW ✗
        save({ clientId: 'c-unk', professionalId: 'p-unk', categorySlug: 'mystery' }), // unknown ✗
        save({ clientId: 'c-nul', professionalId: 'p-nul', categorySlug: null }), // uncategorized ✗
      ],
      bookedPairs: new Set(),
      alreadyNotifiedDedupeKeys: new Set(),
      now: NOW,
    })

    expect(candidates.map((c) => c.clientId)).toEqual(['c-med'])
    expect(candidates[0]!.commitmentTier).toBe('MEDIUM')
  })

  it('excludes pairs that already booked the pro', () => {
    const candidates = selectConsultNudgeCandidates({
      saves: [save()],
      bookedPairs: new Set(['client-1::pro-1']),
      alreadyNotifiedDedupeKeys: new Set(),
      now: NOW,
    })
    expect(candidates).toHaveLength(0)
  })

  it('excludes pairs already nudged this cooldown window', () => {
    const dedupeKey = buildConsultNudgeDedupeKey({
      clientId: 'client-1',
      professionalId: 'pro-1',
      now: NOW,
    })
    const candidates = selectConsultNudgeCandidates({
      saves: [save()],
      bookedPairs: new Set(),
      alreadyNotifiedDedupeKeys: new Set([dedupeKey]),
      now: NOW,
    })
    expect(candidates).toHaveLength(0)
  })
})

describe('allocateConsultNudges', () => {
  const mk = (
    clientId: string,
    savedAt: Date,
    overrides: Partial<ConsultNudgeCandidate> = {},
  ): ConsultNudgeCandidate => ({
    clientId,
    professionalId: `pro-${clientId}`,
    lookPostId: `look-${clientId}-${savedAt.getTime()}`,
    savedAt,
    categorySlug: 'permanent-makeup',
    commitmentTier: 'HIGH',
    dedupeKey: `saved-consult:${clientId}:pro:${savedAt.getTime()}`,
    trigger: HESITATION_CONSULT_TRIGGER,
    ...overrides,
  })

  it('drops muted recipients as opt-out (before spending budget)', () => {
    const result = allocateConsultNudges({
      candidates: [mk('c1', daysAgo(10))],
      sentCountByClient: new Map(),
      mutedClients: new Set(['c1']),
    })
    expect(result.granted).toHaveLength(0)
    expect(result.mutedOptOut).toBe(1)
    expect(result.budgetBlocked).toBe(0)
  })

  it('prefers the freshest save when a client is over budget', () => {
    const result = allocateConsultNudges({
      candidates: [
        mk('c1', daysAgo(40), { professionalId: 'pro-old', dedupeKey: 'old' }),
        mk('c1', daysAgo(6), { professionalId: 'pro-new', dedupeKey: 'new' }),
      ],
      sentCountByClient: new Map(),
      mutedClients: new Set(),
      cap: 1,
    })
    expect(result.granted).toHaveLength(1)
    expect(result.granted[0]!.dedupeKey).toBe('new')
    expect(result.budgetBlocked).toBe(1)
  })

  it('respects the pooled weekly count already spent this window', () => {
    const result = allocateConsultNudges({
      candidates: [mk('c1', daysAgo(10))],
      sentCountByClient: new Map([['c1', 3]]),
      mutedClients: new Set(),
      cap: 3,
    })
    expect(result.granted).toHaveLength(0)
    expect(result.budgetBlocked).toBe(1)
  })
})

describe('composeConsultNudgeCopy', () => {
  it('is information-first, non-urgent, and links to the pro profile', () => {
    const copy = composeConsultNudgeCopy({
      proName: 'Ava Ink',
      candidate: {
        lookPostId: 'look-1',
        professionalId: 'pro-1',
        commitmentTier: 'HIGH',
      },
    })

    expect(copy.title).toBe('Have questions for Ava Ink?')
    expect(copy.body).toContain('no rush')
    expect(copy.body).toContain('consult')
    // Never urgency / scarcity language.
    expect(copy.body.toLowerCase()).not.toMatch(/hurry|last chance|now|cheaper|book now/)
    expect(copy.href).toBe('/professionals/pro-1')
    expect(copy.data.trigger).toBe(HESITATION_CONSULT_TRIGGER)
    expect(copy.data.commitmentTier).toBe('HIGH')
  })

  it('falls back to a generic pro label when the name is blank', () => {
    const copy = composeConsultNudgeCopy({
      proName: '   ',
      candidate: {
        lookPostId: 'look-1',
        professionalId: 'pro-1',
        commitmentTier: 'MEDIUM',
      },
    })
    expect(copy.title).toBe('Have questions for a pro you saved?')
  })
})
