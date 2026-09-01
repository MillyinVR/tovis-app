// lib/consult/proProposalReview.test.ts
//
// Book the Look, B5 — the two pure halves of the pro's review: what her
// recorded numbers MEAN beside what the client was sold, and what an untrusted
// submission is allowed to be. Both decide things a component must never decide
// twice, so each rule gets a case that fails if the rule is relaxed.

import { Prisma, ServiceLocationType } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import {
  CONSULT_PROPOSAL_REVIEW_NOTE_MAX_LENGTH,
  ProProposalReviewError,
  deriveDeclinedRecommendations,
  deriveProposalReviewLineStatus,
  parseProposalReviewSubmission,
} from './proProposalReview'
import type { ConsultProMenuOffering } from './proMenu'

const AT = '2026-08-31T12:00:00.000Z'

function status(
  overrides: Partial<Parameters<typeof deriveProposalReviewLineStatus>[0]> = {},
) {
  return deriveProposalReviewLineStatus({
    proposedPrice: '180.00',
    proposedDurationMinutes: 90,
    proFinalPrice: '180.00',
    proFinalDurationMinutes: 90,
    proFinalNote: null,
    proFinalAt: AT,
    ...overrides,
  })
}

describe('deriveProposalReviewLineStatus', () => {
  it('is NOT_REVIEWED until a timestamp says a person looked', () => {
    // The columns are nullable together, so numbers without the timestamp are
    // not a review — they are a half-written row, and calling them CONFIRMED
    // would put a pair into decision 7's signal that nobody ever confirmed.
    expect(status({ proFinalAt: null })).toBe('NOT_REVIEWED')
    expect(
      status({ proFinalAt: null, proFinalPrice: '900.00' }),
    ).toBe('NOT_REVIEWED')
  })

  it('is CONFIRMED when her numbers match what the client was sold', () => {
    expect(status()).toBe('CONFIRMED')
  })

  it('is ADJUSTED when the price moves', () => {
    expect(status({ proFinalPrice: '210.00' })).toBe('ADJUSTED')
  })

  it('is ADJUSTED when the duration moves', () => {
    expect(status({ proFinalDurationMinutes: 120 })).toBe('ADJUSTED')
  })

  it('ranks a moved number above a note — an adjusted line is not just a flag', () => {
    expect(
      status({ proFinalPrice: '210.00', proFinalNote: 'thicker than the photo' }),
    ).toBe('ADJUSTED')
  })

  it('is FLAGGED when she wrote a concern and changed nothing', () => {
    expect(status({ proFinalNote: 'ask about the box dye first' })).toBe(
      'FLAGGED',
    )
  })

  it('compares against the PROPOSAL price, so a matching mobile figure confirms', () => {
    // The regression this guards: comparing against the estimate's SALON price
    // would call an untouched mobile line "adjusted" every single time.
    expect(
      status({ proposedPrice: '150.00', proFinalPrice: '150.00' }),
    ).toBe('CONFIRMED')
  })
})

function submission(lines: unknown) {
  return parseProposalReviewSubmission({ lines })
}

describe('parseProposalReviewSubmission', () => {
  it('normalizes money and keeps the duration as whole minutes', () => {
    expect(
      submission([{ estimateLineId: 'l1', price: '180.5', durationMinutes: 90 }]),
    ).toEqual([
      { estimateLineId: 'l1', price: '180.50', durationMinutes: 90, note: null },
    ])
  })

  it('trims a note and stores an empty one as null', () => {
    expect(
      submission([
        {
          estimateLineId: 'l1',
          price: '180',
          durationMinutes: 90,
          note: '  needs a strand test  ',
        },
      ])[0]?.note,
    ).toBe('needs a strand test')
    expect(
      submission([
        { estimateLineId: 'l1', price: '180', durationMinutes: 90, note: '   ' },
      ])[0]?.note,
    ).toBeNull()
  })

  it('refuses a body that is not a non-empty line list', () => {
    expect(() => parseProposalReviewSubmission(null)).toThrow(
      ProProposalReviewError,
    )
    expect(() => parseProposalReviewSubmission({})).toThrow(
      ProProposalReviewError,
    )
    expect(() => submission([])).toThrow(ProProposalReviewError)
    expect(() => submission('lines')).toThrow(ProProposalReviewError)
  })

  it('refuses the same line twice — there is no rule for which one wins', () => {
    expect(() =>
      submission([
        { estimateLineId: 'l1', price: '180', durationMinutes: 90 },
        { estimateLineId: 'l1', price: '200', durationMinutes: 90 },
      ]),
    ).toThrow(ProProposalReviewError)
  })

  it('refuses a price that is not money', () => {
    for (const price of ['-1', '1.005', '', 'abc', '1e3']) {
      expect(() =>
        submission([{ estimateLineId: 'l1', price, durationMinutes: 90 }]),
      ).toThrow(ProProposalReviewError)
    }
    // A JSON number would round on the way in; money crosses as a string.
    expect(() =>
      submission([{ estimateLineId: 'l1', price: 180, durationMinutes: 90 }]),
    ).toThrow(ProProposalReviewError)
  })

  it('refuses a duration that is not a whole positive number of minutes', () => {
    for (const durationMinutes of [0, -30, 45.5, '90', null]) {
      expect(() =>
        submission([{ estimateLineId: 'l1', price: '180', durationMinutes }]),
      ).toThrow(ProProposalReviewError)
    }
  })

  it('allows a zero price — a complimentary service is a real menu row', () => {
    expect(
      submission([{ estimateLineId: 'l1', price: '0', durationMinutes: 30 }])[0]
        ?.price,
    ).toBe('0.00')
  })

  it('refuses a note past the stored length rather than truncating it', () => {
    const tooLong = 'x'.repeat(CONSULT_PROPOSAL_REVIEW_NOTE_MAX_LENGTH + 1)
    expect(() =>
      submission([
        {
          estimateLineId: 'l1',
          price: '180',
          durationMinutes: 90,
          note: tooLong,
        },
      ]),
    ).toThrow(ProProposalReviewError)
  })

  it('refuses a missing or blank line id', () => {
    expect(() =>
      submission([{ price: '180', durationMinutes: 90 }]),
    ).toThrow(ProProposalReviewError)
    expect(() =>
      submission([{ estimateLineId: '   ', price: '180', durationMinutes: 90 }]),
    ).toThrow(ProProposalReviewError)
  })
})

