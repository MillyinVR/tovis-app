import { describe, expect, it } from 'vitest'

import { edgePageDirectionFromClientX } from './dragEdge'

// Cross-week drag auto-pagination: the timeline spans [left, right] in client px;
// a `threshold`-wide band at each edge triggers previous (-1) / next (1).
describe('edgePageDirectionFromClientX', () => {
  const bounds = { left: 100, right: 800, threshold: 48 }

  it('returns -1 inside the left band, inclusive of its inner boundary', () => {
    expect(edgePageDirectionFromClientX({ clientX: 110, ...bounds })).toBe(-1)
    expect(edgePageDirectionFromClientX({ clientX: 148, ...bounds })).toBe(-1) // left + threshold
  })

  it('returns 1 inside the right band, inclusive of its inner boundary', () => {
    expect(edgePageDirectionFromClientX({ clientX: 790, ...bounds })).toBe(1)
    expect(edgePageDirectionFromClientX({ clientX: 752, ...bounds })).toBe(1) // right - threshold
  })

  it('returns 0 just inside either band and in the middle', () => {
    expect(edgePageDirectionFromClientX({ clientX: 149, ...bounds })).toBe(0)
    expect(edgePageDirectionFromClientX({ clientX: 751, ...bounds })).toBe(0)
    expect(edgePageDirectionFromClientX({ clientX: 450, ...bounds })).toBe(0)
  })

  it('paginates when the pointer is dragged past an edge (off-screen)', () => {
    expect(edgePageDirectionFromClientX({ clientX: 20, ...bounds })).toBe(-1)
    expect(edgePageDirectionFromClientX({ clientX: 960, ...bounds })).toBe(1)
  })

  it('prefers the left band when the container is narrower than two thresholds', () => {
    // left=100 right=180 threshold=48 → bands overlap; leading (previous) wins.
    expect(
      edgePageDirectionFromClientX({
        clientX: 140,
        left: 100,
        right: 180,
        threshold: 48,
      }),
    ).toBe(-1)
  })
})
