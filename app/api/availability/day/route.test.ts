// app/api/availability/day/route.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ServiceLocationType } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  getScheduleVersion: vi.fn(),
  getScheduleConfigVersion: vi.fn(),

  buildDayCacheKey: vi.fn(),
  cacheGetJson: vi.fn(),
  cacheSetJson: vi.fn(),

  resolveDurationWithAddOns: vi.fn(),
  loadBusyIntervals: vi.fn(),
  loadAvailabilityOfferingContext: vi.fn(),

  computeDaySlotsFast: vi.fn(),
}))

vi.mock('@/lib/booking/cacheVersion', () => ({
  getScheduleVersion: mocks.getScheduleVersion,
  getScheduleConfigVersion: mocks.getScheduleConfigVersion,
}))

vi.mock('@/lib/availability/data/cache', () => ({
  buildDayCacheKey: mocks.buildDayCacheKey,
  cacheGetJson: mocks.cacheGetJson,
  cacheSetJson: mocks.cacheSetJson,
}))

vi.mock('@/lib/availability/data/addOnContext', () => ({
  resolveDurationWithAddOns: mocks.resolveDurationWithAddOns,
}))

vi.mock('@/lib/availability/data/busyIntervals', () => ({
  loadBusyIntervals: mocks.loadBusyIntervals,
}))

vi.mock('@/lib/availability/data/offeringContext', () => ({
  loadAvailabilityOfferingContext: mocks.loadAvailabilityOfferingContext,
}))

vi.mock('@/lib/availability/core/dayComputation', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/availability/core/dayComputation')>(
      '@/lib/availability/core/dayComputation',
    )

  return {
    ...actual,
    computeDaySlotsFast: mocks.computeDaySlotsFast,
  }
})

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

function makeBaseContext(overrides?: Partial<{
  locationId: string
  effectiveLocationType: ServiceLocationType
  timeZone: string
  timeZoneSource: 'LOCATION' | 'PROFESSIONAL'
  workingHours: typeof WORKING_HOURS
  defaultStepMinutes: number
  defaultLead: number
  locationBufferMinutes: number
  maxAdvanceDays: number
  durationMinutes: number
  offeringDbId: string
  offeringPayload: {
    id: string
    offersInSalon: boolean
    offersMobile: boolean
    salonDurationMinutes: number | null
    mobileDurationMinutes: number | null
    salonPriceStartingAt: string | null
    mobilePriceStartingAt: string | null
  }
}>) {
  return {
    ok: true as const,
    value: {
      locationId: overrides?.locationId ?? 'salon-1',
      effectiveLocationType:
        overrides?.effectiveLocationType ?? ServiceLocationType.SALON,
      timeZone: overrides?.timeZone ?? 'UTC',
      timeZoneSource: overrides?.timeZoneSource ?? 'LOCATION',
      workingHours: overrides?.workingHours ?? WORKING_HOURS,
      defaultStepMinutes: overrides?.defaultStepMinutes ?? 60,
      defaultLead: overrides?.defaultLead ?? 0,
      locationBufferMinutes: overrides?.locationBufferMinutes ?? 0,
      maxAdvanceDays: overrides?.maxAdvanceDays ?? 365,
      durationMinutes: overrides?.durationMinutes ?? 60,
      offeringDbId: overrides?.offeringDbId ?? 'offering-1',
      offeringPayload: overrides?.offeringPayload ?? {
        id: 'offering-1',
        offersInSalon: true,
        offersMobile: true,
        salonDurationMinutes: 60,
        mobileDurationMinutes: 60,
        salonPriceStartingAt: '50.00',
        mobilePriceStartingAt: '70.00',
      },
    },
  }
}

