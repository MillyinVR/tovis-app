// lib/consult/inChairFinalization.test.ts
//
// Book the Look, B6. The thresholds Tori set on 2026-08-31 are a PRODUCT
// promise — a client is told, and offered a full refund, exactly when one of
// them is crossed — so the boundaries are asserted from both sides rather than
// somewhere comfortably inside them.

import { describe, expect, it } from 'vitest'

import type {
  ConsultProposalReviewDTO,
  ConsultProposalReviewLineDTO,
} from '@/lib/dto/consult'

import {
  buildConsultationItemsFromProposalJson,
  buildInChairConsultationItems,
  CONSULT_REVISION_DURATION_INCREASE_MINUTES,
  CONSULT_REVISION_PRICE_INCREASE_RATIO,
  deriveConsultRevisionNotice,
  deriveConsultRevisionNoticeFromReview,
  inChairConsultationInitialPrice,
} from './inChairFinalization'

function notice(args: {
  committedPriceCents: number
  finalPriceCents: number
  committedDurationMinutes?: number
  finalDurationMinutes?: number
}) {
  return deriveConsultRevisionNotice({
    committedPriceCents: args.committedPriceCents,
    finalPriceCents: args.finalPriceCents,
    committedDurationMinutes: args.committedDurationMinutes ?? 90,
    finalDurationMinutes: args.finalDurationMinutes ?? 90,
  })
}

describe('deriveConsultRevisionNotice — price', () => {
  it('is quiet when the price does not move', () => {
    const result = notice({ committedPriceCents: 20000, finalPriceCents: 20000 })
    expect(result.bigChange).toBe(false)
    expect(result.reasons).toEqual([])
    expect(result.priceIncreaseCents).toBe(0)
    expect(result.priceIncreaseRatio).toBeNull()
  })

  it('is quiet when the price goes DOWN — there is nothing to escape from', () => {
    const result = notice({ committedPriceCents: 20000, finalPriceCents: 12000 })
    expect(result.bigChange).toBe(false)
    expect(result.priceIncreaseCents).toBe(0)
    // The totals are still reported honestly, just not as a change she needs
    // to answer.
    expect(result.finalPriceCents).toBe(12000)
  })

  it('is quiet at EXACTLY the threshold — "more than ~10%" is strict', () => {
    // 10% of $200.00 is $20.00 exactly.
    const result = notice({ committedPriceCents: 20000, finalPriceCents: 22000 })
    expect(result.priceIncreaseRatio).toBeCloseTo(
      CONSULT_REVISION_PRICE_INCREASE_RATIO,
      10,
    )
    expect(result.bigChange).toBe(false)
  })

  it('fires one cent past the threshold', () => {
    const result = notice({ committedPriceCents: 20000, finalPriceCents: 22001 })
    expect(result.bigChange).toBe(true)
    expect(result.reasons).toEqual(['PRICE'])
    expect(result.priceIncreaseCents).toBe(2001)
  })

  it('treats any rise off a zero committed price as big, with no ratio', () => {
    const result = notice({ committedPriceCents: 0, finalPriceCents: 6000 })
    expect(result.bigChange).toBe(true)
    expect(result.reasons).toEqual(['PRICE'])
    // Infinity is never reported as a percentage.
    expect(result.priceIncreaseRatio).toBeNull()
  })

  it('stays quiet when a zero committed price does not move', () => {
    const result = notice({ committedPriceCents: 0, finalPriceCents: 0 })
    expect(result.bigChange).toBe(false)
  })
})

describe('deriveConsultRevisionNotice — duration', () => {
  it('is quiet one minute under the threshold', () => {
    const result = notice({
      committedPriceCents: 20000,
      finalPriceCents: 20000,
      committedDurationMinutes: 90,
      finalDurationMinutes: 90 + CONSULT_REVISION_DURATION_INCREASE_MINUTES - 1,
    })
    expect(result.bigChange).toBe(false)
    expect(result.durationIncreaseMinutes).toBe(29)
  })

  it('fires AT the threshold — "30+ minutes" includes 30', () => {
    const result = notice({
      committedPriceCents: 20000,
      finalPriceCents: 20000,
      committedDurationMinutes: 90,
      finalDurationMinutes: 90 + CONSULT_REVISION_DURATION_INCREASE_MINUTES,
    })
    expect(result.bigChange).toBe(true)
    expect(result.reasons).toEqual(['DURATION'])
  })

  it('is quiet when the appointment gets shorter', () => {
    const result = notice({
      committedPriceCents: 20000,
      finalPriceCents: 20000,
      committedDurationMinutes: 180,
      finalDurationMinutes: 90,
    })
    expect(result.bigChange).toBe(false)
    expect(result.durationIncreaseMinutes).toBe(0)
  })

  it('reports both reasons when both are crossed, in a stable order', () => {
    const result = notice({
      committedPriceCents: 20000,
      finalPriceCents: 30000,
      committedDurationMinutes: 90,
      finalDurationMinutes: 150,
    })
    expect(result.reasons).toEqual(['PRICE', 'DURATION'])
  })
})

