// app/api/pro/locations/[id]/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { Prisma, ProfessionalLocationType } from '@prisma/client'

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

  const bumpScheduleConfigVersion = vi.fn()
  const refreshLocation = vi.fn()
  const deleteLocationFromIndex = vi.fn()
  const evaluatePublishableLocation = vi.fn()
  const buildAddressPrivacyWriteData = vi.fn()

  const professionalLocation = {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  }

  const prisma = {
    professionalLocation,
    $transaction: vi.fn(),
  }

  return {
    jsonOk,
    jsonFail,
    requirePro,
    enforceRateLimit,
    rateLimitIdentity,
    bumpScheduleConfigVersion,
    refreshLocation,
    deleteLocationFromIndex,
    evaluatePublishableLocation,
    buildAddressPrivacyWriteData,
    professionalLocation,
    prisma,
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/app/api/_utils/responses', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
}))

vi.mock('@/app/api/_utils/auth/requirePro', () => ({
  requirePro: mocks.requirePro,
}))

vi.mock('@/app/api/_utils/rateLimit', () => ({
  enforceRateLimit: mocks.enforceRateLimit,
  rateLimitIdentity: mocks.rateLimitIdentity,
}))

vi.mock('@/lib/booking/cacheVersion', () => ({
  bumpScheduleConfigVersion: mocks.bumpScheduleConfigVersion,
}))

vi.mock('@/lib/search/index/refreshSearchIndex', () => ({
  refreshLocation: mocks.refreshLocation,
  deleteLocationFromIndex: mocks.deleteLocationFromIndex,
}))

vi.mock('@/lib/pro/readiness/proReadiness', () => ({
  evaluatePublishableLocation: mocks.evaluatePublishableLocation,
}))

vi.mock('@/lib/security/addressEncryption', () => ({
  buildAddressPrivacyWriteData: mocks.buildAddressPrivacyWriteData,
}))

import { DELETE, PATCH } from './route'

type RouteCtx = {
  params: Promise<{ id: string }>
}

const validWorkingHours = {
  mon: { enabled: true, start: '09:00', end: '17:00' },
  tue: { enabled: false, start: '09:00', end: '17:00' },
  wed: { enabled: false, start: '09:00', end: '17:00' },
  thu: { enabled: false, start: '09:00', end: '17:00' },
  fri: { enabled: false, start: '09:00', end: '17:00' },
  sat: { enabled: false, start: '09:00', end: '17:00' },
  sun: { enabled: false, start: '09:00', end: '17:00' },
}

const addressPrivacyWriteData = {
  encryptedAddressJson: {
    v: 1,
    algorithm: 'plaintext-json-expand-phase',
    keyVersion: 'address-json-v1',
    address: {
      formattedAddress: '456 Market St, San Diego, CA',
      addressLine1: '456 Market St',
      addressLine2: 'Suite 9',
      city: 'San Diego',
      state: 'CA',
      postalCode: '92101',
      countryCode: 'US',
      placeId: 'place_456',
      lat: '32.7',
      lng: '-117.1',
    },
  },
  addressKeyVersion: 'address-json-v1',
  postalCodePrefix: '92101',
  latApprox: new Prisma.Decimal('32.7000'),
  lngApprox: new Prisma.Decimal('-117.1000'),
}

const ADDRESS_PRIVACY_WRITE_KEYS = [
  'encryptedAddressJson',
  'addressKeyVersion',
  'postalCodePrefix',
  'latApprox',
  'lngApprox',
] as const

function expectNoAddressPrivacyWrites(data: Record<string, unknown>) {
  for (const key of ADDRESS_PRIVACY_WRITE_KEYS) {
    expect(data).not.toHaveProperty(key)
  }
}

function makePatchRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/pro/locations/loc_123', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

function makeDeleteRequest(): NextRequest {
  return new NextRequest('http://localhost/api/pro/locations/loc_123', {
    method: 'DELETE',
  })
}

function makeCtx(id = 'loc_123'): RouteCtx {
  return {
    params: Promise.resolve({ id }),
  }
}

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

