// lib/looks/publication/backfillPortfolioLook.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaVisibility } from '@prisma/client'

const mocks = vi.hoisted(() => {
  const mediaAssetFindUnique = vi.fn()
  const mediaAssetUpdate = vi.fn()
  const createOrUpdateProLookFromMediaAsset = vi.fn()

  const tx = {
    mediaAsset: { update: mediaAssetUpdate },
  }

  type TransactionCallback = (db: typeof tx) => Promise<unknown> | unknown

  const prisma = {
    mediaAsset: { findUnique: mediaAssetFindUnique },
    $transaction: vi.fn(async (callback: TransactionCallback) => {
      return await callback(tx)
    }),
  }

  return {
    mediaAssetFindUnique,
    mediaAssetUpdate,
    createOrUpdateProLookFromMediaAsset,
    tx,
    prisma,
  }
})

vi.mock('./service', () => ({
  createOrUpdateProLookFromMediaAsset:
    mocks.createOrUpdateProLookFromMediaAsset,
}))

import {
  processBackfillPortfolioLook,
  resolveBackfillServiceId,
} from './backfillPortfolioLook'

type MediaOverrides = Partial<{
  id: string
  professionalId: string
  visibility: MediaVisibility
  isFeaturedInPortfolio: boolean
  isEligibleForLooks: boolean
  primaryServiceId: string
  services: Array<{ serviceId: string }>
  lookPostPrimaryFor: Array<{ id: string }>
}>

function makeMedia(overrides: MediaOverrides = {}) {
  return {
    id: 'media-1',
    professionalId: 'pro-1',
    visibility: MediaVisibility.PUBLIC,
    isFeaturedInPortfolio: true,
    isEligibleForLooks: false,
    primaryServiceId: 'svc-1',
    services: [{ serviceId: 'svc-1' }],
    lookPostPrimaryFor: [] as Array<{ id: string }>,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.prisma.$transaction.mockImplementation(
    async (callback: (db: typeof mocks.tx) => Promise<unknown> | unknown) =>
      await callback(mocks.tx),
  )
  mocks.createOrUpdateProLookFromMediaAsset.mockResolvedValue({})
})

describe('resolveBackfillServiceId', () => {
  it('prefers the primary service when it is one of the tags', () => {
    expect(
      resolveBackfillServiceId({
        primaryServiceId: 'svc-primary',
        services: [{ serviceId: 'svc-other' }, { serviceId: 'svc-primary' }],
      }),
    ).toBe('svc-primary')
  })

  it('falls back to the first tag when the primary is not tagged', () => {
    expect(
      resolveBackfillServiceId({
        primaryServiceId: 'svc-untagged',
        services: [{ serviceId: 'svc-a' }, { serviceId: 'svc-b' }],
      }),
    ).toBe('svc-a')
  })

  it('returns null when there are no service tags', () => {
    expect(
      resolveBackfillServiceId({ primaryServiceId: 'svc-1', services: [] }),
    ).toBeNull()
  })
})

