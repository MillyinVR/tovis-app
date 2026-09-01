// lib/consult/bookingProposal.test.ts
//
// B4's derivation rules, exercised without a database. Everything a 3 AM client
// is asked to commit to — and everything the pro's day is sized by — is decided
// in this one pure function, so each rule gets a case that FAILS if the rule is
// relaxed.

import { Prisma, ServiceLocationType } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import { MAX_SLOT_DURATION_MINUTES } from '@/lib/booking/constants'

import {
  deriveConsultBookingProposal,
  type ConsultBookingProposalAnalysisInput,
  type ConsultBookingProposalEnhancementSelection,
  type ConsultBookingProposalEstimateInput,
} from './bookingProposal'
import type { ConsultProMenuOffering } from './proMenu'

const CATEGORY_ID = 'cat_hair_color'

function offering(
  overrides: Partial<ConsultProMenuOffering> & { serviceId: string },
): ConsultProMenuOffering {
  return {
    id: `off_${overrides.serviceId}`,
    offersInSalon: true,
    offersMobile: true,
    salonPriceStartingAt: new Prisma.Decimal('180.00'),
    salonDurationMinutes: 90,
    mobilePriceStartingAt: new Prisma.Decimal('220.00'),
    mobileDurationMinutes: 120,
    ...overrides,
    service: {
      name: `Service ${overrides.serviceId}`,
      description: null,
      categoryId: CATEGORY_ID,
      defaultDurationMinutes: 60,
      ...overrides.service,
    },
  }
}

function estimate(
  lines: Array<{
    serviceId: string
    source?: 'LOOK_LINKED_SERVICE' | 'ANALYSIS_RECOMMENDATION'
  }>,
  status: 'ESTIMATED' | 'REFUSED' = 'ESTIMATED',
): ConsultBookingProposalEstimateInput {
  return {
    status,
    lines: lines.map((line, index) => ({
      id: `line_${line.serviceId}`,
      sortOrder: index,
      serviceId: line.serviceId,
      offeringId: `off_${line.serviceId}`,
      source: line.source ?? (index === 0 ? 'LOOK_LINKED_SERVICE' : 'ANALYSIS_RECOMMENDATION'),
    })),
  }
}

/**
 * One stored analysis recommendation.
 *
 * `serviceId` is what makes it a SERVICE reference — the same link B3 builds a
 * beyond-floor line from, and (B7) the link that carries the client-facing
 * reason back onto the offer. Omitting it produces the SERVICE_CATEGORY form:
 * the matcher found nothing on this pro's menu.
 */
function recommendation(
  serviceIntent: string,
  options: { serviceId?: string; rationale?: string } = {},
): ConsultBookingProposalAnalysisInput[number] {
  return {
    serviceIntent: serviceIntent as ConsultBookingProposalAnalysisInput[number]['serviceIntent'],
    title: `Title ${serviceIntent}`,
    rationale: options.rationale ?? `Because of ${serviceIntent}.`,
    achievability: 'LIKELY_SINGLE_APPOINTMENT',
    discussWithProfessional: true,
    reference: options.serviceId
      ? {
          type: 'SERVICE',
          serviceId: options.serviceId,
          serviceCategoryId: CATEGORY_ID,
        }
      : { type: 'SERVICE_CATEGORY', serviceId: null, serviceCategoryId: CATEGORY_ID },
  }
}

