// lib/consult/serviceEstimate.test.ts
//
// The translation module's derivation rules, exercised without a database.
// Everything the pro's money and day depend on is decided in this one pure
// function, so each rule gets a case that FAILS if the rule is relaxed.

import { Prisma, ServiceLocationType } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import type { ConsultAnalysisReferenceDTO } from '@/lib/dto/consult'

import type { ConsultProMenuOffering } from './proMenu'
import {
  deriveConsultServiceEstimate,
  type ConsultServiceEstimateAnalysisInput,
} from './serviceEstimate'

const CATEGORY_ID = 'cat_hair_color'

function offering(
  overrides: Partial<ConsultProMenuOffering> & { serviceId: string },
): ConsultProMenuOffering {
  return {
    id: `off_${overrides.serviceId}`,
    offersInSalon: true,
    offersMobile: false,
    salonPriceStartingAt: new Prisma.Decimal('180.00'),
    salonDurationMinutes: 90,
    mobilePriceStartingAt: null,
    mobileDurationMinutes: null,
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

function serviceReference(serviceId: string): ConsultAnalysisReferenceDTO {
  return { type: 'SERVICE', serviceId, serviceCategoryId: CATEGORY_ID }
}

const categoryReference: ConsultAnalysisReferenceDTO = {
  type: 'SERVICE_CATEGORY',
  serviceId: null,
  serviceCategoryId: CATEGORY_ID,
}

function analysis(
  recommendations: Array<{
    title: string
    rationale: string
    reference: ConsultAnalysisReferenceDTO
  }>,
): ConsultServiceEstimateAnalysisInput {
  return {
    recommendations: recommendations.map((recommendation) => ({
      serviceIntent: 'SERVICE' as const,
      serviceName: 'Balayage',
      achievability: 'Discuss in person.',
      discussWithProfessional: true as const,
      ...recommendation,
    })),
  }
}

function derive(args: {
  menu: ConsultProMenuOffering[]
  floorServiceId: string | null
  analysis?: ConsultServiceEstimateAnalysisInput
  stepMinutes?: number
}) {
  return deriveConsultServiceEstimate({
    locationType: ServiceLocationType.SALON,
    stepMinutes: args.stepMinutes ?? 30,
    bufferMinutes: 15,
    menu: args.menu,
    floorServiceId: args.floorServiceId,
    analysis: args.analysis ?? analysis([]),
  })
}

describe('the floor', () => {
  it("prices the look's linked service off the pro's own column", () => {
    const result = derive({
      menu: [offering({ serviceId: 'svc_balayage' })],
      floorServiceId: 'svc_balayage',
    })

    expect(result.status).toBe('ESTIMATED')
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0]).toMatchObject({
      sortOrder: 0,
      serviceId: 'svc_balayage',
      offeringId: 'off_svc_balayage',
      serviceName: 'Service svc_balayage',
      source: 'LOOK_LINKED_SERVICE',
      estimatedDurationMinutes: 90,
    })
    expect(result.lines[0]?.estimatedPrice.toString()).toBe('180')
  })

  it('refuses when the look names no service at all', () => {
    const result = derive({
      menu: [offering({ serviceId: 'svc_balayage' })],
      floorServiceId: null,
    })

    expect(result).toMatchObject({
      status: 'REFUSED',
      refusalCode: 'LOOK_SERVICE_UNLINKED',
      lines: [],
    })
  })

  it("refuses when the look's service is not on this pro's menu", () => {
    const result = derive({
      menu: [offering({ serviceId: 'svc_other' })],
      floorServiceId: 'svc_balayage',
    })

    expect(result).toMatchObject({
      status: 'REFUSED',
      refusalCode: 'SERVICE_NOT_ON_MENU',
    })
  })

  it('refuses rather than inventing a price the pro never listed', () => {
    const result = derive({
      menu: [
        offering({ serviceId: 'svc_balayage', salonPriceStartingAt: null }),
      ],
      floorServiceId: 'svc_balayage',
    })

    expect(result).toMatchObject({
      status: 'REFUSED',
      refusalCode: 'MENU_PRICE_UNSET',
    })
  })

  it("refuses rather than falling back to the catalog's default duration", () => {
    // The Service row still says 60 minutes. Borrowing it would be a number
    // this pro never chose, so DURATION_REQUIRED is the honest answer.
    const result = derive({
      menu: [offering({ serviceId: 'svc_balayage', salonDurationMinutes: null })],
      floorServiceId: 'svc_balayage',
    })

    expect(result).toMatchObject({
      status: 'REFUSED',
      refusalCode: 'MENU_DURATION_UNSET',
    })
  })

  it('refuses a NEGATIVE listed price rather than propagating it', () => {
    // Nothing in the database constrains an offering's price columns, and the
    // booking context's validator accepts any finite number — so this is the
    // only place that catches it before it becomes a stored estimate.
    const result = derive({
      menu: [
        offering({
          serviceId: 'svc_balayage',
          salonPriceStartingAt: new Prisma.Decimal('-10.00'),
        }),
      ],
      floorServiceId: 'svc_balayage',
    })

    expect(result).toMatchObject({
      status: 'REFUSED',
      refusalCode: 'MENU_PRICE_UNSET',
    })
  })

  it('prices a COMPLIMENTARY service at zero rather than dropping its minutes', () => {
    // A free service still takes time out of her day. Dropping it would
    // understate the duration — the one number decision 11 protects.
    const result = derive({
      menu: [
        offering({
          serviceId: 'svc_balayage',
          salonPriceStartingAt: new Prisma.Decimal('0.00'),
          salonDurationMinutes: 45,
        }),
      ],
      floorServiceId: 'svc_balayage',
    })

    expect(result.status).toBe('ESTIMATED')
    expect(result.lines[0]?.estimatedPrice.toFixed(2)).toBe('0.00')
    expect(result.lines[0]?.estimatedDurationMinutes).toBe(60)
  })

  it('refuses when the pro does not offer the service in this mode', () => {
    const result = derive({
      menu: [offering({ serviceId: 'svc_balayage', offersInSalon: false })],
      floorServiceId: 'svc_balayage',
    })

    expect(result).toMatchObject({
      status: 'REFUSED',
      refusalCode: 'MENU_MODE_UNAVAILABLE',
    })
  })
})

