// app/api/pro/locations/[id]/mobile-base/route.test.ts

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
  const enforceRateLimit = vi.fn()
  const rateLimitIdentity = vi.fn()
  const googleGeocodePostal = vi.fn()
  const googleTimeZoneId = vi.fn()
  const bumpScheduleConfigVersion = vi.fn()
  const refreshProfessional = vi.fn()
  const buildAddressPrivacyWriteData = vi.fn()

  const professionalLocation = {
    findFirst: vi.fn(),
    update: vi.fn(),
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
    enforceRateLimit,
    rateLimitIdentity,
    googleGeocodePostal,
    googleTimeZoneId,
    bumpScheduleConfigVersion,
    refreshProfessional,
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
}))

vi.mock('@/app/api/_utils/auth/requirePro', () => ({
  requirePro: mocks.requirePro,
}))

vi.mock('@/app/api/_utils/google', () => ({
  googleGeocodePostal: mocks.googleGeocodePostal,
  googleTimeZoneId: mocks.googleTimeZoneId,
}))

vi.mock('@/app/api/_utils/rateLimit', () => ({
  enforceRateLimit: mocks.enforceRateLimit,
  rateLimitIdentity: mocks.rateLimitIdentity,
}))

vi.mock('@/lib/booking/cacheVersion', () => ({
  bumpScheduleConfigVersion: mocks.bumpScheduleConfigVersion,
}))

vi.mock('@/lib/search/index/refreshSearchIndex', () => ({
  refreshProfessional: mocks.refreshProfessional,
}))

vi.mock('@/lib/security/addressEncryption', () => ({
  buildAddressPrivacyWriteData: mocks.buildAddressPrivacyWriteData,
}))

vi.mock('@/lib/timeZone', () => ({
  isValidIanaTimeZone: (value: unknown) =>
    typeof value === 'string' && value.includes('/'),
}))

import { PATCH } from './route'

