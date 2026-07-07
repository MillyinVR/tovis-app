// lib/personalization/lookEmbedding.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  LOOK_EMBEDDING_DIMENSIONS,
  LOOK_EMBEDDING_MAX_IMAGE_BYTES,
  LookEmbeddingError,
  embedLookImage,
  pickLookEmbeddingImageContentType,
  readLookEmbeddingConfig,
  type EmbeddingFetchInit,
} from './lookEmbedding'

function makeVector(fill = 0.25): number[] {
  return new Array(LOOK_EMBEDDING_DIMENSIONS).fill(fill)
}

function makeFetch(response: {
  ok?: boolean
  status?: number
  json?: unknown
}) {
  return vi.fn<
    (
      url: string,
      init: EmbeddingFetchInit,
    ) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>
  >(async () => ({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    json: async () => response.json,
  }))
}

const CONFIG = { apiKey: 'test-key', model: 'voyage-multimodal-3.5' }

describe('lib/personalization/lookEmbedding.ts', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('readLookEmbeddingConfig', () => {
    it('returns null when VOYAGE_API_KEY is unset or blank', () => {
      vi.stubEnv('VOYAGE_API_KEY', '')
      expect(readLookEmbeddingConfig()).toBeNull()
    })

    it('returns the default model with the key set', () => {
      vi.stubEnv('VOYAGE_API_KEY', 'k')
      vi.stubEnv('LOOK_EMBEDDING_MODEL', '')
      expect(readLookEmbeddingConfig()).toEqual({
        apiKey: 'k',
        model: 'voyage-multimodal-3.5',
      })
    })

    it('honours the model override', () => {
      vi.stubEnv('VOYAGE_API_KEY', 'k')
      vi.stubEnv('LOOK_EMBEDDING_MODEL', 'voyage-multimodal-3')
      expect(readLookEmbeddingConfig()?.model).toBe('voyage-multimodal-3')
    })
  })

  describe('pickLookEmbeddingImageContentType', () => {
    it('accepts the supported image types case-insensitively', () => {
      expect(pickLookEmbeddingImageContentType('image/jpeg')).toBe('image/jpeg')
      expect(pickLookEmbeddingImageContentType('IMAGE/PNG')).toBe('image/png')
      expect(pickLookEmbeddingImageContentType(' image/webp ')).toBe(
        'image/webp',
      )
    })

    it('rejects video and unknown types', () => {
      expect(pickLookEmbeddingImageContentType('video/mp4')).toBeNull()
      expect(
        pickLookEmbeddingImageContentType('application/octet-stream'),
      ).toBeNull()
      expect(pickLookEmbeddingImageContentType(null)).toBeNull()
    })
  })

  describe('embedLookImage', () => {
    it('posts a base64 data URL and returns the vector', async () => {
      const fetchImpl = makeFetch({
        json: { data: [{ embedding: makeVector() }] },
      })

      const result = await embedLookImage({
        config: CONFIG,
        bytes: new Uint8Array([1, 2, 3]),
        contentType: 'image/jpeg',
        fetchImpl,
      })

      expect(result).toEqual(makeVector())

      const call = fetchImpl.mock.calls[0]
      if (!call) throw new Error('fetch was not called')
      const [url, init] = call
      expect(url).toBe('https://api.voyageai.com/v1/multimodalembeddings')
      expect(init.headers).toMatchObject({
        Authorization: 'Bearer test-key',
      })

      const body = JSON.parse(init.body) as {
        model: string
        input_type: string
        inputs: Array<{ content: Array<{ type: string; image_base64: string }> }>
      }
      expect(body.model).toBe('voyage-multimodal-3.5')
      expect(body.input_type).toBe('document')
      expect(body.inputs[0]?.content[0]?.type).toBe('image_base64')
      expect(body.inputs[0]?.content[0]?.image_base64).toBe(
        `data:image/jpeg;base64,${Buffer.from([1, 2, 3]).toString('base64')}`,
      )
    })

    it('rejects empty and oversized images without calling the provider', async () => {
      const fetchImpl = makeFetch({ json: {} })

      await expect(
        embedLookImage({
          config: CONFIG,
          bytes: new Uint8Array(0),
          contentType: 'image/png',
          fetchImpl,
        }),
      ).rejects.toMatchObject({ kind: 'bad_input' })

      await expect(
        embedLookImage({
          config: CONFIG,
          bytes: new Uint8Array(LOOK_EMBEDDING_MAX_IMAGE_BYTES + 1),
          contentType: 'image/png',
          fetchImpl,
        }),
      ).rejects.toMatchObject({ kind: 'bad_input' })

      expect(fetchImpl).not.toHaveBeenCalled()
    })

    it('maps provider failures to unavailable without leaking the body', async () => {
      const fetchImpl = makeFetch({ ok: false, status: 429 })

      await expect(
        embedLookImage({
          config: CONFIG,
          bytes: new Uint8Array([1]),
          contentType: 'image/png',
          fetchImpl,
        }),
      ).rejects.toMatchObject({
        kind: 'unavailable',
        message: 'Embedding request failed with status 429.',
      })
    })

    it('rejects wrong-dimension and non-finite vectors', async () => {
      await expect(
        embedLookImage({
          config: CONFIG,
          bytes: new Uint8Array([1]),
          contentType: 'image/png',
          fetchImpl: makeFetch({ json: { data: [{ embedding: [1, 2, 3] }] } }),
        }),
      ).rejects.toMatchObject({ kind: 'bad_output' })

      const badComponent = makeVector()
      badComponent[7] = Number.NaN
      await expect(
        embedLookImage({
          config: CONFIG,
          bytes: new Uint8Array([1]),
          contentType: 'image/png',
          fetchImpl: makeFetch({ json: { data: [{ embedding: badComponent }] } }),
        }),
      ).rejects.toMatchObject({ kind: 'bad_output' })
    })

    it('rejects a missing vector as bad_output', async () => {
      await expect(
        embedLookImage({
          config: CONFIG,
          bytes: new Uint8Array([1]),
          contentType: 'image/png',
          fetchImpl: makeFetch({ json: { data: [] } }),
        }),
      ).rejects.toBeInstanceOf(LookEmbeddingError)
    })
  })
})
