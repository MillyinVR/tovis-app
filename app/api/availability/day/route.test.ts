// app/api/availability/day/route.test.ts
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
  timeZone?: string | null
}) {
  return {
    id: args.id,
    type: args.type,
    isPrimary: args.isPrimary ?? false,
    isBookable: true,
    timeZone: args.timeZone ?? 'UTC',
    workingHours: WORKING_HOURS,
    bufferMinutes: 0,
    stepMinutes: 60,
    advanceNoticeMinutes: 0,
    maxDaysAhead: 365,
    lat: null,
    lng: null,
    city: null,
    formattedAddress:
      args.type === 'MOBILE_BASE' ? null : '123 Main St, Test City, CA 90001',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  }
}

function addDaysUtc(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60_000)
}

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  )
}

function ymd(date: Date): string {
  const yyyy = date.getUTCFullYear()
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function slotIso(date: Date, hour: number): string {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      hour,
      0,
      0,
      0,
    ),
  ).toISOString()
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
  const req = new Request(
    `https://example.test/api/availability/day?${search.toString()}`,
  )
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
      timeZone: 'UTC',
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
    expect(body.timeZone).toBe('UTC')
    expect(body.timeZoneSource).toBe('LOCATION')
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
      clientAddressId: 'addr-1',
      date: DAY,
    })

    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.locationType).toBe('MOBILE')
    expect(body.locationId).toBe('mobile-1')
    expect(body.timeZone).toBe('UTC')
    expect(body.timeZoneSource).toBe('LOCATION')
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
      clientAddressId: 'addr-1',
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

  it('falls back deterministically to professional timezone when location timezone is null', async () => {
    const legacySalonLocation = makeLocation({
      id: 'legacy-salon-1',
      type: 'SALON',
      isPrimary: true,
      timeZone: null,
    })

    mocks.professionalProfileFindUnique.mockResolvedValueOnce({
      id: 'pro-1',
      businessName: 'Test Pro',
      avatarUrl: null,
      location: null,
      timeZone: 'America/Chicago',
    })

    mocks.professionalLocationFindFirst.mockImplementationOnce(
      async (args: { where?: { id?: string } }) => {
        const id = args.where?.id
        if (id === legacySalonLocation.id) return legacySalonLocation
        return null
      },
    )

    const response = await getAvailability({
      professionalId: 'pro-1',
      serviceId: 'service-1',
      locationType: 'SALON',
      locationId: 'legacy-salon-1',
      date: DAY,
    })

    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.locationType).toBe('SALON')
    expect(body.locationId).toBe('legacy-salon-1')
    expect(body.timeZone).toBe('America/Chicago')
    expect(body.timeZoneSource).toBe('PROFESSIONAL')
    expect(Array.isArray(body.slots)).toBe(true)
  })
})
function localHmInTz(isoUtc: string, timeZone: string): string {
  const d = new Date(isoUtc)

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)

  const hh = parts.find((p) => p.type === 'hour')?.value ?? '00'
  const mm = parts.find((p) => p.type === 'minute')?.value ?? '00'
  return `${hh}:${mm}`
}

function localYmdInTz(isoUtc: string, timeZone: string): string {
  const d = new Date(isoUtc)

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)

  const yyyy = parts.find((p) => p.type === 'year')?.value ?? '0000'
  const mm = parts.find((p) => p.type === 'month')?.value ?? '00'
  const dd = parts.find((p) => p.type === 'day')?.value ?? '00'
  return `${yyyy}-${mm}-${dd}`
}

