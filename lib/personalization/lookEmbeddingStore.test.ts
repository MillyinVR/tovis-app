// lib/personalization/lookEmbeddingStore.test.ts
import { describe, expect, it } from 'vitest'

import { LOOK_EMBEDDING_DIMENSIONS } from './lookEmbedding'
import {
  parseEmbeddingVectorText,
  serializeEmbeddingVector,
} from './lookEmbeddingStore'

function makeVector(): number[] {
  return Array.from(
    { length: LOOK_EMBEDDING_DIMENSIONS },
    (_, i) => (i % 7) * 0.125 - 0.375,
  )
}

describe('lib/personalization/lookEmbeddingStore.ts', () => {
  it('round-trips a vector through the pgvector text literal', () => {
    const vector = makeVector()
    const text = serializeEmbeddingVector(vector)

    expect(text.startsWith('[')).toBe(true)
    expect(text.endsWith(']')).toBe(true)
    expect(parseEmbeddingVectorText(text)).toEqual(vector)
  })

  it('rejects wrong dimensions and non-finite components on serialize', () => {
    expect(() => serializeEmbeddingVector([1, 2, 3])).toThrowError(
      /3 dimensions/,
    )

    const bad = makeVector()
    bad[0] = Number.POSITIVE_INFINITY
    expect(() => serializeEmbeddingVector(bad)).toThrowError(/non-finite/)
  })

  it('rejects malformed literals and wrong dimensions on parse', () => {
    expect(() => parseEmbeddingVectorText('not a vector')).toThrowError(
      /not a pgvector literal/,
    )
    expect(() => parseEmbeddingVectorText('[1,2,3]')).toThrowError(
      /3 dimensions/,
    )
    const junk = `[${new Array(LOOK_EMBEDDING_DIMENSIONS).fill('x').join(',')}]`
    expect(() => parseEmbeddingVectorText(junk)).toThrowError(/non-finite/)
  })
})