function derive(args: {
  menu: ConsultProMenuOffering[]
  estimate?: ConsultBookingProposalEstimateInput | null
  analysisRecommendations?: ConsultBookingProposalAnalysisInput
  locationType?: ServiceLocationType
  stepMinutes?: number
  enhancementSelection?: ConsultBookingProposalEnhancementSelection
}) {
  return deriveConsultBookingProposal({
    locationType: args.locationType ?? ServiceLocationType.SALON,
    stepMinutes: args.stepMinutes ?? 30,
    bufferMinutes: 15,
    menu: args.menu,
    estimate:
      args.estimate === undefined
        ? estimate([{ serviceId: 'svc_balayage' }])
        : args.estimate,
    // The ordinary path: the analysis recommended real colour work. Note this
    // is NOT "no safety flags" — every analysis carries ALLERGY_HISTORY_UNKNOWN,
    // which is why the gate reads service intents instead.
    analysisRecommendations: args.analysisRecommendations ?? [
      recommendation('BALAYAGE', { serviceId: 'svc_balayage' }),
      recommendation('TONER_GLOSS', { serviceId: 'svc_gloss' }),
    ],
    // 🔴 'ALL' is the DEFAULT HERE ON PURPOSE. It is what availability and the
    // hold pass — the widest thing the booking could become — and it is the
    // reading every case below this line was written against. The client's own
    // selection is exercised in its own block at the bottom of this file.
    enhancementSelection: args.enhancementSelection ?? 'ALL',
  })
}

const floor = offering({ serviceId: 'svc_balayage' })

describe('an estimate is not automatically a proposal', () => {
  // 🔴 The load-bearing case for this whole slice. When the analysis routes to
  // safety prerequisites, B3's estimate legitimately contains the patch/strand
  // test lines AND the chemical floor — the honest PRO-facing answer. That floor
  // is a service the analysis explicitly declined to recommend yet, so it must
  // never become a price a client can commit to unattended at 3 AM.
  it('refuses when the analysis routed to safety prerequisites, however well the menu prices', () => {
    const patch = offering({ serviceId: 'svc_patch' })

    const result = derive({
      menu: [floor, patch],
      estimate: estimate([
        { serviceId: 'svc_balayage' },
        { serviceId: 'svc_patch' },
      ]),
      // What `resolveRecommendations` actually stores when routing blocks
      // chemical work: the tests plus a professional colour review, replacing
      // the colour recommendations entirely.
      analysisRecommendations: [
        recommendation('PATCH_TEST'),
        recommendation('COLOR_CONSULTATION'),
      ],
    })

    expect(result.status).toBe('REFUSED')
    expect(result.refusalCode).toBe('SAFETY_REVIEW_REQUIRED')
    expect(result.lines).toEqual([])
  })

  it('refuses on a STRAND_TEST as well as a PATCH_TEST', () => {
    const result = derive({
      menu: [floor],
      analysisRecommendations: [
        recommendation('STRAND_TEST'),
        recommendation('COLOR_CONSULTATION'),
      ],
    })
    expect(result.refusalCode).toBe('SAFETY_REVIEW_REQUIRED')
  })

  // 🔴 The case that would have shipped a permanently-dead feature. EVERY
  // hair-color analysis carries ALLERGY_HISTORY_UNKNOWN — addRequiredSafetyFlags
  // adds it unconditionally, because the intake never asks about allergies. A
  // gate on "any safety flag" refuses 100% of consults; the routing signal is
  // the service INTENT.
  it('proposes normally for an analysis that recommended real colour work', () => {
    const result = derive({
      menu: [floor],
      analysisRecommendations: [
        recommendation('BALAYAGE', { serviceId: 'svc_balayage' }),
      ],
    })
    expect(result.status).toBe('PROPOSED')
  })

  it('refuses a REFUSED estimate rather than falling back', () => {
    const result = derive({
      menu: [floor],
      estimate: estimate([], 'REFUSED'),
    })
    expect(result.status).toBe('REFUSED')
    expect(result.refusalCode).toBe('ESTIMATE_REFUSED')
  })

  it('refuses when there is no estimate at all', () => {
    const result = derive({ menu: [floor], estimate: null })
    expect(result.status).toBe('REFUSED')
    expect(result.refusalCode).toBe('ESTIMATE_MISSING')
  })
})

