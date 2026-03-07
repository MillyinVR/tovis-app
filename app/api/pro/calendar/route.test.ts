import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  return {
    requirePro: vi.fn(),
    professionalProfileFindUnique: vi.fn(),
    professionalLocationFindMany: vi.fn(),
    bookingFindMany: vi.fn(),
    calendarBlockFindMany: vi.fn(),
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: {
    professionalProfile: {
      findUnique: mocks.professionalProfileFindUnique,
    },
    professionalLocation: {
      findMany: mocks.professionalLocationFindMany,
    },
    booking: {
      findMany: mocks.bookingFindMany,
    },
    calendarBlock: {
      findMany: mocks.calendarBlockFindMany,
    },
  },
}))

vi.mock('@/app/api/_utils', () => ({
  requirePro: mocks.requirePro,
  jsonOk: (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  jsonFail: (status: number, message: string, extra?: Record<string, unknown>) =>
    new Response(JSON.stringify({ ok: false, message, ...(extra ?? {}) }), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
}))

import { GET } from './route'

function makeBooking(args: {
  id: string
  startsAt: string
  locationType: 'SALON' | 'MOBILE'
  locationId: string
  serviceName: string
  clientFirstName: string
}) {
  return {
    id: args.id,
    scheduledFor: new Date(args.startsAt),
    status: 'ACCEPTED',
    totalDurationMinutes: 60,
    bufferMinutes: 0,
    locationType: args.locationType,
    locationId: args.locationId,
    client: {
      firstName: args.clientFirstName,
      lastName: 'Client',
      user: { email: `${args.clientFirstName.toLowerCase()}@example.com` },
    },
    service: {
      name: args.serviceName,
    },
    serviceItems: [],
  }
}

const salonBooking = makeBooking({
  id: 'booking-salon',
  startsAt: '2030-01-15T10:00:00.000Z',
  locationType: 'SALON',
  locationId: 'salon-1',
  serviceName: 'Salon Cut',
  clientFirstName: 'Salon',
})

const mobileBooking = makeBooking({
  id: 'booking-mobile',
  startsAt: '2030-01-15T11:00:00.000Z',
  locationType: 'MOBILE',
  locationId: 'mobile-1',
  serviceName: 'Mobile Glam',
  clientFirstName: 'Mobile',
})

const allBlocks = [
  {
    id: 'block-global',
    startsAt: new Date('2030-01-15T08:00:00.000Z'),
    endsAt: new Date('2030-01-15T09:00:00.000Z'),
    note: 'Global block',
    locationId: null,
  },
  {
    id: 'block-salon',
    startsAt: new Date('2030-01-15T12:00:00.000Z'),
    endsAt: new Date('2030-01-15T13:00:00.000Z'),
    note: 'Salon block',
    locationId: 'salon-1',
  },
  {
    id: 'block-mobile',
    startsAt: new Date('2030-01-15T14:00:00.000Z'),
    endsAt: new Date('2030-01-15T15:00:00.000Z'),
    note: 'Mobile block',
    locationId: 'mobile-1',
  },
]

describe('GET /api/pro/calendar', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requirePro.mockResolvedValue({
      ok: true,
      professionalId: 'pro-1',
    })

    mocks.professionalProfileFindUnique.mockResolvedValue({
      id: 'pro-1',
      timeZone: 'UTC',
      autoAcceptBookings: false,
    })

    mocks.professionalLocationFindMany.mockResolvedValue([
      {
        id: 'salon-1',
        type: 'SALON',
        isPrimary: true,
        timeZone: 'UTC',
      },
      {
        id: 'mobile-1',
        type: 'MOBILE_BASE',
        isPrimary: false,
        timeZone: 'UTC',
      },
    ])

    mocks.bookingFindMany.mockResolvedValue([salonBooking, mobileBooking])

    mocks.calendarBlockFindMany.mockImplementation(
      async (args: { where?: { OR?: Array<{ locationId: string | null }> } }) => {
        const allowedLocationIds =
          args.where?.OR?.map((entry) => entry.locationId ?? null) ?? []

        return allBlocks.filter((block) =>
          allowedLocationIds.includes(block.locationId ?? null),
        )
      },
    )
  })

  it('returns both salon and mobile bookings with locationType preserved', async () => {
    const response = await GET(new Request('https://example.test/api/pro/calendar'))
    const body = await response.json()

    expect(response.status).toBe(200)

    const bookingEvents = body.events.filter(
      (event: { kind: string }) => event.kind === 'BOOKING',
    )

    expect(bookingEvents).toHaveLength(2)

    expect(
      bookingEvents.find((event: { id: string }) => event.id === 'booking-salon'),
    ).toMatchObject({
      locationType: 'SALON',
      locationId: 'salon-1',
    })

    expect(
      bookingEvents.find((event: { id: string }) => event.id === 'booking-mobile'),
    ).toMatchObject({
      locationType: 'MOBILE',
      locationId: 'mobile-1',
    })
  })

  it('returns all pro bookings, while blocks stay selected-location/global only', async () => {
    const response = await GET(
      new Request('https://example.test/api/pro/calendar?locationId=mobile-1'),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.location.id).toBe('mobile-1')

    const bookingEvents = body.events.filter(
      (event: { kind: string }) => event.kind === 'BOOKING',
    )
    const blockEvents = body.events.filter(
      (event: { kind: string }) => event.kind === 'BLOCK',
    )

    expect(bookingEvents).toHaveLength(2)
    expect(
      bookingEvents.map((event: { id: string }) => event.id).sort(),
    ).toEqual(['booking-mobile', 'booking-salon'])

    expect(
      blockEvents.map((event: { blockId: string }) => event.blockId).sort(),
    ).toEqual(['block-global', 'block-mobile'])
  })
})