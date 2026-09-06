// lib/homepage/socialProof.ts
//
// The homepage's two SOCIAL-PROOF slots: the numeric proof band ("looks booked
// straight from the feed", "of last-minute openings refilled", …) and the
// "From the chair" testimonial row.
//
// Both are laid out in the source design (the "Home Page Live" artboard in the
// brand's Claude Design project) with specimen content: 41,208 looks booked,
// 92% of last-minute openings refilled, 6.4 admin hours returned weekly, $1.8M
// recovered, captioned "Platform figures, trailing twelve months" — plus three
// named pros and clients in Austin, Chicago and Atlanta. None of it is real.
// It was written to show the composition, and the platform it describes does
// not yet have the trailing twelve months to measure.
//
// Tori's call (2026-09-06) was to keep the STRUCTURE and gate it off, so the
// slot is ready the day the numbers exist. Two independent conditions have to
// hold before anything renders:
//
//   1. `HOMEPAGE_SOCIAL_PROOF=ON` — the environment opts in, and
//   2. the corresponding array below is non-empty.
//
// The second condition is the one that matters. Flipping an env var must never
// be enough to publish a claim about the business; somebody has to come here
// and write the figure down, next to where it says the figure must be true.
// Until then both arrays stay empty and both sections render nothing — which
// is why the default is safe even if the flag is switched on by accident.

/** Accepted values for `HOMEPAGE_SOCIAL_PROOF`. Anything else reads as OFF. */
export const HOMEPAGE_SOCIAL_PROOF_MODES = ['ON', 'OFF'] as const

export type HomepageSocialProofMode = (typeof HOMEPAGE_SOCIAL_PROOF_MODES)[number]

export const HOMEPAGE_SOCIAL_PROOF_DEFAULT: HomepageSocialProofMode = 'OFF'

/**
 * Which brand token paints a stat's figure. Named rather than free-form so a
 * new stat cannot introduce a raw colour, and so the accent rotation stays
 * inside the Peacock Plume set.
 */
export type HomepageProofTone = 'paper' | 'teal' | 'gold' | 'iris'

export type HomepageProofStat = {
  /**
   * The figure exactly as it should read, formatted — "41,208", "92%", "6.4h".
   * A string, not a number, because these are typeset claims rather than
   * values anything computes with, and the unit is part of the claim.
   */
  readonly value: string
  /** What the figure counts. Sentence case, no trailing period. */
  readonly label: string
  readonly tone: HomepageProofTone
}

export type HomepageVoice = {
  readonly quote: string
  /** "Nadia R. · Color specialist · Austin" — person, role, city. */
  readonly attribution: string
}

/**
 * 🔴 EMPTY ON PURPOSE. Do not restore the design's specimen figures.
 *
 * Every entry added here becomes a public, quantified claim about the
 * business under the caption "Platform figures, trailing twelve months". Add
 * one only when it has been measured against production and you can say from
 * WHAT query, and update the caption if the window is not twelve months.
 */
export const HOMEPAGE_PROOF_STATS: readonly HomepageProofStat[] = []

/**
 * 🔴 EMPTY ON PURPOSE. Do not restore the design's specimen testimonials.
 *
 * These are attributed quotes from named people. Add one only when a real
 * client or pro has actually said it and agreed to be quoted by that name.
 */
export const HOMEPAGE_VOICES: readonly HomepageVoice[] = []

/** The caption under the proof band. Only rendered when a stat is. */
export const HOMEPAGE_PROOF_CAPTION = 'Platform figures, trailing twelve months.'

function socialProofMode(): HomepageSocialProofMode {
  const raw = process.env.HOMEPAGE_SOCIAL_PROOF?.trim()
  const override = HOMEPAGE_SOCIAL_PROOF_MODES.find((mode) => mode === raw)
  return override ?? HOMEPAGE_SOCIAL_PROOF_DEFAULT
}

/**
 * What the homepage should render in its two proof slots. Both arrays are
 * empty unless the flag is ON *and* real content has been written above.
 */
export function homepageSocialProof(): {
  stats: readonly HomepageProofStat[]
  voices: readonly HomepageVoice[]
} {
  if (socialProofMode() !== 'ON') {
    return { stats: [], voices: [] }
  }
  return { stats: HOMEPAGE_PROOF_STATS, voices: HOMEPAGE_VOICES }
}
