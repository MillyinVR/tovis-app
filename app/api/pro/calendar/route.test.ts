// app/api/pro/calendar/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  return {
    requirePro: vi.fn(),
    professionalProfileFindUnique: vi.fn(),
    professionalLocationFindMany: vi.fn(),
    bookingFindMany: vi.fn(),
    calendarBlockFindMany: vi.fn(),
    resolveAppointmentSchedulingContext: vi.fn(),
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

vi.mock('@/lib/booking/timeZoneTruth', () => ({
  resolveAppointmentSchedulingContext: mocks.resolveAppointmentSchedulingContext,
}))

import { GET } from './route'

function makeBooking(args: {
  id: string
  startsAt: string
  locationType: 'SALON' | 'MOBILE'
  locationId: string
  serviceName: string
  clientFirstName: string
  locationTimeZone?: string | null
  location?: { id: string; timeZone: string | null } | null
}) {
  return {
    id: args.id,
    scheduledFor: new Date(args.startsAt),
    status: 'ACCEPTED',
    totalDurationMinutes: 60,
    bufferMinutes: 0,
    locationType: args.locationType,
    locationId: args.locationId,
    locationTimeZone: args.locationTimeZone ?? null,
    location: args.location ?? null,
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
  locationTimeZone: 'America/New_York',
  location: {
    id: 'salon-1',
    timeZone: 'America/Chicago',
  },
})

const mobileBooking = makeBooking({
  id: 'booking-mobile',
  startsAt: '2030-01-15T11:00:00.000Z',
  locationType: 'MOBILE',
  locationId: 'mobile-1',
  serviceName: 'Mobile Glam',
  clientFirstName: 'Mobile',
  locationTimeZone: null,
  location: {
    id: 'mobile-1',
    timeZone: 'America/Chicago',
  },
})

