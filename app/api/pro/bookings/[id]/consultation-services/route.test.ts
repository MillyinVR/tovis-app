// app/api/pro/bookings/[id]/consultation-services/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingServiceItemType } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  bookingFindUnique: vi.fn(),
  professionalServiceOfferingFindMany: vi.fn(),

  requirePro: vi.fn(),
  pickString: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: {
      findUnique: mocks.bookingFindUnique,
    },
    professionalServiceOffering: {
      findMany: mocks.professionalServiceOfferingFindMany,
    },
  },
}))

vi.mock('@/app/api/_utils', () => ({
  requirePro: mocks.requirePro,
  pickString: mocks.pickString,
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
}))

import { GET } from './route'

function makeJsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  })
}

function makeCtx(id = 'booking_1') {
  return {
    params: Promise.resolve({ id }),
  }
}

function makeRequest(): Request {
  return new Request(
    'http://localhost/api/pro/bookings/booking_1/consultation-services',
    {
      method: 'GET',
    },
  )
}

function decimalLike(value: string) {
  return {
    toString: () => value,
  }
}

function makeBooking(overrides?: {
  professionalId?: string
  serviceItems?: Array<{
    id: string
    serviceId: string
    offeringId: string | null
    itemType: BookingServiceItemType
    parentItemId: string | null
  }>
}) {
  return {
    id: 'booking_1',
    professionalId: overrides?.professionalId ?? 'pro_1',
    serviceItems:
      overrides?.serviceItems ??
      [
        {
          id: 'booking_item_base_1',
          serviceId: 'service_base_1',
          offeringId: 'offering_base_1',
          itemType: BookingServiceItemType.BASE,
          parentItemId: null,
        },
        {
          id: 'booking_item_addon_1',
          serviceId: 'service_addon_1',
          offeringId: null,
          itemType: BookingServiceItemType.ADD_ON,
          parentItemId: 'booking_item_base_1',
        },
      ],
  }
}

function makeOfferings() {
  return [
    {
      id: 'offering_hair_1',
      serviceId: 'service_hair_1',
      salonPriceStartingAt: null,
      salonDurationMinutes: null,
      mobilePriceStartingAt: '100.456',
      mobileDurationMinutes: 60,
      service: {
        name: 'Zebra Cut',
        category: {
          name: 'Hair',
        },
      },
      addOns: [
        {
          isRecommended: true,
          priceOverride: decimalLike('20.555'),
          durationOverrideMinutes: 15,
          addOnService: {
            id: 'service_addon_2',
            name: 'Gloss',
            defaultDurationMinutes: 20,
            minPrice: '25.00',
            category: {
              name: 'Treatment',
            },
          },
        },
      ],
    },
    {
      id: 'offering_brow_1',
      serviceId: 'service_brow_1',
      salonPriceStartingAt: decimalLike('49.991'),
      salonDurationMinutes: 30,
      mobilePriceStartingAt: null,
      mobileDurationMinutes: null,
      service: {
        name: 'Brow Lamination',
        category: {
          name: 'Brows',
        },
      },
      addOns: [],
    },
  ]
}