describe('mode reconciliation', () => {
  // The salon and mobile columns are different numbers on a hand-configured
  // pro. B3 priced SALON because no mode had been chosen; B4 must read the
  // column for the mode the client actually picked.
  it('prices and sizes MOBILE from the mobile columns, not the salon ones', () => {
    const salon = derive({ menu: [floor], locationType: ServiceLocationType.SALON })
    const mobile = derive({ menu: [floor], locationType: ServiceLocationType.MOBILE })

    expect(salon.status).toBe('PROPOSED')
    expect(mobile.status).toBe('PROPOSED')
    if (salon.status !== 'PROPOSED' || mobile.status !== 'PROPOSED') return

    expect(salon.startingAtPrice.toString()).toBe('180')
    expect(salon.totalDurationMinutes).toBe(90)

    expect(mobile.startingAtPrice.toString()).toBe('220')
    expect(mobile.totalDurationMinutes).toBe(120)
  })

  // A CSV-imported pro's one price rides both modes — the case that makes it
  // tempting to skip the re-derivation entirely.
  it('gives both modes the same answer when the pro lists one price for both', () => {
    const both = offering({
      serviceId: 'svc_balayage',
      mobilePriceStartingAt: new Prisma.Decimal('180.00'),
      mobileDurationMinutes: 90,
    })

    const salon = derive({ menu: [both], locationType: ServiceLocationType.SALON })
    const mobile = derive({ menu: [both], locationType: ServiceLocationType.MOBILE })
    if (salon.status !== 'PROPOSED' || mobile.status !== 'PROPOSED') {
      throw new Error('both modes should propose')
    }

    expect(mobile.startingAtPrice.toString()).toBe(salon.startingAtPrice.toString())
    expect(mobile.totalDurationMinutes).toBe(salon.totalDurationMinutes)
  })

  it('refuses — never falls back to the salon number — when the mode is not offered', () => {
    const salonOnly = offering({
      serviceId: 'svc_balayage',
      offersMobile: false,
      mobilePriceStartingAt: null,
      mobileDurationMinutes: null,
    })

    const result = derive({
      menu: [salonOnly],
      locationType: ServiceLocationType.MOBILE,
    })

    expect(result.status).toBe('REFUSED')
    expect(result.refusalCode).toBe('MODE_NOT_OFFERED')
    expect(result.lines).toEqual([])
  })

  it('refuses when the chosen mode is offered but carries no price', () => {
    const result = derive({
      menu: [offering({ serviceId: 'svc_balayage', mobilePriceStartingAt: null })],
      locationType: ServiceLocationType.MOBILE,
    })
    expect(result.refusalCode).toBe('MODE_PRICE_UNSET')
  })

  it('refuses when the chosen mode is offered but carries no duration', () => {
    const result = derive({
      menu: [offering({ serviceId: 'svc_balayage', mobileDurationMinutes: null })],
      locationType: ServiceLocationType.MOBILE,
    })
    expect(result.refusalCode).toBe('MODE_DURATION_UNSET')
  })

  // The estimate's own zero/negative rule must survive the re-derivation:
  // priceLine is shared with B3 precisely so it cannot diverge here.
  it('refuses a negative listed price and allows a complimentary zero one', () => {
    const negative = derive({
      menu: [
        offering({
          serviceId: 'svc_balayage',
          salonPriceStartingAt: new Prisma.Decimal('-10.00'),
        }),
      ],
    })
    expect(negative.refusalCode).toBe('MODE_PRICE_UNSET')

    const complimentary = derive({
      menu: [
        offering({
          serviceId: 'svc_balayage',
          salonPriceStartingAt: new Prisma.Decimal('0.00'),
        }),
      ],
    })
    expect(complimentary.status).toBe('PROPOSED')
    if (complimentary.status !== 'PROPOSED') return
    // Zero money, but the time it takes is still reserved.
    expect(complimentary.startingAtPrice.toString()).toBe('0')
    expect(complimentary.totalDurationMinutes).toBe(90)
  })
})