const legacyBooking = makeBooking({
  id: 'booking-legacy',
  startsAt: '2030-01-15T23:30:00.000Z',
  locationType: 'SALON',
  locationId: 'legacy-1',
  serviceName: 'Legacy Booking',
  clientFirstName: 'Legacy',
  locationTimeZone: null,
  location: {
    id: 'legacy-1',
    timeZone: null,
  },
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
      timeZone: 'Europe/London',
      autoAcceptBookings: false,
    })

    mocks.professionalLocationFindMany.mockResolvedValue([
      {
        id: 'salon-1',
        type: 'SALON',
        isPrimary: true,
        timeZone: 'America/Los_Angeles',
      },
      {
        id: 'mobile-1',
        type: 'MOBILE_BASE',
        isPrimary: false,
        timeZone: 'America/Denver',
      },
      {
        id: 'legacy-1',
        type: 'SALON',
        isPrimary: false,
        timeZone: null,
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

    mocks.resolveAppointmentSchedulingContext.mockImplementation(
      async (args: {
        bookingLocationTimeZone?: string | null
        location?: { id?: string | null; timeZone?: string | null } | null
        locationId?: string | null
        professionalTimeZone?: string | null
      }) => {
        const bookingTz =
          typeof args.bookingLocationTimeZone === 'string'
            ? args.bookingLocationTimeZone.trim()
            : ''
        if (bookingTz) {
          return {
            ok: true,
            context: {
              appointmentTimeZone: bookingTz,
              timeZoneSource: 'BOOKING_SNAPSHOT',
              locationId: args.locationId ?? args.location?.id ?? null,
              locationTimeZone:
                typeof args.location?.timeZone === 'string'
                  ? args.location.timeZone
                  : null,
              businessTimeZone:
                typeof args.professionalTimeZone === 'string'
                  ? args.professionalTimeZone
                  : null,
            },
          }
        }

        const locationTz =
          typeof args.location?.timeZone === 'string'
            ? args.location.timeZone.trim()
            : ''
        if (locationTz) {
          return {
            ok: true,
            context: {
              appointmentTimeZone: locationTz,
              timeZoneSource: 'LOCATION',
              locationId: args.location?.id ?? args.locationId ?? null,
              locationTimeZone: locationTz,
              businessTimeZone:
                typeof args.professionalTimeZone === 'string'
                  ? args.professionalTimeZone
                  : null,
            },
          }
        }

        const proTz =
          typeof args.professionalTimeZone === 'string'
            ? args.professionalTimeZone.trim()
            : ''
        if (proTz) {
          return {
            ok: true,
            context: {
              appointmentTimeZone: proTz,
              timeZoneSource: 'PROFESSIONAL',
              locationId: args.location?.id ?? args.locationId ?? null,
              locationTimeZone: null,
              businessTimeZone: proTz,
            },
          }
        }

        return {
          ok: true,
          context: {
            appointmentTimeZone: 'UTC',
            timeZoneSource: 'FALLBACK',
            locationId: args.location?.id ?? args.locationId ?? null,
            locationTimeZone: null,
            businessTimeZone: null,
          },
        }
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

  it('returns viewport timezone separately from per-booking event timezones', async () => {
    const response = await GET(new Request('https://example.test/api/pro/calendar'))
    const body = await response.json()

    expect(response.status).toBe(200)

    expect(body.timeZone).toBe('America/Los_Angeles')
    expect(body.viewportTimeZone).toBe('America/Los_Angeles')

    const bookingEvents = body.events.filter(
      (event: { kind: string }) => event.kind === 'BOOKING',
    )

    const salonEvent = bookingEvents.find(
      (event: { id: string }) => event.id === 'booking-salon',
    )
    const mobileEvent = bookingEvents.find(
      (event: { id: string }) => event.id === 'booking-mobile',
    )

    expect(salonEvent).toMatchObject({
      id: 'booking-salon',
      startsAt: '2030-01-15T10:00:00.000Z',
      endsAt: '2030-01-15T11:00:00.000Z',
      timeZone: 'America/New_York',
      timeZoneSource: 'BOOKING_SNAPSHOT',
    })

    expect(mobileEvent).toMatchObject({
      id: 'booking-mobile',
      startsAt: '2030-01-15T11:00:00.000Z',
      endsAt: '2030-01-15T12:00:00.000Z',
      timeZone: 'America/Chicago',
      timeZoneSource: 'LOCATION',
    })

    expect(typeof salonEvent.localDateKey).toBe('string')
    expect(typeof mobileEvent.localDateKey).toBe('string')
    expect(typeof salonEvent.viewLocalDateKey).toBe('string')
    expect(typeof mobileEvent.viewLocalDateKey).toBe('string')
  })

  it('falls back deterministically for legacy rows with null locationTimeZone and returns timeZoneSource', async () => {
    mocks.bookingFindMany.mockResolvedValue([legacyBooking])

    const response = await GET(new Request('https://example.test/api/pro/calendar'))
    const body = await response.json()

    expect(response.status).toBe(200)

    const bookingEvents = body.events.filter(
      (event: { kind: string }) => event.kind === 'BOOKING',
    )

    expect(bookingEvents).toHaveLength(1)

    expect(bookingEvents[0]).toMatchObject({
      id: 'booking-legacy',
      timeZone: 'Europe/London',
      timeZoneSource: 'PROFESSIONAL',
      startsAt: '2030-01-15T23:30:00.000Z',
      endsAt: '2030-01-16T00:30:00.000Z',
    })

    expect(typeof bookingEvents[0].localDateKey).toBe('string')
    expect(typeof bookingEvents[0].viewLocalDateKey).toBe('string')
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

  it('computes todays management buckets using viewport-local day keys', async () => {
    const response = await GET(new Request('https://example.test/api/pro/calendar'))
    const body = await response.json()

    expect(response.status).toBe(200)

    expect(body.management).toBeTruthy()
    expect(Array.isArray(body.management.todaysBookings)).toBe(true)
    expect(Array.isArray(body.management.pendingRequests)).toBe(true)
    expect(Array.isArray(body.management.waitlistToday)).toBe(true)
    expect(Array.isArray(body.management.blockedToday)).toBe(true)
  })
})