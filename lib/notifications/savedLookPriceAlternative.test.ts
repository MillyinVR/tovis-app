// lib/notifications/savedLookPriceAlternative.test.ts
//
// Pure-core coverage for the §6.8 price-alternative trigger: the over-budget /
// in-band predicates, candidate selection (band gate, above-band gate, tenant-scoped
// alternative match, one-per-pair freshest hook, exclusions), per-client budget
// allocation (mute + pooled cap + freshest-first order), the price-invisible copy
// contract, and the cooldown-bucketed dedupeKey.

import { describe, expect, it } from 'vitest'

import type { LearnedPriceBand } from '@/lib/looks/personalizedRanking'

import {
  PRICE_ALTERNATIVE_TRIGGER,
  SAVED_LOOK_PRICE_ALTERNATIVE,
  allocatePriceAlternatives,
  buildPriceAlternativeDedupeKey,
  composePriceAlternativeCopy,
  isAboveBand,
  isInBand,
  selectPriceAlternativeCandidates,
  tenantCategoryKey,
  type AlternativeLook,
  type PriceAlternativeCandidate,
  type PricedSaveRow,
} from './savedLookPriceAlternative'

const NOW = new Date('2026-07-15T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
const TENANT = 'tenant-root'

// A $60-usual client: logCenter = ln(60), band trusted (3 priced bookings).
const BAND: LearnedPriceBand = { logCenter: Math.log(60), sampleCount: 3 }

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * DAY_MS)
}

function save(overrides: Partial<PricedSaveRow> = {}): PricedSaveRow {
  return {
    clientId: 'client-1',
    professionalId: 'pro-expensive',
    lookPostId: 'look-saved',
    savedAt: daysAgo(10),
    tenantId: TENANT,
    categorySlug: 'balayage',
    price: 200, // > 3× the $60 band center → over budget
    ...overrides,
  }
}

function alt(overrides: Partial<AlternativeLook> = {}): AlternativeLook {
  return {
    lookPostId: 'look-alt',
    professionalId: 'pro-affordable',
    price: 75, // ≤ 1.5× the $60 band center → in band
    rankScore: 10,
    proName: 'Ann Rivera',
    ...overrides,
  }
}

function altPool(
  looks: AlternativeLook[],
  tenantId = TENANT,
  slug = 'balayage',
): Map<string, AlternativeLook[]> {
  return new Map([[tenantCategoryKey(tenantId, slug), looks]])
}

describe('isAboveBand / isInBand', () => {
  it('flags a look ~3×+ the band center as over budget, but not one merely pricey', () => {
    expect(isAboveBand(200, BAND)).toBe(true) // ~3.3× 60 → clearly over budget
    expect(isAboveBand(179, BAND)).toBe(false) // just under 3× → not yet a blocker
    expect(isAboveBand(120, BAND)).toBe(false) // 2× — pricey but not "blocked"
    expect(isAboveBand(60, BAND)).toBe(false)
  })

  it('treats up to ~1.5× the center as in band, cheaper always in band', () => {
    expect(isInBand(89, BAND)).toBe(true) // just under 1.5× 60 → in band
    expect(isInBand(75, BAND)).toBe(true)
    expect(isInBand(30, BAND)).toBe(true) // cheaper is fine (no floor)
    expect(isInBand(120, BAND)).toBe(false) // 2× — above the in-band ceiling
  })

  it('rejects non-positive / malformed prices from both predicates', () => {
    expect(isAboveBand(0, BAND)).toBe(false)
    expect(isAboveBand(Number.NaN, BAND)).toBe(false)
    expect(isInBand(-5, BAND)).toBe(false)
  })
})

describe('buildPriceAlternativeDedupeKey', () => {
  it('is stable inside a cooldown window and rolls to a new bucket after it', () => {
    const cooldownMs = SAVED_LOOK_PRICE_ALTERNATIVE.cooldownDays * DAY_MS
    const bucketStart = Math.floor(NOW.getTime() / cooldownMs) * cooldownMs
    const key = (offsetMs: number) =>
      buildPriceAlternativeDedupeKey({
        clientId: 'c',
        professionalId: 'p',
        now: new Date(bucketStart + offsetMs),
      })

    const early = key(1000)
    expect(early).toContain('saved-price-alt:c:p:')
    expect(key(cooldownMs - 1000)).toBe(early) // same window
    expect(key(cooldownMs)).not.toBe(early) // next window
  })
})

