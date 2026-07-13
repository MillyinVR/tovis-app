// lib/looks/relationshipSignals.test.ts
import { describe, expect, it } from 'vitest'

import { aggregateRelationshipSignals } from './relationshipSignals'

const A = new Date('2026-05-01T12:00:00.000Z')
const B = new Date('2026-06-20T12:00:00.000Z')
const C = new Date('2026-07-01T12:00:00.000Z')

describe('lib/looks/relationshipSignals', () => {
  describe('aggregateRelationshipSignals', () => {
    it('counts completed visits per pro and keeps the latest instant', () => {
      const map = aggregateRelationshipSignals([
        { professionalId: 'pro_a', scheduledFor: A, finishedAt: null },
        { professionalId: 'pro_a', scheduledFor: C, finishedAt: null },
        { professionalId: 'pro_a', scheduledFor: B, finishedAt: null },
        { professionalId: 'pro_b', scheduledFor: B, finishedAt: null },
      ])
      expect(map.get('pro_a')).toEqual({ lastVisitAt: C, completedVisits: 3 })
      expect(map.get('pro_b')).toEqual({ lastVisitAt: B, completedVisits: 1 })
    })

    it('prefers finishedAt over scheduledFor as the visit instant', () => {
      const map = aggregateRelationshipSignals([
        { professionalId: 'pro_a', scheduledFor: A, finishedAt: C },
      ])
      expect(map.get('pro_a')?.lastVisitAt).toBe(C)
    })

    it('falls back to scheduledFor when finishedAt is missing or invalid', () => {
      const map = aggregateRelationshipSignals([
        { professionalId: 'pro_a', scheduledFor: B, finishedAt: new Date('nope') },
      ])
      expect(map.get('pro_a')?.lastVisitAt).toBe(B)
    })

    it('skips rows with no professional id or no usable timestamp', () => {
      const map = aggregateRelationshipSignals([
        { professionalId: '  ', scheduledFor: A, finishedAt: null },
        { professionalId: 'pro_a', scheduledFor: new Date('nope'), finishedAt: null },
        { professionalId: 'pro_b', scheduledFor: B, finishedAt: null },
      ])
      expect(map.has('')).toBe(false)
      expect(map.has('pro_a')).toBe(false)
      expect(map.get('pro_b')?.completedVisits).toBe(1)
    })

    it('returns an empty map for no rows', () => {
      expect(aggregateRelationshipSignals([]).size).toBe(0)
    })
  })
})
