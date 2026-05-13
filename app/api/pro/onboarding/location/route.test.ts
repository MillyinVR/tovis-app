// app/api/pro/onboarding/location/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProfessionalLocationType } from '@prisma/client'

const mocks = vi.hoisted(() => {
  const jsonOk = vi.fn((data: unknown, status = 200) => {
    return new Response(
      JSON.stringify({
        ok: true,
        ...((data as Record<string, unknown>) ?? {}),
      }),
      {
        status,
        headers: { 'content-type': 'application/json' },
      },
    )
  })

  const jsonFail = vi.fn(
    (status: number, error: string, extra?: Record<string, unknown>) => {
      return new Response(
        JSON.stringify({
          ok: false,
          error,
          ...(extra ?? {}),
        }),
        {
          status,
          headers: { 'content-type': 'application/json' },
        },
      )
    },
  )

  const requirePro = vi.fn()
  const getGoogleMapsKey = vi.fn()
  const fetchWithTimeout = vi.fn()
  const safeJson = vi.fn()

  const bumpScheduleConfigVersion = vi.fn()
  const refreshLocation = vi.fn()

  const professionalLocation = {
    updateMany: vi.fn(),
    create: vi.fn(),
  }

  const professionalProfile = {
    update: vi.fn(),
  }

  const prisma = {
    professionalLocation,
    professionalProfile,
    $transaction: vi.fn(),
  }

  return {
    jsonOk,
    jsonFail,
    requirePro,
    getGoogleMapsKey,
    fetchWithTimeout,
    safeJson,
    bumpScheduleConfigVersion,
    refreshLocation,
    professionalLocation,
    professionalProfile,
    prisma,
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
  pickString: (value: unknown) =>
    typeof value === 'string' && value.trim() ? value.trim() : null,
  getGoogleMapsKey: mocks.getGoogleMapsKey,
  fetchWithTimeout: mocks.fetchWithTimeout,
  safeJson: mocks.safeJson,
}))

vi.mock('@/app/api/_utils/auth/requirePro', () => ({
  requirePro: mocks.requirePro,
}))

vi.mock('@/lib/booking/cacheVersion', () => ({
  bumpScheduleConfigVersion: mocks.bumpScheduleConfigVersion,
}))

vi.mock('@/lib/search/index/refreshSearchIndex', () => ({
  refreshLocation: mocks.refreshLocation,
}))

vi.mock('@/lib/timeZone', () => ({
  isValidIanaTimeZone: (value: unknown) =>
    typeof value === 'string' && value.includes('/'),
}))

import { POST } from './route'

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/pro/onboarding/location', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

