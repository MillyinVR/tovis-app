import { describe, expect, it } from 'vitest'
import { MediaPhase, MediaType } from '@prisma/client'

import {
  buildFeaturedPairQuery,
  normalizeSeedParam,
} from './featuredPairParams'
import {
  resolveFeaturedPairSeed,
  type FeaturedSeedMedia,
} from './featuredPairSeed'

const MEDIA: FeaturedSeedMedia[] = [
  { id: 'before-img', phase: MediaPhase.BEFORE, mediaType: MediaType.IMAGE },
  { id: 'before-img-2', phase: MediaPhase.BEFORE, mediaType: MediaType.IMAGE },
  { id: 'before-vid', phase: MediaPhase.BEFORE, mediaType: MediaType.VIDEO },
  { id: 'after-img', phase: MediaPhase.AFTER, mediaType: MediaType.IMAGE },
  { id: 'after-vid', phase: MediaPhase.AFTER, mediaType: MediaType.VIDEO },
  { id: 'other-img', phase: MediaPhase.OTHER, mediaType: MediaType.IMAGE },
]

function seed(
  overrides: Partial<Parameters<typeof resolveFeaturedPairSeed>[0]>,
) {
  return resolveFeaturedPairSeed({
    savedBeforeAssetId: null,
    savedAfterAssetId: null,
    paramBeforeAssetId: undefined,
    paramAfterAssetId: undefined,
    media: MEDIA,
    ...overrides,
  })
}

describe('resolveFeaturedPairSeed', () => {
  it('falls back to the saved pair when no params are carried (key absent)', () => {
    expect(
      seed({
        savedBeforeAssetId: 'before-img',
        savedAfterAssetId: 'after-img',
      }),
    ).toEqual({
      featuredBeforeAssetId: 'before-img',
      featuredAfterAssetId: 'after-img',
    })
  })

  it('returns null/null when nothing is saved and nothing is carried', () => {
    expect(seed({})).toEqual({
      featuredBeforeAssetId: null,
      featuredAfterAssetId: null,
    })
  })

  it('does not re-validate the saved value (trusts what was persisted)', () => {
    // A saved id that is not present in `media` still passes through untouched
    // — the FK's onDelete:SetNull already clears a deleted photo.
    expect(
      seed({
        savedBeforeAssetId: 'gone-from-media',
        savedAfterAssetId: 'after-img',
      }),
    ).toEqual({
      featuredBeforeAssetId: 'gone-from-media',
      featuredAfterAssetId: 'after-img',
    })
  })

  it('lets a carried pick win over a stale saved value', () => {
    expect(
      seed({
        savedBeforeAssetId: 'before-img',
        savedAfterAssetId: 'after-img',
        paramBeforeAssetId: 'before-img-2',
        paramAfterAssetId: 'after-img',
      }),
    ).toEqual({
      featuredBeforeAssetId: 'before-img-2',
      featuredAfterAssetId: 'after-img',
    })
  })

  it('treats an empty-string param as an explicit clear (not a fallback)', () => {
    expect(
      seed({
        savedBeforeAssetId: 'before-img',
        savedAfterAssetId: 'after-img',
        paramBeforeAssetId: '',
        paramAfterAssetId: '',
      }),
    ).toEqual({
      featuredBeforeAssetId: null,
      featuredAfterAssetId: null,
    })
  })

  it('resolves each field independently (one carried, one absent)', () => {
    expect(
      seed({
        savedBeforeAssetId: 'before-img',
        savedAfterAssetId: 'after-img',
        paramBeforeAssetId: 'before-img-2',
        // after param absent → keep saved after
        paramAfterAssetId: undefined,
      }),
    ).toEqual({
      featuredBeforeAssetId: 'before-img-2',
      featuredAfterAssetId: 'after-img',
    })
  })

  it('drops a carried id that is not on this booking', () => {
    expect(
      seed({
        paramBeforeAssetId: 'not-a-real-id',
        paramAfterAssetId: 'after-img',
      }),
    ).toEqual({
      featuredBeforeAssetId: null,
      featuredAfterAssetId: 'after-img',
    })
  })

  it('drops a carried id whose phase does not match the field', () => {
    // An AFTER image carried as the BEFORE param, and a BEFORE image as AFTER.
    expect(
      seed({
        paramBeforeAssetId: 'after-img',
        paramAfterAssetId: 'before-img',
      }),
    ).toEqual({
      featuredBeforeAssetId: null,
      featuredAfterAssetId: null,
    })
  })

  it('drops a carried VIDEO id (only images are featurable)', () => {
    expect(
      seed({
        paramBeforeAssetId: 'before-vid',
        paramAfterAssetId: 'after-vid',
      }),
    ).toEqual({
      featuredBeforeAssetId: null,
      featuredAfterAssetId: null,
    })
  })

  it('trims surrounding whitespace on a carried id before validating', () => {
    expect(
      seed({
        paramBeforeAssetId: '  before-img  ',
        paramAfterAssetId: '  after-img  ',
      }),
    ).toEqual({
      featuredBeforeAssetId: 'before-img',
      featuredAfterAssetId: 'after-img',
    })
  })
})

describe('featuredPairParams', () => {
  it('always emits both keys, empty when unset, so absent vs cleared is distinguishable', () => {
    expect(buildFeaturedPairQuery(null, null)).toBe('fb=&fa=')
    expect(buildFeaturedPairQuery('b1', 'a1')).toBe('fb=b1&fa=a1')
    expect(buildFeaturedPairQuery('b1', null)).toBe('fb=b1&fa=')
  })

  it('round-trips through resolveFeaturedPairSeed via URLSearchParams', () => {
    const qs = buildFeaturedPairQuery('before-img', null)
    const params = new URLSearchParams(qs)
    const result = resolveFeaturedPairSeed({
      savedBeforeAssetId: 'stale-before',
      savedAfterAssetId: 'stale-after',
      paramBeforeAssetId: normalizeSeedParam(params.get('fb') ?? undefined),
      paramAfterAssetId: normalizeSeedParam(params.get('fa') ?? undefined),
      media: MEDIA,
    })
    // fb carried a valid id → wins; fa carried empty → explicit clear.
    expect(result).toEqual({
      featuredBeforeAssetId: 'before-img',
      featuredAfterAssetId: null,
    })
  })

  it('normalizeSeedParam collapses arrays and preserves undefined', () => {
    expect(normalizeSeedParam('x')).toBe('x')
    expect(normalizeSeedParam(['x', 'y'])).toBe('x')
    expect(normalizeSeedParam([])).toBeUndefined()
    expect(normalizeSeedParam(undefined)).toBeUndefined()
  })
})
