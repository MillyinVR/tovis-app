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

function makeLocation(
  overrides: Partial<BookableLocation> = {},
): BookableLocation {
  return {
    id: 'loc_primary',
    type: ProfessionalLocationType.SALON,
    name: 'Main Salon',
    isPrimary: true,
    isBookable: true,
    timeZone: 'America/Los_Angeles',
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

    resolveApptTimeZoneMock.mockResolvedValue({
      ok: true,
      timeZone: 'America/Los_Angeles',
    })

    const result = await resolveBookingLocationContext({
      professionalId: 'pro_1',
      requestedLocationId: 'loc_requested',
      locationType: ServiceLocationType.SALON,
      allowFallback: false,
    })

    expect(pickBookableLocationMock).toHaveBeenCalledWith({
      tx: undefined,
      professionalId: 'pro_1',
      requestedLocationId: 'loc_requested',
      locationType: ServiceLocationType.SALON,
      allowFallback: false,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Expected ok result')

    expect(result.context.locationId).toBe('loc_requested')
    expect(result.context.location.id).toBe('loc_requested')
    expect(result.context.locationType).toBe(ServiceLocationType.SALON)
    expect(result.context.timeZone).toBe('America/Los_Angeles')
    expect(result.context.stepMinutes).toBe(15)
    expect(result.context.bufferMinutes).toBe(15)
    expect(result.context.advanceNoticeMinutes).toBe(60)
    expect(result.context.maxDaysAhead).toBe(90)
  })

  it('returns LOCATION_NOT_FOUND when the requested location is invalid and fallback is disabled', async () => {
    pickBookableLocationMock.mockResolvedValue(null)

    const result = await resolveBookingLocationContext({
      professionalId: 'pro_1',
      requestedLocationId: 'loc_missing',
      locationType: ServiceLocationType.SALON,
      allowFallback: false,
    })

    expect(pickBookableLocationMock).toHaveBeenCalledWith({
      tx: undefined,
      professionalId: 'pro_1',
      requestedLocationId: 'loc_missing',
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

    resolveApptTimeZoneMock.mockResolvedValue({
      ok: true,
      timeZone: 'America/Los_Angeles',
    })

    const result = await resolveBookingLocationContext({
      professionalId: 'pro_1',
      requestedLocationId: 'loc_bad',
      locationType: ServiceLocationType.SALON,
      allowFallback: true,
    })

    expect(pickBookableLocationMock).toHaveBeenCalledWith({
      tx: undefined,
      professionalId: 'pro_1',
      requestedLocationId: 'loc_bad',
      locationType: ServiceLocationType.SALON,
      allowFallback: true,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Expected ok result')

    expect(result.context.locationId).toBe('loc_fallback')
  })

  it('defaults allowFallback to true when omitted', async () => {
    pickBookableLocationMock.mockResolvedValue(
      makeLocation({
        id: 'loc_best',
      }),
    )

    resolveApptTimeZoneMock.mockResolvedValue({
      ok: true,
      timeZone: 'America/Los_Angeles',
    })

    const result = await resolveBookingLocationContext({
      professionalId: 'pro_1',
      requestedLocationId: 'loc_unknown',
      locationType: ServiceLocationType.SALON,
    })

    expect(pickBookableLocationMock).toHaveBeenCalledWith({
      tx: undefined,
      professionalId: 'pro_1',
      requestedLocationId: 'loc_unknown',
      locationType: ServiceLocationType.SALON,
      allowFallback: true,
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
      professionalId: 'pro_1',
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

    resolveApptTimeZoneMock.mockResolvedValue({
      ok: true,
      timeZone: 'Not/A_Real_Time_Zone',
    })

    const result = await resolveBookingLocationContext({
      professionalId: 'pro_1',
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