const addressPrivacyWriteData = {
  encryptedAddressJson: { v: 1 },
  addressKeyVersion: 'address-json-v1',
  postalCodePrefix: '92024',
  latApprox: '33.0370',
  lngApprox: '-117.2920',
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/pro/locations/loc_123/mobile-base', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

function makeCtx(id = 'loc_123') {
  return { params: Promise.resolve({ id }) }
}

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

function parsedPostal() {
  return {
    lat: 33.036987,
    lng: -117.291982,
    city: 'Encinitas',
    state: 'CA',
    postalCode: '92024',
    countryCode: 'US',
  }
}

describe('PATCH /api/pro/locations/[id]/mobile-base', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requirePro.mockResolvedValue({
      ok: true,
      userId: 'user_123',
      professionalId: 'pro_123',
      proId: 'pro_123',
    })

    mocks.enforceRateLimit.mockResolvedValue(null)
    mocks.rateLimitIdentity.mockResolvedValue('identity_123')

    mocks.googleGeocodePostal.mockResolvedValue(parsedPostal())
    mocks.googleTimeZoneId.mockResolvedValue('America/Los_Angeles')
    mocks.bumpScheduleConfigVersion.mockResolvedValue(1)
    mocks.refreshProfessional.mockResolvedValue(undefined)
    mocks.buildAddressPrivacyWriteData.mockReturnValue(addressPrivacyWriteData)

    const tx = {
      professionalLocation: mocks.professionalLocation,
      professionalProfile: mocks.professionalProfile,
    }

    mocks.prisma.$transaction.mockImplementation(
      async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx),
    )

    mocks.professionalLocation.findFirst.mockResolvedValue({
      id: 'loc_123',
      type: ProfessionalLocationType.MOBILE_BASE,
      isPrimary: true,
      postalCode: '92101',
    })

    mocks.professionalLocation.update.mockResolvedValue({
      id: 'loc_123',
      postalCode: '92024',
      timeZone: 'America/Los_Angeles',
    })

    mocks.professionalProfile.update.mockResolvedValue({
      mobileBasePostalCode: '92024',
      mobileRadiusMiles: 25,
    })
  })

  it('passes through failed pro auth unchanged', async () => {
    const authRes = new Response(null, { status: 401 })

    mocks.requirePro.mockResolvedValue({
      ok: false,
      res: authRes,
    })

    const result = await PATCH(
      makeRequest({ postalCode: '92024' }) as never,
      makeCtx(),
    )

    expect(result).toBe(authRes)
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('returns 400 when neither postalCode nor radiusMiles is provided', async () => {
    const result = await PATCH(makeRequest({}) as never, makeCtx())

    const body = await readJson<{ ok: false; code: string }>(result)

    expect(result.status).toBe(400)
    expect(body.code).toBe('EMPTY_PATCH')
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('returns 400 when radiusMiles is out of range', async () => {
    const result = await PATCH(
      makeRequest({ radiusMiles: 999 }) as never,
      makeCtx(),
    )

    const body = await readJson<{ ok: false; code: string }>(result)

    expect(result.status).toBe(400)
    expect(body.code).toBe('INVALID_RADIUS')
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('returns 404 when the location does not belong to the pro', async () => {
    mocks.professionalLocation.findFirst.mockResolvedValue(null)

    const result = await PATCH(
      makeRequest({ postalCode: '92024' }) as never,
      makeCtx(),
    )

    expect(result.status).toBe(404)
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('returns 400 for non mobile-base locations', async () => {
    mocks.professionalLocation.findFirst.mockResolvedValue({
      id: 'loc_123',
      type: ProfessionalLocationType.SALON,
      isPrimary: true,
      postalCode: '92101',
    })

    const result = await PATCH(
      makeRequest({ postalCode: '92024' }) as never,
      makeCtx(),
    )

    const body = await readJson<{ ok: false; code: string }>(result)

    expect(result.status).toBe(400)
    expect(body.code).toBe('NOT_MOBILE_BASE')
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('returns 400 when the postal code cannot be located', async () => {
    mocks.googleGeocodePostal.mockResolvedValue({
      ...parsedPostal(),
      lat: null,
      lng: null,
    })

    const result = await PATCH(
      makeRequest({ postalCode: '00000' }) as never,
      makeCtx(),
    )

    const body = await readJson<{ ok: false; code: string }>(result)

    expect(result.status).toBe(400)
    expect(body.code).toBe('POSTAL_NOT_FOUND')
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('re-geocodes a new ZIP, updates the location, and syncs profile config', async () => {
    const result = await PATCH(
      makeRequest({ postalCode: '92024', radiusMiles: 25 }) as never,
      makeCtx(),
    )

    const body = await readJson<{
      ok: true
      locationId: string
      postalCode: string
      timeZone: string
      mobileBasePostalCode: string
      mobileRadiusMiles: number
    }>(result)

    expect(result.status).toBe(200)

    expect(mocks.googleGeocodePostal).toHaveBeenCalledWith('92024')
    expect(mocks.googleTimeZoneId).toHaveBeenCalledWith(
      33.036987,
      -117.291982,
    )

    expect(mocks.professionalLocation.update).toHaveBeenCalledWith({
      where: { id: 'loc_123' },
      data: {
        city: 'Encinitas',
        state: 'CA',
        postalCode: '92024',
        countryCode: 'US',

        lat: 33.036987,
        lng: -117.291982,

        ...addressPrivacyWriteData,

        timeZone: 'America/Los_Angeles',
      },
      select: {
        id: true,
        postalCode: true,
        timeZone: true,
      },
    })

    expect(mocks.professionalProfile.update).toHaveBeenCalledWith({
      where: { id: 'pro_123' },
      data: {
        mobileBasePostalCode: '92024',
        timeZone: 'America/Los_Angeles',
        mobileRadiusMiles: 25,
      },
      select: {
        mobileBasePostalCode: true,
        mobileRadiusMiles: true,
      },
    })

    expect(mocks.bumpScheduleConfigVersion).toHaveBeenCalledWith('pro_123')
    expect(mocks.refreshProfessional).toHaveBeenCalledWith(
      'pro_123',
      'location.update',
    )

    expect(body).toEqual({
      ok: true,
      locationId: 'loc_123',
      postalCode: '92024',
      timeZone: 'America/Los_Angeles',
      mobileBasePostalCode: '92024',
      mobileRadiusMiles: 25,
    })
  })

  it('does not touch profile timezone when the location is not primary', async () => {
    mocks.professionalLocation.findFirst.mockResolvedValue({
      id: 'loc_123',
      type: ProfessionalLocationType.MOBILE_BASE,
      isPrimary: false,
      postalCode: '92101',
    })

    await PATCH(makeRequest({ postalCode: '92024' }) as never, makeCtx())

    expect(mocks.professionalProfile.update).toHaveBeenCalledWith({
      where: { id: 'pro_123' },
      data: {
        mobileBasePostalCode: '92024',
      },
      select: {
        mobileBasePostalCode: true,
        mobileRadiusMiles: true,
      },
    })
  })

  it('updates only the radius without geocoding when postalCode is omitted', async () => {
    mocks.professionalProfile.update.mockResolvedValue({
      mobileBasePostalCode: '92101',
      mobileRadiusMiles: 50,
    })

    const result = await PATCH(
      makeRequest({ radiusMiles: 50 }) as never,
      makeCtx(),
    )

    const body = await readJson<{
      ok: true
      postalCode: string
      mobileRadiusMiles: number
    }>(result)

    expect(result.status).toBe(200)

    expect(mocks.googleGeocodePostal).not.toHaveBeenCalled()
    expect(mocks.googleTimeZoneId).not.toHaveBeenCalled()
    expect(mocks.professionalLocation.update).not.toHaveBeenCalled()

    expect(mocks.professionalProfile.update).toHaveBeenCalledWith({
      where: { id: 'pro_123' },
      data: {
        mobileRadiusMiles: 50,
      },
      select: {
        mobileBasePostalCode: true,
        mobileRadiusMiles: true,
      },
    })

    expect(body.postalCode).toBe('92101')
    expect(body.mobileRadiusMiles).toBe(50)
  })

  it('returns 500 when Google throws', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    mocks.googleGeocodePostal.mockRejectedValue(new Error('Google said nope.'))

    const result = await PATCH(
      makeRequest({ postalCode: '92024' }) as never,
      makeCtx(),
    )

    const body = await readJson<{ ok: false; error: string }>(result)

    expect(result.status).toBe(500)
    expect(body.error).toBe('Google said nope.')

    consoleErrorSpy.mockRestore()
  })
})
