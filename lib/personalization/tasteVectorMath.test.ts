// lib/personalization/tasteVectorMath.test.ts
import { describe, expect, it } from 'vitest'

import { LOOK_EMBEDDING_DIMENSIONS } from './lookEmbedding'
import {
  SESSION_TASTE_STEER_FULL_SIGNALS,
  SESSION_TASTE_STEER_MAX,
  blendSessionTasteVector,
  type TasteVectorSignal,
} from './tasteVectorMath'

function basisVector(axis: number, value = 1): number[] {
  const vector = new Array<number>(LOOK_EMBEDDING_DIMENSIONS).fill(0)
  vector[axis] = value
  return vector
}

function norm(vector: readonly number[]): number {
  return Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0))
}

describe('blendSessionTasteVector', () => {
  it('passes the stored vector through unchanged with no fresh session signals', () => {
    const stored = basisVector(0)
    const blend = blendSessionTasteVector({
      storedVector: stored,
      storedSignalCount: 12,
      sessionSignals: [],
    })

    expect(blend.signalCount).toBe(12)
    expect(blend.vector).not.toBeNull()
    expect(blend.vector![0] ?? Number.NaN).toBeCloseTo(1)
    expect(norm(blend.vector!)).toBeCloseTo(1)
  })

  it('is null with neither a stored vector nor session signals', () => {
    expect(
      blendSessionTasteVector({
        storedVector: null,
        storedSignalCount: 0,
        sessionSignals: [],
      }),
    ).toEqual({ vector: null, signalCount: 0 })
  })

  it('seeds a session-only vector when no mature vector exists', () => {
    const signals: TasteVectorSignal[] = [
      { embedding: basisVector(1), weight: 2 },
      { embedding: basisVector(1), weight: 2 },
    ]
    const blend = blendSessionTasteVector({
      storedVector: null,
      storedSignalCount: 0,
      sessionSignals: signals,
    })

    // Direction is the fresh centroid; confidence is the fresh-signal count.
    expect(blend.signalCount).toBe(2)
    expect(blend.vector).not.toBeNull()
    expect(blend.vector![1] ?? Number.NaN).toBeCloseTo(1)
    expect(blend.vector![0] ?? Number.NaN).toBeCloseTo(0)
  })

  it('rotates the mature vector toward the fresh centroid, stored still dominant', () => {
    const stored = basisVector(0)
    const blend = blendSessionTasteVector({
      storedVector: stored,
      storedSignalCount: 30,
      // One fresh save orthogonal to the mature taste.
      sessionSignals: [{ embedding: basisVector(1), weight: 2 }],
    })

    // freshCount 1 → sessionPull = MAX × 1/FULL. blended ∝ [1, pull, 0, …].
    const pull = SESSION_TASTE_STEER_MAX * (1 / SESSION_TASTE_STEER_FULL_SIGNALS)
    const expectedRatio = pull // blended[1] / blended[0]
    expect(blend.vector).not.toBeNull()
    const ratio = (blend.vector![1] ?? 0) / (blend.vector![0] ?? Number.NaN)
    expect(ratio).toBeCloseTo(expectedRatio, 6)
    // Stored direction keeps the larger share, and confidence rises by the fresh
    // signal.
    expect(blend.vector![0] ?? Number.NaN).toBeGreaterThan(
      blend.vector![1] ?? Number.NaN,
    )
    expect(blend.signalCount).toBe(31)
    expect(norm(blend.vector!)).toBeCloseTo(1)
  })

  it('caps the steer once enough fresh signals accrue', () => {
    const stored = basisVector(0)
    const atFull = blendSessionTasteVector({
      storedVector: stored,
      storedSignalCount: 5,
      sessionSignals: Array.from(
        { length: SESSION_TASTE_STEER_FULL_SIGNALS },
        () => ({ embedding: basisVector(1), weight: 2 }),
      ),
    })
    const beyondFull = blendSessionTasteVector({
      storedVector: stored,
      storedSignalCount: 5,
      sessionSignals: Array.from(
        { length: SESSION_TASTE_STEER_FULL_SIGNALS * 3 },
        () => ({ embedding: basisVector(1), weight: 2 }),
      ),
    })

    // Direction saturates at the steer ceiling — more saves past the cap don't
    // rotate further (they still raise confidence).
    const ratioAt = (atFull.vector![1] ?? 0) / (atFull.vector![0] ?? Number.NaN)
    const ratioBeyond =
      (beyondFull.vector![1] ?? 0) / (beyondFull.vector![0] ?? Number.NaN)
    expect(ratioAt).toBeCloseTo(SESSION_TASTE_STEER_MAX, 6)
    expect(ratioBeyond).toBeCloseTo(ratioAt, 6)
    // Even at full steer the mature direction stays dominant (pull < 1).
    expect(atFull.vector![0] ?? Number.NaN).toBeGreaterThan(
      atFull.vector![1] ?? Number.NaN,
    )
  })

  it('ignores unusable session signals when counting confidence', () => {
    const stored = basisVector(0)
    const blend = blendSessionTasteVector({
      storedVector: stored,
      storedSignalCount: 4,
      sessionSignals: [
        { embedding: basisVector(1), weight: 2 }, // usable
        { embedding: basisVector(2), weight: 0 }, // zero weight → dropped
        { embedding: [1, 2, 3], weight: 5 }, // wrong dimension → dropped
      ],
    })

    // Only the one usable signal counts.
    expect(blend.signalCount).toBe(5)
    expect(blend.vector![2] ?? Number.NaN).toBeCloseTo(0)
  })

  it('treats a malformed stored vector as no mature vector', () => {
    const blend = blendSessionTasteVector({
      storedVector: [1, 2, 3], // wrong dimension
      storedSignalCount: 40,
      sessionSignals: [{ embedding: basisVector(1), weight: 2 }],
    })

    // Falls to the seed path: fresh centroid, fresh-only confidence.
    expect(blend.signalCount).toBe(1)
    expect(blend.vector![1] ?? Number.NaN).toBeCloseTo(1)
  })

  it('sanitizes a non-positive / non-finite stored signal count', () => {
    const stored = basisVector(0)
    for (const bad of [-5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const blend = blendSessionTasteVector({
        storedVector: stored,
        storedSignalCount: bad,
        sessionSignals: [],
      })
      expect(blend.signalCount).toBe(0)
    }
  })
})
