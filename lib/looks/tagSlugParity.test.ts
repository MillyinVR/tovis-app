// lib/looks/tagSlugParity.test.ts
//
// The web half of the look-tag slug parity contract.
//
// `schema/parity/lookTagSlugs.json` is GENERATED from `slugifyLookTag` /
// `resolveLookTagSlug`. tovis-ios commits the same file and drives its Swift
// twin (`LooksPath.slugifyTag` / `LooksPath.tagSlug`) over every pair. This
// test is what makes the committed file trustworthy: change the slug rule
// without regenerating and it fails here, on the PR that changed it, instead of
// the fixture quietly describing a rule the code no longer implements.
//
// The forcing function is the ORDER of those two failures. Regenerate, and the
// fixture changes; the iOS copy no longer matches (caught by
// `check:ios-parity-fixtures`), and once it is updated the Swift twin has to
// reproduce the new pairs or the iOS test goes red. A rule change cannot reach
// production on one platform only.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { deriveLookTagSlugParityCases, LOOK_TAG_SLUG_PARITY_INPUTS } from './tagSlugParity'
import {
  LOOK_TAG_SLUG_FIXTURE_PATH,
  renderLookTagSlugFixture,
} from './tagSlugParityFixture'
import { MIN_LOOK_TAG_SLUG_LENGTH, resolveLookTagSlug, slugifyLookTag } from './tags'

const committed = readFileSync(
  resolve(process.cwd(), LOOK_TAG_SLUG_FIXTURE_PATH),
  'utf8',
)

describe('look-tag slug parity fixture', () => {
  // 🔴 The one that matters. Byte equality, not deep equality of the parsed
  // objects: the escaping and the ordering are part of the contract (see
  // `asciiOnly` — the decomposed cases stop being decomposed if the file is
  // ever normalized), and only comparing the bytes notices that.
  it('is in sync with the real slug functions (regenerate: pnpm gen:look-tag-slug-fixture)', () => {
    expect(committed).toBe(renderLookTagSlugFixture())
  })

  it('is pure ASCII, so nothing can normalize the decomposed cases away', () => {
    // eslint-disable-next-line no-control-regex
    expect(/[^\x00-\x7f]/.test(committed)).toBe(false)
  })

  // The fixture's value is entirely in the cases that DISCRIMINATE. These
  // assertions name the rules each one rules out, so deleting a case is a
  // visible act rather than a silent loss of coverage.
  it('keeps the cases that discriminate between plausible slug rules', () => {
    const cases = deriveLookTagSlugParityCases()
    const bySlug = (input: string) =>
      cases.find((c) => c.input === input)?.slug

    // Not transliteration: a precomposed accent is DROPPED, not folded to 'e'.
    expect(bySlug('café')).toBe('caf')
    // …and the decomposed spelling of the same word answers differently,
    // because there the 'e' is a real ASCII letter. The two must stay distinct
    // entries — if the file is ever NFC-normalized they collapse into one.
    expect(bySlug('café')).toBe('cafe')
    expect(bySlug('café')).not.toBe(bySlug('café'))

    // Not "keep hyphens", and not "spaces become hyphens".
    expect(bySlug('Money-Piece')).toBe('moneypiece')
    expect(bySlug('baby lights')).toBe('babylights')

    // Case folding that CHANGES LENGTH: U+0130 lowercases to 'i' + a combining
    // mark. The ASCII 'i' survives. A rule that filtered whole grapheme
    // CLUSTERS would answer 'stanbul' — the divergence this fixture caught in
    // the Swift twin.
    expect(bySlug('İstanbul')).toBe('istanbul')

    // Unicode "numbers" that are not ASCII digits are dropped, not kept.
    expect(bySlug('Ⅻ')).toBe('')
    expect(bySlug('٣')).toBe('')
  })

  it('exercises both sides of the two-character floor', () => {
    const cases = deriveLookTagSlugParityCases()
    expect(cases.some((c) => c.tagSlug === null && c.slug.length === 1)).toBe(true)
    expect(cases.some((c) => c.tagSlug === null && c.slug.length === 0)).toBe(true)
    expect(cases.some((c) => c.tagSlug !== null && c.slug.length === MIN_LOOK_TAG_SLUG_LENGTH)).toBe(true)
  })

  it('has no duplicate inputs — a duplicate is a discriminator someone lost', () => {
    expect(new Set(LOOK_TAG_SLUG_PARITY_INPUTS).size).toBe(
      LOOK_TAG_SLUG_PARITY_INPUTS.length,
    )
  })

  // `resolveLookTagSlug` is now the single implementation of the floor, shared
  // by `parseLookTags` and `loadLookTagPage` (they each had their own copy of
  // the same two lines). Pin the relationship so a future edit cannot make the
  // resolved value disagree with the raw slug it is supposed to be.
  it('resolveLookTagSlug is slugifyLookTag plus the floor, nothing else', () => {
    for (const input of LOOK_TAG_SLUG_PARITY_INPUTS) {
      const slug = slugifyLookTag(input)
      expect(resolveLookTagSlug(input)).toBe(
        slug.length >= MIN_LOOK_TAG_SLUG_LENGTH ? slug : null,
      )
    }
  })
})
