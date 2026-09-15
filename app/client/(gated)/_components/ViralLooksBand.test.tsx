// The viral band's destination and its count — the two halves of the overclaim.
//
// Both are pinned by reading the SOURCE rather than by rendering, because the
// failure mode here was never a wrong render: it was three `/search?q=` links
// where someone fixed the first one they found, and a count field whose name
// stopped matching what it held.
import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const SOURCE = fs.readFileSync(
  path.join(process.cwd(), 'app/client/(gated)/_components/ViralLooksBand.tsx'),
  'utf8',
)

describe('where a live viral look leads', () => {
  it('sends every live look to its own page, never to a text search', () => {
    // Tori, 2026-09-15: the look leads to the pros who opted in. `/search?q=`
    // returned whatever the NAME matched — pros who had never heard of it.
    expect(SOURCE).not.toMatch(/\/search\?q=/)
  })

  it('links all three live entry points, not just the first one found', () => {
    // Two in LiveLookHero (the CTA and the waitlist bridge) and one on
    // LiveLookStrip. A previous pass fixed one and left two.
    const links = SOURCE.match(/href=\{viralLookPath\(live\.id\)\}/g) ?? []
    expect(links).toHaveLength(3)
  })

  it('builds the href through the shared route helper', () => {
    // Not a hand-written `/client/viral/${id}`: the helper is where the "NOT
    // under /looks, that prefix is an associated Universal Link" reasoning
    // lives, and an inline template string would quietly escape it.
    expect(SOURCE).toMatch(/import \{ viralLookPath \} from '@\/lib\/routes'/)
  })
})

describe('what the count counts', () => {
  it('reads the opt-in count on live looks, never the fan-out', () => {
    // `_count.approvalFanOuts` was DELIVERY — pros we managed to notify. The
    // copy beside it says "now offer this".
    expect(SOURCE).toMatch(/const proCount = live\._count\.proOffers/)
    expect(SOURCE).not.toMatch(/live\._count\.approvalFanOuts/)
  })

  it('makes the verb agree, because ONE pro is now the ordinary case', () => {
    // Counting fan-outs, a matched look almost always had several; counting
    // opt-ins, the first pro to say yes leaves the count at exactly 1. The old
    // `${n} ${n === 1 ? 'pro' : 'pros'} now offer this` rendered the sentence
    // "1 pro now offer this" on the surface this slice makes reachable.
    expect(SOURCE).not.toMatch(/'pro' : 'pros'\} now offer this/)
    const singular = SOURCE.match(/'1 pro now offers this'/g) ?? []
    expect(singular).toHaveLength(2)
  })

  it('keeps the fan-out on the PENDING card, where it is the true statement', () => {
    // "Shared with N pros in your area" is a claim about delivery. Counting
    // opt-ins there would break a line that is currently correct.
    expect(SOURCE).toMatch(/const sharedCount = pending\._count\.approvalFanOuts/)
  })
})
