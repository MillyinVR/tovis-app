// lib/looks/tagSlugParity.ts
//
// The cross-repo parity fixture for the look-tag slug rule.
//
// tovis-ios carries a Swift twin of `slugifyLookTag` (`LooksPath.slugifyTag`,
// with `LooksPath.tagSlug` applying the floor). A twin is only as good as what
// holds it to the original: the iOS assertions were HAND-WRITTEN expected
// values, so nothing tied them to this function. If web changed its slug rule —
// started keeping hyphens, or transliterated `café → cafe` instead of `caf` —
// tag links built on web would resolve to a different feed (or a 404) on the
// phone, silently, with both test suites green.
//
// So the pairs are GENERATED from the real functions below and committed to
// `schema/parity/lookTagSlugs.json`; tovis-ios commits the same file and drives
// its twin over every pair. Changing the rule here changes the fixture, which
// fails the iOS test until the twin is changed to match. Generated, it cannot
// drift; hand-written, it could.
//
// ⚠️ This is NOT a list of cases the rule handles "correctly" — it has no
// opinion on what the rule should be. It is a list of inputs that DISCRIMINATE
// between plausible rules, so that changing the rule is visible rather than
// silent. Adding a case is free; removing one throws away a discriminator.

import { resolveLookTagSlug, slugifyLookTag } from './tags'

/**
 * Inputs chosen because a different-but-plausible slug rule answers them
 * differently. Each comment says which rule the case rules out.
 *
 * 🔴 Several entries are deliberately DECOMPOSED (a base letter followed by a
 * combining mark) and are NOT interchangeable with their precomposed twins.
 * That distinction is the whole point of those cases — see `ASCII_ONLY_JSON`
 * in the generator, which escapes every non-ASCII code point so an editor
 * normalizing the committed file cannot quietly erase it.
 */
export const LOOK_TAG_SLUG_PARITY_INPUTS: readonly string[] = [
  // ── The everyday shapes ────────────────────────────────────────────────
  'Balayage', // lowercasing
  'BALAYAGE', // …from all-caps too
  '90s_Blowout', // underscores dropped, digits kept
  'A1', // a digit is not a separator
  'ab', // exactly at the floor — the accepting side of it

  // ── Separators: rules out "keep hyphens" / "hyphenate spaces" ─────────
  'Money-Piece', // a hyphen is DROPPED, not kept and not a separator
  'baby lights', // a space is DROPPED, not turned into a hyphen
  '  balayage  ', // surrounding whitespace leaves nothing behind
  '#tag', // a stray hash is just another dropped character
  '-1-', // leading/trailing separators do not survive

  // ── Accents: rules out transliteration ───────────────────────────────
  'café', // PRECOMPOSED é → 'caf'. Transliteration would say 'cafe'.
  'café', // DECOMPOSED é → 'cafe': the mark goes, the ASCII 'e' stays.
  'é', // the same pair alone, so the case is visible without the stem
  'naïve', // precomposed ï
  'ÉCLAT', // an accent that is also upper-case
  'straße', // ß lowercases to itself and is not ASCII → dropped
  'ǅungla', // a titlecase digraph: lowercases, still not ASCII

  // ── Case folding that CHANGES LENGTH — the sharpest discriminator ────
  // U+0130 lowercases to 'i' + U+0307 (combining dot above). The ASCII 'i'
  // survives and the mark does not, so this is 'istanbul' / 'i'. A rule that
  // filtered whole grapheme CLUSTERS instead of code points would answer
  // 'stanbul' / '' — which is exactly the divergence this fixture caught in
  // the Swift twin.
  'İstanbul',
  'İ',

  // ── Non-latin / non-ascii: everything drops ──────────────────────────
  'ｆｕｌｌ', // fullwidth latin is not ASCII
  '日本語', // CJK
  '💇', // an emoji (a surrogate pair)
  'ß', // ß alone
  'ﬁne', // the ﬁ ligature does not decompose to ASCII here
  'Ⅻ', // Ⅻ — a NUMBER to Unicode, but not an ASCII digit
  '²', // superscript two — likewise
  '٣', // Arabic-Indic digit three — likewise

  // ── Below the floor: rules out "any non-empty slug resolves" ─────────
  'a', // one character
  '--', // slugs to empty
  '__', // …as does this
  '', // and the empty string itself
]

export type LookTagSlugParityCase = {
  /** The raw segment, exactly as it would arrive in `/looks/tags/{input}`. */
  input: string
  /** `slugifyLookTag(input)` — the normalization, floor NOT applied. */
  slug: string
  /**
   * `resolveLookTagSlug(input)` — what `/looks/tags/{input}` actually resolves
   * to. null below the two-character floor, where `loadLookTagPage` returns
   * null and the phone shows nothing.
   */
  tagSlug: string | null
}

/**
 * Derive the pairs from the REAL functions. The generator and the drift test
 * both call this, so the committed fixture and the assertion can never be
 * computed two different ways.
 */
export function deriveLookTagSlugParityCases(): LookTagSlugParityCase[] {
  return LOOK_TAG_SLUG_PARITY_INPUTS.map((input) => ({
    input,
    slug: slugifyLookTag(input),
    tagSlug: resolveLookTagSlug(input),
  }))
}
