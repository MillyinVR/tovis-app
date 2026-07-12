// lib/looks/publication/portfolioLookSync.test.ts
import { LookPostStatus, MediaVisibility } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const mediaAssetFindUnique = vi.fn()
  const mediaAssetUpdate = vi.fn()
  const createOrUpdateProLookFromMediaAsset = vi.fn()
  const updateProLookPublication = vi.fn()

  const db = {
    mediaAsset: {
      findUnique: mediaAssetFindUnique,
      update: mediaAssetUpdate,
    },
  }

  return {
    mediaAssetFindUnique,
    mediaAssetUpdate,
    createOrUpdateProLookFromMediaAsset,
    updateProLookPublication,
    db,
  }
})

// withPublicationTx is stubbed as a passthrough so the reconciler runs against
// the mock db directly (no real $transaction); the publication service fns are
// mocked so this suite isolates the publish/retract *decision*.
vi.mock('./service', () => ({
  withPublicationTx: (
    db: unknown,
    fn: (tx: unknown) => Promise<unknown>,
  ): Promise<unknown> => fn(db),
  createOrUpdateProLookFromMediaAsset:
    mocks.createOrUpdateProLookFromMediaAsset,
  updateProLookPublication: mocks.updateProLookPublication,
}))

import { reconcilePortfolioLookForMediaAsset } from './portfolioLookSync'

type MediaRowOverrides = Partial<{
  id: string
  professionalId: string
  visibility: MediaVisibility
  isFeaturedInPortfolio: boolean
  isEligibleForLooks: boolean
  reviewId: string | null
  storageBucket: string
  primaryServiceId: string
  services: Array<{ serviceId: string }>
  booking: { mediaUseConsentAt: Date | null } | null
  lookPostPrimaryFor: Array<{
    id: string
    status: LookPostStatus
    clientAuthorId: string | null
  }>
}>

function makeMedia(overrides?: MediaRowOverrides) {
  return {
    id: 'media_1',
    professionalId: 'pro_1',
    visibility: MediaVisibility.PUBLIC,
    isFeaturedInPortfolio: true,
    isEligibleForLooks: true,
    reviewId: null,
    storageBucket: 'media-public',
    primaryServiceId: 'service_1',
    services: [{ serviceId: 'service_1' }],
    booking: null,
    lookPostPrimaryFor: [],
    ...(overrides ?? {}),
  }
}

function run(mediaAssetId = 'media_1', professionalId = 'pro_1') {
  return reconcilePortfolioLookForMediaAsset(mocks.db as never, {
    professionalId,
    mediaAssetId,
  })
}