describe('the slot is sized by the estimate', () => {
  it('sums every line, not just the floor', () => {
    const gloss = offering({
      serviceId: 'svc_gloss',
      salonPriceStartingAt: new Prisma.Decimal('40.00'),
      salonDurationMinutes: 20,
    })

    const result = derive({
      menu: [floor, gloss],
      estimate: estimate([
        { serviceId: 'svc_balayage' },
        { serviceId: 'svc_gloss' },
      ]),
    })

    expect(result.status).toBe('PROPOSED')
    if (result.status !== 'PROPOSED') return

    // 90 + ceil(20 → 30) = 120, and 180 + 40 = 220.
    expect(result.totalDurationMinutes).toBe(120)
    expect(result.startingAtPrice.toString()).toBe('220')
    expect(result.lines).toHaveLength(2)
  })

  it('rounds each line UP to the pro’s slot granularity, never down', () => {
    const result = derive({
      menu: [offering({ serviceId: 'svc_balayage', salonDurationMinutes: 95 })],
      stepMinutes: 30,
    })
    if (result.status !== 'PROPOSED') throw new Error('expected a proposal')
    expect(result.totalDurationMinutes).toBe(120)
  })

  it('excludes the buffer from the width and reports it separately', () => {
    const result = derive({ menu: [floor] })
    if (result.status !== 'PROPOSED') throw new Error('expected a proposal')
    expect(result.totalDurationMinutes).toBe(90)
    expect(result.bufferMinutes).toBe(15)
  })

  // Refused, not CLAMPED. A silently shortened appointment is exactly the
  // duration miss decision 11 protects against, and the client has no knob to
  // shrink a proposal with.
  it('refuses rather than clamping when the lines exceed the slot ceiling', () => {
    const long = offering({
      serviceId: 'svc_balayage',
      salonDurationMinutes: MAX_SLOT_DURATION_MINUTES,
    })
    const alsoLong = offering({
      serviceId: 'svc_gloss',
      salonDurationMinutes: 60,
    })

    const result = derive({
      menu: [long, alsoLong],
      estimate: estimate([
        { serviceId: 'svc_balayage' },
        { serviceId: 'svc_gloss' },
      ]),
    })

    expect(result.status).toBe('REFUSED')
    expect(result.refusalCode).toBe('SLOT_TOO_LONG')
  })
})

describe('nothing is invented', () => {
  // B3 may DROP a beyond-floor line it cannot price, because the estimate is
  // still a true answer without it. A proposal may not: the client is being
  // asked to commit to a total, and a dropped line silently changes both the
  // price and the width of what she agreed to.
  it('refuses when a beyond-floor line has left the menu, rather than dropping it', () => {
    const result = derive({
      menu: [floor],
      estimate: estimate([
        { serviceId: 'svc_balayage' },
        { serviceId: 'svc_gloss' },
      ]),
    })

    expect(result.status).toBe('REFUSED')
    expect(result.refusalCode).toBe('OFFERING_OFF_MENU')
  })

  it('refuses when the offering id now points at a different service', () => {
    const swapped = offering({ serviceId: 'svc_something_else' })
    // The pro replaced the menu row: same offering id, different service.
    const relabelled = { ...swapped, id: 'off_svc_balayage' }

    const result = derive({ menu: [relabelled] })
    expect(result.refusalCode).toBe('OFFERING_OFF_MENU')
  })

  it('re-snapshots the service name from the menu as it is now', () => {
    const renamed = offering({
      serviceId: 'svc_balayage',
      service: {
        name: 'Signature Balayage',
        description: null,
        categoryId: CATEGORY_ID,
        defaultDurationMinutes: 60,
      },
    })

    const result = derive({ menu: [renamed] })
    if (result.status !== 'PROPOSED') throw new Error('expected a proposal')
    expect(result.lines[0]?.serviceName).toBe('Signature Balayage')
  })

  it('keeps the estimate line id on every proposed line', () => {
    const result = derive({ menu: [floor] })
    if (result.status !== 'PROPOSED') throw new Error('expected a proposal')
    expect(result.lines[0]?.estimateLineId).toBe('line_svc_balayage')
    expect(result.lines[0]?.source).toBe('LOOK_LINKED_SERVICE')
  })
})

