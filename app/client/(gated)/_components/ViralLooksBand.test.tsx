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

  it('states the count through the shared copy, on BOTH live surfaces', () => {
    // The hero and the strip each spelled the sentence out, and the pluralised
    // `${n} ${n === 1 ? 'pro' : 'pros'} now offer this` on both of them
    // rendered "1 pro now offer this" — the singular branch became the ordinary
    // case the moment the count started counting opt-ins. One definition, in
    // lib/brand/viralLooksCopy.ts, is what stops the next edit fixing one of
    // the two. The zero branches are deliberately NOT count sentences: the hero
    // and strip say "Newly approved".
    expect(SOURCE).not.toMatch(/'pro' : 'pros'\} now offer/)
    const calls = SOURCE.match(/viralOfferingProsLine\(proCount, brandName\)/g) ?? []
    expect(calls).toHaveLength(2)
  })

  it('takes the brand name as a prop rather than naming a brand', () => {
    // The sentence names the platform to make the count's scope explicit (Tori,
    // 2026-09-15). A literal here would ship one tenant's brand to another and
    // would fail check:no-hardcoded-brand-strings.
    expect(SOURCE).toMatch(/brandName: string/)
  })

  it('keeps the fan-out on the PENDING card, where delivery is the claim', () => {
    // "Shared with N pros" is a claim about delivery, which is exactly what a
    // fan-out row records. Counting opt-ins there would break a true line.
    expect(SOURCE).toMatch(/const sharedCount = pending\._count\.approvalFanOuts/)
  })

  it('does not claim the pros it shared with are near the client', () => {
    // The line read "Shared with N pros IN YOUR AREA".
    // `findMatchingProsByRequestedCategory` filters on the requested category
    // and on public pro visibility — there is no geography in it, and never
    // was. The fan-out count is honest; "in your area" was not.
    expect(SOURCE).not.toMatch(/in your area/i)
  })
})
