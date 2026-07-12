import { describe, expect, it } from 'vitest'

import { overlappingEventIds } from './overlap'

// The pro calendar's passive double-book highlight. Half-open [start, end):
// back-to-back appointments that merely touch do NOT count as an overlap.
describe('overlappingEventIds', () => {
  it('flags only the events that truly overlap', () => {
    const ids = overlappingEventIds([
      { id: 'a', startsAt: '2026-07-15T17:00:00Z', endsAt: '2026-07-15T18:00:00Z' },
      { id: 'b', startsAt: '2026-07-15T17:30:00Z', endsAt: '2026-07-15T18:30:00Z' },
      { id: 'c', startsAt: '2026-07-15T19:00:00Z', endsAt: '2026-07-15T20:00:00Z' },
    ])
    expect([...ids].sort()).toEqual(['a', 'b'])
  })

  it('does not flag back-to-back (touching) appointments', () => {
    const ids = overlappingEventIds([
      { id: 'a', startsAt: '2026-07-15T17:00:00Z', endsAt: '2026-07-15T18:00:00Z' },
      { id: 'b', startsAt: '2026-07-15T18:00:00Z', endsAt: '2026-07-15T19:00:00Z' },
    ])
    expect(ids.size).toBe(0)
  })

  it('handles the empty set and three mutually overlapping events', () => {
    expect(overlappingEventIds([]).size).toBe(0)

    const ids = overlappingEventIds([
      { id: 'a', startsAt: '2026-07-15T17:00:00Z', endsAt: '2026-07-15T19:00:00Z' },
      { id: 'b', startsAt: '2026-07-15T17:30:00Z', endsAt: '2026-07-15T18:30:00Z' },
      { id: 'c', startsAt: '2026-07-15T18:15:00Z', endsAt: '2026-07-15T20:00:00Z' },
    ])
    expect([...ids].sort()).toEqual(['a', 'b', 'c'])
  })
})
