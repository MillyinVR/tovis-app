import { describe, expect, it } from 'vitest'
import { MediaPhase, MediaType, MediaVisibility, Role } from '@prisma/client'
import {
  MediaAssetInvariantError,
  assertMediaAssetInvariant,
  buildMediaAssetCreateData,
  type MediaAssetWriteInput,
} from './recordMediaAsset'

const PRIVATE = 'media-private'
const PUBLIC = 'media-public'

function base(overrides: Partial<MediaAssetWriteInput> = {}): MediaAssetWriteInput {
  return {
    professionalId: 'pro_1',
    proTenantId: 'tenant_1',
    primaryServiceId: 'svc_1',
    storageBucket: PRIVATE,
    storagePath: 'pro/pro_1/x.jpg',
    mediaType: MediaType.IMAGE,
    visibility: MediaVisibility.PRO_CLIENT,
    ...overrides,
  }
}

describe('buildMediaAssetCreateData defaults', () => {
  it('fills optional fields with safe defaults', () => {
    const data = buildMediaAssetCreateData(base())

    expect(data).toMatchObject({
      professionalId: 'pro_1',
      proTenantId: 'tenant_1',
      primaryServiceId: 'svc_1',
      bookingId: null,
      reviewId: null,
      uploadedByUserId: null,
      uploadedByRole: null,
      thumbBucket: null,
      thumbPath: null,
      url: null,
      thumbUrl: null,
      caption: null,
      phase: MediaPhase.OTHER,
      isEligibleForLooks: false,
      isFeaturedInPortfolio: false,
      reviewLocked: false,
    })
  })

  it('passes through provided values', () => {
    const data = buildMediaAssetCreateData(
      base({
        bookingId: 'bk_1',
        uploadedByUserId: 'u_1',
        uploadedByRole: Role.PRO,
        phase: MediaPhase.AFTER,
        caption: 'after shot',
        thumbBucket: PRIVATE,
        thumbPath: 'pro/pro_1/x_thumb.jpg',
      }),
    )

    expect(data).toMatchObject({
      bookingId: 'bk_1',
      uploadedByUserId: 'u_1',
      uploadedByRole: Role.PRO,
      phase: MediaPhase.AFTER,
      caption: 'after shot',
      thumbBucket: PRIVATE,
      thumbPath: 'pro/pro_1/x_thumb.jpg',
    })
  })
})

describe('primaryServiceId invariant', () => {
  it('rejects a blank primaryServiceId', () => {
    expect(() =>
      assertMediaAssetInvariant(base({ primaryServiceId: '   ' })),
    ).toThrow(MediaAssetInvariantError)
  })
})

describe('PRO_CLIENT invariant', () => {
  it('allows PRO_CLIENT in the private bucket', () => {
    expect(() => assertMediaAssetInvariant(base())).not.toThrow()
  })

  it('rejects PRO_CLIENT in the public (world-readable) bucket', () => {
    expect(() =>
      assertMediaAssetInvariant(base({ storageBucket: PUBLIC })),
    ).toThrow(MediaAssetInvariantError)
  })
})

describe('PUBLIC invariant (consent model)', () => {
  it('allows PUBLIC in the public bucket', () => {
    expect(() =>
      assertMediaAssetInvariant(
        base({ visibility: MediaVisibility.PUBLIC, storageBucket: PUBLIC }),
      ),
    ).not.toThrow()
  })

  it('rejects PUBLIC in the private bucket with no review promotion', () => {
    expect(() =>
      assertMediaAssetInvariant(
        base({ visibility: MediaVisibility.PUBLIC, storageBucket: PRIVATE, reviewId: null }),
      ),
    ).toThrow(MediaAssetInvariantError)
  })

  it('allows PUBLIC on review-promoted private media (client consent)', () => {
    expect(() =>
      assertMediaAssetInvariant(
        base({
          visibility: MediaVisibility.PUBLIC,
          storageBucket: PRIVATE,
          reviewId: 'rev_1',
        }),
      ),
    ).not.toThrow()
  })
})

describe('storage pointer invariants', () => {
  it('rejects an empty storagePath', () => {
    expect(() => assertMediaAssetInvariant(base({ storagePath: '   ' }))).toThrow(
      MediaAssetInvariantError,
    )
  })

  it('rejects a thumbBucket without a thumbPath', () => {
    expect(() =>
      assertMediaAssetInvariant(base({ thumbBucket: PRIVATE, thumbPath: null })),
    ).toThrow(MediaAssetInvariantError)
  })
})
