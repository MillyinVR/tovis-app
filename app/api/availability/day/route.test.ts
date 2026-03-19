// app/api/availability/day/route.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  workingHours?: typeof WORKING_HOURS
  bufferMinutes?: number
  stepMinutes?: number
  advanceNoticeMinutes?: number
  maxDaysAhead?: number
}) {
  return {
    id: args.id,
    type: args.type,
    isPrimary: args.isPrimary ?? false,
    isBookable: true,
    timeZone: args.timeZone === undefined ? 'UTC' : args.timeZone,
    workingHours: args.workingHours ?? WORKING_HOURS,
    bufferMinutes: args.bufferMinutes ?? 0,
    stepMinutes: args.stepMinutes ?? 60,
    advanceNoticeMinutes: args.advanceNoticeMinutes ?? 0,
    maxDaysAhead: args.maxDaysAhead ?? 365,
    lat: null,
    lng: null,
    city: null,
    formattedAddress:
      args.type === 'MOBILE_BASE' ? null : '123 Main St, Test City, CA 90001',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  }
}

function makeDstLocation(args?: {
  workingHours?: {
    sun: { enabled: boolean; start: string; end: string }
    mon: { enabled: boolean; start: string; end: string }
    tue: { enabled: boolean; start: string; end: string }
    wed: { enabled: boolean; start: string; end: string }
    thu: { enabled: boolean; start: string; end: string }
    fri: { enabled: boolean; start: string; end: string }
    sat: { enabled: boolean; start: string; end: string }
  }
}) {
  return {
    id: 'dst-salon-1',
    type: 'SALON',
    isPrimary: true,
    isBookable: true,
    timeZone: 'America/New_York',
    workingHours:
      args?.workingHours ?? {
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
    maxDaysAhead: 730,
    lat: null,
    lng: null,
    city: null,
    formattedAddress: '123 DST St, Test City, NY 10001',
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

const DST_SPRING_FORWARD_DAY = '2027-03-14'
const DST_FALL_BACK_DAY = '2027-11-07'
const NEAR_MIDNIGHT_DAY = '2027-01-15'

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

describe('GET /api/availability/day parity regressions', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-11T19:00:00.000Z'))
    vi.clearAllMocks()

    mocks.professionalProfileFindUnique.mockResolvedValue({
      id: 'pro-1',
      businessName: 'Parity Pro',
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
      offersMobile: false,
      salonDurationMinutes: 15,
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
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns working-window aligned slots when the window starts off the midnight step boundary', async () => {
    const stepAnchoredLocation = makeLocation({
      id: 'step-salon-1',
      type: 'SALON',
      isPrimary: true,
      timeZone: 'UTC',
      stepMinutes: 15,
      bufferMinutes: 0,
      workingHours: {
        sun: { enabled: true, start: '09:10', end: '10:10' },
        mon: { enabled: true, start: '09:10', end: '10:10' },
        tue: { enabled: true, start: '09:10', end: '10:10' },
        wed: { enabled: true, start: '09:10', end: '10:10' },
        thu: { enabled: true, start: '09:10', end: '10:10' },
        fri: { enabled: true, start: '09:10', end: '10:10' },
        sat: { enabled: true, start: '09:10', end: '10:10' },
      },
    })

    mocks.professionalLocationFindFirst.mockImplementationOnce(
      async (args: { where?: { id?: string } }) => {
        if (args.where?.id === 'step-salon-1') return stepAnchoredLocation
        return null
      },
    )

    const response = await getAvailability({
      professionalId: 'pro-1',
      serviceId: 'service-1',
      locationType: 'SALON',
      locationId: 'step-salon-1',
      date: '2026-03-12',
    })

    const body = await response.json()

    expect(response.status).toBe(200)

    expect(body.slots).toContain('2026-03-12T09:10:00.000Z')
    expect(body.slots).toContain('2026-03-12T09:25:00.000Z')
    expect(body.slots).toContain('2026-03-12T09:40:00.000Z')
    expect(body.slots).toContain('2026-03-12T09:55:00.000Z')

    expect(body.slots).not.toContain('2026-03-12T09:00:00.000Z')
    expect(body.slots).not.toContain('2026-03-12T09:15:00.000Z')
    expect(body.slots).not.toContain('2026-03-12T09:30:00.000Z')
    expect(body.slots).not.toContain('2026-03-12T09:45:00.000Z')
  })

  it('does not expose slots past the exact max-days-ahead timestamp boundary on the final allowed date', async () => {
    const horizonLocation = makeLocation({
      id: 'horizon-salon-1',
      type: 'SALON',
      isPrimary: true,
      timeZone: 'UTC',
      stepMinutes: 30,
      bufferMinutes: 0,
      maxDaysAhead: 7,
      workingHours: {
        sun: { enabled: true, start: '18:00', end: '21:00' },
        mon: { enabled: true, start: '18:00', end: '21:00' },
        tue: { enabled: true, start: '18:00', end: '21:00' },
        wed: { enabled: true, start: '18:00', end: '21:00' },
        thu: { enabled: true, start: '18:00', end: '21:00' },
        fri: { enabled: true, start: '18:00', end: '21:00' },
        sat: { enabled: true, start: '18:00', end: '21:00' },
      },
    })

    mocks.professionalLocationFindFirst.mockImplementationOnce(
      async (args: { where?: { id?: string } }) => {
        if (args.where?.id === 'horizon-salon-1') return horizonLocation
        return null
      },
    )

    const response = await getAvailability({
      professionalId: 'pro-1',
      serviceId: 'service-1',
      locationType: 'SALON',
      locationId: 'horizon-salon-1',
      date: '2026-03-18',
    })

    const body = await response.json()

    expect(response.status).toBe(200)

    expect(body.slots).toContain('2026-03-18T18:00:00.000Z')
    expect(body.slots).toContain('2026-03-18T18:30:00.000Z')
    expect(body.slots).toContain('2026-03-18T19:00:00.000Z')

    expect(body.slots).not.toContain('2026-03-18T19:30:00.000Z')
    expect(body.slots).not.toContain('2026-03-18T20:00:00.000Z')
    expect(body.slots).not.toContain('2026-03-18T20:30:00.000Z')
  })
})

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
        return makeDstLocation()
      },
    )
  })

  it('spring forward: does not return nonexistent 02:00 local hour slots', async () => {
    const response = await getAvailability({
      professionalId: 'pro-1',
      serviceId: 'service-1',
      locationType: 'SALON',
      locationId: 'dst-salon-1',
      date: DST_SPRING_FORWARD_DAY,
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
    expect(localTimes).not.toContain('03:30')
  })

  it('fall back: returns valid slots across the repeated 01:00 local hour window', async () => {
    const response = await getAvailability({
      professionalId: 'pro-1',
      serviceId: 'service-1',
      locationType: 'SALON',
      locationId: 'dst-salon-1',
      date: DST_FALL_BACK_DAY,
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

    expect(oneAmSlots.length).toBeGreaterThanOrEqual(1)
    expect(oneThirtySlots.length).toBeGreaterThanOrEqual(1)

    expect(new Set(oneAmSlots).size).toBe(oneAmSlots.length)
    expect(new Set(oneThirtySlots).size).toBe(oneThirtySlots.length)

    expect(localTimes).toContain('02:00')
    expect(localTimes).toContain('02:30')
  })

  it('near midnight: returned slots stay on the requested local date', async () => {
    mocks.professionalServiceOfferingFindFirst.mockResolvedValueOnce({
      id: 'offering-1',
      offersInSalon: true,
      offersMobile: false,
      salonDurationMinutes: 30,
      mobileDurationMinutes: null,
      salonPriceStartingAt: '50.00',
      mobilePriceStartingAt: null,
    })

    mocks.professionalLocationFindFirst.mockImplementationOnce(
      async (args: { where?: { id?: string } }) => {
        if (args.where?.id !== 'dst-salon-1') return null

        return makeDstLocation({
          workingHours: {
            sun: { enabled: true, start: '23:00', end: '23:59' },
            mon: { enabled: true, start: '23:00', end: '23:59' },
            tue: { enabled: true, start: '23:00', end: '23:59' },
            wed: { enabled: true, start: '23:00', end: '23:59' },
            thu: { enabled: true, start: '23:00', end: '23:59' },
            fri: { enabled: true, start: '23:00', end: '23:59' },
            sat: { enabled: true, start: '23:00', end: '23:59' },
          },
        })
      },
    )

    const response = await getAvailability({
      professionalId: 'pro-1',
      serviceId: 'service-1',
      locationType: 'SALON',
      locationId: 'dst-salon-1',
      date: NEAR_MIDNIGHT_DAY,
    })

    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.timeZone).toBe('America/New_York')
    expect(body.timeZoneSource).toBe('LOCATION')

    const localDates = (body.slots as string[]).map((iso) =>
      localYmdInTz(iso, 'America/New_York'),
    )

    expect(localDates.length).toBeGreaterThan(0)
    expect(localDates.every((d) => d === NEAR_MIDNIGHT_DAY)).toBe(true)
  })
})