function makeDaySlotsResult(args?: {
  slots?: string[]
  dayStartUtc?: string
  dayEndExclusiveUtc?: string
}) {
  return {
    ok: true as const,
    dayStartUtc: new Date(args?.dayStartUtc ?? `${DAY}T00:00:00.000Z`),
    dayEndExclusiveUtc: new Date(
      args?.dayEndExclusiveUtc ?? `${DAY}T24:00:00.000Z`.replace('24:00:00.000Z', '00:00:00.000Z'),
    ),
    slots: args?.slots ?? [SLOT_09, SLOT_10, SLOT_11],
  }
}

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

    mocks.getScheduleVersion.mockResolvedValue('sched-v1')
    mocks.getScheduleConfigVersion.mockResolvedValue('cfg-v1')

    mocks.buildDayCacheKey.mockReturnValue(null)
    mocks.cacheGetJson.mockResolvedValue(null)
    mocks.cacheSetJson.mockResolvedValue(undefined)

    mocks.resolveDurationWithAddOns.mockResolvedValue({
      ok: true,
      durationMinutes: 60,
    })

    mocks.loadBusyIntervals.mockResolvedValue([])

    mocks.loadAvailabilityOfferingContext.mockResolvedValue(
      makeBaseContext({
        locationId: 'salon-1',
        effectiveLocationType: ServiceLocationType.SALON,
        timeZone: 'UTC',
        timeZoneSource: 'LOCATION',
      }),
    )

    mocks.computeDaySlotsFast.mockResolvedValue(
      makeDaySlotsResult({
        slots: [SLOT_09, SLOT_10, SLOT_11],
      }),
    )
  })

  afterEach(() => {
    vi.useRealTimers()
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
    expect(body.mode).toBe('DAY')
    expect(body.locationType).toBe('SALON')
    expect(body.locationId).toBe('salon-1')
    expect(body.timeZone).toBe('UTC')
    expect(body.timeZoneSource).toBe('LOCATION')
    expect(body.request.locationType).toBe('SALON')
    expect(body.request.locationId).toBe('salon-1')
    expect(body.slots).toContain(SLOT_09)
    expect(body.slots).toContain(SLOT_10)
    expect(body.slots).toContain(SLOT_11)
  })

  it('shows mobile slots when the client picked mobile', async () => {
    mocks.loadAvailabilityOfferingContext.mockResolvedValueOnce(
      makeBaseContext({
        locationId: 'mobile-1',
        effectiveLocationType: ServiceLocationType.MOBILE,
        timeZone: 'UTC',
        timeZoneSource: 'LOCATION',
      }),
    )

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
    expect(body.mode).toBe('DAY')
    expect(body.locationType).toBe('MOBILE')
    expect(body.locationId).toBe('mobile-1')
    expect(body.request.locationType).toBe('MOBILE')
    expect(body.request.clientAddressId).toBe('addr-1')
    expect(body.slots).toContain(SLOT_09)
    expect(body.slots).toContain(SLOT_10)
    expect(body.slots).toContain(SLOT_11)
  })

  it('a salon booking blocks the same-time mobile slot for the same pro', async () => {
    mocks.loadAvailabilityOfferingContext.mockResolvedValueOnce(
      makeBaseContext({
        locationId: 'mobile-1',
        effectiveLocationType: ServiceLocationType.MOBILE,
        timeZone: 'UTC',
      }),
    )

    mocks.computeDaySlotsFast.mockResolvedValueOnce(
      makeDaySlotsResult({
        slots: [SLOT_09, SLOT_11],
      }),
    )

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
    mocks.computeDaySlotsFast.mockResolvedValueOnce(
      makeDaySlotsResult({
        slots: [SLOT_09, SLOT_11],
      }),
    )

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
    mocks.loadAvailabilityOfferingContext.mockResolvedValueOnce(
      makeBaseContext({
        locationId: 'legacy-salon-1',
        effectiveLocationType: ServiceLocationType.SALON,
        timeZone: 'America/Chicago',
        timeZoneSource: 'PROFESSIONAL',
      }),
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

describe('GET /api/availability/day phase 2 placement', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.getScheduleVersion.mockResolvedValue('sched-v1')
    mocks.getScheduleConfigVersion.mockResolvedValue('cfg-v1')
    mocks.buildDayCacheKey.mockReturnValue(null)
    mocks.cacheGetJson.mockResolvedValue(null)
    mocks.cacheSetJson.mockResolvedValue(undefined)
    mocks.resolveDurationWithAddOns.mockResolvedValue({
      ok: true,
      durationMinutes: 60,
    })
    mocks.loadBusyIntervals.mockResolvedValue([])
    mocks.computeDaySlotsFast.mockResolvedValue(
      makeDaySlotsResult({
        slots: [SLOT_09, SLOT_10, SLOT_11],
      }),
    )
  })

  it('defaults day availability to salon when both modes are supported, even if mobile is primary', async () => {
    mocks.loadAvailabilityOfferingContext.mockResolvedValueOnce(
      makeBaseContext({
        locationId: 'salon-secondary-1',
        effectiveLocationType: ServiceLocationType.SALON,
      }),
    )

    const response = await getAvailability({
      professionalId: 'pro-1',
      serviceId: 'service-1',
      date: DAY,
    })

    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.mode).toBe('DAY')
    expect(body.locationType).toBe('SALON')
    expect(body.locationId).toBe('salon-secondary-1')
    expect(body.slots).toContain(SLOT_09)
  })

  it('returns 400 when date is missing because summary moved to bootstrap', async () => {
    const response = await getAvailability({
      professionalId: 'pro-1',
      serviceId: 'service-1',
    })

    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.ok).toBe(false)
    expect(body.error).toContain('Missing date')
    expect(mocks.loadAvailabilityOfferingContext).not.toHaveBeenCalled()
  })

  it('falls back to mobile on initial load only when salon placement is invalid', async () => {
    mocks.loadAvailabilityOfferingContext.mockResolvedValueOnce(
      makeBaseContext({
        locationId: 'mobile-valid-1',
        effectiveLocationType: ServiceLocationType.MOBILE,
      }),
    )

    const response = await getAvailability({
      professionalId: 'pro-1',
      serviceId: 'service-1',
      clientAddressId: 'addr-1',
      date: DAY,
    })

    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.locationType).toBe('MOBILE')
    expect(body.locationId).toBe('mobile-valid-1')
  })

  it('does not silently switch an explicit mobile request to salon', async () => {
    mocks.loadAvailabilityOfferingContext.mockResolvedValueOnce({
      ok: false,
      kind: 'BOOKING_ERROR',
      code: 'LOCATION_NOT_FOUND',
    })

    const response = await getAvailability({
      professionalId: 'pro-1',
      serviceId: 'service-1',
      locationType: 'MOBILE',
      clientAddressId: 'addr-1',
      date: DAY,
    })

    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.ok).toBe(false)
    expect(body.code).toBe('LOCATION_NOT_FOUND')
  })
})

