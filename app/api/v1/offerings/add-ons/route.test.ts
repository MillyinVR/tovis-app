// app/api/v1/offerings/add-ons/route.test.ts
//
// Covers two things the booking add-ons cluster changed on this route:
//  - `isPreselected` is passed through on the wire (the pro's own "starts
//    ticked" opt-in, independent of `isRecommended`).
//  - a link whose duration chain resolves to an intentional 0 (an
//    instant/retail add-on) is now included, using the SAME resolver
//    booking/finalize use (`resolveAddOnDurationMinutes`), not the drifted,
//    always-falls-back-to-30 calculation this route used to run separately.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma, ServiceLocationType } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  offeringFindUnique: vi.fn(),
  offeringAddOnFindMany: vi.fn(),
  proOfferingFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    professionalServiceOffering: {
      findUnique: mocks.offeringFindUnique,
      findMany: mocks.proOfferingFindMany,
    },
    offeringAddOn: { findMany: mocks.offeringAddOnFindMany },
  },
}))

import { GET } from './route'

function makeRequest(params: Record<string, string>): Request {
  const url = new URL('http://localhost/api/v1/offerings/add-ons')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new Request(url)
}

const OFFERING_ID = 'offering_1'

function baseAddOnLink(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: 'oa_1',
    addOnServiceId: 'svc_addon_1',
    sortOrder: 1,
    isRecommended: false,
    isPreselected: false,
    priceOverride: new Prisma.Decimal('35'),
    durationOverrideMinutes: null,
    addOnService: {
      id: 'svc_addon_1',
      name: 'Take-home gloss kit',
      addOnGroup: 'Extras',
      defaultDurationMinutes: 0,
      minPrice: new Prisma.Decimal('35'),
      category: { slug: 'extras' },
    },
    ...(overrides ?? {}),
  }
}

beforeEach(() => {
  vi.clearAllMocks()

  mocks.offeringFindUnique.mockResolvedValue({
    id: OFFERING_ID,
    isActive: true,
    professionalId: 'pro_1',
    offersInSalon: true,
    offersMobile: false,
    professional: { id: 'pro_1', businessName: 'Noor Beauty' },
    service: { id: 'svc_base', name: 'Balayage' },
  })

  mocks.proOfferingFindMany.mockResolvedValue([])
})

describe('GET /api/v1/offerings/add-ons', () => {
  it('includes isPreselected on every returned add-on', async () => {
    mocks.offeringAddOnFindMany.mockResolvedValue([
      baseAddOnLink({
        isPreselected: true,
        durationOverrideMinutes: 15,
        addOnService: {
          ...baseAddOnLink().addOnService,
          defaultDurationMinutes: 15,
        },
      }),
    ])

    const res = await GET(
      makeRequest({ offeringId: OFFERING_ID, locationType: 'SALON' }),
    )
    const body = (await res.json()) as {
      addOns: Array<{ isPreselected: boolean }>
    }

    expect(body.addOns).toHaveLength(1)
    expect(body.addOns[0]?.isPreselected).toBe(true)
  })

  it('includes a link whose duration resolves to a legitimate 0 (instant/retail add-on), not filtered out', async () => {
    // durationOverrideMinutes null, no pro offering, service default 0 — the
    // exact "Take-home gloss kit" seed shape.
    mocks.offeringAddOnFindMany.mockResolvedValue([baseAddOnLink()])

    const res = await GET(
      makeRequest({ offeringId: OFFERING_ID, locationType: 'SALON' }),
    )
    const body = (await res.json()) as {
      addOns: Array<{ minutes: number; price: string }>
    }

    expect(body.addOns).toHaveLength(1)
    expect(body.addOns[0]?.minutes).toBe(0)
    expect(body.addOns[0]?.price).toBe('35')
  })

  it('still excludes a link with no price at all', async () => {
    mocks.offeringAddOnFindMany.mockResolvedValue([
      baseAddOnLink({
        priceOverride: null,
        addOnService: {
          ...baseAddOnLink().addOnService,
          minPrice: null,
        },
      }),
    ])

    const res = await GET(
      makeRequest({ offeringId: OFFERING_ID, locationType: 'SALON' }),
    )
    const body = (await res.json()) as { addOns: unknown[] }

    expect(body.addOns).toHaveLength(0)
  })
})