describe('processBackfillPortfolioLook', () => {
  it('skips media that does not exist', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValue(null)

    const result = await processBackfillPortfolioLook(mocks.prisma as never, {
      mediaAssetId: 'missing',
      dryRun: false,
    })

    expect(result.status).toBe('SKIPPED_NOT_FOUND')
    expect(mocks.createOrUpdateProLookFromMediaAsset).not.toHaveBeenCalled()
  })

  it('skips media that already has a look', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValue(
      makeMedia({ lookPostPrimaryFor: [{ id: 'look-1' }] }),
    )

    const result = await processBackfillPortfolioLook(mocks.prisma as never, {
      mediaAssetId: 'media-1',
      dryRun: false,
    })

    expect(result.status).toBe('SKIPPED_ALREADY_LOOK')
    expect(mocks.createOrUpdateProLookFromMediaAsset).not.toHaveBeenCalled()
  })

  it('skips media that is not featured', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValue(
      makeMedia({ isFeaturedInPortfolio: false }),
    )

    const result = await processBackfillPortfolioLook(mocks.prisma as never, {
      mediaAssetId: 'media-1',
      dryRun: false,
    })

    expect(result.status).toBe('SKIPPED_NOT_FEATURED')
  })

  it('skips media that is not public', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValue(
      makeMedia({ visibility: MediaVisibility.PRO_CLIENT }),
    )

    const result = await processBackfillPortfolioLook(mocks.prisma as never, {
      mediaAssetId: 'media-1',
      dryRun: false,
    })

    expect(result.status).toBe('SKIPPED_NOT_PUBLIC')
  })

  it('skips media with no bookable service tag', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValue(makeMedia({ services: [] }))

    const result = await processBackfillPortfolioLook(mocks.prisma as never, {
      mediaAssetId: 'media-1',
      dryRun: false,
    })

    expect(result.status).toBe('SKIPPED_NO_SERVICE')
    expect(mocks.createOrUpdateProLookFromMediaAsset).not.toHaveBeenCalled()
  })

  it('reports WOULD_CREATE without writing on a dry run', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValue(makeMedia())

    const result = await processBackfillPortfolioLook(mocks.prisma as never, {
      mediaAssetId: 'media-1',
      dryRun: true,
    })

    expect(result).toEqual({ status: 'WOULD_CREATE', serviceId: 'svc-1' })
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    expect(mocks.mediaAssetUpdate).not.toHaveBeenCalled()
    expect(mocks.createOrUpdateProLookFromMediaAsset).not.toHaveBeenCalled()
  })

  it('marks the asset Looks-eligible and publishes a look', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValue(makeMedia())

    const result = await processBackfillPortfolioLook(mocks.prisma as never, {
      mediaAssetId: 'media-1',
      dryRun: false,
    })

    expect(result).toEqual({ status: 'CREATED', serviceId: 'svc-1' })
    expect(mocks.mediaAssetUpdate).toHaveBeenCalledWith({
      where: { id: 'media-1' },
      data: { isEligibleForLooks: true },
    })
    expect(mocks.createOrUpdateProLookFromMediaAsset).toHaveBeenCalledWith(
      mocks.tx,
      {
        professionalId: 'pro-1',
        request: {
          mediaAssetId: 'media-1',
          primaryServiceId: 'svc-1',
          publish: true,
        },
      },
    )
  })

  it('does not re-write eligibility when the asset is already eligible', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValue(
      makeMedia({ isEligibleForLooks: true }),
    )

    const result = await processBackfillPortfolioLook(mocks.prisma as never, {
      mediaAssetId: 'media-1',
      dryRun: false,
    })

    expect(result.status).toBe('CREATED')
    expect(mocks.mediaAssetUpdate).not.toHaveBeenCalled()
    expect(mocks.createOrUpdateProLookFromMediaAsset).toHaveBeenCalledTimes(1)
  })

  it('publishes with the primary service even when it is not the first tag', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValue(
      makeMedia({
        primaryServiceId: 'svc-primary',
        services: [{ serviceId: 'svc-other' }, { serviceId: 'svc-primary' }],
      }),
    )

    const result = await processBackfillPortfolioLook(mocks.prisma as never, {
      mediaAssetId: 'media-1',
      dryRun: false,
    })

    expect(result.serviceId).toBe('svc-primary')
    expect(mocks.createOrUpdateProLookFromMediaAsset).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({
        request: expect.objectContaining({ primaryServiceId: 'svc-primary' }),
      }),
    )
  })

  it('reports FAILED with the error message when publication throws', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValue(makeMedia())
    mocks.createOrUpdateProLookFromMediaAsset.mockRejectedValue(
      new Error('Looks publication requires a public media asset.'),
    )

    const result = await processBackfillPortfolioLook(mocks.prisma as never, {
      mediaAssetId: 'media-1',
      dryRun: false,
    })

    expect(result.status).toBe('FAILED')
    expect(result.error).toBe(
      'Looks publication requires a public media asset.',
    )
  })
})