describe('selectPriceAlternativeCandidates', () => {
  const base = {
    bandsByClient: new Map([['client-1', BAND]]),
    alternativesByCategory: altPool([alt()]),
    bookedPairs: new Set<string>(),
    alreadyNotifiedDedupeKeys: new Set<string>(),
    now: NOW,
  }

  it('emits a candidate for an over-budget save with an in-band alternative', () => {
    const out = selectPriceAlternativeCandidates({ ...base, saves: [save()] })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      clientId: 'client-1',
      professionalId: 'pro-expensive', // dedupe identity = the over-budget pro
      blockedLookPostId: 'look-saved',
      alternativeLookPostId: 'look-alt',
      alternativeProfessionalId: 'pro-affordable',
      alternativeProName: 'Ann Rivera',
      trigger: PRICE_ALTERNATIVE_TRIGGER,
    })
  })

  it('skips a client with no learned band (unknown budget)', () => {
    const out = selectPriceAlternativeCandidates({
      ...base,
      bandsByClient: new Map(),
      saves: [save()],
    })
    expect(out).toEqual([])
  })

  it('skips an in-budget save (price_fit handles those in the feed)', () => {
    const out = selectPriceAlternativeCandidates({
      ...base,
      saves: [save({ price: 70 })], // near the band, not a blocker
    })
    expect(out).toEqual([])
  })

  it('skips a pair the client already booked', () => {
    const out = selectPriceAlternativeCandidates({
      ...base,
      saves: [save()],
      bookedPairs: new Set(['client-1::pro-expensive']),
    })
    expect(out).toEqual([])
  })

  it('skips a pair already nudged this window', () => {
    const dedupeKey = buildPriceAlternativeDedupeKey({
      clientId: 'client-1',
      professionalId: 'pro-expensive',
      now: NOW,
    })
    const out = selectPriceAlternativeCandidates({
      ...base,
      saves: [save()],
      alreadyNotifiedDedupeKeys: new Set([dedupeKey]),
    })
    expect(out).toEqual([])
  })

  it('never offers the same pro, the same look, or an out-of-band alternative', () => {
    // Pool: the over-budget pro's own look, the saved look, and an out-of-band look —
    // none eligible → no candidate.
    const out = selectPriceAlternativeCandidates({
      ...base,
      saves: [save()],
      alternativesByCategory: altPool([
        alt({ professionalId: 'pro-expensive', lookPostId: 'x1' }), // same pro
        alt({ lookPostId: 'look-saved' }), // same look
        alt({ lookPostId: 'x2', price: 300 }), // out of band
      ]),
    })
    expect(out).toEqual([])
  })

  it('picks the highest-rankScore eligible alternative (pool is pre-sorted)', () => {
    const out = selectPriceAlternativeCandidates({
      ...base,
      saves: [save()],
      alternativesByCategory: altPool([
        alt({ lookPostId: 'best', proName: 'Best', rankScore: 30 }),
        alt({ lookPostId: 'second', proName: 'Second', rankScore: 10 }),
      ]),
    })
    expect(out[0]?.alternativeLookPostId).toBe('best')
  })

  it('only matches alternatives in the same tenant + category', () => {
    // Alternative exists, but under a DIFFERENT tenant key → no match.
    const out = selectPriceAlternativeCandidates({
      ...base,
      saves: [save()],
      alternativesByCategory: altPool([alt()], 'other-tenant'),
    })
    expect(out).toEqual([])
  })

  it('keeps one candidate per (client, over-budget pro), hooking the freshest save', () => {
    const out = selectPriceAlternativeCandidates({
      ...base,
      saves: [
        save({ lookPostId: 'old', savedAt: daysAgo(40) }),
        save({ lookPostId: 'fresh', savedAt: daysAgo(6) }),
      ],
    })
    expect(out).toHaveLength(1)
    expect(out[0]?.blockedLookPostId).toBe('fresh')
  })
})

describe('allocatePriceAlternatives', () => {
  function candidate(
    overrides: Partial<PriceAlternativeCandidate> = {},
  ): PriceAlternativeCandidate {
    return {
      clientId: 'client-1',
      professionalId: 'pro-expensive',
      blockedLookPostId: 'look-saved',
      savedAt: daysAgo(10),
      categorySlug: 'balayage',
      alternativeLookPostId: 'look-alt',
      alternativeProfessionalId: 'pro-affordable',
      alternativeProName: 'Ann Rivera',
      dedupeKey: 'dk',
      trigger: PRICE_ALTERNATIVE_TRIGGER,
      ...overrides,
    }
  }

  it('drops muted recipients before spending budget (opt-out signal)', () => {
    const out = allocatePriceAlternatives({
      candidates: [candidate()],
      sentCountByClient: new Map(),
      mutedClients: new Set(['client-1']),
    })
    expect(out.granted).toEqual([])
    expect(out.mutedOptOut).toBe(1)
  })

  it('honors the pooled weekly cap, freshest-save first', () => {
    const out = allocatePriceAlternatives({
      candidates: [
        candidate({ professionalId: 'p-old', dedupeKey: 'a', savedAt: daysAgo(30) }),
        candidate({ professionalId: 'p-new', dedupeKey: 'b', savedAt: daysAgo(6) }),
      ],
      sentCountByClient: new Map([['client-1', 2]]), // one slot left (cap 3)
      mutedClients: new Set(),
    })
    expect(out.granted).toHaveLength(1)
    expect(out.granted[0]?.professionalId).toBe('p-new') // freshest wins the slot
    expect(out.budgetBlocked).toBe(1)
  })
})

describe('composePriceAlternativeCopy', () => {
  const copy = composePriceAlternativeCopy({
    candidate: {
      professionalId: 'pro-expensive',
      blockedLookPostId: 'look-saved',
      alternativeLookPostId: 'look-alt',
      alternativeProfessionalId: 'pro-affordable',
      alternativeProName: 'Ann Rivera',
    },
  })

  it('names the alternative pro and links to the alternative look', () => {
    expect(copy.title).toBe('Ann Rivera has a similar look')
    expect(copy.href).toBe('/looks/look-alt')
    expect(copy.data.alternativeLookPostId).toBe('look-alt')
    expect(copy.data.trigger).toBe(PRICE_ALTERNATIVE_TRIGGER)
  })

  it('never mentions price, budget, or "cheaper" (the band is selection, not judgment)', () => {
    const text = `${copy.title} ${copy.body}`.toLowerCase()
    for (const word of ['price', 'budget', 'cheap', 'afford', 'expensive', '$']) {
      expect(text).not.toContain(word)
    }
  })

  it('falls back to a neutral, brand-free name', () => {
    const fallback = composePriceAlternativeCopy({
      candidate: {
        professionalId: 'p',
        blockedLookPostId: 'l',
        alternativeLookPostId: 'a',
        alternativeProfessionalId: 'ap',
        alternativeProName: '   ',
      },
    })
    expect(fallback.title).toBe('Another pro has a similar look')
  })
})
