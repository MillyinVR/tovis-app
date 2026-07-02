// app/api/v1/pro/calendar/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  return {
    requirePro: vi.fn(),
    professionalProfileFindUnique: vi.fn(),
    professionalLocationFindMany: vi.fn(),
    bookingFindMany: vi.fn(),
    calendarBlockFindMany: vi.fn(),
    waitlistEntryFindMany: vi.fn(),
    professionalServiceOfferingFindMany: vi.fn(),
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
    waitlistEntry: {
      findMany: mocks.waitlistEntryFindMany,
    },
    professionalServiceOffering: {
      findMany: mocks.professionalServiceOfferingFindMany,
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

// Note: @/lib/booking/timeZoneTruth is intentionally NOT mocked. The route
// resolves each booking's timezone purely from values already loaded with the
// booking (booking snapshot → location → professional → fallback), so the real
// resolver exercises that precedence directly.

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

describe('GET /api/v1/pro/calendar', () => {
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

    mocks.waitlistEntryFindMany.mockResolvedValue([])
    mocks.professionalServiceOfferingFindMany.mockResolvedValue([])

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
    const response = await GET(new Request('https://example.test/api/v1/pro/calendar'))
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
    const response = await GET(new Request('https://example.test/api/v1/pro/calendar'))
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

    const response = await GET(new Request('https://example.test/api/v1/pro/calendar'))
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
      new Request('https://example.test/api/v1/pro/calendar?locationId=mobile-1'),
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
    const response = await GET(new Request('https://example.test/api/v1/pro/calendar'))
    const body = await response.json()

    expect(response.status).toBe(200)

    expect(body.management).toBeTruthy()
    expect(Array.isArray(body.management.todaysBookings)).toBe(true)
    expect(Array.isArray(body.management.pendingRequests)).toBe(true)
    expect(Array.isArray(body.management.waitlistToday)).toBe(true)
    expect(Array.isArray(body.management.blockedToday)).toBe(true)
  })

  function makeWaitlistEntry(args: {
    id: string
    preferenceType: 'ANY_TIME' | 'TIME_OF_DAY' | 'SPECIFIC_DATE' | 'TIME_RANGE'
    specificDate?: Date | null
    timeOfDay?: 'MORNING' | 'AFTERNOON' | 'EVENING' | null
    windowStartMin?: number | null
    windowEndMin?: number | null
    serviceId?: string
    serviceName?: string
    clientFirstName?: string
  }) {
    return {
      id: args.id,
      status: 'ACTIVE',
      createdAt: new Date('2030-01-10T00:00:00.000Z'),
      serviceId: args.serviceId ?? 'svc-1',
      preferenceType: args.preferenceType,
      specificDate: args.specificDate ?? null,
      timeOfDay: args.timeOfDay ?? null,
      windowStartMin: args.windowStartMin ?? null,
      windowEndMin: args.windowEndMin ?? null,
      service: { name: args.serviceName ?? 'Balayage' },
      client: {
        id: 'client-wl-1',
        firstName: args.clientFirstName ?? 'Wendy',
        lastName: 'Waitlister',
        user: { email: 'wendy@example.com' },
      },
    }
  }

  it('maps an ACTIVE waitlist entry into a WAITLIST event with a preference label and offer link', async () => {
    mocks.waitlistEntryFindMany.mockResolvedValue([
      makeWaitlistEntry({ id: 'wl-anytime', preferenceType: 'ANY_TIME' }),
    ])
    // An active offering for the requested service enables the "Offer a time" deep-link.
    mocks.professionalServiceOfferingFindMany.mockResolvedValue([
      { id: 'offering-1', serviceId: 'svc-1' },
    ])

    const response = await GET(new Request('https://example.test/api/v1/pro/calendar'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.management.waitlistToday).toHaveLength(1)

    const event = body.management.waitlistToday[0]
    expect(event).toMatchObject({
      id: 'waitlist:wl-anytime',
      kind: 'BOOKING',
      status: 'WAITLIST',
      title: 'Balayage',
      clientName: 'Wendy Waitlister',
      locationId: null,
      preferenceLabel: 'Any time',
    })
    expect(event.offerHref).toContain('/pro/bookings/new')
    expect(event.offerHref).toContain('offeringId=offering-1')
    // Synthetic waitlist events never enter the top-level grid.
    expect(
      body.events.some((e: { id: string }) => e.id === 'waitlist:wl-anytime'),
    ).toBe(false)
  })

  it('shows the full active waitlist regardless of a SPECIFIC_DATE preference date', async () => {
    mocks.waitlistEntryFindMany.mockResolvedValue([
      makeWaitlistEntry({
        id: 'wl-future',
        preferenceType: 'SPECIFIC_DATE',
        specificDate: new Date('2099-01-01T00:00:00.000Z'),
      }),
    ])

    const response = await GET(new Request('https://example.test/api/v1/pro/calendar'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.management.waitlistToday).toHaveLength(1)
    expect(body.management.waitlistToday[0].preferenceLabel).toBe('Jan 1')
    // No active offering was stubbed → no bookable slot to offer.
    expect(body.management.waitlistToday[0].offerHref).toBeNull()
  })
})