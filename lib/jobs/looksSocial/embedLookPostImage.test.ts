// lib/jobs/looksSocial/embedLookPostImage.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LookPostStatus, MediaType, ModerationStatus } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  embedLookImage: vi.fn(),
  upsertLookPostEmbedding: vi.fn(),
  download: vi.fn(),
}))

vi.mock('@/lib/personalization/lookEmbedding', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@/lib/personalization/lookEmbedding')
    >()
  return {
    ...actual,
    embedLookImage: mocks.embedLookImage,
  }
})

vi.mock('@/lib/personalization/lookEmbeddingStore', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@/lib/personalization/lookEmbeddingStore')
    >()
  return {
    ...actual,
    upsertLookPostEmbedding: mocks.upsertLookPostEmbedding,
  }
})

vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    storage: {
      from: () => ({
        download: mocks.download,
      }),
    },
  }),
}))

import {
  processEmbedLookPostImage,
  type EmbedLookPostImageDb,
  type EmbedLookPostImageLookRow,
} from './embedLookPostImage'

function makeLookRow(
  overrides?: Partial<EmbedLookPostImageLookRow>,
): EmbedLookPostImageLookRow {
  return {
    id: 'look_1',
    status: LookPostStatus.PUBLISHED,
    moderationStatus: ModerationStatus.APPROVED,
    primaryMediaAsset: {
      id: 'asset_1',
      mediaType: MediaType.IMAGE,
      storageBucket: 'media-public',
      storagePath: 'client/c1/look_public/2026-07/a.jpg',
    },
    embedding: null,
    ...overrides,
  }
}

function makeDb(row: EmbedLookPostImageLookRow | null) {
  const findUnique = vi.fn(async () => row)
  const db: EmbedLookPostImageDb = {
    lookPost: { findUnique },
    $executeRaw: vi.fn(async () => 0),
    $queryRaw: vi.fn(async () => []) as EmbedLookPostImageDb['$queryRaw'],
  }
  return { db, findUnique }
}

function makeBlob(type: string): Blob {
  return new Blob([new Uint8Array([9, 8, 7])], { type })
}

const NOW = new Date('2026-07-07T12:00:00Z')

