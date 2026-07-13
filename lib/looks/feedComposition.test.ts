// lib/looks/feedComposition.test.ts
import { describe, expect, it } from 'vitest'

import {
  EXPLORATION_MIN_AFFINITY_CATEGORIES,
  EXPLORATION_SLOTS_CAP,
  SESSION_INTENT_PROFILES,
  interleaveExploration,
  parseSessionIntent,
  resolveCompositionPlan,
  type SessionIntent,
} from './feedComposition'

describe('lib/looks/feedComposition', () => {
  describe('parseSessionIntent', () => {
    it('maps the book synonyms', () => {
      for (const raw of ['book', 'Booking', ' BOOKABLE ']) {
        expect(parseSessionIntent(raw)).toBe('book')
      }
    })

    it('maps the dream synonyms', () => {
      for (const raw of ['dream', 'inspire', 'INSPIRATION']) {
        expect(parseSessionIntent(raw)).toBe('dream')
      }
    })

    it('defaults unknown / empty / null to default', () => {
      for (const raw of ['', '   ', 'nonsense', null, undefined]) {
        expect(parseSessionIntent(raw)).toBe('default')
      }
    })
  })

  describe('resolveCompositionPlan', () => {
    const confident = EXPLORATION_MIN_AFFINITY_CATEGORIES

    it('passes the intent multiplier straight through', () => {
      for (const intent of ['default', 'book', 'dream'] as SessionIntent[]) {
        const plan = resolveCompositionPlan({
          intent,
          limit: 12,
          affinityCategoryCount: confident,
          diversityEnabled: true,
          isEntryLoad: true,
        })
        expect(plan.availabilityWeightMultiplier).toBe(
          SESSION_INTENT_PROFILES[intent].availabilityWeightMultiplier,
        )
        expect(plan.intent).toBe(intent)
      }
    })

    it('reserves round(limit × share) slots for a confident graph on entry', () => {
      const plan = resolveCompositionPlan({
        intent: 'default',
        limit: 12,
        affinityCategoryCount: confident,
        diversityEnabled: true,
        isEntryLoad: true,
      })
      // 12 × 0.12 = 1.44 → 1
      expect(plan.explorationSlots).toBe(1)
    })

    it('reserves zero slots when the flag is off', () => {
      const plan = resolveCompositionPlan({
        intent: 'dream',
        limit: 20,
        affinityCategoryCount: confident + 5,
        diversityEnabled: false,
        isEntryLoad: true,
      })
      expect(plan.explorationSlots).toBe(0)
    })

    it('reserves zero slots for a thin graph (below the confidence gate)', () => {
      const plan = resolveCompositionPlan({
        intent: 'default',
        limit: 12,
        affinityCategoryCount: confident - 1,
        diversityEnabled: true,
        isEntryLoad: true,
      })
      expect(plan.explorationSlots).toBe(0)
    })

    it('reserves zero slots on a non-entry (paginated) load', () => {
      const plan = resolveCompositionPlan({
        intent: 'default',
        limit: 12,
        affinityCategoryCount: confident + 3,
        diversityEnabled: true,
        isEntryLoad: false,
      })
      expect(plan.explorationSlots).toBe(0)
    })

    it('caps exploration slots regardless of page size', () => {
      const plan = resolveCompositionPlan({
        intent: 'dream',
        limit: 200,
        affinityCategoryCount: confident,
        diversityEnabled: true,
        isEntryLoad: true,
      })
      expect(plan.explorationSlots).toBe(EXPLORATION_SLOTS_CAP)
    })

    it('never returns negative slots for a degenerate limit', () => {
      const plan = resolveCompositionPlan({
        intent: 'default',
        limit: Number.NaN,
        affinityCategoryCount: confident,
        diversityEnabled: true,
        isEntryLoad: true,
      })
      expect(plan.explorationSlots).toBe(0)
    })
  })

  describe('interleaveExploration', () => {
    const P = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5']

    it('returns a copy of the personalized order when there is nothing to inject', () => {
      const out = interleaveExploration(P, [], 2)
      expect(out).toEqual(P)
      expect(out).not.toBe(P)
    })

    it('returns a copy when slots is 0 even if exploration is available', () => {
      expect(interleaveExploration(P, ['e0'], 0)).toEqual(P)
    })

    it('keeps every personalized item in order and adds the exploration items', () => {
      const out = interleaveExploration(P, ['e0', 'e1'], 2)
      expect(out).toHaveLength(P.length + 2)
      // Personalized items preserve their relative order.
      expect(out.filter((x) => x.startsWith('p'))).toEqual(P)
      // Both exploration items are present, none duplicated.
      expect(out.filter((x) => x === 'e0')).toHaveLength(1)
      expect(out.filter((x) => x === 'e1')).toHaveLength(1)
    })

    it('places a single exploration item mid-page, not at an edge', () => {
      const out = interleaveExploration(P, ['e0'], 1)
      const idx = out.indexOf('e0')
      expect(idx).toBeGreaterThan(0)
      expect(idx).toBeLessThan(out.length - 1)
    })

    it('is bounded by the exploration array length, not the requested slots', () => {
      const out = interleaveExploration(P, ['e0'], 5)
      expect(out.filter((x) => x === 'e0')).toHaveLength(1)
      expect(out).toHaveLength(P.length + 1)
    })

    it('makes exploration the page when there are no personalized items', () => {
      expect(interleaveExploration([], ['e0', 'e1'], 2)).toEqual(['e0', 'e1'])
    })

    it('does not mutate its inputs', () => {
      const p = [...P]
      const e = ['e0', 'e1']
      interleaveExploration(p, e, 2)
      expect(p).toEqual(P)
      expect(e).toEqual(['e0', 'e1'])
    })
  })
})
