// lib/discovery/nearby.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma, ProfessionType } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  getWorkingWindowForDay: vi.fn(),
}))

vi.mock('@/lib/scheduling/workingHours', () => ({
  getWorkingWindowForDay: mocks.getWorkingWindowForDay,
}))

import {
  boundsForRadiusMiles,
  buildDiscoveryLocationLabel,
  haversineMiles,
  inferProfessionTypesFromQuery,
  isOpenNowAtLocation,
  mapProfessionalLocation,
  milesToLatDelta,
  milesToLngDelta,
  pickClosestLocationWithinRadius,
  pickPrimaryLocation,
  shouldExcludeSelfProfessional,
  type DiscoveryLocationDto,
} from './nearby'

function pickDefined<T>(value: T | undefined, fallback: T): T {
  return value === undefined ? fallback : value
}

function makeLocation(
  overrides: Partial<DiscoveryLocationDto> = {},
): DiscoveryLocationDto {
  return {
    id: pickDefined(overrides.id, 'loc_1'),
    formattedAddress: pickDefined(overrides.formattedAddress, '123 Main St'),
    city: pickDefined(overrides.city, 'San Diego'),
    state: pickDefined(overrides.state, 'CA'),
    timeZone: pickDefined(overrides.timeZone, 'UTC'),
    placeId: pickDefined(overrides.placeId, 'place_1'),
    lat: pickDefined(overrides.lat, 32.7157),
    lng: pickDefined(overrides.lng, -117.1611),
    isPrimary: pickDefined(overrides.isPrimary, false),
    workingHours: pickDefined(overrides.workingHours, {
      mon: { enabled: true, start: '09:00', end: '17:00' },
    }),
  }
}

