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

describe('crop rect completeness (item 2)', () => {
  it('writes a valid rect through unchanged', () => {
    const data = buildMediaAssetCreateData(
      base({ cropX: 0.25, cropY: 0.1, cropW: 0.5, cropH: 0.4 }),
    )

    expect(data).toMatchObject({
      cropX: 0.25,
      cropY: 0.1,
      cropW: 0.5,
      cropH: 0.4,
    })
  })

  it('leaves all four null when no crop was supplied — the full stored frame', () => {
    const data = buildMediaAssetCreateData(base())

    expect(data).toMatchObject({
      cropX: null,
      cropY: null,
      cropW: null,
      cropH: null,
    })
  })

  // 🔴 The invariant. Three columns set and one null is not a degraded crop, it
  // is an unanswerable one — a renderer given it has no honest frame to draw.
  // The choke point normalizes it away rather than letting it reach the row.
  it.each([
    ['no width', { cropX: 0.25, cropY: 0.1, cropH: 0.4 }],
    ['no origin', { cropW: 0.5, cropH: 0.4 }],
    ['off the edge of the image', { cropX: 0.7, cropY: 0.1, cropW: 0.5, cropH: 0.4 }],
    ['zero extent', { cropX: 0.25, cropY: 0.1, cropW: 0, cropH: 0.4 }],
  ])('normalizes an unusable rect (%s) to all-null', (_label, crop) => {
    const data = buildMediaAssetCreateData(base(crop))

    expect(data).toMatchObject({
      cropX: null,
      cropY: null,
      cropW: null,
      cropH: null,
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