function makeExistingLocation(
  overrides: Partial<{
    id: string
    type: ProfessionalLocationType
    isPrimary: boolean
    isBookable: boolean
    timeZone: string | null
    placeId: string | null
    formattedAddress: string | null
    addressLine1: string | null
    addressLine2: string | null
    city: string | null
    state: string | null
    postalCode: string | null
    countryCode: string | null
    lat: Prisma.Decimal | null
    lng: Prisma.Decimal | null
    workingHours: unknown
  }> = {},
) {
  return {
    id: 'loc_123',
    type: ProfessionalLocationType.SALON,
    isPrimary: false,
    isBookable: false,
    timeZone: 'America/Los_Angeles',
    placeId: 'place_123',
    formattedAddress: '123 Main St, San Diego, CA',
    addressLine1: '123 Main St',
    addressLine2: null,
    city: 'San Diego',
    state: 'CA',
    postalCode: '92101',
    countryCode: 'US',
    lat: new Prisma.Decimal('32.715736'),
    lng: new Prisma.Decimal('-117.161087'),
    workingHours: validWorkingHours,
    ...overrides,
  }
}

function makeUpdatedLocation(
  overrides: Partial<{
    id: string
    isPrimary: boolean
    isBookable: boolean
    timeZone: string | null
    type: ProfessionalLocationType
  }> = {},
) {
  return {
    id: 'loc_123',
    isPrimary: false,
    isBookable: false,
    timeZone: 'America/Los_Angeles',
    type: ProfessionalLocationType.SALON,
    ...overrides,
  }
}