describe('duration is never understated', () => {
  it('rounds a line UP to the slot granularity, not to the nearest', () => {
    // 50 minutes on a 30-minute grid. Rounding to the NEAREST gives 45 and
    // steals 5 minutes from the pro's day; decision 11 says round up.
    const result = derive({
      menu: [offering({ serviceId: 'svc_gloss', salonDurationMinutes: 50 })],
      floorServiceId: 'svc_gloss',
    })

    expect(result.lines[0]?.estimatedDurationMinutes).toBe(60)
  })

  it('leaves a duration already on the grid alone', () => {
    const result = derive({
      menu: [offering({ serviceId: 'svc_gloss', salonDurationMinutes: 60 })],
      floorServiceId: 'svc_gloss',
      stepMinutes: 20,
    })

    expect(result.lines[0]?.estimatedDurationMinutes).toBe(60)
  })
})

describe('beyond the floor', () => {
  const floor = offering({ serviceId: 'svc_balayage' })

  it('adds an analysis-referenced service, carrying the analysis rationale', () => {
    const gloss = offering({
      serviceId: 'svc_gloss',
      salonPriceStartingAt: new Prisma.Decimal('45.00'),
      salonDurationMinutes: 20,
    })

    const result = derive({
      menu: [floor, gloss],
      floorServiceId: 'svc_balayage',
      analysis: analysis([
        {
          title: 'Gloss to hold the tone',
          rationale: 'The mid-lengths read warm against the inspiration.',
          reference: serviceReference('svc_gloss'),
        },
      ]),
    })

    expect(result.lines).toHaveLength(2)
    expect(result.lines[1]).toMatchObject({
      sortOrder: 1,
      serviceId: 'svc_gloss',
      source: 'ANALYSIS_RECOMMENDATION',
      rationale:
        'Gloss to hold the tone — The mid-lengths read warm against the inspiration.',
      estimatedDurationMinutes: 30,
    })
  })

  it('never prices a recommendation the analysis could not match to a service', () => {
    const result = derive({
      menu: [floor],
      floorServiceId: 'svc_balayage',
      analysis: analysis([
        {
          title: 'Something off-menu',
          rationale: 'No offering matched this direction.',
          reference: categoryReference,
        },
      ]),
    })

    expect(result.lines).toHaveLength(1)
  })

  it('never prices a service that is not on the menu, even when referenced', () => {
    const result = derive({
      menu: [floor],
      floorServiceId: 'svc_balayage',
      analysis: analysis([
        {
          title: 'Vivid',
          rationale: 'Referenced but no longer offered.',
          reference: serviceReference('svc_vivid'),
        },
      ]),
    })

    expect(result.lines).toHaveLength(1)
  })

  it('drops an unpriceable extra rather than losing the whole estimate', () => {
    const unpriced = offering({
      serviceId: 'svc_gloss',
      salonPriceStartingAt: null,
    })

    const result = derive({
      menu: [floor, unpriced],
      floorServiceId: 'svc_balayage',
      analysis: analysis([
        {
          title: 'Gloss',
          rationale: 'Priced nowhere on the menu.',
          reference: serviceReference('svc_gloss'),
        },
      ]),
    })

    expect(result.status).toBe('ESTIMATED')
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0]?.source).toBe('LOOK_LINKED_SERVICE')
  })

  it('folds a recommendation for the floor service INTO the floor line', () => {
    const result = derive({
      menu: [floor],
      floorServiceId: 'svc_balayage',
      analysis: analysis([
        {
          title: 'Balayage',
          rationale: 'The inspiration is a hand-painted lift.',
          reference: serviceReference('svc_balayage'),
        },
      ]),
    })

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0]?.source).toBe('LOOK_LINKED_SERVICE')
    expect(result.lines[0]?.rationale).toContain(
      'The inspiration is a hand-painted lift.',
    )
  })

  // When the intake or the photos route to safety prerequisites, the analysis
  // REPLACES its recommendations with patch test / strand test / a color review
  // (analysisContract's resolveRecommendations), each already resolved to a
  // real offering on this pro's menu. Those become estimate lines like any
  // other, and the floor is still priced — the pro's answer to "what does this
  // look cost, and what has to happen first" is both halves, and the brief's
  // own safety section sits directly above it.
  //
  // 🔴 B4 must NOT read these lines as a bookable proposal without consulting
  // the safety flags: the floor here is a chemical service the analysis has
  // explicitly declined to recommend yet.
  it('prices the floor AND the safety prerequisites when the analysis routes to safety', () => {
    const patch = offering({
      serviceId: 'svc_patch',
      salonPriceStartingAt: new Prisma.Decimal('0.01'),
      salonDurationMinutes: 15,
    })

    const result = derive({
      menu: [floor, patch],
      floorServiceId: 'svc_balayage',
      analysis: analysis([
        {
          title: 'Patch Test',
          rationale:
            'Because a prior reaction was reported, test for sensitivity first.',
          reference: serviceReference('svc_patch'),
        },
      ]),
    })

    expect(result.status).toBe('ESTIMATED')
    expect(result.lines.map((line) => line.serviceId)).toEqual([
      'svc_balayage',
      'svc_patch',
    ])
    expect(result.lines[1]?.rationale).toContain('test for sensitivity first')
  })

  it('emits one line per service when two recommendations name the same one', () => {
    const gloss = offering({ serviceId: 'svc_gloss', salonDurationMinutes: 20 })

    const result = derive({
      menu: [floor, gloss],
      floorServiceId: 'svc_balayage',
      analysis: analysis([
        {
          title: 'Gloss',
          rationale: 'First reason.',
          reference: serviceReference('svc_gloss'),
        },
        {
          title: 'Gloss again',
          rationale: 'Second reason.',
          reference: serviceReference('svc_gloss'),
        },
      ]),
    })

    expect(result.lines).toHaveLength(2)
    expect(result.lines[1]?.rationale).toBe('Gloss — First reason.')
  })
})
