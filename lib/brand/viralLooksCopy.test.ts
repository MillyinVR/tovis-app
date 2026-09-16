// What the viral-look count says — pinned, because the last two defects on this
// sentence were both invisible to typecheck and to every other test.
//
// 1. "1 pro now offer this" — a pluralised noun dropped into a fixed verb.
// 2. "3 pros now offer this" reading as "3 near me" when the query has no
//    geography in it at all (Tori, 2026-09-15: keep it platform-wide, say so).
import { describe, expect, it } from 'vitest'

import {
  viralOfferingLede,
  viralOfferingProCountLabel,
  viralOfferingProsLine,
} from './viralLooksCopy'

// Not 'TOVIS': a literal here would pass while the caller hardcoded its own
// brand string, which is exactly the white-label failure the guard exists for.
const BRAND = 'Brandenburg'

describe('viralOfferingProsLine', () => {
  it('agrees in number at one, which is the ORDINARY case', () => {
    // Counting fan-outs, a matched look almost always had several. Counting
    // opt-ins, every look passes through exactly 1 on its way up.
    expect(viralOfferingProsLine(1, BRAND)).toBe('1 pro on Brandenburg offers this')
  })

  it('agrees in number above one', () => {
    expect(viralOfferingProsLine(3, BRAND)).toBe(
      '3 pros on Brandenburg offer this',
    )
  })

  it('says nobody rather than "0 pros"', () => {
    expect(viralOfferingProsLine(0, BRAND)).toBe(
      'No pro on Brandenburg offers this yet',
    )
  })

  it('treats a negative count as zero rather than rendering it', () => {
    // The pro library decrements this optimistically when a pro withdraws, and
    // a stale row could in principle take it under zero before the server
    // answers. "-1 pros offer this" must not be reachable.
    expect(viralOfferingProsLine(-1, BRAND)).toBe(
      'No pro on Brandenburg offers this yet',
    )
  })

  it('names the brand in every branch that states a count', () => {
    for (const count of [0, 1, 2, 17]) {
      expect(viralOfferingProsLine(count, BRAND)).toContain(BRAND)
    }
  })
})

describe('viralOfferingLede', () => {
  it('agrees in number, and names the scope once there is a count to scope', () => {
    expect(viralOfferingLede(1, BRAND)).toBe(
      '1 pro on Brandenburg has said they can do this look.',
    )
    expect(viralOfferingLede(4, BRAND)).toBe(
      '4 pros on Brandenburg have said they can do this look.',
    )
  })

  it('does not name a scope at zero, because there is no number to scope', () => {
    // "No pro on Brandenburg has taken this one on" would be a wider claim than
    // the query supports reading as narrower than it is. Zero is just zero.
    expect(viralOfferingLede(0, BRAND)).toBe('No pro has taken this one on yet.')
    expect(viralOfferingLede(0, BRAND)).not.toContain(BRAND)
  })

  it('ends its sentences, unlike the card line', () => {
    for (const count of [0, 1, 6]) {
      expect(viralOfferingLede(count, BRAND)).toMatch(/\.$/)
    }
  })
})

describe('viralOfferingProCountLabel', () => {
  it('is a subject phrase with no verb to disagree with', () => {
    expect(viralOfferingProCountLabel(1, BRAND)).toBe('1 pro on Brandenburg')
    expect(viralOfferingProCountLabel(5, BRAND)).toBe('5 pros on Brandenburg')
  })
})

describe('the scope every count-bearing string carries', () => {
  it('never implies proximity', () => {
    // There is no geography in `findMatchingProsByRequestedCategory` — it
    // filters on the requested category and public pro visibility, nothing
    // else. Any of these words would be a promise the product cannot keep.
    const strings = [0, 1, 3].flatMap((count) => [
      viralOfferingProsLine(count, BRAND),
      viralOfferingLede(count, BRAND),
      viralOfferingProCountLabel(count, BRAND),
    ])

    for (const value of strings) {
      expect(value).not.toMatch(/near|nearby|in your area|around you|local/i)
    }
  })
})
