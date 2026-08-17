// lib/media/hashStorageObject.test.ts
import { createHash } from 'node:crypto'

import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  download: vi.fn(),
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    storage: {
      from: () => ({
        download: mocks.download,
      }),
    },
  }),
}))

import { hashStorageObjectBytes, MediaHashError } from './hashStorageObject'

function makeBlob(bytes: number[], type = 'image/jpeg'): Blob {
  return new Blob([new Uint8Array(bytes)], { type })
}

describe('hashStorageObjectBytes', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns the sha256 of the downloaded bytes, not a client-declared value', async () => {
    const bytes = [1, 2, 3, 4, 5]
    mocks.download.mockResolvedValue({ data: makeBlob(bytes), error: null })

    const expected = createHash('sha256')
      .update(new Uint8Array(bytes))
      .digest('hex')

    const result = await hashStorageObjectBytes({
      bucket: 'media-private',
      path: 'bookings/b1/before/main.jpg',
      maxBytes: 30 * 1024 * 1024,
    })

    expect(result.sha256).toBe(expected)
    expect(result.sizeBytes).toBe(bytes.length)
  })

  it('throws MediaHashError("missing") when the download errors', async () => {
    mocks.download.mockResolvedValue({
      data: null,
      error: new Error('not found'),
    })

    await expect(
      hashStorageObjectBytes({
        bucket: 'media-private',
        path: 'missing.jpg',
        maxBytes: 1024,
      }),
    ).rejects.toMatchObject({ kind: 'missing' })
  })

  it('throws MediaHashError("missing") when data is null with no error', async () => {
    mocks.download.mockResolvedValue({ data: null, error: null })

    await expect(
      hashStorageObjectBytes({
        bucket: 'media-private',
        path: 'missing.jpg',
        maxBytes: 1024,
      }),
    ).rejects.toBeInstanceOf(MediaHashError)
  })

  it('throws MediaHashError("too_large") when the object exceeds maxBytes', async () => {
    mocks.download.mockResolvedValue({
      data: makeBlob([1, 2, 3, 4, 5, 6, 7, 8]),
      error: null,
    })

    await expect(
      hashStorageObjectBytes({
        bucket: 'media-private',
        path: 'big.jpg',
        maxBytes: 4,
      }),
    ).rejects.toMatchObject({ kind: 'too_large' })
  })
})