describe('app/api/pro/locations/[id]/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requirePro.mockResolvedValue({
      ok: true,
      userId: 'user_123',
      professionalId: 'pro_123',
    })

    mocks.rateLimitIdentity.mockResolvedValue('user_123')
    mocks.enforceRateLimit.mockResolvedValue(null)

    mocks.professionalLocation.findFirst.mockResolvedValue(makeExistingLocation())
    mocks.professionalLocation.updateMany.mockResolvedValue({ count: 1 })
    mocks.professionalLocation.deleteMany.mockResolvedValue({ count: 1 })

    mocks.bumpScheduleConfigVersion.mockResolvedValue(1)
    mocks.refreshLocation.mockResolvedValue(undefined)
    mocks.deleteLocationFromIndex.mockResolvedValue(undefined)

    mocks.evaluatePublishableLocation.mockReturnValue({
      ok: true,
      locationId: 'loc_123',
    })

    mocks.buildAddressPrivacyWriteData.mockReturnValue(addressPrivacyWriteData)

    const tx = {
      professionalLocation: mocks.professionalLocation,
    }

    mocks.prisma.$transaction.mockImplementation(
      async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx),
    )
  })

  describe('PATCH', () => {
    it('passes through failed pro auth unchanged', async () => {
      const authRes = new Response(null, { status: 401 })

      mocks.requirePro.mockResolvedValue({
        ok: false,
        res: authRes,
      })

      const result = await PATCH(makePatchRequest({ name: 'New Name' }), makeCtx())

      expect(result).toBe(authRes)
      expect(result.status).toBe(401)

      expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
      expect(mocks.professionalLocation.findFirst).not.toHaveBeenCalled()
      expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
      expect(mocks.buildAddressPrivacyWriteData).not.toHaveBeenCalled()
    })

    it('passes through rate limit response unchanged', async () => {
      const limitedRes = new Response('rate limited', { status: 429 })

      mocks.enforceRateLimit.mockResolvedValue(limitedRes)

      const result = await PATCH(makePatchRequest({ name: 'New Name' }), makeCtx())

      expect(result).toBe(limitedRes)
      expect(result.status).toBe(429)

      expect(mocks.rateLimitIdentity).toHaveBeenCalledWith('user_123')
      expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
        bucket: 'pro:locations:write',
        identity: 'user_123',
      })

      expect(mocks.professionalLocation.findFirst).not.toHaveBeenCalled()
      expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
      expect(mocks.buildAddressPrivacyWriteData).not.toHaveBeenCalled()
    })

    it('returns 400 when id is missing', async () => {
      const result = await PATCH(
        makePatchRequest({ name: 'New Name' }),
        makeCtx('   '),
      )

      const body = await readJson<{
        ok: false
        error: string
      }>(result)

      expect(result.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error: 'Missing id',
      })

      expect(mocks.professionalLocation.findFirst).not.toHaveBeenCalled()
      expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
      expect(mocks.buildAddressPrivacyWriteData).not.toHaveBeenCalled()
    })

    it('returns 404 when location is not found', async () => {
      mocks.professionalLocation.findFirst.mockResolvedValueOnce(null)

      const result = await PATCH(makePatchRequest({ name: 'New Name' }), makeCtx())

      const body = await readJson<{
        ok: false
        error: string
      }>(result)

      expect(result.status).toBe(404)
      expect(body).toEqual({
        ok: false,
        error: 'Location not found',
      })

      expect(mocks.professionalLocation.findFirst).toHaveBeenCalledWith({
        where: { id: 'loc_123', professionalId: 'pro_123' },
        select: {
          id: true,
          type: true,
          isPrimary: true,
          isBookable: true,
          timeZone: true,
          placeId: true,
          formattedAddress: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          state: true,
          postalCode: true,
          countryCode: true,
          lat: true,
          lng: true,
          workingHours: true,
        },
      })

      expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
      expect(mocks.buildAddressPrivacyWriteData).not.toHaveBeenCalled()
    })

    it('rejects publishing a draft location through PATCH and points callers to schedule publish', async () => {
      mocks.professionalLocation.findFirst.mockResolvedValueOnce(
        makeExistingLocation({
          isBookable: false,
        }),
      )

      const result = await PATCH(
        makePatchRequest({
          isBookable: true,
        }),
        makeCtx(),
      )

      const body = await readJson<{
        ok: false
        error: string
        code: string
      }>(result)

      expect(result.status).toBe(409)
      expect(body).toEqual({
        ok: false,
        error: 'Use the schedule publish endpoint to make a location bookable.',
        code: 'USE_SCHEDULE_PUBLISH',
      })

      expect(mocks.evaluatePublishableLocation).not.toHaveBeenCalled()
      expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
      expect(mocks.bumpScheduleConfigVersion).not.toHaveBeenCalled()
      expect(mocks.refreshLocation).not.toHaveBeenCalled()
      expect(mocks.buildAddressPrivacyWriteData).not.toHaveBeenCalled()
    })

    it('returns 400 when isBookable is not boolean', async () => {
      const result = await PATCH(
        makePatchRequest({
          isBookable: 'yes obviously',
        }),
        makeCtx(),
      )

      const body = await readJson<{
        ok: false
        error: string
      }>(result)

      expect(result.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error: 'isBookable must be boolean',
      })

      expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
      expect(mocks.buildAddressPrivacyWriteData).not.toHaveBeenCalled()
    })

    it('returns 400 when trying to unset the current primary location directly', async () => {
      mocks.professionalLocation.findFirst.mockResolvedValueOnce(
        makeExistingLocation({
          isPrimary: true,
        }),
      )

      const result = await PATCH(
        makePatchRequest({
          isPrimary: false,
        }),
        makeCtx(),
      )

      const body = await readJson<{
        ok: false
        error: string
      }>(result)

      expect(result.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error:
          'Cannot unset primary directly. Set another location as primary instead.',
      })

      expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
      expect(mocks.buildAddressPrivacyWriteData).not.toHaveBeenCalled()
    })

    it('updates a draft location without address edits and does not rebuild privacy fields', async () => {
      mocks.professionalLocation.findFirst.mockResolvedValueOnce(
        makeExistingLocation({
          isBookable: false,
        }),
      )

      mocks.professionalLocation.findFirst.mockResolvedValueOnce(
        makeUpdatedLocation({
          isBookable: false,
          isPrimary: false,
        }),
      )

      const result = await PATCH(
        makePatchRequest({
          name: 'Updated Draft Location',
          isPrimary: false,
        }),
        makeCtx(),
      )

      const body = await readJson<{
        ok: true
        location: {
          id: string
          isPrimary: boolean
          isBookable: boolean
          timeZone: string | null
          type: ProfessionalLocationType
        }
      }>(result)

      expect(result.status).toBe(200)

      expect(mocks.buildAddressPrivacyWriteData).not.toHaveBeenCalled()

      expect(mocks.professionalLocation.updateMany).toHaveBeenCalledWith({
        where: { id: 'loc_123', professionalId: 'pro_123' },
        data: {
          name: 'Updated Draft Location',
          isPrimary: false,
        },
      })

      expect(mocks.bumpScheduleConfigVersion).toHaveBeenCalledWith('pro_123')
      expect(mocks.refreshLocation).toHaveBeenCalledWith(
        'loc_123',
        'location.update',
      )

      expect(mocks.professionalLocation.updateMany).toHaveBeenCalledWith({
        where: { id: 'loc_123', professionalId: 'pro_123' },
        data: {
          name: 'Updated Draft Location',
          isPrimary: false,
        },
      })

      const updateCall = mocks.professionalLocation.updateMany.mock.calls[0]?.[0]
      expect(updateCall).toBeDefined()
      expectNoAddressPrivacyWrites(updateCall.data)

      expect(body).toEqual({
        ok: true,
        location: {
          id: 'loc_123',
          isPrimary: false,
          isBookable: false,
          timeZone: 'America/Los_Angeles',
          type: ProfessionalLocationType.SALON,
        },
      })
    })

    it('updates a draft location with address privacy write fields when address fields change', async () => {
      mocks.professionalLocation.findFirst.mockResolvedValueOnce(
        makeExistingLocation({
          isBookable: false,
          addressLine1: '123 Main St',
          addressLine2: null,
          city: 'San Diego',
          state: 'CA',
          postalCode: '92101',
          countryCode: 'US',
        }),
      )

      mocks.professionalLocation.findFirst.mockResolvedValueOnce(
        makeUpdatedLocation({
          isBookable: false,
          isPrimary: false,
        }),
      )

      const result = await PATCH(
        makePatchRequest({
          formattedAddress: '456 Market St, San Diego, CA',
          addressLine1: '456 Market St',
          addressLine2: 'Suite 9',
          city: 'San Diego',
          state: 'CA',
          postalCode: '92101',
          countryCode: 'US',
          placeId: 'place_456',
          lat: 32.7,
          lng: -117.1,
        }),
        makeCtx(),
      )

      expect(result.status).toBe(200)

      expect(mocks.buildAddressPrivacyWriteData).toHaveBeenCalledWith({
        formattedAddress: '456 Market St, San Diego, CA',
        addressLine1: '456 Market St',
        addressLine2: 'Suite 9',
        city: 'San Diego',
        state: 'CA',
        postalCode: '92101',
        countryCode: 'US',
        placeId: 'place_456',
        lat: 32.7,
        lng: -117.1,
      })

      expect(mocks.professionalLocation.updateMany).toHaveBeenCalledWith({
        where: { id: 'loc_123', professionalId: 'pro_123' },
        data: {
          placeId: 'place_456',
          formattedAddress: '456 Market St, San Diego, CA',
          addressLine1: '456 Market St',
          addressLine2: 'Suite 9',
          city: 'San Diego',
          state: 'CA',
          postalCode: '92101',
          countryCode: 'US',
          lat: new Prisma.Decimal('32.7'),
          lng: new Prisma.Decimal('-117.1'),
          encryptedAddressJson: addressPrivacyWriteData.encryptedAddressJson,
          addressKeyVersion: 'address-json-v1',
          postalCodePrefix: '92101',
          latApprox: new Prisma.Decimal('32.7000'),
          lngApprox: new Prisma.Decimal('-117.1000'),
        },
      })

      expect(mocks.bumpScheduleConfigVersion).toHaveBeenCalledWith('pro_123')
      expect(mocks.refreshLocation).toHaveBeenCalledWith(
        'loc_123',
        'location.update',
      )
    })

    it('sets another location as primary by clearing the old primary first', async () => {
      mocks.professionalLocation.findFirst.mockResolvedValueOnce(
        makeExistingLocation({
          isPrimary: false,
          isBookable: false,
        }),
      )

      mocks.professionalLocation.findFirst.mockResolvedValueOnce(
        makeUpdatedLocation({
          isPrimary: true,
          isBookable: false,
        }),
      )

      const result = await PATCH(
        makePatchRequest({
          isPrimary: true,
        }),
        makeCtx(),
      )

      expect(result.status).toBe(200)

      expect(mocks.professionalLocation.updateMany).toHaveBeenNthCalledWith(1, {
        where: { professionalId: 'pro_123', isPrimary: true },
        data: { isPrimary: false },
      })

      expect(mocks.professionalLocation.updateMany).toHaveBeenNthCalledWith(2, {
        where: { id: 'loc_123', professionalId: 'pro_123' },
        data: {
          isPrimary: true,
        },
      })

      expect(mocks.buildAddressPrivacyWriteData).not.toHaveBeenCalled()
    })

    it('allows turning an existing bookable location off', async () => {
      mocks.professionalLocation.findFirst.mockResolvedValueOnce(
        makeExistingLocation({
          isBookable: true,
        }),
      )

      mocks.professionalLocation.findFirst.mockResolvedValueOnce(
        makeUpdatedLocation({
          isBookable: false,
        }),
      )

      const result = await PATCH(
        makePatchRequest({
          isBookable: false,
        }),
        makeCtx(),
      )

      expect(result.status).toBe(200)

      expect(mocks.evaluatePublishableLocation).not.toHaveBeenCalled()
      expect(mocks.buildAddressPrivacyWriteData).not.toHaveBeenCalled()

      expect(mocks.professionalLocation.updateMany).toHaveBeenCalledWith({
        where: { id: 'loc_123', professionalId: 'pro_123' },
        data: {
          isBookable: false,
        },
      })

      const updateCall = mocks.professionalLocation.updateMany.mock.calls[0]?.[0]
      expect(updateCall).toBeDefined()
      expectNoAddressPrivacyWrites(updateCall.data)

      expect(mocks.bumpScheduleConfigVersion).toHaveBeenCalledWith('pro_123')
      expect(mocks.refreshLocation).toHaveBeenCalledWith(
        'loc_123',
        'location.update',
      )
    })

    it('validates an already-bookable location before applying address edits that keep it bookable', async () => {
      mocks.professionalLocation.findFirst.mockResolvedValueOnce(
        makeExistingLocation({
          isBookable: true,
        }),
      )

      mocks.professionalLocation.findFirst.mockResolvedValueOnce(
        makeUpdatedLocation({
          isBookable: true,
        }),
      )

      const result = await PATCH(
        makePatchRequest({
          timeZone: 'America/Los_Angeles',
          formattedAddress: '456 Market St, San Diego, CA',
          placeId: 'place_456',
          lat: 32.7,
          lng: -117.1,
        }),
        makeCtx(),
      )

      expect(result.status).toBe(200)

      expect(mocks.evaluatePublishableLocation).toHaveBeenCalledWith({
        id: 'loc_123',
        type: ProfessionalLocationType.SALON,
        formattedAddress: '456 Market St, San Diego, CA',
        timeZone: 'America/Los_Angeles',
        workingHours: validWorkingHours,
      })

      expect(mocks.buildAddressPrivacyWriteData).toHaveBeenCalledWith({
        formattedAddress: '456 Market St, San Diego, CA',
        addressLine1: '123 Main St',
        addressLine2: null,
        city: 'San Diego',
        state: 'CA',
        postalCode: '92101',
        countryCode: 'US',
        placeId: 'place_456',
        lat: 32.7,
        lng: -117.1,
      })

      expect(mocks.professionalLocation.updateMany).toHaveBeenCalledWith({
        where: { id: 'loc_123', professionalId: 'pro_123' },
        data: {
          placeId: 'place_456',
          formattedAddress: '456 Market St, San Diego, CA',
          lat: new Prisma.Decimal('32.7'),
          lng: new Prisma.Decimal('-117.1'),
          timeZone: 'America/Los_Angeles',
          encryptedAddressJson: addressPrivacyWriteData.encryptedAddressJson,
          addressKeyVersion: 'address-json-v1',
          postalCodePrefix: '92101',
          latApprox: new Prisma.Decimal('32.7000'),
          lngApprox: new Prisma.Decimal('-117.1000'),
        },
      })
    })

    it('blocks edits that would make an existing bookable location fail publishability checks before privacy build', async () => {
      mocks.professionalLocation.findFirst.mockResolvedValueOnce(
        makeExistingLocation({
          isBookable: true,
        }),
      )

      mocks.evaluatePublishableLocation.mockReturnValueOnce({
        ok: false,
        locationId: 'loc_123',
        blockers: ['LOCATION_MISSING_TIMEZONE'],
      })

      const result = await PATCH(
        makePatchRequest({
          timeZone: '',
        }),
        makeCtx(),
      )

      const body = await readJson<{
        ok: false
        error: string
        blockers: string[]
      }>(result)

      expect(result.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error:
          'Bookable locations must have valid timezone, working hours, and address requirements.',
        blockers: ['LOCATION_MISSING_TIMEZONE'],
      })

      expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
      expect(mocks.bumpScheduleConfigVersion).not.toHaveBeenCalled()
      expect(mocks.refreshLocation).not.toHaveBeenCalled()
      expect(mocks.buildAddressPrivacyWriteData).not.toHaveBeenCalled()
    })

    it('blocks an existing bookable location when lat/lng would be missing before privacy build', async () => {
      mocks.professionalLocation.findFirst.mockResolvedValueOnce(
        makeExistingLocation({
          isBookable: true,
        }),
      )

      const result = await PATCH(
        makePatchRequest({
          lat: null,
          lng: null,
        }),
        makeCtx(),
      )

      const body = await readJson<{
        ok: false
        error: string
      }>(result)

      expect(result.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error: 'Bookable locations must include lat/lng.',
      })

      expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
      expect(mocks.buildAddressPrivacyWriteData).not.toHaveBeenCalled()
    })

    it('blocks an existing bookable salon location when placeId is removed before privacy build', async () => {
      mocks.professionalLocation.findFirst.mockResolvedValueOnce(
        makeExistingLocation({
          isBookable: true,
          type: ProfessionalLocationType.SALON,
        }),
      )

      const result = await PATCH(
        makePatchRequest({
          placeId: '',
        }),
        makeCtx(),
      )

      const body = await readJson<{
        ok: false
        error: string
      }>(result)

      expect(result.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error:
          'Salon/Suite bookable locations require placeId and formattedAddress.',
      })

      expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
      expect(mocks.buildAddressPrivacyWriteData).not.toHaveBeenCalled()
    })

    it('returns 400 when workingHours are invalid', async () => {
      const result = await PATCH(
        makePatchRequest({
          workingHours: {
            mon: { enabled: true, start: '17:00', end: '09:00' },
          },
        }),
        makeCtx(),
      )

      const body = await readJson<{
        ok: false
        error: string
      }>(result)

      expect(result.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error:
          'workingHours must contain mon..sun with { enabled, start, end }, valid HH:MM times, and end after start.',
      })

      expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
      expect(mocks.buildAddressPrivacyWriteData).not.toHaveBeenCalled()
    })

    it('returns 404 when updateMany does not update exactly one row', async () => {
      mocks.professionalLocation.updateMany.mockResolvedValueOnce({ count: 0 })

      const result = await PATCH(
        makePatchRequest({
          name: 'Updated Name',
        }),
        makeCtx(),
      )

      const body = await readJson<{
        ok: false
        error: string
      }>(result)

      expect(result.status).toBe(404)
      expect(body).toEqual({
        ok: false,
        error: 'Location not found',
      })

      expect(mocks.bumpScheduleConfigVersion).not.toHaveBeenCalled()
      expect(mocks.refreshLocation).not.toHaveBeenCalled()
    })

    it('returns 500 when PATCH throws unexpectedly', async () => {
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined)

      mocks.professionalLocation.findFirst.mockRejectedValueOnce(
        new Error('db exploded'),
      )

      const result = await PATCH(
        makePatchRequest({
          name: 'Updated Name',
        }),
        makeCtx(),
      )

      const body = await readJson<{
        ok: false
        error: string
      }>(result)

      expect(result.status).toBe(500)
      expect(body).toEqual({
        ok: false,
        error: 'db exploded',
      })

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'PATCH /api/pro/locations/[id] error',
        expect.any(Error),
      )

      consoleErrorSpy.mockRestore()
    })
  })

  describe('DELETE', () => {
    it('passes through failed pro auth unchanged', async () => {
      const authRes = new Response(null, { status: 401 })

      mocks.requirePro.mockResolvedValue({
        ok: false,
        res: authRes,
      })

      const result = await DELETE(makeDeleteRequest(), makeCtx())

      expect(result).toBe(authRes)
      expect(result.status).toBe(401)

      expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
      expect(mocks.professionalLocation.deleteMany).not.toHaveBeenCalled()
    })

    it('passes through rate limit response unchanged for DELETE', async () => {
      const limitedRes = new Response('rate limited', { status: 429 })

      mocks.enforceRateLimit.mockResolvedValue(limitedRes)

      const result = await DELETE(makeDeleteRequest(), makeCtx())

      expect(result).toBe(limitedRes)
      expect(result.status).toBe(429)

      expect(mocks.professionalLocation.deleteMany).not.toHaveBeenCalled()
    })

    it('returns 400 when DELETE id is missing', async () => {
      const result = await DELETE(makeDeleteRequest(), makeCtx('   '))

      const body = await readJson<{
        ok: false
        error: string
      }>(result)

      expect(result.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error: 'Missing id',
      })

      expect(mocks.professionalLocation.deleteMany).not.toHaveBeenCalled()
    })

    it('deletes the location, bumps schedule version, and removes search index row', async () => {
      const result = await DELETE(makeDeleteRequest(), makeCtx())

      const body = await readJson<{
        ok: true
      }>(result)

      expect(result.status).toBe(200)
      expect(body).toEqual({
        ok: true,
      })

      expect(mocks.professionalLocation.deleteMany).toHaveBeenCalledWith({
        where: { id: 'loc_123', professionalId: 'pro_123' },
      })

      expect(mocks.bumpScheduleConfigVersion).toHaveBeenCalledWith('pro_123')
      expect(mocks.deleteLocationFromIndex).toHaveBeenCalledWith('loc_123')
    })

    it('returns 404 when DELETE finds no matching location', async () => {
      mocks.professionalLocation.deleteMany.mockResolvedValueOnce({ count: 0 })

      const result = await DELETE(makeDeleteRequest(), makeCtx())

      const body = await readJson<{
        ok: false
        error: string
      }>(result)

      expect(result.status).toBe(404)
      expect(body).toEqual({
        ok: false,
        error: 'Location not found',
      })

      expect(mocks.bumpScheduleConfigVersion).not.toHaveBeenCalled()
      expect(mocks.deleteLocationFromIndex).not.toHaveBeenCalled()
    })

    it('returns 409 when DELETE hits a Prisma foreign-key constraint error', async () => {
      mocks.professionalLocation.deleteMany.mockRejectedValueOnce({
        code: 'P2003',
        message: 'Foreign key constraint failed',
      })

      const result = await DELETE(makeDeleteRequest(), makeCtx())

      const body = await readJson<{
        ok: false
        error: string
      }>(result)

      expect(result.status).toBe(409)
      expect(body).toEqual({
        ok: false,
        error:
          'This location is used by existing bookings and cannot be deleted.',
      })

      expect(mocks.bumpScheduleConfigVersion).not.toHaveBeenCalled()
      expect(mocks.deleteLocationFromIndex).not.toHaveBeenCalled()
    })

    it('returns 409 when DELETE hits a textual foreign-key error', async () => {
      mocks.professionalLocation.deleteMany.mockRejectedValueOnce(
        new Error('violates foreign key constraint'),
      )

      const result = await DELETE(makeDeleteRequest(), makeCtx())

      const body = await readJson<{
        ok: false
        error: string
      }>(result)

      expect(result.status).toBe(409)
      expect(body).toEqual({
        ok: false,
        error:
          'This location is used by existing bookings and cannot be deleted.',
      })
    })

    it('returns 500 when DELETE throws unexpectedly', async () => {
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined)

      mocks.professionalLocation.deleteMany.mockRejectedValueOnce(
        new Error('delete exploded'),
      )

      const result = await DELETE(makeDeleteRequest(), makeCtx())

      const body = await readJson<{
        ok: false
        error: string
      }>(result)

      expect(result.status).toBe(500)
      expect(body).toEqual({
        ok: false,
        error: 'delete exploded',
      })

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'DELETE /api/pro/locations/[id] error',
        expect.any(Error),
      )

      consoleErrorSpy.mockRestore()
    })
  })
})