// ── B7 — beyond the floor is a recommendation, not a bill ────────────────────
//
// Decision 10: the enhancements the analysis suggests are OPT-IN. The floor —
// the look she tapped Book on — is never declinable. These cases fail if either
// half is relaxed.
describe('the client chooses what is beyond the floor', () => {
  const gloss = offering({
    serviceId: 'svc_gloss',
    salonPriceStartingAt: new Prisma.Decimal('40.00'),
    salonDurationMinutes: 20,
  })

  const twoLines = () =>
    estimate([{ serviceId: 'svc_balayage' }, { serviceId: 'svc_gloss' }])

  // 🔴 The load-bearing case. An empty selection is what every surface passes
  // before she has chosen anything, and it must produce the LOOK — not the look
  // plus everything the analysis could think of.
  it('proposes the floor alone when she has chosen nothing', () => {
    const result = derive({
      menu: [floor, gloss],
      estimate: twoLines(),
      enhancementSelection: [],
    })

    if (result.status !== 'PROPOSED') throw new Error('expected a proposal')
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0]?.serviceId).toBe('svc_balayage')
    expect(result.startingAtPrice.toString()).toBe('180')
    expect(result.totalDurationMinutes).toBe(90)
  })

  it('adds exactly what she ticked, priced and sized by the server', () => {
    const result = derive({
      menu: [floor, gloss],
      estimate: twoLines(),
      enhancementSelection: ['line_svc_gloss'],
    })

    if (result.status !== 'PROPOSED') throw new Error('expected a proposal')
    expect(result.lines.map((line) => line.serviceId)).toEqual([
      'svc_balayage',
      'svc_gloss',
    ])
    // 180 + 40, and 90 + ceil(20 → 30).
    expect(result.startingAtPrice.toString()).toBe('220')
    expect(result.totalDurationMinutes).toBe(120)
  })

  it('offers every priced enhancement, with the analysis’s own reason', () => {
    const result = derive({
      menu: [floor, gloss],
      estimate: twoLines(),
      enhancementSelection: [],
      analysisRecommendations: [
        recommendation('BALAYAGE', { serviceId: 'svc_balayage' }),
        recommendation('TONER_GLOSS', {
          serviceId: 'svc_gloss',
          rationale: 'A gloss keeps this tone from going brassy.',
        }),
      ],
    })

    if (result.status !== 'PROPOSED') throw new Error('expected a proposal')
    expect(result.recommendations).toHaveLength(1)
    expect(result.recommendations[0]).toMatchObject({
      estimateLineId: 'line_svc_gloss',
      outcome: 'A gloss keeps this tone from going brassy.',
      selected: false,
    })
    expect(result.recommendations[0]?.price.toString()).toBe('40')
    expect(result.recommendations[0]?.durationMinutes).toBe(30)
  })

  // The FLOOR is the look. It has no card, because there is no version of this
  // booking without it.
  it('never offers the floor as something to decline', () => {
    const result = derive({
      menu: [floor, gloss],
      estimate: twoLines(),
      enhancementSelection: [],
    })

    if (result.status !== 'PROPOSED') throw new Error('expected a proposal')
    expect(
      result.recommendations.some((r) => r.serviceId === 'svc_balayage'),
    ).toBe(false)
  })

  it('marks a ticked enhancement selected, so the screen cannot decide that itself', () => {
    const result = derive({
      menu: [floor, gloss],
      estimate: twoLines(),
      enhancementSelection: ['line_svc_gloss'],
    })

    if (result.status !== 'PROPOSED') throw new Error('expected a proposal')
    expect(result.recommendations[0]?.selected).toBe(true)
  })

  // A hand-edited link, or one left over from a consult whose estimate has
  // moved on. It must narrow the booking, never widen or break it.
  it('ignores an id that is not one of this estimate’s lines', () => {
    const result = derive({
      menu: [floor, gloss],
      estimate: twoLines(),
      enhancementSelection: ['line_from_somewhere_else'],
    })

    if (result.status !== 'PROPOSED') throw new Error('expected a proposal')
    expect(result.lines).toHaveLength(1)
    expect(result.startingAtPrice.toString()).toBe('180')
  })

  // 🔴 The asymmetry that makes B7 safe. Rule 4 (an off-menu line refuses the
  // whole proposal) still governs anything ON the booking — but an extra she
  // did NOT take going off the pro's menu says nothing about the booking she
  // actually made, and taking her floor down with it would be absurd.
  it('refuses an off-menu line she TOOK, and quietly drops one she did not', () => {
    const declined = derive({
      menu: [floor],
      estimate: twoLines(),
      enhancementSelection: [],
    })
    expect(declined.status).toBe('PROPOSED')
    if (declined.status !== 'PROPOSED') return
    expect(declined.lines).toHaveLength(1)
    expect(declined.recommendations).toHaveLength(0)

    const taken = derive({
      menu: [floor],
      estimate: twoLines(),
      enhancementSelection: ['line_svc_gloss'],
    })
    expect(taken.status).toBe('REFUSED')
    expect(taken.refusalCode).toBe('OFFERING_OFF_MENU')
  })

  it('refuses a taken enhancement the pro no longer prices in this mode', () => {
    const unpriced = offering({
      serviceId: 'svc_gloss',
      mobilePriceStartingAt: null,
    })

    const taken = derive({
      menu: [offering({ serviceId: 'svc_balayage' }), unpriced],
      estimate: twoLines(),
      locationType: ServiceLocationType.MOBILE,
      enhancementSelection: ['line_svc_gloss'],
    })
    expect(taken.refusalCode).toBe('MODE_PRICE_UNSET')

    const declined = derive({
      menu: [offering({ serviceId: 'svc_balayage' }), unpriced],
      estimate: twoLines(),
      locationType: ServiceLocationType.MOBILE,
      enhancementSelection: [],
    })
    expect(declined.status).toBe('PROPOSED')
  })

  // An enhancement nobody can explain cannot be phrased by OUTCOME, and the one
  // thing it must never fall back to is the service name (decision 1). So it is
  // not offered — but it is still LINED for 'ALL', which is what keeps the hold
  // sized for the widest case.
  it('does not offer an enhancement whose analysis reason is missing, but still sizes for it', () => {
    const noReason = derive({
      menu: [floor, gloss],
      estimate: twoLines(),
      enhancementSelection: [],
      analysisRecommendations: [
        recommendation('BALAYAGE', { serviceId: 'svc_balayage' }),
        // Matched to no service on her menu — the SERVICE_CATEGORY form.
        recommendation('TONER_GLOSS'),
      ],
    })
    if (noReason.status !== 'PROPOSED') throw new Error('expected a proposal')
    expect(noReason.recommendations).toEqual([])

    const widest = derive({
      menu: [floor, gloss],
      estimate: twoLines(),
      enhancementSelection: 'ALL',
      analysisRecommendations: [
        recommendation('BALAYAGE', { serviceId: 'svc_balayage' }),
        recommendation('TONER_GLOSS'),
      ],
    })
    if (widest.status !== 'PROPOSED') throw new Error('expected a proposal')
    expect(widest.totalDurationMinutes).toBe(120)
  })

  // 🔴 The whole safety story of this slice in one assertion: whatever she
  // chooses, the commit is never wider than what the hold reserved.
  it('never proposes more than the ’ALL’ reservation the hold was sized by', () => {
    const held = derive({
      menu: [floor, gloss],
      estimate: twoLines(),
      enhancementSelection: 'ALL',
    })
    if (held.status !== 'PROPOSED') throw new Error('expected a proposal')

    for (const selection of [[], ['line_svc_gloss']]) {
      const committed = derive({
        menu: [floor, gloss],
        estimate: twoLines(),
        enhancementSelection: selection,
      })
      if (committed.status !== 'PROPOSED') throw new Error('expected a proposal')
      expect(committed.totalDurationMinutes).toBeLessThanOrEqual(
        held.totalDurationMinutes,
      )
    }
  })

  it('re-numbers sortOrder contiguously when an enhancement is declined', () => {
    const result = derive({
      menu: [
        floor,
        gloss,
        offering({ serviceId: 'svc_treatment', salonDurationMinutes: 15 }),
      ],
      estimate: estimate([
        { serviceId: 'svc_balayage' },
        { serviceId: 'svc_gloss' },
        { serviceId: 'svc_treatment' },
      ]),
      enhancementSelection: ['line_svc_treatment'],
    })

    if (result.status !== 'PROPOSED') throw new Error('expected a proposal')
    expect(result.lines.map((line) => line.sortOrder)).toEqual([0, 1])
  })
})