function googleOkResponse(): Response {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function googlePlacePayload() {
  return {
    status: 'OK',
    result: {
      place_id: 'place_123',
      name: 'Vivid Salon',
      formatted_address: '123 Main St, San Diego, CA 92101',
      geometry: {
        location: {
          lat: 32.715736,
          lng: -117.161087,
        },
      },
      address_components: [
        {
          long_name: 'San Diego',
          short_name: 'San Diego',
          types: ['locality'],
        },
        {
          long_name: 'California',
          short_name: 'CA',
          types: ['administrative_area_level_1'],
        },
        {
          long_name: '92101',
          short_name: '92101',
          types: ['postal_code'],
        },
        {
          long_name: 'United States',
          short_name: 'US',
          types: ['country'],
        },
      ],
    },
  }
}

function googlePostalPayload() {
  return {
    status: 'OK',
    results: [
      {
        geometry: {
          location: {
            lat: 32.715736,
            lng: -117.161087,
          },
        },
        address_components: [
          {
            long_name: 'San Diego',
            short_name: 'San Diego',
            types: ['locality'],
          },
          {
            long_name: 'California',
            short_name: 'CA',
            types: ['administrative_area_level_1'],
          },
          {
            long_name: '92101',
            short_name: '92101',
            types: ['postal_code'],
          },
          {
            long_name: 'United States',
            short_name: 'US',
            types: ['country'],
          },
        ],
      },
    ],
  }
}

function googleTimeZonePayload() {
  return {
    status: 'OK',
    timeZoneId: 'America/Los_Angeles',
  }
}

describe('POST /api/pro/onboarding/location', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requirePro.mockResolvedValue({
      ok: true,
      userId: 'user_123',
      professionalId: 'pro_123',
      proId: 'pro_123',
    })

    mocks.getGoogleMapsKey.mockReturnValue('google_key')
    mocks.fetchWithTimeout.mockResolvedValue(googleOkResponse())
    mocks.bumpScheduleConfigVersion.mockResolvedValue(1)
    mocks.refreshLocation.mockResolvedValue(undefined)

    const tx = {
      professionalLocation: mocks.professionalLocation,
      professionalProfile: mocks.professionalProfile,
    }

    mocks.prisma.$transaction.mockImplementation(
      async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx),
    )

    mocks.professionalLocation.updateMany.mockResolvedValue({ count: 1 })

    mocks.professionalLocation.create.mockResolvedValue({
      id: 'loc_123',
      type: ProfessionalLocationType.SALON,
      timeZone: 'America/Los_Angeles',
      isPrimary: true,
      isBookable: false,
      advanceNoticeMinutes: 15,
    })

    mocks.professionalProfile.update.mockResolvedValue({
      id: 'pro_123',
    })
  })

  it('passes through failed pro auth unchanged', async () => {
    const authRes = new Response(null, { status: 401 })

    mocks.requirePro.mockResolvedValue({
      ok: false,
      res: authRes,
    })

    const result = await POST(makeRequest({ mode: 'SALON' }))

    expect(result).toBe(authRes)
    expect(result.status).toBe(401)

    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    expect(mocks.bumpScheduleConfigVersion).not.toHaveBeenCalled()
    expect(mocks.refreshLocation).not.toHaveBeenCalled()
  })

  it('returns 400 when mode is missing or invalid', async () => {
    const result = await POST(makeRequest({ mode: 'GARAGE_BEAUTY_CHAOS' }))

    const body = await readJson<{
      ok: false
      error: string
      code: string
    }>(result)

    expect(result.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Missing or invalid mode.',
      code: 'INVALID_MODE',
    })

    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('returns 400 when salon or suite mode is missing placeId', async () => {
    const result = await POST(makeRequest({ mode: 'SALON' }))

    const body = await readJson<{
      ok: false
      error: string
      code: string
    }>(result)

    expect(result.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Missing placeId.',
      code: 'MISSING_PLACE',
    })

    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('creates a draft salon location, updates profile timezone, bumps version, and refreshes index', async () => {
    mocks.safeJson
      .mockResolvedValueOnce(googlePlacePayload())
      .mockResolvedValueOnce(googleTimeZonePayload())

    const result = await POST(
      makeRequest({
        mode: 'SALON',
        placeId: 'place_123',
        sessionToken: 'session_123',
        locationName: 'Main Salon',
        makePrimary: true,
        advanceNoticeMinutes: 60,
      }),
    )

    const body = await readJson<{
      ok: true
      location: {
        id: string
        isBookable: boolean
      }
    }>(result)

    expect(result.status).toBe(200)

    expect(mocks.professionalLocation.updateMany).toHaveBeenCalledWith({
      where: { professionalId: 'pro_123', isPrimary: true },
      data: { isPrimary: false },
    })

    expect(mocks.professionalLocation.create).toHaveBeenCalledWith({
      data: {
        professionalId: 'pro_123',
        type: ProfessionalLocationType.SALON,
        name: 'Main Salon',
        isPrimary: true,
        isBookable: false,

        formattedAddress: '123 Main St, San Diego, CA 92101',
        city: 'San Diego',
        state: 'CA',
        postalCode: '92101',
        countryCode: 'US',
        placeId: 'place_123',

        lat: 32.715736,
        lng: -117.161087,

        timeZone: 'America/Los_Angeles',
        advanceNoticeMinutes: 60,
        workingHours: expect.objectContaining({
          mon: { enabled: true, start: '09:00', end: '17:00' },
        }),
      },
      select: {
        id: true,
        type: true,
        timeZone: true,
        isPrimary: true,
        isBookable: true,
        advanceNoticeMinutes: true,
      },
    })

    expect(mocks.professionalProfile.update).toHaveBeenCalledWith({
      where: { id: 'pro_123' },
      data: {
        timeZone: 'America/Los_Angeles',
        mobileBasePostalCode: null,
        mobileRadiusMiles: null,
      },
      select: { id: true },
    })

    expect(mocks.bumpScheduleConfigVersion).toHaveBeenCalledWith('pro_123')
    expect(mocks.refreshLocation).toHaveBeenCalledWith(
      'loc_123',
      'location.create',
    )

    expect(body).toEqual({
      ok: true,
      location: {
        id: 'loc_123',
        type: ProfessionalLocationType.SALON,
        timeZone: 'America/Los_Angeles',
        isPrimary: true,
        isBookable: false,
        advanceNoticeMinutes: 15,
      },
    })
  })

  it('creates a draft suite location when mode is SUITE', async () => {
    mocks.safeJson
      .mockResolvedValueOnce(googlePlacePayload())
      .mockResolvedValueOnce(googleTimeZonePayload())

    mocks.professionalLocation.create.mockResolvedValue({
      id: 'loc_suite',
      type: ProfessionalLocationType.SUITE,
      timeZone: 'America/Los_Angeles',
      isPrimary: true,
      isBookable: false,
      advanceNoticeMinutes: 15,
    })

    const result = await POST(
      makeRequest({
        mode: 'SUITE',
        placeId: 'place_123',
      }),
    )

    expect(result.status).toBe(200)

    expect(mocks.professionalLocation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: ProfessionalLocationType.SUITE,
          isBookable: false,
        }),
      }),
    )

    expect(mocks.bumpScheduleConfigVersion).toHaveBeenCalledWith('pro_123')
    expect(mocks.refreshLocation).toHaveBeenCalledWith(
      'loc_suite',
      'location.create',
    )
  })

  it('does not unset existing primary locations when makePrimary is false', async () => {
    mocks.safeJson
      .mockResolvedValueOnce(googlePlacePayload())
      .mockResolvedValueOnce(googleTimeZonePayload())

    await POST(
      makeRequest({
        mode: 'SALON',
        placeId: 'place_123',
        makePrimary: false,
      }),
    )

    expect(mocks.professionalLocation.updateMany).not.toHaveBeenCalled()

    expect(mocks.professionalLocation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isPrimary: false,
          isBookable: false,
        }),
      }),
    )
  })

  it('returns 400 when Google place details do not include coordinates', async () => {
    mocks.safeJson.mockResolvedValueOnce({
      status: 'OK',
      result: {
        place_id: 'place_123',
        name: 'Vivid Salon',
        formatted_address: '123 Main St',
        geometry: {
          location: {},
        },
      },
    })

    const result = await POST(
      makeRequest({
        mode: 'SALON',
        placeId: 'place_123',
      }),
    )

    const body = await readJson<{
      ok: false
      error: string
      code: string
    }>(result)

    expect(result.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Selected place is missing coordinates.',
      code: 'PLACE_NO_GEO',
    })

    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    expect(mocks.bumpScheduleConfigVersion).not.toHaveBeenCalled()
    expect(mocks.refreshLocation).not.toHaveBeenCalled()
  })

  it('returns 400 when mobile mode is missing postalCode', async () => {
    const result = await POST(makeRequest({ mode: 'MOBILE' }))

    const body = await readJson<{
      ok: false
      error: string
      code: string
    }>(result)

    expect(result.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Missing postalCode.',
      code: 'MISSING_POSTAL',
    })

    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('returns 400 when mobile radius is invalid', async () => {
    const result = await POST(
      makeRequest({
        mode: 'MOBILE',
        postalCode: '92101',
        radiusMiles: 0,
      }),
    )

    const body = await readJson<{
      ok: false
      error: string
      code: string
    }>(result)

    expect(result.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Invalid radius. Provide radiusMiles (1-200) or radiusKm (1-400).',
      code: 'INVALID_RADIUS',
    })

    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('creates a draft mobile base location, updates profile mobile config, bumps version, and refreshes index', async () => {
    mocks.safeJson
      .mockResolvedValueOnce(googlePostalPayload())
      .mockResolvedValueOnce(googleTimeZonePayload())

    mocks.professionalLocation.create.mockResolvedValue({
      id: 'loc_mobile',
      type: ProfessionalLocationType.MOBILE_BASE,
      timeZone: 'America/Los_Angeles',
      isPrimary: true,
      isBookable: false,
      advanceNoticeMinutes: 30,
    })

    const result = await POST(
      makeRequest({
        mode: 'MOBILE',
        postalCode: '92101',
        radiusMiles: 25,
        locationName: 'Mobile Glam Zone',
        advanceNoticeMinutes: 30,
      }),
    )

    const body = await readJson<{
      ok: true
      location: {
        id: string
        type: ProfessionalLocationType
        isBookable: boolean
      }
    }>(result)

    expect(result.status).toBe(200)

    expect(mocks.professionalLocation.create).toHaveBeenCalledWith({
      data: {
        professionalId: 'pro_123',
        type: ProfessionalLocationType.MOBILE_BASE,
        name: 'Mobile Glam Zone',
        isPrimary: true,
        isBookable: false,

        city: 'San Diego',
        state: 'CA',
        postalCode: '92101',
        countryCode: 'US',

        lat: 32.715736,
        lng: -117.161087,

        timeZone: 'America/Los_Angeles',
        advanceNoticeMinutes: 30,
        workingHours: expect.objectContaining({
          mon: { enabled: true, start: '09:00', end: '17:00' },
        }),
      },
      select: {
        id: true,
        type: true,
        timeZone: true,
        isPrimary: true,
        isBookable: true,
        advanceNoticeMinutes: true,
      },
    })

    expect(mocks.professionalProfile.update).toHaveBeenCalledWith({
      where: { id: 'pro_123' },
      data: {
        mobileBasePostalCode: '92101',
        mobileRadiusMiles: 25,
        timeZone: 'America/Los_Angeles',
      },
      select: { id: true },
    })

    expect(mocks.bumpScheduleConfigVersion).toHaveBeenCalledWith('pro_123')
    expect(mocks.refreshLocation).toHaveBeenCalledWith(
      'loc_mobile',
      'location.create',
    )

    expect(body.location).toEqual({
      id: 'loc_mobile',
      type: ProfessionalLocationType.MOBILE_BASE,
      timeZone: 'America/Los_Angeles',
      isPrimary: true,
      isBookable: false,
      advanceNoticeMinutes: 30,
    })
  })

  it('converts radiusKm to miles for mobile config', async () => {
    mocks.safeJson
      .mockResolvedValueOnce(googlePostalPayload())
      .mockResolvedValueOnce(googleTimeZonePayload())

    await POST(
      makeRequest({
        mode: 'MOBILE',
        postalCode: '92101',
        radiusKm: 40,
      }),
    )

    expect(mocks.professionalProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          mobileRadiusMiles: 25,
        }),
      }),
    )
  })

  it('returns 400 when postal geocode does not include coordinates', async () => {
    mocks.safeJson.mockResolvedValueOnce({
      status: 'OK',
      results: [
        {
          geometry: {
            location: {},
          },
          address_components: [],
        },
      ],
    })

    const result = await POST(
      makeRequest({
        mode: 'MOBILE',
        postalCode: '92101',
        radiusMiles: 25,
      }),
    )

    const body = await readJson<{
      ok: false
      error: string
      code: string
    }>(result)

    expect(result.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Could not locate that postal code.',
      code: 'POSTAL_NOT_FOUND',
    })

    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    expect(mocks.bumpScheduleConfigVersion).not.toHaveBeenCalled()
    expect(mocks.refreshLocation).not.toHaveBeenCalled()
  })

  it('returns 500 when Google throws', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    mocks.fetchWithTimeout.mockResolvedValue(
      new Response(JSON.stringify({ status: 'REQUEST_DENIED' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    mocks.safeJson.mockResolvedValueOnce({
      status: 'REQUEST_DENIED',
      error_message: 'Google said nope.',
    })

    const result = await POST(
      makeRequest({
        mode: 'SALON',
        placeId: 'place_123',
      }),
    )

    const body = await readJson<{
      ok: false
      error: string
      code: string
    }>(result)

    expect(result.status).toBe(500)
    expect(body).toEqual({
      ok: false,
      error: 'Google said nope.',
      code: 'INTERNAL',
    })

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'POST /api/pro/onboarding/location error',
      expect.any(Error),
    )

    consoleErrorSpy.mockRestore()
  })

  it('returns 500 when the transaction throws', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    mocks.safeJson
      .mockResolvedValueOnce(googlePlacePayload())
      .mockResolvedValueOnce(googleTimeZonePayload())

    mocks.prisma.$transaction.mockRejectedValue(new Error('db exploded'))

    const result = await POST(
      makeRequest({
        mode: 'SALON',
        placeId: 'place_123',
      }),
    )

    const body = await readJson<{
      ok: false
      error: string
      code: string
    }>(result)

    expect(result.status).toBe(500)
    expect(body).toEqual({
      ok: false,
      error: 'db exploded',
      code: 'INTERNAL',
    })

    expect(mocks.bumpScheduleConfigVersion).not.toHaveBeenCalled()
    expect(mocks.refreshLocation).not.toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })
})