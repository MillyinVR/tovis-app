import { describe, expect, it } from 'vitest'

import {
  canProSharePublicly,
  isUnpromotedPrivateMedia,
} from '@/lib/media/publicShareGuard'

describe('publicShareGuard', () => {
  it('blocks unpromoted private-bucket media (a raw before/after session photo)', () => {
    const media = { storageBucket: 'media-private', reviewId: null }
    expect(isUnpromotedPrivateMedia(media)).toBe(true)
    expect(canProSharePublicly(media)).toBe(false)
  })

  it('allows private media once the client promoted it via a review', () => {
    const media = { storageBucket: 'media-private', reviewId: 'review_1' }
    expect(isUnpromotedPrivateMedia(media)).toBe(false)
    expect(canProSharePublicly(media)).toBe(true)
  })

  it('allows public-bucket media (the pro’s own portfolio/Looks uploads)', () => {
    expect(canProSharePublicly({ storageBucket: 'media-public', reviewId: null })).toBe(true)
    expect(canProSharePublicly({ storageBucket: 'media-public', reviewId: 'review_1' })).toBe(true)
  })

  it('treats unknown/null bucket as not-private (cannot be a private session photo)', () => {
    expect(canProSharePublicly({ storageBucket: null, reviewId: null })).toBe(true)
  })

  it('allows private media once the client granted aftercare media-use consent (B3b)', () => {
    const media = {
      storageBucket: 'media-private',
      reviewId: null,
      clientUseConsentAt: new Date(),
    }
    expect(isUnpromotedPrivateMedia(media)).toBe(false)
    expect(canProSharePublicly(media)).toBe(true)
  })

  it('still blocks when consent is null (not granted)', () => {
    const media = {
      storageBucket: 'media-private',
      reviewId: null,
      clientUseConsentAt: null,
    }
    expect(canProSharePublicly(media)).toBe(false)
  })
})
