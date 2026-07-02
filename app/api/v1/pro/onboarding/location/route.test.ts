// app/api/v1/pro/onboarding/location/route.test.ts

import { ProfessionalLocationType } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  const googlePlaceDetails = vi.fn()
  const googleGeocodePostal = vi.fn()
  const googleTimeZoneId = vi.fn()

  const bumpScheduleConfigVersion = vi.fn()
  const refreshLocation = vi.fn()
  const buildAddressPrivacyWriteData = vi.fn()

  const professionalLocation = {
    updateMany: vi.fn(),
    create: vi.fn(),
    count: vi.fn(),
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
    googlePlaceDetails,
    googleGeocodePostal,
    googleTimeZoneId,
    bumpScheduleConfigVersion,
    refreshLocation,
    buildAddressPrivacyWriteData,
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
}))

vi.mock('@/app/api/_utils/google', () => ({
  googlePlaceDetails: mocks.googlePlaceDetails,
  googleGeocodePostal: mocks.googleGeocodePostal,
  googleTimeZoneId: mocks.googleTimeZoneId,
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

vi.mock('@/lib/security/addressEncryption', () => ({
  buildAddressPrivacyWriteData: mocks.buildAddressPrivacyWriteData,
}))

vi.mock('@/lib/timeZone', () => ({
  isValidIanaTimeZone: (value: unknown) =>
    typeof value === 'string' && value.includes('/'),
}))

import { POST } from './route'

const addressPrivacyWriteData = {
  encryptedAddressJson: {
    v: 1,
    algorithm: 'plaintext-json-expand-phase',
    keyVersion: 'address-json-v1',
    address: {
      city: 'San Diego',
      state: 'CA',
      postalCode: '92101',
      countryCode: 'US',
      lat: '32.715736',
      lng: '-117.161087',
    },
  },
  addressKeyVersion: 'address-json-v1',
  postalCodePrefix: '92101',
  latApprox: '32.7157',
  lngApprox: '-117.1611',
}

const ADDRESS_PRIVACY_WRITE_KEYS = [
  'encryptedAddressJson',
  'addressKeyVersion',
  'postalCodePrefix',
  'latApprox',
  'lngApprox',
  'formattedAddress',
  'addressLine1',
  'addressLine2',
  'city',
  'state',
  'postalCode',
  'countryCode',
  'placeId',
  'lat',
  'lng',
] as const

function expectNoAddressPrivacyWrites(data: Record<string, unknown>) {
  for (const key of ADDRESS_PRIVACY_WRITE_KEYS) {
    expect(data).not.toHaveProperty(key)
  }
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/pro/onboarding/location', {
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

function parsedPlace() {
  return {
    placeId: 'place_123',
    name: 'Vivid Salon',
    formattedAddress: '123 Main St, San Diego, CA 92101',
    lat: 32.715736,
    lng: -117.161087,
    city: 'San Diego',
    state: 'CA',
    postalCode: '92101',
    countryCode: 'US',
  }
}

function parsedPostal() {
  return {
    lat: 32.715736,
    lng: -117.161087,
    city: 'San Diego',
    state: 'CA',
    postalCode: '92101',
    countryCode: 'US',
  }
}

describe('POST /api/v1/pro/onboarding/location', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requirePro.mockResolvedValue({
      ok: true,
      userId: 'user_123',
      professionalId: 'pro_123',
      proId: 'pro_123',
    })

    mocks.googlePlaceDetails.mockResolvedValue(parsedPlace())
    mocks.googleGeocodePostal.mockResolvedValue(parsedPostal())
    mocks.googleTimeZoneId.mockResolvedValue('America/Los_Angeles')
    mocks.bumpScheduleConfigVersion.mockResolvedValue(1)
    mocks.refreshLocation.mockResolvedValue(undefined)
    mocks.buildAddressPrivacyWriteData.mockReturnValue(addressPrivacyWriteData)

    const tx = {
      professionalLocation: mocks.professionalLocation,
      professionalProfile: mocks.professionalProfile,
    }

    mocks.prisma.$transaction.mockImplementation(
      async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx),
    )

    mocks.professionalLocation.updateMany.mockResolvedValue({ count: 1 })
    mocks.professionalLocation.count.mockResolvedValue(0)

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
    expect(mocks.buildAddressPrivacyWriteData).not.toHaveBeenCalled()
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
    expect(mocks.buildAddressPrivacyWriteData).not.toHaveBeenCalled()
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
    expect(mocks.buildAddressPrivacyWriteData).not.toHaveBeenCalled()
  })

  it('creates a draft salon location with address privacy fields, updates profile timezone, and syncs side effects', async () => {
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
        type: ProfessionalLocationType
        timeZone: string
        isPrimary: boolean
        isBookable: boolean
        advanceNoticeMinutes: number
      }
    }>(result)

    expect(result.status).toBe(200)

    expect(mocks.buildAddressPrivacyWriteData).toHaveBeenCalledWith({
      formattedAddress: '123 Main St, San Diego, CA 92101',
      addressLine1: null,
      addressLine2: null,
      city: 'San Diego',
      state: 'CA',
      postalCode: '92101',
      countryCode: 'US',
      placeId: 'place_123',
      lat: 32.715736,
      lng: -117.161087,
    })

    expect(mocks.professionalLocation.updateMany).toHaveBeenCalledWith({
      where: { professionalId: 'pro_123', isPrimary: true },
      data: { isPrimary: false },
    })

    const primaryClearCall =
      mocks.professionalLocation.updateMany.mock.calls[0]?.[0]
    expect(primaryClearCall).toBeDefined()
    expectNoAddressPrivacyWrites(primaryClearCall.data)

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

        ...addressPrivacyWriteData,

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

  it('preserves profile mobile config when adding a salon while a mobile base exists', async () => {
    mocks.professionalLocation.count.mockResolvedValue(1)

    const result = await POST(
      makeRequest({
        mode: 'SALON',
        placeId: 'place_123',
      }),
    )

    expect(result.status).toBe(200)

    expect(mocks.professionalLocation.count).toHaveBeenCalledWith({
      where: {
        professionalId: 'pro_123',
        type: ProfessionalLocationType.MOBILE_BASE,
        archivedAt: null,
      },
    })

    expect(mocks.professionalProfile.update).toHaveBeenCalledWith({
      where: { id: 'pro_123' },
      data: {
        timeZone: 'America/Los_Angeles',
      },
      select: { id: true },
    })
  })

  it('creates a draft suite location when mode is SUITE', async () => {
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

    expect(mocks.professionalLocation.updateMany).toHaveBeenCalledWith({
      where: { professionalId: 'pro_123', isPrimary: true },
      data: { isPrimary: false },
    })

    const primaryClearCall =
      mocks.professionalLocation.updateMany.mock.calls[0]?.[0]
    expect(primaryClearCall).toBeDefined()
    expectNoAddressPrivacyWrites(primaryClearCall.data)

    expect(mocks.professionalLocation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: ProfessionalLocationType.SUITE,
          isBookable: false,
          ...addressPrivacyWriteData,
        }),
      }),
    )

    expect(mocks.buildAddressPrivacyWriteData).toHaveBeenCalledWith({
      formattedAddress: '123 Main St, San Diego, CA 92101',
      addressLine1: null,
      addressLine2: null,
      city: 'San Diego',
      state: 'CA',
      postalCode: '92101',
      countryCode: 'US',
      placeId: 'place_123',
      lat: 32.715736,
      lng: -117.161087,
    })

    expect(mocks.bumpScheduleConfigVersion).toHaveBeenCalledWith('pro_123')
    expect(mocks.refreshLocation).toHaveBeenCalledWith(
      'loc_suite',
      'location.create',
    )
  })

  it('does not unset existing primary locations when makePrimary is false', async () => {
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
          ...addressPrivacyWriteData,
        }),
      }),
    )
  })

  it('returns 400 when Google place details do not include coordinates', async () => {
    mocks.googlePlaceDetails.mockResolvedValueOnce({
      ...parsedPlace(),
      lat: null,
      lng: null,
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
    expect(mocks.buildAddressPrivacyWriteData).not.toHaveBeenCalled()
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
    expect(mocks.buildAddressPrivacyWriteData).not.toHaveBeenCalled()
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
    expect(mocks.buildAddressPrivacyWriteData).not.toHaveBeenCalled()
  })

  it('creates a draft mobile base location with address privacy fields, updates profile mobile config, bumps version, and refreshes index', async () => {
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
        timeZone: string
        isPrimary: boolean
        isBookable: boolean
        advanceNoticeMinutes: number
      }
    }>(result)

    expect(result.status).toBe(200)

    expect(mocks.buildAddressPrivacyWriteData).toHaveBeenCalledWith({
      formattedAddress: null,
      addressLine1: null,
      addressLine2: null,
      city: 'San Diego',
      state: 'CA',
      postalCode: '92101',
      countryCode: 'US',
      placeId: null,
      lat: 32.715736,
      lng: -117.161087,
    })

    expect(mocks.professionalLocation.updateMany).toHaveBeenCalledWith({
      where: { professionalId: 'pro_123', isPrimary: true },
      data: { isPrimary: false },
    })

    const primaryClearCall =
      mocks.professionalLocation.updateMany.mock.calls[0]?.[0]
    expect(primaryClearCall).toBeDefined()
    expectNoAddressPrivacyWrites(primaryClearCall.data)

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

        ...addressPrivacyWriteData,

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

    expect(mocks.buildAddressPrivacyWriteData).toHaveBeenCalledWith({
      formattedAddress: null,
      addressLine1: null,
      addressLine2: null,
      city: 'San Diego',
      state: 'CA',
      postalCode: '92101',
      countryCode: 'US',
      placeId: null,
      lat: 32.715736,
      lng: -117.161087,
    })
  })

  it('returns 400 when postal geocode does not include coordinates', async () => {
    mocks.googleGeocodePostal.mockResolvedValueOnce({
      ...parsedPostal(),
      lat: null,
      lng: null,
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
    expect(mocks.buildAddressPrivacyWriteData).not.toHaveBeenCalled()
  })

  it('returns 500 when Google throws', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    mocks.googlePlaceDetails.mockRejectedValueOnce(
      new Error('Google said nope.'),
    )

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
      'POST /api/v1/pro/onboarding/location error',
      expect.any(Error),
    )

    consoleErrorSpy.mockRestore()
  })

  it('returns 500 when the transaction throws', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

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