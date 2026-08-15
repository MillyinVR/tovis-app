import { describe, expect, it } from 'vitest'

import {
  canProSharePublicly,
  isUnpromotedPrivateMedia,
} from '@/lib/media/publicShareGuard'

/** A pro's own upload: no booking behind it, in the public bucket. */
const proUpload = {
  bookingId: null,
  storageBucket: 'media-public',
  reviewId: null,
}

/** A photo taken during a client's appointment. */
const sessionPhoto = {
  bookingId: 'booking_1',
  storageBucket: 'media-private',
  reviewId: null,
}

describe('publicShareGuard', () => {
  it('blocks an unreleased session photo (a raw before/after)', () => {
    expect(isUnpromotedPrivateMedia(sessionPhoto)).toBe(true)
    expect(canProSharePublicly(sessionPhoto)).toBe(false)
  })

  it('allows it once the client promoted it via a review', () => {
    const media = { ...sessionPhoto, reviewId: 'review_1' }
    expect(isUnpromotedPrivateMedia(media)).toBe(false)
    expect(canProSharePublicly(media)).toBe(true)
  })

  it('allows it once the client granted aftercare media-use consent (B3b)', () => {
    const media = { ...sessionPhoto, clientUseConsentAt: new Date() }
    expect(isUnpromotedPrivateMedia(media)).toBe(false)
    expect(canProSharePublicly(media)).toBe(true)
  })

  it('still blocks when consent is explicitly null (not granted)', () => {
    expect(canProSharePublicly({ ...sessionPhoto, clientUseConsentAt: null })).toBe(
      false,
    )
  })

  it('allows the pro’s own uploads (no booking behind them)', () => {
    expect(canProSharePublicly(proUpload)).toBe(true)
    expect(canProSharePublicly({ ...proUpload, reviewId: 'review_1' })).toBe(true)
  })

  // ── Regression: the rule used to key ONLY on the bucket string ──────────────
  //
  // 🔴 These are the cases that made the old implementation fail OPEN. It read
  // `storageBucket === 'media-private'`, so ANY asset whose bucket was not
  // byte-identical to that literal was classified as the pro's to publish —
  // meaning a bucket rename, a storage migration or a new upload path would
  // have silently turned clients' session photos into publishable ones, with
  // nothing failing. A prior test even pinned that behaviour as correct
  // ("unknown/null bucket … cannot be a private session photo").
  //
  // Provenance is now the primary signal, so the bucket may be anything.
  describe('does not depend on the bucket string alone', () => {
    it('blocks a session photo in a RENAMED bucket', () => {
      const media = { ...sessionPhoto, storageBucket: 'media-private-v2' }
      expect(canProSharePublicly(media)).toBe(false)
    })

    it('blocks a session photo with a NULL bucket', () => {
      const media = { ...sessionPhoto, storageBucket: null }
      expect(canProSharePublicly(media)).toBe(false)
    })

    it('blocks a session photo written to the PUBLIC bucket by mistake', () => {
      const media = { ...sessionPhoto, storageBucket: 'media-public' }
      expect(canProSharePublicly(media)).toBe(false)
    })

    it('still blocks private-bucket media even with no booking recorded', () => {
      // Belt-and-braces: the bucket remains an independent reason to refuse, so
      // a legacy row that lost its bookingId is held rather than released.
      const media = { bookingId: null, storageBucket: 'media-private', reviewId: null }
      expect(canProSharePublicly(media)).toBe(false)
    })

    it('allows a genuine pro upload with an unrecognised bucket', () => {
      // No booking and not the private bucket → nothing links it to a client.
      const media = { bookingId: null, storageBucket: 'local-demo-seed', reviewId: null }
      expect(canProSharePublicly(media)).toBe(true)
    })
  })
})
