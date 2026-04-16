// lib/booking/locationContext.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProfessionalLocationType, ServiceLocationType } from '@prisma/client'
import type { BookableLocation } from '@/lib/booking/pickLocation'

const { pickBookableLocationMock, resolveApptTimeZoneMock } = vi.hoisted(() => ({
  pickBookableLocationMock: vi.fn(),
  resolveApptTimeZoneMock: vi.fn(),
}))

vi.mock('@/lib/booking/pickLocation', () => ({
  pickBookableLocation: pickBookableLocationMock,
}))

vi.mock('@/lib/booking/timeZoneTruth', () => ({
  resolveApptTimeZone: resolveApptTimeZoneMock,
}))

import { resolveBookingLocationContext } from '@/lib/booking/locationContext'

const PROFESSIONAL_ID = 'pro_1'
const DEFAULT_TIME_ZONE = 'America/Los_Angeles'

function makeLocation(
  overrides: Partial<BookableLocation> = {},
): BookableLocation {
  return {
    id: 'loc_primary',
    type: ProfessionalLocationType.SALON,
    name: 'Main Salon',
    isPrimary: true,
    isBookable: true,
    timeZone: DEFAULT_TIME_ZONE,
    workingHours: {
      sun: { enabled: false, start: '09:00', end: '17:00' },
      mon: { enabled: true, start: '09:00', end: '17:00' },
      tue: { enabled: true, start: '09:00', end: '17:00' },
      wed: { enabled: true, start: '09:00', end: '17:00' },
      thu: { enabled: true, start: '09:00', end: '17:00' },
      fri: { enabled: true, start: '09:00', end: '17:00' },
      sat: { enabled: false, start: '09:00', end: '17:00' },
    },
    bufferMinutes: 15,
    stepMinutes: 15,
    advanceNoticeMinutes: 60,
    maxDaysAhead: 90,
    lat: null,
    lng: null,
    city: 'Los Angeles',
    formattedAddress: '123 Main St, Los Angeles, CA',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

function mockValidTimeZoneResolution(
  timeZone = DEFAULT_TIME_ZONE,
) {
  resolveApptTimeZoneMock.mockResolvedValue({
    ok: true,
    timeZone,
  })
}

function expectLocationLookup(args: {
  requestedLocationId: string
  locationType: ServiceLocationType
  allowFallback: boolean
}) {
  expect(pickBookableLocationMock).toHaveBeenCalledWith({
    tx: undefined,
    professionalId: PROFESSIONAL_ID,
    requestedLocationId: args.requestedLocationId,
    locationType: args.locationType,
    allowFallback: args.allowFallback,
  })
}

describe('resolveBookingLocationContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the explicitly requested location when it is valid and fallback is disabled', async () => {
    pickBookableLocationMock.mockResolvedValue(
      makeLocation({
        id: 'loc_requested',
        type: ProfessionalLocationType.SALON,
      }),
    )
    mockValidTimeZoneResolution()

    const result = await resolveBookingLocationContext({
      professionalId: PROFESSIONAL_ID,
      requestedLocationId: 'loc_requested',
      locationType: ServiceLocationType.SALON,
      allowFallback: false,
    })

    expectLocationLookup({
      requestedLocationId: 'loc_requested',
      locationType: ServiceLocationType.SALON,
      allowFallback: false,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Expected ok result')

    expect(result.context.locationId).toBe('loc_requested')
    expect(result.context.location.id).toBe('loc_requested')
    expect(result.context.locationType).toBe(ServiceLocationType.SALON)
    expect(result.context.timeZone).toBe(DEFAULT_TIME_ZONE)
    expect(result.context.stepMinutes).toBe(15)
    expect(result.context.bufferMinutes).toBe(15)
    expect(result.context.advanceNoticeMinutes).toBe(60)
    expect(result.context.maxDaysAhead).toBe(90)
  })

  it('returns LOCATION_NOT_FOUND when the requested location is non-bookable and fallback is disabled', async () => {
    pickBookableLocationMock.mockResolvedValue(null)

    const result = await resolveBookingLocationContext({
      professionalId: PROFESSIONAL_ID,
      requestedLocationId: 'loc_non_bookable',
      locationType: ServiceLocationType.SALON,
      allowFallback: false,
    })

    expectLocationLookup({
      requestedLocationId: 'loc_non_bookable',
      locationType: ServiceLocationType.SALON,
      allowFallback: false,
    })

    expect(resolveApptTimeZoneMock).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: false,
      error: 'LOCATION_NOT_FOUND',
    })
  })

  it('allows fallback when explicitly enabled and the requested location is unavailable', async () => {
    pickBookableLocationMock.mockResolvedValue(
      makeLocation({
        id: 'loc_fallback',
        type: ProfessionalLocationType.SALON,
        isPrimary: true,
      }),
    )
    mockValidTimeZoneResolution()

    const result = await resolveBookingLocationContext({
      professionalId: PROFESSIONAL_ID,
      requestedLocationId: 'loc_bad',
      locationType: ServiceLocationType.SALON,
      allowFallback: true,
    })

    expectLocationLookup({
      requestedLocationId: 'loc_bad',
      locationType: ServiceLocationType.SALON,
      allowFallback: false,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Expected ok result')

    expect(result.context.locationId).toBe('loc_fallback')
  })

  it('forces allowFallback to false when requestedLocationId is present and allowFallback is omitted', async () => {
    pickBookableLocationMock.mockResolvedValue(
      makeLocation({
        id: 'loc_best',
      }),
    )
    mockValidTimeZoneResolution()

    const result = await resolveBookingLocationContext({
      professionalId: PROFESSIONAL_ID,
      requestedLocationId: 'loc_unknown',
      locationType: ServiceLocationType.SALON,
    })

    expectLocationLookup({
      requestedLocationId: 'loc_unknown',
      locationType: ServiceLocationType.SALON,
      allowFallback: false,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Expected ok result')

    expect(result.context.locationId).toBe('loc_best')
  })

  it('returns TIMEZONE_REQUIRED when timezone resolution fails', async () => {
    pickBookableLocationMock.mockResolvedValue(makeLocation())
    resolveApptTimeZoneMock.mockResolvedValue({
      ok: false,
    })

    const result = await resolveBookingLocationContext({
      professionalId: PROFESSIONAL_ID,
      requestedLocationId: 'loc_primary',
      locationType: ServiceLocationType.SALON,
      allowFallback: false,
    })

    expect(result).toEqual({
      ok: false,
      error: 'TIMEZONE_REQUIRED',
    })
  })

  it('returns TIMEZONE_REQUIRED when the resolved timezone is invalid', async () => {
    pickBookableLocationMock.mockResolvedValue(makeLocation())
    mockValidTimeZoneResolution('Not/A_Real_Time_Zone')

    const result = await resolveBookingLocationContext({
      professionalId: PROFESSIONAL_ID,
      requestedLocationId: 'loc_primary',
      locationType: ServiceLocationType.SALON,
      allowFallback: false,
    })

    expect(result).toEqual({
      ok: false,
      error: 'TIMEZONE_REQUIRED',
    })
  })
})