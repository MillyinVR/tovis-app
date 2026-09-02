// lib/media/retractToPrivateBucket.test.ts
//
// The contract under test is an ORDERING, not a return value: copy → verify →
// re-point → delete. Every failure case below asserts what the world looks like
// after a partial failure, because "the row is still valid and the operation is
// retryable" is the only property that makes this safe to run against production
// storage that has no restorable backup.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  download: vi.fn(),
  upload: vi.fn(),
  list: vi.fn(),
  remove: vi.fn(),
  purge: vi.fn(),
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    storage: {
      from: (bucket: string) => ({
        download: (path: string) => mocks.download(bucket, path),
        upload: (path: string, blob: unknown, opts: unknown) =>
          mocks.upload(bucket, path, blob, opts),
        list: (dir: string, opts: unknown) => mocks.list(bucket, dir, opts),
        remove: (paths: string[]) => mocks.remove(bucket, paths),
      }),
    },
  }),
}))

vi.mock('@/lib/media/cdnCache', () => ({
  purgeCdnObject: (bucket: string, path: string) => mocks.purge(bucket, path),
}))

vi.mock('@/lib/security/logging', () => ({
  safeError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}))

import {
  retractMediaAssetIfNoLongerShown,
  retractMediaAssetToPrivate,
} from './retractToPrivateBucket'
import type { Prisma } from '@prisma/client'
import { MEDIA_UPLOAD_CACHE_CONTROL } from '@/lib/media/cacheControl'
import { BUCKETS } from '@/lib/storageBuckets'

const PUBLIC_PATH = 'pro/pro_1/looks_public/2026-08/1788212846485_abc.jpg'
const THUMB_PATH = 'pro/pro_1/looks_public/2026-08/thumb.jpg'
const SIZE = 597_189

const MEDIA = {
  id: 'media_1',
  professionalId: 'pro_1',
  storageBucket: BUCKETS.mediaPublic,
  storagePath: PUBLIC_PATH,
  thumbBucket: null,
  thumbPath: null,
  isFeaturedInPortfolio: false,
  isEligibleForLooks: false,
}

/** A storage `list` that reports `size` for every object asked about. */
function listReturnsSize(size: number) {
  return vi.fn((_bucket: string, _dir: string, opts: { search: string }) =>
    Promise.resolve({
      data: [{ name: opts.search, metadata: { size } }],
      error: null,
    }),
  )
}

type UpdateArgs = { where: { id: string }; data: Prisma.MediaAssetUpdateInput }

function makeDb() {
  const update = vi.fn((_args: UpdateArgs): Promise<unknown> =>
    Promise.resolve({}),
  )
  return { update, db: { mediaAsset: { update } } }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.download.mockResolvedValue({
    data: { type: 'image/jpeg', size: SIZE },
    error: null,
  })
  mocks.upload.mockResolvedValue({ error: null })
  mocks.list.mockImplementation(listReturnsSize(SIZE))
  mocks.remove.mockResolvedValue({ error: null })
  mocks.purge.mockResolvedValue({ ok: true })
})

