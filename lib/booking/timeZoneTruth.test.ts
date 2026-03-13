import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  professionalLocationFindFirst: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    professionalLocation: {
      findFirst: mocks.professionalLocationFindFirst,
    },
  },
}))

import {
  resolveApptTimeZone,
  resolveApptTimeZoneFromValues,
  resolveSchedulingTimeZoneFromValues,
} from './timeZoneTruth'

describe('lib/booking/timeZoneTruth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('prefers booking snapshot timezone first', () => {
    const result = resolveApptTimeZoneFromValues({
      bookingLocationTimeZone: 'America/New_York',
      locationTimeZone: 'America/Chicago',
      professionalTimeZone: null,
      fallback: 'UTC',
    })

    expect(result).toEqual({
      ok: true,
      timeZone: 'America/New_York',
      source: 'BOOKING_SNAPSHOT',
    })
  })

  it('prefers hold snapshot when booking snapshot is missing', () => {
    const result = resolveApptTimeZoneFromValues({
      holdLocationTimeZone: 'America/Denver',
      locationTimeZone: 'America/Chicago',
      professionalTimeZone: null,
      fallback: 'UTC',
    })

    expect(result).toEqual({
      ok: true,
      timeZone: 'America/Denver',
      source: 'HOLD_SNAPSHOT',
    })
  })

  it('prefers location over professional when snapshot timezones are missing', () => {
    const result = resolveApptTimeZoneFromValues({
      locationTimeZone: 'America/Chicago',
      professionalTimeZone: 'America/Los_Angeles',
      fallback: 'UTC',
    })

    expect(result).toEqual({
      ok: true,
      timeZone: 'America/Chicago',
      source: 'LOCATION',
    })
  })

  it('falls back to professional timezone when location is invalid or missing', () => {
    const result = resolveApptTimeZoneFromValues({
      locationTimeZone: 'not-a-real-zone',
      professionalTimeZone: 'America/Los_Angeles',
      fallback: 'UTC',
    })

    expect(result).toEqual({
      ok: true,
      timeZone: 'America/Los_Angeles',
      source: 'PROFESSIONAL',
    })
  })

  it('returns fallback in non-strict mode', () => {
    const result = resolveApptTimeZoneFromValues({
      bookingLocationTimeZone: null,
      holdLocationTimeZone: null,
      locationTimeZone: null,
      professionalTimeZone: null,
      fallback: 'UTC',
    })

    expect(result).toEqual({
      ok: true,
      timeZone: 'UTC',
      source: 'FALLBACK',
    })
  })

  it('rejects missing timezone in strict mode', () => {
    const result = resolveSchedulingTimeZoneFromValues({
      bookingLocationTimeZone: null,
      holdLocationTimeZone: null,
      locationTimeZone: null,
      professionalTimeZone: null,
      fallback: 'UTC',
    })

    expect(result).toEqual({
      ok: false,
      error:
        'Missing a valid timezone from booking, hold, location, or professional settings.',
    })
  })

  it('fetches location timezone by ids when direct values are missing', async () => {
    mocks.professionalLocationFindFirst.mockResolvedValueOnce({
      timeZone: 'America/Chicago',
    })

    const result = await resolveApptTimeZone({
      bookingLocationTimeZone: null,
      locationId: 'loc_1',
      professionalId: 'pro_1',
      professionalTimeZone: null,
      fallback: 'UTC',
    })

    expect(mocks.professionalLocationFindFirst).toHaveBeenCalledWith({
      where: { id: 'loc_1', professionalId: 'pro_1' },
      select: { timeZone: true },
    })

    expect(result).toEqual({
      ok: true,
      timeZone: 'America/Chicago',
      source: 'LOCATION',
    })
  })

  it('falls back to professional timezone for legacy null snapshot rows', async () => {
    mocks.professionalLocationFindFirst.mockResolvedValueOnce({
      timeZone: null,
    })

    const result = await resolveApptTimeZone({
      bookingLocationTimeZone: null,
      locationId: 'legacy_loc',
      professionalId: 'pro_1',
      professionalTimeZone: 'Europe/London',
      fallback: 'UTC',
    })

    expect(result).toEqual({
      ok: true,
      timeZone: 'Europe/London',
      source: 'PROFESSIONAL',
    })
  })
})