describe('lib/discovery/nearby.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-20T12:30:00.000Z'))

    mocks.getWorkingWindowForDay.mockReturnValue({
      ok: true,
      startMinutes: 12 * 60,
      endMinutes: 13 * 60,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('haversineMiles', () => {
    it('returns zero distance for identical coordinates', () => {
      expect(
        haversineMiles(
          { lat: 32.7157, lng: -117.1611 },
          { lat: 32.7157, lng: -117.1611 },
        ),
      ).toBeCloseTo(0, 8)
    })

    it('returns a positive symmetric distance for different coordinates', () => {
      const a = { lat: 32.7157, lng: -117.1611 }
      const b = { lat: 34.0522, lng: -118.2437 }

      const ab = haversineMiles(a, b)
      const ba = haversineMiles(b, a)

      expect(ab).toBeGreaterThan(0)
      expect(ab).toBeCloseTo(ba, 8)
    })
  })

  describe('milesToLatDelta / milesToLngDelta', () => {
    it('converts 69 miles to about one latitude degree', () => {
      expect(milesToLatDelta(69)).toBeCloseTo(1, 2)
    })

    it('converts 69 miles to about one longitude degree at the equator', () => {
      expect(milesToLngDelta(69, 0)).toBeCloseTo(1, 2)
    })

    it('widens longitude delta at higher latitudes', () => {
      const equator = milesToLngDelta(69, 0)
      const highLat = milesToLngDelta(69, 60)

      expect(highLat).toBeGreaterThan(equator)
      expect(highLat).toBeCloseTo(2, 1)
    })
  })

  describe('boundsForRadiusMiles', () => {
    it('returns a bounded latitude and longitude box around the center', () => {
      const bounds = boundsForRadiusMiles(32.7157, -117.1611, 10)

      expect(bounds.minLat).toBeLessThan(32.7157)
      expect(bounds.maxLat).toBeGreaterThan(32.7157)
      expect(bounds.minLng).toBeLessThan(-117.1611)
      expect(bounds.maxLng).toBeGreaterThan(-117.1611)
    })

    it('clamps bounds at world limits', () => {
      const bounds = boundsForRadiusMiles(89.9, 179.9, 500)

      expect(bounds.minLat).toBeGreaterThanOrEqual(-90)
      expect(bounds.maxLat).toBeLessThanOrEqual(90)
      expect(bounds.minLng).toBeGreaterThanOrEqual(-180)
      expect(bounds.maxLng).toBeLessThanOrEqual(180)
    })
  })

  describe('inferProfessionTypesFromQuery', () => {
    it('infers profession types from common discovery text', () => {
      const result = inferProfessionTypesFromQuery(
        'barber hair stylist facial skin nail massage makeup mua',
      )

      expect(result).toEqual([
        ProfessionType.BARBER,
        ProfessionType.COSMETOLOGIST,
        ProfessionType.ESTHETICIAN,
        ProfessionType.MANICURIST,
        ProfessionType.MASSAGE_THERAPIST,
        ProfessionType.MAKEUP_ARTIST,
      ])
    })

    it('dedupes repeated keyword matches', () => {
      const result = inferProfessionTypesFromQuery('hair stylist hair cosmo')

      expect(result).toEqual([ProfessionType.COSMETOLOGIST])
    })
  })

  describe('mapProfessionalLocation', () => {
    it('maps Prisma decimal coordinates into number coordinates', () => {
      const location = mapProfessionalLocation({
        id: 'loc_1',
        formattedAddress: '123 Main St',
        city: 'San Diego',
        state: 'CA',
        timeZone: 'America/Los_Angeles',
        placeId: 'place_1',
        lat: new Prisma.Decimal('32.7157000'),
        lng: new Prisma.Decimal('-117.1611000'),
        isPrimary: true,
        workingHours: { mon: { enabled: true, start: '09:00', end: '17:00' } },
      })

      expect(location).toEqual({
        id: 'loc_1',
        formattedAddress: '123 Main St',
        city: 'San Diego',
        state: 'CA',
        timeZone: 'America/Los_Angeles',
        placeId: 'place_1',
        lat: 32.7157,
        lng: -117.1611,
        isPrimary: true,
        workingHours: { mon: { enabled: true, start: '09:00', end: '17:00' } },
      })
    })
  })

  describe('pickPrimaryLocation', () => {
    it('returns the primary location when one exists', () => {
      const secondary = makeLocation({ id: 'loc_1', isPrimary: false })
      const primary = makeLocation({ id: 'loc_2', isPrimary: true })

      expect(pickPrimaryLocation([secondary, primary])).toEqual(primary)
    })

    it('falls back to the first location when none are primary', () => {
      const first = makeLocation({ id: 'loc_1', isPrimary: false })
      const second = makeLocation({ id: 'loc_2', isPrimary: false })

      expect(pickPrimaryLocation([first, second])).toEqual(first)
    })

    it('returns null for an empty location list', () => {
      expect(pickPrimaryLocation([])).toBeNull()
    })
  })

  describe('isOpenNowAtLocation', () => {
    it('returns true when the mocked working window contains the current UTC time', () => {
      const result = isOpenNowAtLocation({
        timeZone: 'UTC',
        workingHours: { mon: { enabled: true, start: '09:00', end: '17:00' } },
      })

      expect(result).toBe(true)
      expect(mocks.getWorkingWindowForDay).toHaveBeenCalledWith(
        new Date('2026-04-20T12:30:00.000Z'),
        { mon: { enabled: true, start: '09:00', end: '17:00' } },
        'UTC',
      )
    })

    it('returns false when there is no timezone', () => {
      expect(
        isOpenNowAtLocation({
          timeZone: null,
          workingHours: {},
        }),
      ).toBe(false)

      expect(mocks.getWorkingWindowForDay).not.toHaveBeenCalled()
    })

    it('returns false when working hours are unavailable', () => {
      mocks.getWorkingWindowForDay.mockReturnValueOnce({ ok: false })

      expect(
        isOpenNowAtLocation({
          timeZone: 'UTC',
          workingHours: {},
        }),
      ).toBe(false)
    })

    it('returns false when the current time falls outside the working window', () => {
      mocks.getWorkingWindowForDay.mockReturnValueOnce({
        ok: true,
        startMinutes: 13 * 60,
        endMinutes: 14 * 60,
      })

      expect(
        isOpenNowAtLocation({
          timeZone: 'UTC',
          workingHours: {},
        }),
      ).toBe(false)
    })

    it('uses the provided now value consistently', () => {
      const now = new Date('2026-04-20T12:30:00.000Z')

      const result = isOpenNowAtLocation({
        timeZone: 'UTC',
        workingHours: {},
        now,
      })

      expect(result).toBe(true)
      expect(mocks.getWorkingWindowForDay).toHaveBeenCalledWith(
        now,
        {},
        'UTC',
      )
    })
  })

  describe('pickClosestLocationWithinRadius', () => {
    it('returns the nearest location inside the radius', () => {
      const origin = { lat: 32.7157, lng: -117.1611 }

      const close = makeLocation({
        id: 'loc_close',
        lat: 32.7164,
        lng: -117.1611,
      })

      const farther = makeLocation({
        id: 'loc_farther',
        lat: 32.7307,
        lng: -117.1611,
      })

      const result = pickClosestLocationWithinRadius({
        origin,
        locations: [farther, close],
        radiusMiles: 2,
      })

      expect(result).not.toBeNull()
      expect(result?.location.id).toBe('loc_close')
      expect(result?.distanceMiles).toBeLessThan(2)
    })

    it('returns null when no location falls within the radius', () => {
      const origin = { lat: 32.7157, lng: -117.1611 }

      const farAway = makeLocation({
        id: 'loc_far',
        lat: 33.7157,
        lng: -117.1611,
      })

      const result = pickClosestLocationWithinRadius({
        origin,
        locations: [farAway],
        radiusMiles: 5,
      })

      expect(result).toBeNull()
    })

    it('ignores locations without coordinates', () => {
      const origin = { lat: 32.7157, lng: -117.1611 }

      const missingCoords = makeLocation({
        id: 'loc_missing',
        lat: null,
        lng: null,
      })

      const valid = makeLocation({
        id: 'loc_valid',
        lat: 32.716,
        lng: -117.1611,
      })

      const result = pickClosestLocationWithinRadius({
        origin,
        locations: [missingCoords, valid],
        radiusMiles: 1,
      })

      expect(result?.location.id).toBe('loc_valid')
    })
  })

  describe('buildDiscoveryLocationLabel', () => {
    it('prefers the profile location string when present', () => {
      expect(
        buildDiscoveryLocationLabel({
          profileLocation: 'San Diego, CA',
          location: { city: 'Los Angeles', state: 'CA' },
        }),
      ).toBe('San Diego, CA')
    })

    it('falls back to city and state from the selected location', () => {
      expect(
        buildDiscoveryLocationLabel({
          profileLocation: null,
          location: { city: 'Los Angeles', state: 'CA' },
        }),
      ).toBe('Los Angeles, CA')
    })

    it('returns null when no location label data is available', () => {
      expect(
        buildDiscoveryLocationLabel({
          profileLocation: null,
          location: null,
        }),
      ).toBeNull()
    })
  })

  describe('shouldExcludeSelfProfessional', () => {
    it('returns true when the viewer professional matches the result professional', () => {
      expect(
        shouldExcludeSelfProfessional({
          professionalId: 'pro_1',
          viewerProfessionalId: 'pro_1',
        }),
      ).toBe(true)
    })

    it('returns false when there is no viewer professional id', () => {
      expect(
        shouldExcludeSelfProfessional({
          professionalId: 'pro_1',
          viewerProfessionalId: null,
        }),
      ).toBe(false)
    })

    it('returns false when the ids differ', () => {
      expect(
        shouldExcludeSelfProfessional({
          professionalId: 'pro_1',
          viewerProfessionalId: 'pro_2',
        }),
      ).toBe(false)
    })
  })
})