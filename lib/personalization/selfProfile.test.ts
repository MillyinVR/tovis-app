// lib/personalization/selfProfile.test.ts
import { describe, expect, it } from 'vitest'

import {
  applySelfProfilePatch,
  extractSelfProfileWriteThrough,
  normalizeSelfProfile,
  parseSelfProfileInput,
  selfProfileInterestCategorySlugs,
  SELF_PROFILE_INTEREST_OPTIONS,
  SELF_PROFILE_QUESTIONS,
} from './selfProfile'
import { BOARD_QUESTION_SETS } from '@/lib/boards/context'

describe('lib/personalization/selfProfile', () => {
  describe('normalizeSelfProfile', () => {
    it('keeps only known keys with valid option values', () => {
      expect(
        normalizeSelfProfile({
          hair_type: 'curly',
          hair_length: 'nope',
          skin_type: ' oily ',
          unknown_key: 'x',
        }),
      ).toEqual({ hair_type: 'curly', skin_type: 'oily' })
    })

    it('returns null for non-objects and empty results', () => {
      expect(normalizeSelfProfile(null)).toBeNull()
      expect(normalizeSelfProfile('curly')).toBeNull()
      expect(normalizeSelfProfile([])).toBeNull()
      expect(normalizeSelfProfile({ hair_type: 'invalid' })).toBeNull()
    })

    it('dedupes interests and drops unknown values, keeping option order', () => {
      expect(
        normalizeSelfProfile({
          interests: ['skincare', 'hair', 'hair', 'not-a-thing', 42],
        }),
      ).toEqual({ interests: ['hair', 'skincare'] })
    })
  })

  describe('parseSelfProfileInput', () => {
    it('leaves absent keys absent and treats null/empty as clears', () => {
      const result = parseSelfProfileInput({ hair_type: null, skin_type: '' })
      expect(result).toEqual({
        ok: true,
        value: { hair_type: null, skin_type: null },
      })
    })

    it('accepts valid values and rejects invalid ones', () => {
      expect(parseSelfProfileInput({ hair_length: 'long' })).toEqual({
        ok: true,
        value: { hair_length: 'long' },
      })

      const bad = parseSelfProfileInput({ hair_length: 'gigantic' })
      expect(bad.ok).toBe(false)
      if (!bad.ok) {
        expect(bad.error.code).toBe('INVALID_SELF_PROFILE_FIELD')
      }
    })

    it('validates interests as a known-value string array (null clears)', () => {
      expect(parseSelfProfileInput({ interests: ['nails', 'brows'] })).toEqual({
        ok: true,
        value: { interests: ['nails', 'brows'] },
      })
      expect(parseSelfProfileInput({ interests: null })).toEqual({
        ok: true,
        value: { interests: null },
      })
      expect(parseSelfProfileInput({ interests: ['nails', 'zzz'] }).ok).toBe(
        false,
      )
      expect(parseSelfProfileInput({ interests: 'nails' }).ok).toBe(false)
    })
  })

  describe('applySelfProfilePatch', () => {
    it('sets, clears, and preserves untouched fields', () => {
      const next = applySelfProfilePatch(
        { hair_type: 'curly', skin_type: 'dry', interests: ['hair'] },
        { skin_type: null, hair_length: 'short' },
      )
      expect(next).toEqual({
        hair_type: 'curly',
        hair_length: 'short',
        interests: ['hair'],
      })
    })

    it('returns null when the patch clears everything', () => {
      expect(
        applySelfProfilePatch({ hair_type: 'wavy' }, { hair_type: null }),
      ).toBeNull()
    })
  })

  describe('extractSelfProfileWriteThrough', () => {
    it('maps person-describing board answers onto self-profile fields', () => {
      expect(
        extractSelfProfileWriteThrough({
          hair_length: 'long',
          current_color: 'brunette',
          skin_type: 'sensitive',
          main_concern: 'redness',
          dress_color: 'red', // occasion answer — never written through
        }),
      ).toEqual({
        hair_length: 'long',
        hair_color: 'brunette',
        skin_type: 'sensitive',
        skin_concern: 'redness',
      })
    })

    it('returns null when nothing person-describing is answered', () => {
      expect(extractSelfProfileWriteThrough({ dress_color: 'red' })).toBeNull()
      expect(extractSelfProfileWriteThrough(null)).toBeNull()
    })
  })

  describe('selfProfileInterestCategorySlugs', () => {
    it('unions category slugs across interests', () => {
      expect(
        selfProfileInterestCategorySlugs({ interests: ['nails', 'skincare'] }),
      ).toEqual(['nails', 'nails-enhancements', 'skincare', 'facials'])
    })

    it('returns empty for missing/empty profiles', () => {
      expect(selfProfileInterestCategorySlugs(null)).toEqual([])
      expect(selfProfileInterestCategorySlugs({ hair_type: 'coily' })).toEqual(
        [],
      )
    })
  })

  describe('board-question value compatibility', () => {
    // The write-through stores board option values directly into self-profile
    // fields, so each mapped pair's option-value sets must stay compatible.
    // This test pins that invariant against drift in either module.
    const pairs: ReadonlyArray<{
      boardType: keyof typeof BOARD_QUESTION_SETS
      boardKey: string
      selfKey: string
    }> = [
      { boardType: 'BRIDAL', boardKey: 'hair_length', selfKey: 'hair_length' },
      {
        boardType: 'COLOR_TRANSFORMATION',
        boardKey: 'current_color',
        selfKey: 'hair_color',
      },
      { boardType: 'SKINCARE', boardKey: 'skin_type', selfKey: 'skin_type' },
      {
        boardType: 'SKINCARE',
        boardKey: 'main_concern',
        selfKey: 'skin_concern',
      },
    ]

    it.each(pairs)(
      '$boardType.$boardKey values are valid $selfKey values',
      ({ boardType, boardKey, selfKey }) => {
        const boardQuestion = BOARD_QUESTION_SETS[boardType].find(
          (question) => question.key === boardKey,
        )
        const selfQuestion = SELF_PROFILE_QUESTIONS.find(
          (question) => question.key === selfKey,
        )
        expect(boardQuestion).toBeDefined()
        expect(selfQuestion).toBeDefined()

        const selfValues = new Set(
          selfQuestion?.options.map((option) => option.value),
        )
        for (const option of boardQuestion?.options ?? []) {
          expect(selfValues.has(option.value)).toBe(true)
        }
      },
    )
  })

  it('interest option category slugs are non-empty', () => {
    for (const option of SELF_PROFILE_INTEREST_OPTIONS) {
      expect(option.categorySlugs.length).toBeGreaterThan(0)
    }
  })
})
