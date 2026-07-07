// lib/personalization/tasteVectors.test.ts
import { describe, expect, it } from 'vitest'

import { LOOK_EMBEDDING_DIMENSIONS } from './lookEmbedding'
import {
  computeWeightedTasteVector,
  type TasteVectorSignal,
} from './tasteVectors'

function basisVector(axis: number, value = 1): number[] {
  const vector = new Array<number>(LOOK_EMBEDDING_DIMENSIONS).fill(0)
  vector[axis] = value
  return vector
}

function norm(vector: readonly number[]): number {
  return Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0))
}

describe('computeWeightedTasteVector', () => {
  it('returns null with no usable signal', () => {
    expect(computeWeightedTasteVector([])).toBeNull()
    expect(
      computeWeightedTasteVector([
        { embedding: basisVector(0), weight: 0 },
        { embedding: basisVector(1), weight: -2 },
        { embedding: basisVector(2), weight: Number.NaN },
      ]),
    ).toBeNull()
  })

  it('returns null when the weighted mean is the zero vector', () => {
    expect(
      computeWeightedTasteVector([
        { embedding: basisVector(0, 1), weight: 1 },
        { embedding: basisVector(0, -1), weight: 1 },
      ]),
    ).toBeNull()
  })

  it('skips signals with the wrong dimension', () => {
    const result = computeWeightedTasteVector([
      { embedding: [1, 2, 3], weight: 5 },
      { embedding: basisVector(3), weight: 1 },
    ])

    expect(result).not.toBeNull()
    expect(result![3] ?? Number.NaN).toBeCloseTo(1)
  })

  it('L2-normalizes the output', () => {
    const result = computeWeightedTasteVector([
      { embedding: basisVector(0, 4), weight: 1 },
    ])

    expect(result).not.toBeNull()
    expect(norm(result!)).toBeCloseTo(1)
    expect(result![0] ?? Number.NaN).toBeCloseTo(1)
  })

  it('leans toward the heavier-weighted signal', () => {
    // A "save" at weight 2 vs a "like" at weight 1 on orthogonal looks: the
    // resulting unit vector must sit closer to the saved look's axis.
    const signals: TasteVectorSignal[] = [
      { embedding: basisVector(0), weight: 2 },
      { embedding: basisVector(1), weight: 1 },
    ]

    const result = computeWeightedTasteVector(signals)
    expect(result).not.toBeNull()
    expect(result![0] ?? Number.NaN).toBeGreaterThan(result![1] ?? Number.NaN)
    // cos to axis 0 = 2/sqrt(5), to axis 1 = 1/sqrt(5)
    expect(result![0] ?? Number.NaN).toBeCloseTo(2 / Math.sqrt(5))
    expect(result![1] ?? Number.NaN).toBeCloseTo(1 / Math.sqrt(5))
  })

  it('is invariant to uniform weight scaling', () => {
    const signals: TasteVectorSignal[] = [
      { embedding: basisVector(0), weight: 1 },
      { embedding: basisVector(1), weight: 3 },
    ]
    const scaled = signals.map((s) => ({ ...s, weight: s.weight * 42 }))

    const a = computeWeightedTasteVector(signals)!
    const b = computeWeightedTasteVector(scaled)!
    for (let i = 0; i < LOOK_EMBEDDING_DIMENSIONS; i += 1) {
      expect(a[i] ?? Number.NaN).toBeCloseTo(b[i] ?? Number.NaN)
    }
  })
})