describe('reconcilePortfolioLookForMediaAsset', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mediaAssetFindUnique.mockResolvedValue(makeMedia())
    mocks.mediaAssetUpdate.mockResolvedValue({ id: 'media_1' })
    mocks.createOrUpdateProLookFromMediaAsset.mockResolvedValue({})
    mocks.updateProLookPublication.mockResolvedValue({})
  })

  it('skips when the media asset does not exist', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValueOnce(null)

    await expect(run()).resolves.toBe('SKIPPED_NOT_FOUND')
    expect(mocks.createOrUpdateProLookFromMediaAsset).not.toHaveBeenCalled()
    expect(mocks.updateProLookPublication).not.toHaveBeenCalled()
  })

  it('skips when the media asset belongs to another professional', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValueOnce(
      makeMedia({ professionalId: 'other_pro' }),
    )

    await expect(run()).resolves.toBe('SKIPPED_NOT_OWNED')
    expect(mocks.createOrUpdateProLookFromMediaAsset).not.toHaveBeenCalled()
    expect(mocks.updateProLookPublication).not.toHaveBeenCalled()
  })

  it('never touches a client-authored look', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValueOnce(
      makeMedia({
        lookPostPrimaryFor: [
          {
            id: 'look_1',
            status: LookPostStatus.PUBLISHED,
            clientAuthorId: 'client_1',
          },
        ],
      }),
    )

    await expect(run()).resolves.toBe('SKIPPED_CLIENT_LOOK')
    expect(mocks.createOrUpdateProLookFromMediaAsset).not.toHaveBeenCalled()
    expect(mocks.updateProLookPublication).not.toHaveBeenCalled()
  })

  it('publishes a look for a public, featured, backable asset', async () => {
    await expect(run()).resolves.toBe('PUBLISHED')

    expect(mocks.createOrUpdateProLookFromMediaAsset).toHaveBeenCalledWith(
      mocks.db,
      {
        professionalId: 'pro_1',
        request: {
          mediaAssetId: 'media_1',
          primaryServiceId: 'service_1',
          publish: true,
        },
      },
    )
    // Already Looks-eligible → no pre-publish eligibility write.
    expect(mocks.mediaAssetUpdate).not.toHaveBeenCalled()
    expect(mocks.updateProLookPublication).not.toHaveBeenCalled()
  })

  it('marks a featured-only asset Looks-eligible before publishing', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValueOnce(
      makeMedia({ isFeaturedInPortfolio: true, isEligibleForLooks: false }),
    )

    await expect(run()).resolves.toBe('PUBLISHED')

    expect(mocks.mediaAssetUpdate).toHaveBeenCalledWith({
      where: { id: 'media_1' },
      data: { isEligibleForLooks: true },
    })
    expect(mocks.createOrUpdateProLookFromMediaAsset).toHaveBeenCalledTimes(1)
  })

  it('resolves the look service id from the first tag when the primary is untagged', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValueOnce(
      makeMedia({
        primaryServiceId: 'service_x',
        services: [{ serviceId: 'service_2' }],
      }),
    )

    await expect(run()).resolves.toBe('PUBLISHED')
    expect(mocks.createOrUpdateProLookFromMediaAsset).toHaveBeenCalledWith(
      mocks.db,
      expect.objectContaining({
        request: expect.objectContaining({ primaryServiceId: 'service_2' }),
      }),
    )
  })

  it('does not publish an asset with no bookable service tag', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValueOnce(
      makeMedia({ primaryServiceId: 'service_x', services: [] }),
    )

    await expect(run()).resolves.toBe('SKIPPED_NOT_BACKABLE')
    expect(mocks.createOrUpdateProLookFromMediaAsset).not.toHaveBeenCalled()
    expect(mocks.updateProLookPublication).not.toHaveBeenCalled()
  })

  it('does not publish unpromoted private (client) media even when flagged public', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValueOnce(
      makeMedia({
        storageBucket: 'media-private',
        reviewId: null,
        booking: null,
      }),
    )

    await expect(run()).resolves.toBe('SKIPPED_NOT_BACKABLE')
    expect(mocks.createOrUpdateProLookFromMediaAsset).not.toHaveBeenCalled()
  })

  it('publishes review-promoted private media (client consented)', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValueOnce(
      makeMedia({ storageBucket: 'media-private', reviewId: 'review_1' }),
    )

    await expect(run()).resolves.toBe('PUBLISHED')
    expect(mocks.createOrUpdateProLookFromMediaAsset).toHaveBeenCalledTimes(1)
  })

  it('retracts a published look when the asset is no longer public', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValueOnce(
      makeMedia({
        visibility: MediaVisibility.PRO_CLIENT,
        isFeaturedInPortfolio: false,
        isEligibleForLooks: false,
        lookPostPrimaryFor: [
          {
            id: 'look_1',
            status: LookPostStatus.PUBLISHED,
            clientAuthorId: null,
          },
        ],
      }),
    )

    await expect(run()).resolves.toBe('RETRACTED')
    expect(mocks.updateProLookPublication).toHaveBeenCalledWith(mocks.db, {
      professionalId: 'pro_1',
      lookPostId: 'look_1',
      request: { stateAction: 'unpublish' },
    })
    expect(mocks.createOrUpdateProLookFromMediaAsset).not.toHaveBeenCalled()
  })

  it('retracts a published look that can no longer back a look (tag removed)', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValueOnce(
      makeMedia({
        services: [],
        primaryServiceId: 'service_x',
        lookPostPrimaryFor: [
          {
            id: 'look_1',
            status: LookPostStatus.PUBLISHED,
            clientAuthorId: null,
          },
        ],
      }),
    )

    await expect(run()).resolves.toBe('RETRACTED')
    expect(mocks.updateProLookPublication).toHaveBeenCalledTimes(1)
  })

  it('is a no-op for a private asset with no existing look', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValueOnce(
      makeMedia({
        visibility: MediaVisibility.PRO_CLIENT,
        isFeaturedInPortfolio: false,
        isEligibleForLooks: false,
      }),
    )

    await expect(run()).resolves.toBe('NOOP')
    expect(mocks.createOrUpdateProLookFromMediaAsset).not.toHaveBeenCalled()
    expect(mocks.updateProLookPublication).not.toHaveBeenCalled()
  })

  it('leaves an existing draft look alone when the asset is private', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValueOnce(
      makeMedia({
        visibility: MediaVisibility.PRO_CLIENT,
        isFeaturedInPortfolio: false,
        isEligibleForLooks: false,
        lookPostPrimaryFor: [
          { id: 'look_1', status: LookPostStatus.DRAFT, clientAuthorId: null },
        ],
      }),
    )

    await expect(run()).resolves.toBe('NOOP')
    expect(mocks.updateProLookPublication).not.toHaveBeenCalled()
  })
})