// ── B7 — "recommended attach at session close" (decision 10's pro half) ───────

const CATEGORY_ID = 'cat_hair_color'

function menuOffering(
  serviceId: string,
  overrides: Partial<ConsultProMenuOffering> = {},
): ConsultProMenuOffering {
  return {
    id: `off_${serviceId}`,
    serviceId,
    offersInSalon: true,
    offersMobile: true,
    salonPriceStartingAt: new Prisma.Decimal('40.00'),
    salonDurationMinutes: 20,
    mobilePriceStartingAt: new Prisma.Decimal('55.00'),
    mobileDurationMinutes: 40,
    ...overrides,
    service: {
      name: `Service ${serviceId}`,
      description: null,
      categoryId: CATEGORY_ID,
      defaultDurationMinutes: 30,
      ...overrides.service,
    },
  }
}

function estimateLine(serviceId: string) {
  return {
    id: `line_${serviceId}`,
    sortOrder: 1,
    serviceId,
    offeringId: `off_${serviceId}`,
    serviceName: `Stale ${serviceId}`,
    rationale: 'A gloss keeps this tone from going brassy.',
    proFinalPrice: null,
    proFinalDurationMinutes: null,
    proFinalNote: null,
    proFinalAt: null,
  }
}

function declined(args: {
  menu?: ConsultProMenuOffering[]
  committed?: string[]
  locationType?: ServiceLocationType
  stepMinutes?: number
}) {
  return deriveDeclinedRecommendations({
    estimateLines: [estimateLine('svc_floor'), estimateLine('svc_gloss')],
    committedEstimateLineIds: new Set(args.committed ?? ['line_svc_floor']),
    menu: args.menu ?? [
      menuOffering('svc_floor'),
      menuOffering('svc_gloss'),
    ],
    locationType: args.locationType ?? ServiceLocationType.SALON,
    stepMinutes: args.stepMinutes ?? 30,
  })
}

describe('deriveDeclinedRecommendations', () => {
  it('offers only what the client did not take', () => {
    const result = declined({})
    expect(result.map((row) => row.estimateLineId)).toEqual(['line_svc_gloss'])
  })

  it('offers nothing when she took everything', () => {
    expect(
      declined({ committed: ['line_svc_floor', 'line_svc_gloss'] }),
    ).toEqual([])
  })

  // 🔴 B5 rule 3, still: the estimate prices the SALON column. Putting a salon
  // figure in front of a pro to attach to a MOBILE booking would hand the
  // client a number she is about to approve and that nobody derived for her.
  it('re-prices under the mode this booking was made in', () => {
    const salon = declined({})
    expect(salon[0]?.price).toBe('40.00')
    expect(salon[0]?.durationMinutes).toBe(30)

    const mobile = declined({ locationType: ServiceLocationType.MOBILE })
    expect(mobile[0]?.price).toBe('55.00')
    // 40 minutes rounded UP to the pro's 30-minute step.
    expect(mobile[0]?.durationMinutes).toBe(60)
  })

  it('carries the estimate’s own reason, never an invented one', () => {
    expect(declined({})[0]?.rationale).toBe(
      'A gloss keeps this tone from going brassy.',
    )
  })

  it('shows today’s menu name, not the estimate’s snapshot', () => {
    expect(declined({})[0]?.serviceName).toBe('Service svc_gloss')
  })

  // She cannot attach what she can no longer sell, and the consultation
  // proposal route would refuse the line anyway.
  it('drops a declined line whose offering has left her menu', () => {
    expect(declined({ menu: [menuOffering('svc_floor')] })).toEqual([])
  })

  it('drops a declined line she no longer prices in this mode', () => {
    const result = declined({
      menu: [
        menuOffering('svc_floor'),
        menuOffering('svc_gloss', { mobilePriceStartingAt: null }),
      ],
      locationType: ServiceLocationType.MOBILE,
    })
    expect(result).toEqual([])
  })

  it('drops a line whose offering id now points at a different service', () => {
    const swapped = { ...menuOffering('svc_something_else'), id: 'off_svc_gloss' }
    expect(declined({ menu: [menuOffering('svc_floor'), swapped] })).toEqual([])
  })
})
