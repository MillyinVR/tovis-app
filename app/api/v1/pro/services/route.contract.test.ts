// app/api/v1/pro/services/route.contract.test.ts
//
// Producer → consumer contract for the pro's sellable-services list.
//
// The pro calendar's booking modal fetches THIS route and parses it with
// `parseServiceOptions`, then turns each pick into a draft service item.
// Those two sides drifted once already: the route moved price + duration
// under a nested `selectedMode`, the parser kept reading them flat, and the
// result was that every service the pro checked silently failed to build —
// the draft emptied and the modal refused to save with "Select at least one
// service before saving."
//
// A fixture written by hand can drift the same way, so this drives the REAL
// route handler and feeds its REAL response body to the REAL parser.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma, ServiceLocationType } from '@prisma/client'

import { parseServiceOptions } from '@/app/pro/calendar/_utils/parsers'
import { buildDraftItemFromServiceOption } from '@/app/pro/calendar/_utils/serviceItems'

const mocks = vi.hoisted(() => {
  const jsonOk = vi.fn(
    (data: unknown, status = 200) =>
      new Response(
        JSON.stringify({ ok: true, ...((data as Record<string, unknown>) ?? {}) }),
        { status, headers: { 'content-type': 'application/json' } },
      ),
  )

  const jsonFail = vi.fn(
    (status: number, error: string) =>
      new Response(JSON.stringify({ ok: false, error }), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  )

  return {
    jsonOk,
    jsonFail,
    requirePro: vi.fn(),
    professionalServiceOffering: { findMany: vi.fn() },
  }
})

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
  requirePro: mocks.requirePro,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    professionalServiceOffering: mocks.professionalServiceOffering,
  },
}))

import { GET } from './route'

/**
 * An offering row shaped like the route's own `select` — money as a Prisma
 * `Decimal`, the way the client hands it back.
 */
function offeringRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'offering-1',
    serviceId: 'service-1',
    offersInSalon: true,
    offersMobile: false,
    salonPriceStartingAt: new Prisma.Decimal('85.00'),
    salonDurationMinutes: 90,
    mobilePriceStartingAt: null,
    mobileDurationMinutes: null,
    service: {
      id: 'service-1',
      name: 'Silk Press',
      isActive: true,
      defaultDurationMinutes: 60,
      category: { isActive: true },
    },
    ...overrides,
  }
}

async function getServices(locationType: ServiceLocationType) {
  const res = await GET(
    new Request(`http://localhost/api/v1/pro/services?locationType=${locationType}`),
  )

  const body: unknown = await res.json()

  expect(res.status).toBe(200)

  return (body as { services: unknown }).services
}

describe('GET /api/v1/pro/services → calendar service picker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requirePro.mockResolvedValue({ ok: true, professionalId: 'pro-1' })
  })

  it('returns a salon service the picker can turn into a draft item', async () => {
    mocks.professionalServiceOffering.findMany.mockResolvedValue([offeringRow()])

    const services = await getServices(ServiceLocationType.SALON)
    const [option] = parseServiceOptions(services)

    if (!option) throw new Error('expected the route row to parse')

    expect(option.id).toBe('service-1')
    expect(option.offeringId).toBe('offering-1')
    expect(option.durationMinutes).toBe(90)

    // The step the bug broke: a checked service must build a real item.
    const draftItem = buildDraftItemFromServiceOption(option, 0, 15)

    expect(draftItem).not.toBeNull()
    expect(draftItem?.offeringId).toBe('offering-1')
    expect(draftItem?.durationMinutesSnapshot).toBe(90)
  })

  it('carries the MOBILE mode duration when mobile is requested', async () => {
    mocks.professionalServiceOffering.findMany.mockResolvedValue([
      offeringRow({
        offersInSalon: false,
        offersMobile: true,
        salonPriceStartingAt: null,
        salonDurationMinutes: null,
        mobilePriceStartingAt: new Prisma.Decimal('110.00'),
        mobileDurationMinutes: 120,
      }),
    ])

    const services = await getServices(ServiceLocationType.MOBILE)
    const [option] = parseServiceOptions(services)

    if (!option) throw new Error('expected the route row to parse')

    expect(option.durationMinutes).toBe(120)
    // `moneyToString` strips trailing zeros, so the wire carries "110".
    expect(option.priceStartingAt).toBe('110')
    expect(buildDraftItemFromServiceOption(option, 0, 15)).not.toBeNull()
  })

  it('builds an item for every service the pro could check', async () => {
    // Multi-service edits are the point of the picker: each returned row has
    // to be independently buildable, or "add another service" silently fails.
    mocks.professionalServiceOffering.findMany.mockResolvedValue([
      offeringRow(),
      offeringRow({
        id: 'offering-2',
        serviceId: 'service-2',
        salonDurationMinutes: 30,
        salonPriceStartingAt: new Prisma.Decimal('25.00'),
        service: {
          id: 'service-2',
          name: 'Trim',
          isActive: true,
          defaultDurationMinutes: 30,
          category: { isActive: true },
        },
      }),
    ])

    const services = await getServices(ServiceLocationType.SALON)
    const options = parseServiceOptions(services)

    expect(options).toHaveLength(2)

    const built = options.map((option, index) =>
      buildDraftItemFromServiceOption(option, index, 15),
    )

    expect(built.every((item) => item !== null)).toBe(true)
    expect(built.map((item) => item?.itemType)).toEqual(['BASE', 'ADD_ON'])
  })

  it('falls back to the service default duration when the mode has none', async () => {
    mocks.professionalServiceOffering.findMany.mockResolvedValue([
      offeringRow({ salonDurationMinutes: null }),
    ])

    const services = await getServices(ServiceLocationType.SALON)
    const [option] = parseServiceOptions(services)

    if (!option) throw new Error('expected the route row to parse')

    expect(option.durationMinutes).toBe(60)
    expect(buildDraftItemFromServiceOption(option, 0, 15)).not.toBeNull()
  })
})
