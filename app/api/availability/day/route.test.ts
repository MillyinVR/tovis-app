//app/api/availability/day/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  return {
    professionalProfileFindUnique: vi.fn(),
    serviceFindUnique: vi.fn(),
    professionalServiceOfferingFindFirst: vi.fn(),
    professionalServiceOfferingFindMany: vi.fn(),
    professionalLocationFindFirst: vi.fn(),
    professionalLocationFindMany: vi.fn(),
    offeringAddOnFindMany: vi.fn(),
    bookingFindMany: vi.fn(),
    bookingHoldFindMany: vi.fn(),
    calendarBlockFindMany: vi.fn(),
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: {
    professionalProfile: {
      findUnique: mocks.professionalProfileFindUnique,
    },
    service: {
      findUnique: mocks.serviceFindUnique,
    },
    professionalServiceOffering: {
      findFirst: mocks.professionalServiceOfferingFindFirst,
      findMany: mocks.professionalServiceOfferingFindMany,
    },
    professionalLocation: {
      findFirst: mocks.professionalLocationFindFirst,
      findMany: mocks.professionalLocationFindMany,
    },
    offeringAddOn: {
      findMany: mocks.offeringAddOnFindMany,
    },
    booking: {
      findMany: mocks.bookingFindMany,
    },
    bookingHold: {
      findMany: mocks.bookingHoldFindMany,
    },
    calendarBlock: {
      findMany: mocks.calendarBlockFindMany,
    },
  },
}))

vi.mock('@/lib/redis', () => ({
  getRedis: () => null,
}))

import { GET } from './route'

const WORKING_HOURS = {
  sun: { enabled: true, start: '09:00', end: '12:00' },
  mon: { enabled: true, start: '09:00', end: '12:00' },
  tue: { enabled: true, start: '09:00', end: '12:00' },
  wed: { enabled: true, start: '09:00', end: '12:00' },
  thu: { enabled: true, start: '09:00', end: '12:00' },
  fri: { enabled: true, start: '09:00', end: '12:00' },
  sat: { enabled: true, start: '09:00', end: '12:00' },
}

function makeLocation(args: {
  id: string
  type: 'SALON' | 'SUITE' | 'MOBILE_BASE'
  isPrimary?: boolean
}) {
  return {
    id: args.id,
    type: args.type,
    isPrimary: args.isPrimary ?? false,
    isBookable: true,
    timeZone: 'UTC',
    workingHours: WORKING_HOURS,
    bufferMinutes: 0,
    stepMinutes: 60,
    advanceNoticeMinutes: 0,
    maxDaysAhead: 365,
    lat: null,
    lng: null,
    city: null,
    formattedAddress: null,
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
  }
}

function addDaysUtc(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60_000)
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function ymd(date: Date): string {
  const yyyy = date.getUTCFullYear()
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function slotIso(date: Date, hour: number): string {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    hour,
    0,
    0,
    0,
  )).toISOString()
}

const testDayDate = addDaysUtc(startOfUtcDay(new Date()), 14)
const DAY = ymd(testDayDate)
const SLOT_09 = slotIso(testDayDate, 9)
const SLOT_10 = slotIso(testDayDate, 10)
const SLOT_11 = slotIso(testDayDate, 11)

const salonLocation = makeLocation({
  id: 'salon-1',
  type: 'SALON',
  isPrimary: true,
})

const mobileLocation = makeLocation({
  id: 'mobile-1',
  type: 'MOBILE_BASE',
})

async function getAvailability(params: Record<string, string>) {
  const search = new URLSearchParams(params)
  const req = new Request(`https://example.test/api/availability/day?${search.toString()}`)
  return GET(req)
}

describe('GET /api/availability/day', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.professionalProfileFindUnique.mockResolvedValue({
      id: 'pro-1',
      businessName: 'Test Pro',
      avatarUrl: null,
      location: null,
    })

    mocks.serviceFindUnique.mockResolvedValue({
      id: 'service-1',
      name: 'Haircut',
      category: { name: 'Hair' },
    })

    mocks.professionalServiceOfferingFindFirst.mockResolvedValue({
      id: 'offering-1',
      offersInSalon: true,
      offersMobile: true,
      salonDurationMinutes: 60,
      mobileDurationMinutes: 60,
      salonPriceStartingAt: '50.00',
      mobilePriceStartingAt: '70.00',
    })

    mocks.professionalServiceOfferingFindMany.mockResolvedValue([])
    mocks.offeringAddOnFindMany.mockResolvedValue([])
    mocks.bookingFindMany.mockResolvedValue([])
    mocks.bookingHoldFindMany.mockResolvedValue([])
    mocks.calendarBlockFindMany.mockResolvedValue([])
    mocks.professionalLocationFindMany.mockResolvedValue([])

    mocks.professionalLocationFindFirst.mockImplementation(
      async (args: { where?: { id?: string } }) => {
        const id = args.where?.id
        if (id === salonLocation.id) return salonLocation
        if (id === mobileLocation.id) return mobileLocation
        return null
      },
    )
  })

  it('shows salon slots when the client picked salon', async () => {
    const response = await getAvailability({
      professionalId: 'pro-1',
      serviceId: 'service-1',
      locationType: 'SALON',
      locationId: 'salon-1',
      date: DAY,
    })

    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.locationType).toBe('SALON')
    expect(body.locationId).toBe('salon-1')
    expect(body.slots).toContain(SLOT_09)
    expect(body.slots).toContain(SLOT_10)
    expect(body.slots).toContain(SLOT_11)
  })

  it('shows mobile slots when the client picked mobile', async () => {
    const response = await getAvailability({
      professionalId: 'pro-1',
      serviceId: 'service-1',
      locationType: 'MOBILE',
      locationId: 'mobile-1',
      date: DAY,
    })

    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.locationType).toBe('MOBILE')
    expect(body.locationId).toBe('mobile-1')
    expect(body.slots).toContain(SLOT_09)
    expect(body.slots).toContain(SLOT_10)
    expect(body.slots).toContain(SLOT_11)
  })

  it('a salon booking blocks the same-time mobile slot for the same pro', async () => {
    mocks.bookingFindMany.mockResolvedValue([
      {
        scheduledFor: new Date(SLOT_10),
        totalDurationMinutes: 60,
        bufferMinutes: 0,
      },
    ])

    const response = await getAvailability({
      professionalId: 'pro-1',
      serviceId: 'service-1',
      locationType: 'MOBILE',
      locationId: 'mobile-1',
      date: DAY,
    })

    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.locationType).toBe('MOBILE')
    expect(body.locationId).toBe('mobile-1')
    expect(body.slots).toContain(SLOT_09)
    expect(body.slots).not.toContain(SLOT_10)
    expect(body.slots).toContain(SLOT_11)
  })

  it('a mobile booking blocks the same-time salon slot for the same pro', async () => {
    mocks.bookingFindMany.mockResolvedValue([
      {
        scheduledFor: new Date(SLOT_10),
        totalDurationMinutes: 60,
        bufferMinutes: 0,
      },
    ])

    const response = await getAvailability({
      professionalId: 'pro-1',
      serviceId: 'service-1',
      locationType: 'SALON',
      locationId: 'salon-1',
      date: DAY,
    })

    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.locationType).toBe('SALON')
    expect(body.locationId).toBe('salon-1')
    expect(body.slots).toContain(SLOT_09)
    expect(body.slots).not.toContain(SLOT_10)
    expect(body.slots).toContain(SLOT_11)
  })
})