function reviewLine(
  overrides: Partial<ConsultProposalReviewLineDTO> = {},
): ConsultProposalReviewLineDTO {
  return {
    estimateLineId: 'line_1',
    serviceId: 'svc_1',
    offeringId: 'off_1',
    serviceName: 'Full balayage',
    source: 'LOOK_LINKED_SERVICE',
    rationale: 'The look this consult started from is linked to it.',
    proposedPrice: '200.00',
    proposedDurationMinutes: 90,
    proFinalPrice: null,
    proFinalDurationMinutes: null,
    proFinalNote: null,
    proFinalAt: null,
    reviewStatus: 'NOT_REVIEWED',
    ...overrides,
  }
}

function review(
  overrides: Partial<ConsultProposalReviewDTO> = {},
): ConsultProposalReviewDTO {
  return {
    bookingId: 'bk_1',
    consultId: 'cs_1',
    placement: 'AFTER_ACCEPTANCE',
    editable: true,
    locationType: 'SALON',
    stepMinutes: 15,
    bufferMinutes: 0,
    totalDurationMinutes: 90,
    startingAtPrice: '200.00',
    startingAtLabel: 'Starting at $200',
    proFinalTotalPrice: null,
    proFinalTotalDurationMinutes: null,
    reviewedAt: null,
    lines: [reviewLine()],
    declinedRecommendations: [],
    ...overrides,
  }
}

describe('deriveConsultRevisionNoticeFromReview', () => {
  it('returns null — not "no big change" — when the pro has recorded nothing', () => {
    expect(deriveConsultRevisionNoticeFromReview(review())).toBeNull()
  })

  it('judges her recorded totals against what the client committed to', () => {
    const result = deriveConsultRevisionNoticeFromReview(
      review({
        proFinalTotalPrice: '260.00',
        proFinalTotalDurationMinutes: 90,
      }),
    )
    expect(result?.bigChange).toBe(true)
    expect(result?.committedPriceCents).toBe(20000)
    expect(result?.finalPriceCents).toBe(26000)
  })
})

describe('buildInChairConsultationItems', () => {
  it('opens on her corrections where she made them, and on the client’s numbers where she did not', () => {
    const items = buildInChairConsultationItems(
      review({
        lines: [
          reviewLine({
            estimateLineId: 'line_floor',
            proFinalPrice: '240.00',
            proFinalDurationMinutes: 120,
            reviewStatus: 'ADJUSTED',
            proFinalAt: '2026-08-31T00:00:00.000Z',
          }),
          reviewLine({
            estimateLineId: 'line_gloss',
            serviceId: 'svc_gloss',
            offeringId: 'off_gloss',
            serviceName: 'Gloss',
            proposedPrice: '50.00',
            proposedDurationMinutes: 30,
          }),
        ],
      }),
    )

    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      offeringId: 'off_1',
      price: '240.00',
      durationMinutes: '120',
      itemType: 'BASE',
      source: 'PROPOSAL',
      bookingServiceItemId: null,
    })
    expect(items[1]).toMatchObject({ price: '50.00', durationMinutes: '30' })
    expect(items.map((item) => item.sortOrder)).toEqual([0, 1])
  })

  it('never carries her private flag note into the client-facing line notes', () => {
    const items = buildInChairConsultationItems(
      review({
        lines: [
          reviewLine({
            proFinalNote: 'Her hair may need a second session — do not promise.',
            proFinalAt: '2026-08-31T00:00:00.000Z',
            reviewStatus: 'FLAGGED',
          }),
        ],
      }),
    )
    expect(items[0]?.notes).toBe('')
  })

  it('opens the total on her recorded figure, falling back to the agreed one', () => {
    expect(inChairConsultationInitialPrice(review())).toBe('200.00')
    expect(
      inChairConsultationInitialPrice(
        review({ proFinalTotalPrice: '265.00', proFinalTotalDurationMinutes: 120 }),
      ),
    ).toBe('265.00')
  })
})

describe('buildConsultationItemsFromProposalJson', () => {
  const sent = {
    currency: 'USD',
    items: [
      {
        bookingServiceItemId: null,
        offeringId: 'off_1',
        serviceId: 'svc_1',
        itemType: 'BASE',
        label: 'Full balayage',
        categoryName: null,
        price: '240.00',
        durationMinutes: 120,
        notes: null,
        sortOrder: 0,
        source: 'PROPOSAL',
      },
    ],
  }

  it('reads back what the pro already sent', () => {
    const items = buildConsultationItemsFromProposalJson(sent)
    expect(items).toHaveLength(1)
    expect(items?.[0]).toMatchObject({
      offeringId: 'off_1',
      price: '240.00',
      durationMinutes: '120',
      label: 'Full balayage',
    })
  })

  it('refuses the WHOLE seed when one line is unusable', () => {
    // A base line with no offering cannot be re-sent — the proposal route
    // refuses it — so half a form is worse than falling back.
    expect(
      buildConsultationItemsFromProposalJson({
        items: [sent.items[0], { ...sent.items[0], offeringId: null }],
      }),
    ).toBeNull()

    expect(
      buildConsultationItemsFromProposalJson({
        items: [{ ...sent.items[0], price: 'not-money' }],
      }),
    ).toBeNull()

    expect(
      buildConsultationItemsFromProposalJson({
        items: [{ ...sent.items[0], durationMinutes: 0 }],
      }),
    ).toBeNull()
  })

  it('returns null for anything that is not a proposal', () => {
    expect(buildConsultationItemsFromProposalJson(null)).toBeNull()
    expect(buildConsultationItemsFromProposalJson({ items: [] })).toBeNull()
    expect(buildConsultationItemsFromProposalJson('nope')).toBeNull()
  })
})