describe('GET /api/availability/day DST behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.professionalProfileFindUnique.mockResolvedValue({
      id: 'pro-1',
      businessName: 'DST Pro',
      avatarUrl: null,
      location: null,
      timeZone: 'America/New_York',
    })

    mocks.serviceFindUnique.mockResolvedValue({
      id: 'service-1',
      name: 'Haircut',
      category: { name: 'Hair' },
    })

    mocks.professionalServiceOfferingFindFirst.mockResolvedValue({
      id: 'offering-1',
      offersInSalon: true,
      offersMobile: false,
      salonDurationMinutes: 60,
      mobileDurationMinutes: null,
      salonPriceStartingAt: '50.00',
      mobilePriceStartingAt: null,
    })

    mocks.professionalServiceOfferingFindMany.mockResolvedValue([])
    mocks.offeringAddOnFindMany.mockResolvedValue([])
    mocks.bookingFindMany.mockResolvedValue([])
    mocks.bookingHoldFindMany.mockResolvedValue([])
    mocks.calendarBlockFindMany.mockResolvedValue([])
    mocks.professionalLocationFindMany.mockResolvedValue([])

    mocks.professionalLocationFindFirst.mockImplementation(
      async (args: { where?: { id?: string } }) => {
        if (args.where?.id !== 'dst-salon-1') return null

        return {
          id: 'dst-salon-1',
          type: 'SALON',
          isPrimary: true,
          isBookable: true,
          timeZone: 'America/New_York',
          workingHours: {
            sun: { enabled: true, start: '01:00', end: '04:00' },
            mon: { enabled: true, start: '01:00', end: '04:00' },
            tue: { enabled: true, start: '01:00', end: '04:00' },
            wed: { enabled: true, start: '01:00', end: '04:00' },
            thu: { enabled: true, start: '01:00', end: '04:00' },
            fri: { enabled: true, start: '01:00', end: '04:00' },
            sat: { enabled: true, start: '01:00', end: '04:00' },
          },
          bufferMinutes: 0,
          stepMinutes: 30,
          advanceNoticeMinutes: 0,
          maxDaysAhead: 365,
          lat: null,
          lng: null,
          city: null,
          formattedAddress: '123 DST St, Test City, NY 10001',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }
      },
    )
  })

  it('spring forward: does not return nonexistent 02:00 local hour slots', async () => {
    const response = await getAvailability({
      professionalId: 'pro-1',
      serviceId: 'service-1',
      locationType: 'SALON',
      locationId: 'dst-salon-1',
      date: '2026-03-08',
    })

    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.timeZone).toBe('America/New_York')
    expect(body.timeZoneSource).toBe('LOCATION')

    const localTimes = (body.slots as string[]).map((iso) =>
      localHmInTz(iso, 'America/New_York'),
    )

    expect(localTimes).toContain('01:00')
    expect(localTimes).toContain('01:30')

    expect(localTimes).not.toContain('02:00')
    expect(localTimes).not.toContain('02:30')

    expect(localTimes).toContain('03:00')
    expect(localTimes).toContain('03:30')
  })

  it('fall back: can return distinct UTC instants for repeated 01:00 local hour', async () => {
    const response = await getAvailability({
      professionalId: 'pro-1',
      serviceId: 'service-1',
      locationType: 'SALON',
      locationId: 'dst-salon-1',
      date: '2026-11-01',
    })

    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.timeZone).toBe('America/New_York')
    expect(body.timeZoneSource).toBe('LOCATION')

    const slots = body.slots as string[]
    const localTimes = slots.map((iso) => localHmInTz(iso, 'America/New_York'))

    const oneAmSlots = slots.filter(
      (iso) => localHmInTz(iso, 'America/New_York') === '01:00',
    )
    const oneThirtySlots = slots.filter(
      (iso) => localHmInTz(iso, 'America/New_York') === '01:30',
    )

    expect(oneAmSlots.length).toBeGreaterThanOrEqual(2)
    expect(oneThirtySlots.length).toBeGreaterThanOrEqual(2)

    expect(new Set(oneAmSlots).size).toBe(oneAmSlots.length)
    expect(new Set(oneThirtySlots).size).toBe(oneThirtySlots.length)

    expect(localTimes).toContain('02:00')
    expect(localTimes).toContain('02:30')
    expect(localTimes).toContain('03:00')
  })

  it('near midnight: returned slots stay on the requested local date', async () => {
    mocks.professionalLocationFindFirst.mockImplementationOnce(
      async (args: { where?: { id?: string } }) => {
        if (args.where?.id !== 'dst-salon-1') return null

        return {
          id: 'dst-salon-1',
          type: 'SALON',
          isPrimary: true,
          isBookable: true,
          timeZone: 'America/New_York',
          workingHours: {
            sun: { enabled: true, start: '23:00', end: '23:59' },
            mon: { enabled: true, start: '23:00', end: '23:59' },
            tue: { enabled: true, start: '23:00', end: '23:59' },
            wed: { enabled: true, start: '23:00', end: '23:59' },
            thu: { enabled: true, start: '23:00', end: '23:59' },
            fri: { enabled: true, start: '23:00', end: '23:59' },
            sat: { enabled: true, start: '23:00', end: '23:59' },
          },
          bufferMinutes: 0,
          stepMinutes: 30,
          advanceNoticeMinutes: 0,
          maxDaysAhead: 365,
          lat: null,
          lng: null,
          city: null,
          formattedAddress: '123 DST St, Test City, NY 10001',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }
      },
    )

    const response = await getAvailability({
      professionalId: 'pro-1',
      serviceId: 'service-1',
      locationType: 'SALON',
      locationId: 'dst-salon-1',
      date: '2026-01-15',
    })

    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.timeZone).toBe('America/New_York')
    expect(body.timeZoneSource).toBe('LOCATION')

    const localDates = (body.slots as string[]).map((iso) =>
      localYmdInTz(iso, 'America/New_York'),
    )

    expect(localDates.every((d) => d === '2026-01-15')).toBe(true)
  })
})