describe('GET /api/availability/day parity regressions', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-11T19:00:00.000Z'))
    vi.clearAllMocks()

    mocks.getScheduleVersion.mockResolvedValue('sched-v1')
    mocks.getScheduleConfigVersion.mockResolvedValue('cfg-v1')
    mocks.buildDayCacheKey.mockReturnValue(null)
    mocks.cacheGetJson.mockResolvedValue(null)
    mocks.cacheSetJson.mockResolvedValue(undefined)
    mocks.resolveDurationWithAddOns.mockResolvedValue({
      ok: true,
      durationMinutes: 15,
    })
    mocks.loadBusyIntervals.mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns working-window aligned slots when the window starts off the midnight step boundary', async () => {
    mocks.loadAvailabilityOfferingContext.mockResolvedValueOnce(
      makeBaseContext({
        locationId: 'step-salon-1',
        effectiveLocationType: ServiceLocationType.SALON,
        timeZone: 'UTC',
        defaultStepMinutes: 15,
        locationBufferMinutes: 0,
        durationMinutes: 15,
        workingHours: {
          sun: { enabled: true, start: '09:10', end: '10:10' },
          mon: { enabled: true, start: '09:10', end: '10:10' },
          tue: { enabled: true, start: '09:10', end: '10:10' },
          wed: { enabled: true, start: '09:10', end: '10:10' },
          thu: { enabled: true, start: '09:10', end: '10:10' },
          fri: { enabled: true, start: '09:10', end: '10:10' },
          sat: { enabled: true, start: '09:10', end: '10:10' },
        },
        offeringPayload: {
          id: 'offering-1',
          offersInSalon: true,
          offersMobile: false,
          salonDurationMinutes: 15,
          mobileDurationMinutes: null,
          salonPriceStartingAt: '50.00',
          mobilePriceStartingAt: null,
        },
      }),
    )

    mocks.computeDaySlotsFast.mockResolvedValueOnce({
      ok: true,
      dayStartUtc: new Date('2026-03-12T00:00:00.000Z'),
      dayEndExclusiveUtc: new Date('2026-03-13T00:00:00.000Z'),
      slots: [
        '2026-03-12T09:10:00.000Z',
        '2026-03-12T09:25:00.000Z',
        '2026-03-12T09:40:00.000Z',
        '2026-03-12T09:55:00.000Z',
      ],
    })

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
    mocks.loadAvailabilityOfferingContext.mockResolvedValueOnce(
      makeBaseContext({
        locationId: 'horizon-salon-1',
        effectiveLocationType: ServiceLocationType.SALON,
        timeZone: 'UTC',
        defaultStepMinutes: 30,
        locationBufferMinutes: 0,
        maxAdvanceDays: 7,
        durationMinutes: 15,
        workingHours: {
          sun: { enabled: true, start: '18:00', end: '21:00' },
          mon: { enabled: true, start: '18:00', end: '21:00' },
          tue: { enabled: true, start: '18:00', end: '21:00' },
          wed: { enabled: true, start: '18:00', end: '21:00' },
          thu: { enabled: true, start: '18:00', end: '21:00' },
          fri: { enabled: true, start: '18:00', end: '21:00' },
          sat: { enabled: true, start: '18:00', end: '21:00' },
        },
        offeringPayload: {
          id: 'offering-1',
          offersInSalon: true,
          offersMobile: false,
          salonDurationMinutes: 15,
          mobileDurationMinutes: null,
          salonPriceStartingAt: '50.00',
          mobilePriceStartingAt: null,
        },
      }),
    )

    mocks.computeDaySlotsFast.mockResolvedValueOnce({
      ok: true,
      dayStartUtc: new Date('2026-03-18T00:00:00.000Z'),
      dayEndExclusiveUtc: new Date('2026-03-19T00:00:00.000Z'),
      slots: [
        '2026-03-18T18:00:00.000Z',
        '2026-03-18T18:30:00.000Z',
        '2026-03-18T19:00:00.000Z',
      ],
    })

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

    mocks.getScheduleVersion.mockResolvedValue('sched-v1')
    mocks.getScheduleConfigVersion.mockResolvedValue('cfg-v1')
    mocks.buildDayCacheKey.mockReturnValue(null)
    mocks.cacheGetJson.mockResolvedValue(null)
    mocks.cacheSetJson.mockResolvedValue(undefined)
    mocks.resolveDurationWithAddOns.mockResolvedValue({
      ok: true,
      durationMinutes: 60,
    })
    mocks.loadBusyIntervals.mockResolvedValue([])
  })

  it('spring forward: does not return nonexistent 02:00 local hour slots', async () => {
    mocks.loadAvailabilityOfferingContext.mockResolvedValueOnce(
      makeBaseContext({
        locationId: 'dst-salon-1',
        effectiveLocationType: ServiceLocationType.SALON,
        timeZone: 'America/New_York',
        defaultStepMinutes: 30,
      }),
    )

    mocks.computeDaySlotsFast.mockResolvedValueOnce({
      ok: true,
      dayStartUtc: new Date('2027-03-14T05:00:00.000Z'),
      dayEndExclusiveUtc: new Date('2027-03-15T04:00:00.000Z'),
      slots: [
        '2027-03-14T06:00:00.000Z',
        '2027-03-14T06:30:00.000Z',
        '2027-03-14T07:00:00.000Z',
      ],
    })

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
    mocks.loadAvailabilityOfferingContext.mockResolvedValueOnce(
      makeBaseContext({
        locationId: 'dst-salon-1',
        effectiveLocationType: ServiceLocationType.SALON,
        timeZone: 'America/New_York',
        defaultStepMinutes: 30,
        maxAdvanceDays: 730,
      }),
    )

    mocks.computeDaySlotsFast.mockResolvedValueOnce({
      ok: true,
      dayStartUtc: new Date('2027-11-07T04:00:00.000Z'),
      dayEndExclusiveUtc: new Date('2027-11-08T05:00:00.000Z'),
      slots: [
        '2027-11-07T05:00:00.000Z',
        '2027-11-07T05:30:00.000Z',
        '2027-11-07T06:00:00.000Z',
        '2027-11-07T06:30:00.000Z',
        '2027-11-07T07:00:00.000Z',
        '2027-11-07T07:30:00.000Z',
      ],
    })

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
    mocks.loadAvailabilityOfferingContext.mockResolvedValueOnce(
      makeBaseContext({
        locationId: 'dst-salon-1',
        effectiveLocationType: ServiceLocationType.SALON,
        timeZone: 'America/New_York',
        defaultStepMinutes: 30,
        durationMinutes: 30,
      }),
    )

    mocks.computeDaySlotsFast.mockResolvedValueOnce({
      ok: true,
      dayStartUtc: new Date('2027-01-15T05:00:00.000Z'),
      dayEndExclusiveUtc: new Date('2027-01-16T05:00:00.000Z'),
      slots: [
        '2027-01-16T04:00:00.000Z',
        '2027-01-16T04:30:00.000Z',
      ],
    })

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