describe('retractMediaAssetToPrivate', () => {
  it('copies, re-points, deletes and purges — in that order', async () => {
    const order: string[] = []
    mocks.upload.mockImplementation(() => {
      order.push('upload')
      return Promise.resolve({ error: null })
    })
    mocks.remove.mockImplementation(() => {
      order.push('remove')
      return Promise.resolve({ error: null })
    })
    mocks.purge.mockImplementation(() => {
      order.push('purge')
      return Promise.resolve({ ok: true })
    })

    const { update, db } = makeDb()
    update.mockImplementation(() => {
      order.push('update')
      return Promise.resolve({})
    })

    const outcome = await retractMediaAssetToPrivate(db, MEDIA)

    expect(outcome.status).toBe('RETRACTED')
    // 🔴 The whole safety argument in one assertion. The purge is LAST: it is
    // only meaningful once the origin bytes are actually gone.
    expect(order).toEqual(['upload', 'update', 'remove', 'purge'])
  })

  it('re-points every pointer, including the cached public URLs', async () => {
    const { update, db } = makeDb()

    await retractMediaAssetToPrivate(db, MEDIA)

    const call = update.mock.calls[0]
    if (!call) throw new Error('expected the row to be re-pointed')
    const data = call[0].data
    expect(data.storageBucket).toBe(BUCKETS.mediaPrivate)
    expect(data.storagePath).not.toBe(PUBLIC_PATH)
    // A stored public URL for bytes that no longer exist there is a stale claim.
    expect(data.url).toBeNull()
    expect(data.thumbUrl).toBeNull()
    // Without this the pro could never re-publish their own photograph.
    expect(data.retractedFromPublicAt).toBeInstanceOf(Date)
    expect(data.visibility).toBe('PRO_CLIENT')
  })

  it('deletes NOTHING when the copy cannot be verified', async () => {
    // The destination is not readable back — the copy is unproven.
    mocks.list.mockResolvedValue({ data: [], error: null })

    const { update, db } = makeDb()

    await expect(retractMediaAssetToPrivate(db, MEDIA)).rejects.toThrow(
      /could not be verified/i,
    )

    // The row still describes the intact public original. Retryable.
    expect(update).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('deletes NOTHING when the copy lands at the wrong size', async () => {
    let call = 0
    mocks.list.mockImplementation((_b: string, _d: string, opts: { search: string }) => {
      call += 1
      // Source reports the true size; the copy comes back truncated.
      return Promise.resolve({
        data: [{ name: opts.search, metadata: { size: call === 1 ? SIZE : 12 } }],
        error: null,
      })
    })

    const { update, db } = makeDb()

    await expect(retractMediaAssetToPrivate(db, MEDIA)).rejects.toThrow(
      /verification failed/i,
    )
    expect(update).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('leaves the public original intact when the re-point fails', async () => {
    const { db } = makeDb()
    db.mediaAsset.update = vi.fn((_args: UpdateArgs): Promise<unknown> =>
      Promise.reject(new Error('db down')),
    )

    await expect(retractMediaAssetToPrivate(db, MEDIA)).rejects.toThrow('db down')

    // 🔴 Deleting here would strand the row pointing at bytes that don't exist.
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('reports — never swallows — a public object it could not delete', async () => {
    mocks.remove.mockResolvedValue({ error: { message: 'permission denied' } })

    const { db } = makeDb()
    const outcome = await retractMediaAssetToPrivate(db, MEDIA)

    // The row is correct, but the bytes are still exposed. That must surface.
    expect(outcome.status).toBe('RETRACTED')
    if (outcome.status !== 'RETRACTED') return
    expect(outcome.orphanedPublicObjects).toEqual([
      {
        bucket: BUCKETS.mediaPublic,
        path: PUBLIC_PATH,
        reason: 'permission denied',
      },
    ])

    // 🔴 And it must NOT purge an object that is still there. A purge would
    // succeed, the next request would repopulate the edge from the bytes we
    // failed to remove, and the result would read as a clean retraction.
    expect(mocks.purge).not.toHaveBeenCalled()
  })

  it('writes an explicit cache-control onto the private copy', async () => {
    const { db } = makeDb()

    await retractMediaAssetToPrivate(db, MEDIA)

    const call = mocks.upload.mock.calls[0]
    if (!call) throw new Error('expected the bytes to be copied')
    // Left unset on this path it is the storage-js default, `max-age=3600` —
    // an hour of browser residency that no directly-uploaded object has. A
    // retraction's own copy must not inherit a longer TTL than the original.
    expect(call[3]).toMatchObject({ cacheControl: MEDIA_UPLOAD_CACHE_CONTROL })
  })

  it('purges the edge copy of every object it deletes', async () => {
    const { db } = makeDb()

    const outcome = await retractMediaAssetToPrivate(db, {
      ...MEDIA,
      thumbBucket: BUCKETS.mediaPublic,
      thumbPath: THUMB_PATH,
    })

    expect(outcome.status).toBe('RETRACTED')
    if (outcome.status !== 'RETRACTED') return
    expect(outcome.cdnPurgeFailures).toEqual([])

    // Deleting at the origin leaves the CDN serving the photo for the better
    // part of a minute (measured). Both objects have to be invalidated.
    expect(mocks.purge.mock.calls).toEqual([
      [BUCKETS.mediaPublic, PUBLIC_PATH],
      [BUCKETS.mediaPublic, THUMB_PATH],
    ])
  })

  it('reports a failed purge without failing the retraction', async () => {
    mocks.purge.mockResolvedValue({ ok: false, reason: 'CDN purge failed (403): nope' })

    const { db } = makeDb()
    const outcome = await retractMediaAssetToPrivate(db, MEDIA)

    // The bytes ARE gone; only the edge lingers, and it self-invalidates.
    expect(outcome.status).toBe('RETRACTED')
    if (outcome.status !== 'RETRACTED') return
    expect(outcome.orphanedPublicObjects).toEqual([])
    expect(outcome.cdnPurgeFailures).toEqual([
      {
        bucket: BUCKETS.mediaPublic,
        path: PUBLIC_PATH,
        reason: 'CDN purge failed (403): nope',
      },
    ])
  })

  it('moves the thumbnail too when it is public', async () => {
    const { update, db } = makeDb()

    await retractMediaAssetToPrivate(db, {
      ...MEDIA,
      thumbBucket: BUCKETS.mediaPublic,
      thumbPath: THUMB_PATH,
    })

    const call = update.mock.calls[0]
    if (!call) throw new Error('expected the row to be re-pointed')
    const data = call[0].data
    expect(data.thumbBucket).toBe(BUCKETS.mediaPrivate)
    // Both originals are removed.
    expect(mocks.remove).toHaveBeenCalledTimes(2)
  })

  it('is a no-op for bytes that were never public', async () => {
    const { update, db } = makeDb()

    const outcome = await retractMediaAssetToPrivate(db, {
      ...MEDIA,
      storageBucket: BUCKETS.mediaPrivate,
    })

    expect(outcome.status).toBe('ALREADY_PRIVATE')
    expect(update).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
  })
})

describe('retractMediaAssetIfNoLongerShown', () => {
  it('retracts an asset nothing shows any more', async () => {
    const { db } = makeDb()

    const outcome = await retractMediaAssetIfNoLongerShown(db, {
      ...MEDIA,
      reviewId: null,
    })

    expect(outcome.status).toBe('RETRACTED')
    expect(mocks.remove).toHaveBeenCalled()
  })

  it('treats a missing row as leave-it-alone, never as safe to delete', async () => {
    const { update, db } = makeDb()

    const outcome = await retractMediaAssetIfNoLongerShown(db, null)

    expect(outcome.status).toBe('STILL_SHOWN')
    expect(update).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it.each([
    ['still featured', { isFeaturedInPortfolio: true, isEligibleForLooks: false, reviewId: null }],
    ['still Looks-eligible', { isFeaturedInPortfolio: false, isEligibleForLooks: true, reviewId: null }],
    // 🔴 Review media is PUBLIC with BOTH flags false. A flags-only test would
    // withdraw the photo out from under the client who promoted it.
    ['client-promoted review media', { isFeaturedInPortfolio: false, isEligibleForLooks: false, reviewId: 'rev_1' }],
  ])('refuses to touch %s', async (_label, flags) => {
    const { update, db } = makeDb()

    const outcome = await retractMediaAssetIfNoLongerShown(db, {
      ...MEDIA,
      ...flags,
    })

    expect(outcome.status).toBe('STILL_SHOWN')
    expect(update).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
  })
})