describe('lib/jobs/looksSocial/embedLookPostImage.ts', () => {
  beforeEach(() => {
    vi.stubEnv('VOYAGE_API_KEY', 'test-key')
    vi.stubEnv('LOOK_EMBEDDING_MODEL', '')
    mocks.embedLookImage.mockResolvedValue([0.1, 0.2])
    mocks.upsertLookPostEmbedding.mockResolvedValue(undefined)
    mocks.download.mockResolvedValue({
      data: makeBlob('image/jpeg'),
      error: null,
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it('skips quietly when the provider is unconfigured', async () => {
    vi.stubEnv('VOYAGE_API_KEY', '')
    const { db, findUnique } = makeDb(makeLookRow())

    const result = await processEmbedLookPostImage(db, {
      lookPostId: 'look_1',
    })

    expect(result).toEqual({
      lookPostId: 'look_1',
      status: 'SKIPPED_UNCONFIGURED',
    })
    expect(findUnique).not.toHaveBeenCalled()
    expect(mocks.embedLookImage).not.toHaveBeenCalled()
  })

  it('skips a missing look', async () => {
    const { db } = makeDb(null)

    await expect(
      processEmbedLookPostImage(db, { lookPostId: 'look_x' }),
    ).resolves.toEqual({ lookPostId: 'look_x', status: 'SKIPPED_NOT_FOUND' })
  })

  it('skips draft and unapproved looks', async () => {
    const { db: draftDb } = makeDb(
      makeLookRow({ status: LookPostStatus.DRAFT }),
    )
    await expect(
      processEmbedLookPostImage(draftDb, { lookPostId: 'look_1' }),
    ).resolves.toMatchObject({ status: 'SKIPPED_NOT_ELIGIBLE' })

    const { db: rejectedDb } = makeDb(
      makeLookRow({ moderationStatus: ModerationStatus.REJECTED }),
    )
    await expect(
      processEmbedLookPostImage(rejectedDb, { lookPostId: 'look_1' }),
    ).resolves.toMatchObject({ status: 'SKIPPED_NOT_ELIGIBLE' })
  })

  it('skips video primary assets', async () => {
    const row = makeLookRow()
    row.primaryMediaAsset.mediaType = MediaType.VIDEO
    const { db } = makeDb(row)

    await expect(
      processEmbedLookPostImage(db, { lookPostId: 'look_1' }),
    ).resolves.toMatchObject({ status: 'SKIPPED_UNSUPPORTED_MEDIA' })
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it('skips when the stored embedding already matches asset + model', async () => {
    const { db } = makeDb(
      makeLookRow({
        embedding: { mediaAssetId: 'asset_1', model: 'voyage-multimodal-3.5' },
      }),
    )

    await expect(
      processEmbedLookPostImage(db, { lookPostId: 'look_1' }),
    ).resolves.toMatchObject({ status: 'SKIPPED_UP_TO_DATE' })
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it('re-embeds when the primary asset changed since the stored embedding', async () => {
    const { db } = makeDb(
      makeLookRow({
        embedding: {
          mediaAssetId: 'asset_stale',
          model: 'voyage-multimodal-3.5',
        },
      }),
    )

    await expect(
      processEmbedLookPostImage(db, { lookPostId: 'look_1', now: NOW }),
    ).resolves.toMatchObject({ status: 'EMBEDDED' })
    expect(mocks.embedLookImage).toHaveBeenCalledTimes(1)
  })

  it('reports WOULD_EMBED on dry run without touching storage or the provider', async () => {
    const { db } = makeDb(makeLookRow())

    await expect(
      processEmbedLookPostImage(db, { lookPostId: 'look_1', dryRun: true }),
    ).resolves.toMatchObject({ status: 'WOULD_EMBED' })
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.embedLookImage).not.toHaveBeenCalled()
    expect(mocks.upsertLookPostEmbedding).not.toHaveBeenCalled()
  })

  it('downloads, embeds, and upserts on the happy path', async () => {
    const { db } = makeDb(makeLookRow())

    const result = await processEmbedLookPostImage(db, {
      lookPostId: 'look_1',
      now: NOW,
    })

    expect(result).toEqual({ lookPostId: 'look_1', status: 'EMBEDDED' })

    expect(mocks.embedLookImage).toHaveBeenCalledTimes(1)
    const embedArgs = mocks.embedLookImage.mock.calls[0]?.[0] as {
      config: { model: string }
      bytes: Uint8Array
      contentType: string
    }
    expect(embedArgs.config.model).toBe('voyage-multimodal-3.5')
    expect(embedArgs.contentType).toBe('image/jpeg')
    expect([...embedArgs.bytes]).toEqual([9, 8, 7])

    expect(mocks.upsertLookPostEmbedding).toHaveBeenCalledTimes(1)
    expect(mocks.upsertLookPostEmbedding.mock.calls[0]?.[0]).toBe(db)
    expect(mocks.upsertLookPostEmbedding.mock.calls[0]?.[1]).toEqual({
      lookPostId: 'look_1',
      mediaAssetId: 'asset_1',
      model: 'voyage-multimodal-3.5',
      embedding: [0.1, 0.2],
      now: NOW,
    })
  })

  it('durably skips bytes with an unsupported content type', async () => {
    mocks.download.mockResolvedValue({
      data: makeBlob('application/octet-stream'),
      error: null,
    })
    const { db } = makeDb(makeLookRow())

    await expect(
      processEmbedLookPostImage(db, { lookPostId: 'look_1' }),
    ).resolves.toMatchObject({ status: 'SKIPPED_UNSUPPORTED_MEDIA' })
    expect(mocks.embedLookImage).not.toHaveBeenCalled()
  })

  it('throws (so the queue retries) when the storage download fails', async () => {
    mocks.download.mockResolvedValue({
      data: null,
      error: { message: 'boom' },
    })
    const { db } = makeDb(makeLookRow())

    await expect(
      processEmbedLookPostImage(db, { lookPostId: 'look_1' }),
    ).rejects.toThrowError(/boom/)
  })
})
