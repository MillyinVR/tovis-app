// lib/media/mediaVisibility.test.ts
import fs from 'node:fs'
import path from 'node:path'

import { MediaVisibility } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import { BUCKETS } from '@/lib/storageBuckets'
import {
  isPubliclyViewableMediaAsset,
  isVisibilityAllowedForBucket,
  resolveMediaVisibility,
} from '@/lib/media/mediaVisibility'
// The guard script itself, imported so the rule under test is the one CI runs
// — not a copy of it. Plain .mjs; only `violates` is used.
import { violates } from '../../tools/check-media-visibility-boundary.mjs'

const PUBLIC = BUCKETS.mediaPublic
const PRIVATE = BUCKETS.mediaPrivate

describe('isVisibilityAllowedForBucket', () => {
  it('refuses PRO_CLIENT in the world-readable bucket', () => {
    expect(
      isVisibilityAllowedForBucket({
        storageBucket: PUBLIC,
        visibility: MediaVisibility.PRO_CLIENT,
      }),
    ).toBe(false)
  })

  it('allows PRO_CLIENT in the private bucket', () => {
    expect(
      isVisibilityAllowedForBucket({
        storageBucket: PRIVATE,
        visibility: MediaVisibility.PRO_CLIENT,
      }),
    ).toBe(true)
  })

  it('allows PUBLIC in either bucket', () => {
    for (const storageBucket of [PUBLIC, PRIVATE]) {
      expect(
        isVisibilityAllowedForBucket({
          storageBucket,
          visibility: MediaVisibility.PUBLIC,
        }),
      ).toBe(true)
    }
  })
})

describe('resolveMediaVisibility', () => {
  it('🔴 never returns PRO_CLIENT for a public-bucket asset — the defect', () => {
    // The exact shape of the 3 production rows: a pro's own public-bucket
    // upload, retracted (both flags off). The old bucket-blind
    // `computeVisibility(false, false)` returned PRO_CLIENT here, stamping
    // "private" on bytes an unauthenticated GET returns in full.
    expect(
      resolveMediaVisibility({
        storageBucket: PUBLIC,
        isFeaturedInPortfolio: false,
        isEligibleForLooks: false,
      }),
    ).toBe(MediaVisibility.PUBLIC)
  })

  it('returns PRO_CLIENT for a retracted private-bucket asset', () => {
    expect(
      resolveMediaVisibility({
        storageBucket: PRIVATE,
        isFeaturedInPortfolio: false,
        isEligibleForLooks: false,
      }),
    ).toBe(MediaVisibility.PRO_CLIENT)
  })

  it('returns PUBLIC whenever the asset is shown', () => {
    const shown = [
      { isFeaturedInPortfolio: true, isEligibleForLooks: false },
      { isFeaturedInPortfolio: false, isEligibleForLooks: true },
      { isFeaturedInPortfolio: true, isEligibleForLooks: true },
    ]

    for (const flags of shown) {
      for (const storageBucket of [PUBLIC, PRIVATE]) {
        expect(resolveMediaVisibility({ storageBucket, ...flags })).toBe(
          MediaVisibility.PUBLIC,
        )
      }
    }
  })

  it('can never produce a bucket-illegal combination', () => {
    for (const storageBucket of [PUBLIC, PRIVATE]) {
      for (const isFeaturedInPortfolio of [true, false]) {
        for (const isEligibleForLooks of [true, false]) {
          const visibility = resolveMediaVisibility({
            storageBucket,
            isFeaturedInPortfolio,
            isEligibleForLooks,
          })

          expect(
            isVisibilityAllowedForBucket({ storageBucket, visibility }),
          ).toBe(true)
        }
      }
    }
  })
})

describe('isPubliclyViewableMediaAsset', () => {
  const base = {
    visibility: MediaVisibility.PUBLIC,
    isFeaturedInPortfolio: false,
    isEligibleForLooks: false,
    reviewId: null,
  }

  it('🔴 hides a retracted public-bucket asset even though it stays PUBLIC', () => {
    // This is what keeps the write-side fix from becoming a read-side
    // regression: un-featuring must still take the photo off /media/[id].
    expect(isPubliclyViewableMediaAsset(base)).toBe(false)
  })

  it('shows featured, Looks-eligible, and review-promoted media', () => {
    expect(
      isPubliclyViewableMediaAsset({ ...base, isFeaturedInPortfolio: true }),
    ).toBe(true)
    expect(
      isPubliclyViewableMediaAsset({ ...base, isEligibleForLooks: true }),
    ).toBe(true)
    // Review media is written PUBLIC with BOTH flags false — without the
    // reviewId clause every review photo would 404.
    expect(isPubliclyViewableMediaAsset({ ...base, reviewId: 'rev_1' })).toBe(
      true,
    )
  })

  it('never shows PRO_CLIENT media, whatever the flags say', () => {
    expect(
      isPubliclyViewableMediaAsset({
        visibility: MediaVisibility.PRO_CLIENT,
        isFeaturedInPortfolio: true,
        isEligibleForLooks: true,
        reviewId: 'rev_1',
      }),
    ).toBe(false)
  })
})

describe('check:media-visibility-boundary guard', () => {
  // 🔴 The pre-fix hunks, verbatim from the two routes that produced the 3
  // production rows. Embedded rather than read via `git show`: unit-tests.yml
  // checks out shallow (default fetch-depth 1), so an origin/main lookup would
  // fail in CI — and a guard test that cannot run is a guard that is not there.
  const PRE_FIX_PORTFOLIO_DELETE = `
function computeVisibility(isFeaturedInPortfolio: boolean, isEligibleForLooks: boolean): MediaVisibility {
  return isFeaturedInPortfolio || isEligibleForLooks ? MediaVisibility.PUBLIC : MediaVisibility.PRO_CLIENT
}
const updated = await prisma.mediaAsset.update({
  where: { id: mediaId },
  data: {
    isFeaturedInPortfolio: false,
    isEligibleForLooks: false,
    visibility: computeVisibility(false, false),
    beforeAssetId: null,
  },
})
`

  const PRE_FIX_MEDIA_PATCH = `
function normalizeVisibilityFromFlags(flags: {
  isEligibleForLooks: boolean
  isFeaturedInPortfolio: boolean
}): MediaVisibility {
  return flags.isEligibleForLooks || flags.isFeaturedInPortfolio
    ? MediaVisibility.PUBLIC
    : MediaVisibility.PRO_CLIENT
}
const nextVisibility = normalizeVisibilityFromFlags(nextFlags)
const updated = await prisma.mediaAsset.update({
  where: { id: mediaId },
  data: { visibility: nextVisibility },
})
`

  it.each([
    ['portfolio DELETE', PRE_FIX_PORTFOLIO_DELETE],
    ['media PATCH', PRE_FIX_MEDIA_PATCH],
  ])('fires on the pre-fix %s', (_label, source) => {
    expect(violates(source)).toBe(true)
  })

  // Live assertion against the shipped files: reverting either door, or adding
  // a third bucket-blind visibility write to them, turns this red.
  const DOORS = [
    'app/api/v1/pro/media/[id]/portfolio/route.ts',
    'app/api/v1/pro/media/[id]/route.ts',
    'app/api/v1/pro/media/route.ts',
  ]

  it.each(DOORS)('is quiet on the shipped %s', (file) => {
    const full = path.join(process.cwd(), file)
    expect(fs.existsSync(full)).toBe(true)
    expect(violates(fs.readFileSync(full, 'utf8'))).toBe(false)
  })
})