describe('app/api/pro/bookings/[id]/consultation-services/route.ts', () => {
  beforeEach(() => {
    vi.resetAllMocks()

    mocks.requirePro.mockResolvedValue({
      ok: true,
      professionalId: 'pro_1',
      proId: 'pro_1',
      user: {
        id: 'user_1',
      },
    })

    mocks.pickString.mockImplementation((value: unknown) =>
      typeof value === 'string' && value.trim() ? value.trim() : null,
    )

    mocks.jsonFail.mockImplementation(
      (status: number, error: string, extra?: Record<string, unknown>) =>
        makeJsonResponse(status, {
          ok: false,
          error,
          ...(extra ?? {}),
        }),
    )

    mocks.jsonOk.mockImplementation((payload: unknown, status = 200) =>
      makeJsonResponse(status, {
        ok: true,
        ...(typeof payload === 'object' && payload !== null ? payload : {}),
      }),
    )
  })

  it('returns auth response when requirePro fails', async () => {
    const authRes = makeJsonResponse(401, {
      ok: false,
      error: 'Unauthorized',
    })

    mocks.requirePro.mockResolvedValueOnce({
      ok: false,
      res: authRes,
    })

    const result = await GET(makeRequest(), makeCtx())

    expect(result).toBe(authRes)
    expect(mocks.bookingFindUnique).not.toHaveBeenCalled()
    expect(mocks.professionalServiceOfferingFindMany).not.toHaveBeenCalled()
  })

  it('returns 400 when booking id is missing', async () => {
    const result = await GET(makeRequest(), makeCtx('   '))

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Missing booking id.',
    })

    expect(mocks.bookingFindUnique).not.toHaveBeenCalled()
    expect(mocks.professionalServiceOfferingFindMany).not.toHaveBeenCalled()
  })

  it('returns 404 when booking is not found', async () => {
    mocks.bookingFindUnique.mockResolvedValueOnce(null)

    const result = await GET(makeRequest(), makeCtx())

    expect(result.status).toBe(404)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Booking not found.',
    })

    expect(mocks.bookingFindUnique).toHaveBeenCalledWith({
      where: { id: 'booking_1' },
      select: expect.objectContaining({
        id: true,
        professionalId: true,
        serviceItems: expect.any(Object),
      }),
    })

    expect(mocks.professionalServiceOfferingFindMany).not.toHaveBeenCalled()
  })

  it('returns 403 when booking belongs to another professional', async () => {
    mocks.bookingFindUnique.mockResolvedValueOnce(
      makeBooking({
        professionalId: 'other_pro',
      }),
    )

    const result = await GET(makeRequest(), makeCtx())

    expect(result.status).toBe(403)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Forbidden.',
    })

    expect(mocks.professionalServiceOfferingFindMany).not.toHaveBeenCalled()
  })

  it('returns sorted services, add-ons, and existing booking items for the authenticated professional', async () => {
    mocks.bookingFindUnique.mockResolvedValueOnce(makeBooking())
    mocks.professionalServiceOfferingFindMany.mockResolvedValueOnce(
      makeOfferings(),
    )

    const result = await GET(makeRequest(), makeCtx())

    expect(result.status).toBe(200)

    await expect(result.json()).resolves.toEqual({
      ok: true,
      services: [
        {
          offeringId: 'offering_brow_1',
          serviceId: 'service_brow_1',
          serviceName: 'Brow Lamination',
          categoryName: 'Brows',
          defaultPrice: 49.99,
          defaultDurationMinutes: 30,
          itemType: 'BASE',
        },
        {
          offeringId: 'offering_hair_1',
          serviceId: 'service_hair_1',
          serviceName: 'Zebra Cut',
          categoryName: 'Hair',
          defaultPrice: 100.46,
          defaultDurationMinutes: 60,
          itemType: 'BASE',
        },
      ],
      addOns: [
        {
          parentOfferingId: 'offering_hair_1',
          serviceId: 'service_addon_2',
          serviceName: 'Gloss',
          categoryName: 'Treatment',
          defaultPrice: 20.56,
          defaultDurationMinutes: 15,
          isRecommended: true,
          itemType: 'ADD_ON',
        },
      ],
      existingBookingItems: [
        {
          bookingServiceItemId: 'booking_item_base_1',
          serviceId: 'service_base_1',
          offeringId: 'offering_base_1',
          itemType: BookingServiceItemType.BASE,
          parentItemId: null,
        },
        {
          bookingServiceItemId: 'booking_item_addon_1',
          serviceId: 'service_addon_1',
          offeringId: null,
          itemType: BookingServiceItemType.ADD_ON,
          parentItemId: 'booking_item_base_1',
        },
      ],
    })

    expect(mocks.professionalServiceOfferingFindMany).toHaveBeenCalledWith({
      where: {
        professionalId: 'pro_1',
        isActive: true,
        service: { isActive: true },
      },
      orderBy: [{ createdAt: 'asc' }],
      select: expect.objectContaining({
        id: true,
        serviceId: true,
        addOns: expect.any(Object),
      }),
      take: 500,
    })
  })

  it('returns 500 when loading consultation services fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    mocks.bookingFindUnique.mockRejectedValueOnce(new Error('db boom'))

    const result = await GET(makeRequest(), makeCtx())

    expect(result.status).toBe(500)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Internal server error',
    })

    expect(spy).toHaveBeenCalledWith(
      'GET /api/pro/bookings/[id]/consultation-services error',
      expect.any(Error),
    )

    spy.mockRestore()
  })
})
