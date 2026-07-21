// app/api/v1/pro/offerings/[id]/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
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
  const refreshProfessional = vi.fn()
  const buildAddressPrivacyWriteData = vi.fn()

  const professionalLocation = {
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
  }

  const professionalServiceOffering = {
    findFirst: vi.fn(),
    update: vi.fn(),
  }

  // Reviving an offering (isActive false -> true) drops its price ramps: a ramp
  // outranks the offering's own price at quote time, so one that outlived a
  // removal would keep charging the old import's price.
  const offeringPriceRamp = {
    deleteMany: vi.fn(),
  }

  const prisma = {
    professionalLocation,
    professionalServiceOffering,
    offeringPriceRamp,
    $transaction: vi.fn(),
  }

  return {
    jsonOk,
    jsonFail,
    requirePro,
    enforceRateLimit,
    rateLimitIdentity,
    refreshProfessional,
    buildAddressPrivacyWriteData,
    professionalLocation,
    professionalServiceOffering,
    offeringPriceRamp,
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

vi.mock('@/lib/search/index/refreshSearchIndex', () => ({
  refreshProfessional: mocks.refreshProfessional,
}))

vi.mock('@/lib/security/addressEncryption', () => ({
  buildAddressPrivacyWriteData: mocks.buildAddressPrivacyWriteData,
}))

vi.mock('@/lib/money', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/money')>('@/lib/money')

  return actual
})

import { DELETE, GET, PATCH } from './route'

type RouteCtx = {
  params: Promise<{ id: string }>
}

const addressPrivacyWriteData = {
  encryptedAddressJson: {
    v: 1,
    algorithm: 'plaintext-json-expand-phase',
    keyVersion: 'address-json-v1',
    address: {},
  },
  addressKeyVersion: 'address-json-v1',
  postalCodePrefix: null,
  latApprox: null,
  lngApprox: null,
}

const ADDRESS_PRIVACY_WRITE_KEYS = [
  'encryptedAddressJson',
  'addressKeyVersion',
  'postalCodePrefix',
  'latApprox',
  'lngApprox',
] as const

function expectOnlyEmptyAddressPrivacyWriteData(data: Record<string, unknown>) {
  for (const key of ADDRESS_PRIVACY_WRITE_KEYS) {
    expect(data[key]).toEqual(
      addressPrivacyWriteData[key as keyof typeof addressPrivacyWriteData],
    )
  }
}

function makeCtx(id = 'offering_1'): RouteCtx {
  return {
    params: Promise.resolve({ id }),
  }
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/pro/offerings/offering_1', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

function makeDeleteRequest(): Request {
  return new Request('http://localhost/api/v1/pro/offerings/offering_1', {
    method: 'DELETE',
  })
}

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

function makeService(overrides?: {
  isActive?: boolean
  categoryActive?: boolean
  minPrice?: string
}) {
  return {
    id: 'service_1',
    isActive: overrides?.isActive ?? true,
    minPrice: new Prisma.Decimal(overrides?.minPrice ?? '50.00'),
    isAddOnEligible: false,
    addOnGroup: null,
    defaultImageUrl: 'https://example.com/service.jpg',
    name: 'Haircut',
    category: {
      isActive: overrides?.categoryActive ?? true,
      name: 'Hair',
    },
  }
}

function makeOffering(
  overrides: Partial<{
    id: string
    professionalId: string
    serviceId: string
    description: string | null
    customImageUrl: string | null
    offersInSalon: boolean
    offersMobile: boolean
    salonPriceStartingAt: Prisma.Decimal | null
    salonDurationMinutes: number | null
    mobilePriceStartingAt: Prisma.Decimal | null
    mobileDurationMinutes: number | null
    isActive: boolean
    serviceActive: boolean
    categoryActive: boolean
    minPrice: string
  }> = {},
) {
  return {
    id: overrides.id ?? 'offering_1',
    professionalId: overrides.professionalId ?? 'pro_123',
    serviceId: overrides.serviceId ?? 'service_1',
    title: null,
    description:
      overrides.description !== undefined ? overrides.description : 'Fresh cut',
    customImageUrl:
      overrides.customImageUrl !== undefined ? overrides.customImageUrl : null,
    offersInSalon: overrides.offersInSalon ?? true,
    offersMobile: overrides.offersMobile ?? false,
    salonPriceStartingAt:
      overrides.salonPriceStartingAt !== undefined
        ? overrides.salonPriceStartingAt
        : new Prisma.Decimal('75.00'),
    salonDurationMinutes:
      overrides.salonDurationMinutes !== undefined
        ? overrides.salonDurationMinutes
        : 60,
    mobilePriceStartingAt:
      overrides.mobilePriceStartingAt !== undefined
        ? overrides.mobilePriceStartingAt
        : null,
    mobileDurationMinutes:
      overrides.mobileDurationMinutes !== undefined
        ? overrides.mobileDurationMinutes
        : null,
    isActive: overrides.isActive ?? true,
    createdAt: new Date('2026-05-22T12:00:00.000Z'),
    updatedAt: new Date('2026-05-22T12:00:00.000Z'),
    service: makeService({
      isActive: overrides.serviceActive,
      categoryActive: overrides.categoryActive,
      minPrice: overrides.minPrice,
    }),
  }
}

describe('app/api/v1/pro/offerings/[id]/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requirePro.mockResolvedValue({
      ok: true,
      userId: 'user_123',
      professionalId: 'pro_123',
    })

    mocks.rateLimitIdentity.mockResolvedValue('user_123')
    mocks.enforceRateLimit.mockResolvedValue(null)
    mocks.refreshProfessional.mockResolvedValue(undefined)

    mocks.buildAddressPrivacyWriteData.mockReturnValue(addressPrivacyWriteData)

    mocks.professionalLocation.findMany.mockResolvedValue([])
    mocks.professionalLocation.count.mockResolvedValue(0)
    mocks.professionalLocation.create.mockResolvedValue({ id: 'loc_1' })
    mocks.offeringPriceRamp.deleteMany.mockResolvedValue({ count: 0 })

    mocks.professionalServiceOffering.findFirst.mockResolvedValue(makeOffering())
    mocks.professionalServiceOffering.update.mockResolvedValue(makeOffering())

    const tx = {
      professionalLocation: mocks.professionalLocation,
      professionalServiceOffering: mocks.professionalServiceOffering,
      offeringPriceRamp: mocks.offeringPriceRamp,
    }

    mocks.prisma.$transaction.mockImplementation(
      async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx),
    )
  })

  describe('GET', () => {
    it('passes through failed pro auth unchanged', async () => {
      const authRes = new Response(null, { status: 401 })

      mocks.requirePro.mockResolvedValueOnce({
        ok: false,
        res: authRes,
      })

      const result = await GET(new Request('http://localhost'), makeCtx())

      expect(result).toBe(authRes)
      expect(mocks.professionalServiceOffering.findFirst).not.toHaveBeenCalled()
    })

    it('returns 400 when offering id is missing', async () => {
      const result = await GET(new Request('http://localhost'), makeCtx('   '))
      const body = await readJson<{ ok: false; error: string }>(result)

      expect(result.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error: 'Missing offering id.',
      })

      expect(mocks.professionalServiceOffering.findFirst).not.toHaveBeenCalled()
    })

    it('returns 404 when offering is not found', async () => {
      mocks.professionalServiceOffering.findFirst.mockResolvedValueOnce(null)

      const result = await GET(new Request('http://localhost'), makeCtx())
      const body = await readJson<{ ok: false; error: string }>(result)

      expect(result.status).toBe(404)
      expect(body).toEqual({
        ok: false,
        error: 'Not found.',
      })
    })

    it('returns the active offering for the authenticated pro', async () => {
      mocks.professionalServiceOffering.findFirst.mockResolvedValueOnce(
        makeOffering({
          id: 'offering_1',
          offersInSalon: true,
          offersMobile: false,
          salonPriceStartingAt: new Prisma.Decimal('75.00'),
          salonDurationMinutes: 60,
        }),
      )

      const result = await GET(new Request('http://localhost'), makeCtx())

      const body = await readJson<{
        ok: true
        offering: {
          id: string
          serviceId: string
          serviceName: string
          salonPriceStartingAt: string | null
        }
      }>(result)

      expect(result.status).toBe(200)

      expect(mocks.professionalServiceOffering.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'offering_1',
          professionalId: 'pro_123',
          isActive: true,
        },
        include: {
          service: {
            include: {
              category: true,
            },
          },
        },
      })

      expect(body.offering).toEqual(
        expect.objectContaining({
          id: 'offering_1',
          serviceId: 'service_1',
          serviceName: 'Haircut',
          salonPriceStartingAt: '75',
        }),
      )
    })
  })

  describe('PATCH', () => {
    it('passes through failed pro auth unchanged', async () => {
      const authRes = new Response(null, { status: 401 })

      mocks.requirePro.mockResolvedValueOnce({
        ok: false,
        res: authRes,
      })

      const result = await PATCH(
        makeRequest({ description: 'Updated' }),
        makeCtx(),
      )

      expect(result).toBe(authRes)
      expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
      expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    })

    it('passes through rate limit response unchanged', async () => {
      const limitedRes = new Response('rate limited', { status: 429 })

      mocks.enforceRateLimit.mockResolvedValueOnce(limitedRes)

      const result = await PATCH(
        makeRequest({ description: 'Updated' }),
        makeCtx(),
      )

      expect(result).toBe(limitedRes)
      expect(mocks.rateLimitIdentity).toHaveBeenCalledWith('user_123')
      expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
        bucket: 'pro:offerings:write',
        identity: 'user_123',
      })
      expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    })

    it('returns 400 when offering id is missing', async () => {
      const result = await PATCH(
        makeRequest({ description: 'Updated' }),
        makeCtx('   '),
      )

      const body = await readJson<{ ok: false; error: string }>(result)

      expect(result.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error: 'Missing offering id.',
      })

      expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    })

    it('returns 400 for invalid JSON body shape', async () => {
      const result = await PATCH(makeRequest(['nope']), makeCtx())
      const body = await readJson<{ ok: false; error: string }>(result)

      expect(result.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error: 'Invalid JSON body.',
      })

      expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    })

    it('returns 404 when offering is not found inside the transaction', async () => {
      mocks.professionalServiceOffering.findFirst.mockResolvedValueOnce(null)

      const result = await PATCH(
        makeRequest({ description: 'Updated' }),
        makeCtx(),
      )

      const body = await readJson<{ ok: false; error: string }>(result)

      expect(result.status).toBe(404)
      expect(body).toEqual({
        ok: false,
        error: 'Not found.',
      })

      expect(mocks.refreshProfessional).not.toHaveBeenCalled()
    })

    it('returns 400 when offersInSalon is not boolean', async () => {
      const result = await PATCH(
        makeRequest({
          offersInSalon: 'yes',
        }),
        makeCtx(),
      )

      const body = await readJson<{ ok: false; error: string }>(result)

      expect(result.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error: 'offersInSalon must be boolean.',
      })

      expect(mocks.professionalServiceOffering.update).not.toHaveBeenCalled()
    })

    it('returns 400 when offersMobile is not boolean', async () => {
      const result = await PATCH(
        makeRequest({
          offersMobile: 'yes',
        }),
        makeCtx(),
      )

      const body = await readJson<{ ok: false; error: string }>(result)

      expect(result.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error: 'offersMobile must be boolean.',
      })

      expect(mocks.professionalServiceOffering.update).not.toHaveBeenCalled()
    })

    it('returns 400 when both salon and mobile would be disabled', async () => {
      mocks.professionalServiceOffering.findFirst.mockResolvedValueOnce(
        makeOffering({
          offersInSalon: true,
          offersMobile: false,
        }),
      )

      const result = await PATCH(
        makeRequest({
          offersInSalon: false,
          offersMobile: false,
        }),
        makeCtx(),
      )

      const body = await readJson<{ ok: false; error: string }>(result)

      expect(result.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error: 'Enable at least Salon or Mobile.',
      })

      expect(mocks.professionalServiceOffering.update).not.toHaveBeenCalled()
    })

    it('returns 400 when service is inactive unless disabling the offering', async () => {
      mocks.professionalServiceOffering.findFirst.mockResolvedValueOnce(
        makeOffering({
          serviceActive: false,
        }),
      )

      const result = await PATCH(
        makeRequest({
          description: 'Updated',
        }),
        makeCtx(),
      )

      const body = await readJson<{ ok: false; error: string }>(result)

      expect(result.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error: 'This service is currently unavailable.',
      })

      expect(mocks.professionalServiceOffering.update).not.toHaveBeenCalled()
    })

    // PATCH is a second way back on, and it never goes through writeOffering.
    // A ramp OUTRANKS the offering's own price at quote time, so one that
    // outlived the removal would keep charging the price from the import that
    // created it. Any revive clears them, matching the add flow.
    it('clears price ramps when PATCH revives a removed offering', async () => {
      mocks.professionalServiceOffering.findFirst.mockResolvedValueOnce(
        makeOffering({ isActive: false }),
      )
      mocks.professionalServiceOffering.update.mockResolvedValueOnce(
        makeOffering({ isActive: true }),
      )

      const result = await PATCH(makeRequest({ isActive: true }), makeCtx())

      expect(result.status).toBe(200)
      expect(mocks.offeringPriceRamp.deleteMany).toHaveBeenCalledWith({
        where: { offeringId: 'offering_1' },
      })
    })

    it('leaves price ramps alone when PATCH edits an already-live offering', async () => {
      mocks.professionalServiceOffering.findFirst.mockResolvedValueOnce(
        makeOffering({ isActive: true }),
      )
      mocks.professionalServiceOffering.update.mockResolvedValueOnce(
        makeOffering({ isActive: true }),
      )

      const result = await PATCH(
        makeRequest({ isActive: true, description: 'Updated' }),
        makeCtx(),
      )

      expect(result.status).toBe(200)
      expect(mocks.offeringPriceRamp.deleteMany).not.toHaveBeenCalled()
    })

    it('leaves price ramps alone when PATCH disables an offering', async () => {
      mocks.professionalServiceOffering.findFirst.mockResolvedValueOnce(
        makeOffering({ isActive: true }),
      )
      mocks.professionalServiceOffering.update.mockResolvedValueOnce(
        makeOffering({ isActive: false }),
      )

      const result = await PATCH(makeRequest({ isActive: false }), makeCtx())

      expect(result.status).toBe(200)
      expect(mocks.offeringPriceRamp.deleteMany).not.toHaveBeenCalled()
    })

    it('allows disabling an offering even when the service is inactive', async () => {
      mocks.professionalServiceOffering.findFirst.mockResolvedValueOnce(
        makeOffering({
          serviceActive: false,
        }),
      )

      mocks.professionalServiceOffering.update.mockResolvedValueOnce(
        makeOffering({
          serviceActive: false,
          isActive: false,
        }),
      )

      const result = await PATCH(
        makeRequest({
          isActive: false,
        }),
        makeCtx(),
      )

      expect(result.status).toBe(200)

      expect(mocks.professionalServiceOffering.update).toHaveBeenCalledWith({
        where: { id: 'offering_1' },
        data: { isActive: false },
        include: {
          service: {
            include: {
              category: true,
            },
          },
        },
      })

      expect(mocks.refreshProfessional).toHaveBeenCalledWith(
        'pro_123',
        'offering.update',
      )
    })

    it('updates the rebook interval with a positive whole number of days', async () => {
      const result = await PATCH(
        makeRequest({ rebookIntervalDays: 42 }),
        makeCtx(),
      )

      expect(result.status).toBe(200)
      expect(mocks.professionalServiceOffering.update).toHaveBeenCalledWith({
        where: { id: 'offering_1' },
        data: { rebookIntervalDays: 42 },
        include: {
          service: {
            include: {
              category: true,
            },
          },
        },
      })
    })

    it('clears the rebook interval when passed null', async () => {
      const result = await PATCH(
        makeRequest({ rebookIntervalDays: null }),
        makeCtx(),
      )

      expect(result.status).toBe(200)
      expect(mocks.professionalServiceOffering.update).toHaveBeenCalledWith({
        where: { id: 'offering_1' },
        data: { rebookIntervalDays: null },
        include: {
          service: {
            include: {
              category: true,
            },
          },
        },
      })
    })

    it('returns 400 when rebook interval is zero, negative, or fractional', async () => {
      for (const bad of [0, -7, 30.5]) {
        const result = await PATCH(
          makeRequest({ rebookIntervalDays: bad }),
          makeCtx(),
        )

        const body = await readJson<{ ok: false; error: string }>(result)
        expect(result.status).toBe(400)
        expect(body).toEqual({
          ok: false,
          error:
            'rebookIntervalDays must be a positive whole number of days or null.',
        })
      }

      expect(mocks.professionalServiceOffering.update).not.toHaveBeenCalled()
    })

    it('returns 400 when description is not string or null', async () => {
      const result = await PATCH(
        makeRequest({
          description: 123,
        }),
        makeCtx(),
      )

      const body = await readJson<{ ok: false; error: string }>(result)

      expect(result.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error: 'description must be string or null.',
      })

      expect(mocks.professionalServiceOffering.update).not.toHaveBeenCalled()
    })

    it('returns 400 when customImageUrl is not string or null', async () => {
      const result = await PATCH(
        makeRequest({
          customImageUrl: 123,
        }),
        makeCtx(),
      )

      const body = await readJson<{ ok: false; error: string }>(result)

      expect(result.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error: 'customImageUrl must be string or null.',
      })

      expect(mocks.professionalServiceOffering.update).not.toHaveBeenCalled()
    })

    it('returns 400 when enabled salon receives null duration', async () => {
      mocks.professionalServiceOffering.findFirst.mockResolvedValueOnce(
        makeOffering({
          offersInSalon: true,
          salonDurationMinutes: 60,
          salonPriceStartingAt: new Prisma.Decimal('75.00'),
        }),
      )

      const result = await PATCH(
        makeRequest({
          salonDurationMinutes: null,
        }),
        makeCtx(),
      )

      const body = await readJson<{ ok: false; error: string }>(result)

      expect(result.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error: 'salonDurationMinutes cannot be null when Salon is enabled.',
      })

      expect(mocks.professionalServiceOffering.update).not.toHaveBeenCalled()
    })

    it('returns 400 when salon price is below service minimum', async () => {
      mocks.professionalServiceOffering.findFirst.mockResolvedValueOnce(
        makeOffering({
          offersInSalon: true,
          minPrice: '50.00',
        }),
      )

      const result = await PATCH(
        makeRequest({
          salonPriceStartingAt: '25.00',
        }),
        makeCtx(),
      )

      const body = await readJson<{
        ok: false
        error: string
        minPrice: string
      }>(result)

      expect(result.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error: 'Salon price must be at least $50',
        minPrice: '50',
      })

      expect(mocks.professionalServiceOffering.update).not.toHaveBeenCalled()
    })

    it('returns 400 when enabling mobile without mobile duration', async () => {
      mocks.professionalServiceOffering.findFirst.mockResolvedValueOnce(
        makeOffering({
          offersInSalon: true,
          offersMobile: false,
          mobileDurationMinutes: null,
          mobilePriceStartingAt: null,
        }),
      )

      const result = await PATCH(
        makeRequest({
          offersMobile: true,
          mobilePriceStartingAt: '100.00',
        }),
        makeCtx(),
      )

      const body = await readJson<{ ok: false; error: string }>(result)

      expect(result.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error: 'Mobile is enabled but mobileDurationMinutes is missing/invalid.',
      })

      expect(mocks.professionalServiceOffering.update).not.toHaveBeenCalled()
    })

    it('creates salon placeholder with empty address privacy fields when enabling salon', async () => {
      mocks.professionalServiceOffering.findFirst.mockResolvedValueOnce(
        makeOffering({
          offersInSalon: false,
          offersMobile: true,
          salonPriceStartingAt: null,
          salonDurationMinutes: null,
          mobilePriceStartingAt: new Prisma.Decimal('100.00'),
          mobileDurationMinutes: 75,
        }),
      )

      mocks.professionalServiceOffering.update.mockResolvedValueOnce(
        makeOffering({
          offersInSalon: true,
          offersMobile: true,
          salonPriceStartingAt: new Prisma.Decimal('75.00'),
          salonDurationMinutes: 60,
          mobilePriceStartingAt: new Prisma.Decimal('100.00'),
          mobileDurationMinutes: 75,
        }),
      )

      const result = await PATCH(
        makeRequest({
          offersInSalon: true,
          salonPriceStartingAt: '75',
          salonDurationMinutes: 60,
        }),
        makeCtx(),
      )

      expect(result.status).toBe(200)

      expect(mocks.buildAddressPrivacyWriteData).toHaveBeenCalledWith({
        formattedAddress: null,
        addressLine1: null,
        addressLine2: null,
        city: null,
        state: null,
        postalCode: null,
        countryCode: null,
        placeId: null,
        lat: null,
        lng: null,
      })

      expect(mocks.professionalLocation.create).toHaveBeenCalledWith({
        data: {
          professionalId: 'pro_123',
          type: ProfessionalLocationType.SALON,
          name: 'Set salon address',
          isPrimary: true,
          isBookable: false,
          timeZone: null,
          workingHours: expect.objectContaining({
            mon: {
              enabled: true,
              start: '09:00',
              end: '17:00',
            },
          }),
          ...addressPrivacyWriteData,
        },
        select: { id: true },
      })

      const createCall = mocks.professionalLocation.create.mock.calls[0]?.[0]
      expect(createCall).toBeDefined()
      expect(createCall.data).toMatchObject({
        isBookable: false,
        timeZone: null,
      })
      expectOnlyEmptyAddressPrivacyWriteData(createCall.data)

      expect(mocks.professionalServiceOffering.update).toHaveBeenCalledWith({
        where: { id: 'offering_1' },
        data: {
          offersInSalon: true,
          salonDurationMinutes: 60,
          salonPriceStartingAt: expect.any(Prisma.Decimal),
        },
        include: {
          service: {
            include: {
              category: true,
            },
          },
        },
      })

      expect(mocks.refreshProfessional).toHaveBeenCalledWith(
        'pro_123',
        'offering.update',
      )
    })

    it('creates mobile placeholder with empty address privacy fields when enabling mobile', async () => {
      mocks.professionalServiceOffering.findFirst.mockResolvedValueOnce(
        makeOffering({
          offersInSalon: true,
          offersMobile: false,
          salonPriceStartingAt: new Prisma.Decimal('75.00'),
          salonDurationMinutes: 60,
          mobilePriceStartingAt: null,
          mobileDurationMinutes: null,
        }),
      )

      mocks.professionalServiceOffering.update.mockResolvedValueOnce(
        makeOffering({
          offersInSalon: true,
          offersMobile: true,
          salonPriceStartingAt: new Prisma.Decimal('75.00'),
          salonDurationMinutes: 60,
          mobilePriceStartingAt: new Prisma.Decimal('100.00'),
          mobileDurationMinutes: 75,
        }),
      )

      const result = await PATCH(
        makeRequest({
          offersMobile: true,
          mobilePriceStartingAt: '100.00',
          mobileDurationMinutes: 75,
        }),
        makeCtx(),
      )

      expect(result.status).toBe(200)

      expect(mocks.buildAddressPrivacyWriteData).toHaveBeenCalledWith({
        formattedAddress: null,
        addressLine1: null,
        addressLine2: null,
        city: null,
        state: null,
        postalCode: null,
        countryCode: null,
        placeId: null,
        lat: null,
        lng: null,
      })

      expect(mocks.professionalLocation.create).toHaveBeenCalledWith({
        data: {
          professionalId: 'pro_123',
          type: ProfessionalLocationType.MOBILE_BASE,
          name: 'Set mobile base',
          isPrimary: true,
          isBookable: false,
          timeZone: null,
          workingHours: expect.objectContaining({
            mon: {
              enabled: true,
              start: '09:00',
              end: '17:00',
            },
          }),
          ...addressPrivacyWriteData,
        },
        select: { id: true },
      })

      const createCall = mocks.professionalLocation.create.mock.calls[0]?.[0]
      expect(createCall).toBeDefined()
      expect(createCall.data).toMatchObject({
        isBookable: false,
        timeZone: null,
      })
      expectOnlyEmptyAddressPrivacyWriteData(createCall.data)

      expect(mocks.professionalServiceOffering.update).toHaveBeenCalledWith({
        where: { id: 'offering_1' },
        data: {
          offersMobile: true,
          mobileDurationMinutes: 75,
          mobilePriceStartingAt: expect.any(Prisma.Decimal),
        },
        include: {
          service: {
            include: {
              category: true,
            },
          },
        },
      })

      expect(mocks.refreshProfessional).toHaveBeenCalledWith(
        'pro_123',
        'offering.update',
      )
    })

    it('does not create placeholder locations when compatible locations already exist', async () => {
      mocks.professionalServiceOffering.findFirst.mockResolvedValueOnce(
        makeOffering({
          offersInSalon: false,
          offersMobile: false,
          salonPriceStartingAt: null,
          salonDurationMinutes: null,
          mobilePriceStartingAt: null,
          mobileDurationMinutes: null,
        }),
      )

      mocks.professionalLocation.findMany.mockResolvedValueOnce([
        { type: ProfessionalLocationType.SUITE },
        { type: ProfessionalLocationType.MOBILE_BASE },
      ])

      mocks.professionalServiceOffering.update.mockResolvedValueOnce(
        makeOffering({
          offersInSalon: true,
          offersMobile: true,
          salonPriceStartingAt: new Prisma.Decimal('75.00'),
          salonDurationMinutes: 60,
          mobilePriceStartingAt: new Prisma.Decimal('100.00'),
          mobileDurationMinutes: 75,
        }),
      )

      const result = await PATCH(
        makeRequest({
          offersInSalon: true,
          salonPriceStartingAt: '75',
          salonDurationMinutes: 60,
          offersMobile: true,
          mobilePriceStartingAt: '100.00',
          mobileDurationMinutes: 75,
        }),
        makeCtx(),
      )

      expect(result.status).toBe(200)
      expect(mocks.professionalLocation.create).not.toHaveBeenCalled()
      expect(mocks.buildAddressPrivacyWriteData).not.toHaveBeenCalled()
      expect(mocks.professionalServiceOffering.update).toHaveBeenCalled()
    })

    it('updates editable offering fields and refreshes the professional search index', async () => {
      mocks.professionalServiceOffering.findFirst.mockResolvedValueOnce(
        makeOffering(),
      )

      mocks.professionalServiceOffering.update.mockResolvedValueOnce(
        makeOffering({
          description: 'Updated description',
          customImageUrl: 'https://example.com/custom.jpg',
          salonPriceStartingAt: new Prisma.Decimal('90.00'),
          salonDurationMinutes: 75,
        }),
      )

      const result = await PATCH(
        makeRequest({
          description: '  Updated description  ',
          customImageUrl: 'https://example.com/custom.jpg',
          salonPriceStartingAt: '90',
          salonDurationMinutes: 75,
        }),
        makeCtx(),
      )

      const body = await readJson<{
        ok: true
        offering: {
          description: string | null
          customImageUrl: string | null
          salonPriceStartingAt: string | null
          salonDurationMinutes: number | null
        }
      }>(result)

      expect(result.status).toBe(200)

      expect(mocks.professionalServiceOffering.update).toHaveBeenCalledWith({
        where: { id: 'offering_1' },
        data: {
          description: 'Updated description',
          customImageUrl: 'https://example.com/custom.jpg',
          salonDurationMinutes: 75,
          salonPriceStartingAt: expect.any(Prisma.Decimal),
        },
        include: {
          service: {
            include: {
              category: true,
            },
          },
        },
      })

      expect(mocks.refreshProfessional).toHaveBeenCalledWith(
        'pro_123',
        'offering.update',
      )

      expect(body.offering).toEqual(
        expect.objectContaining({
          description: 'Updated description',
          customImageUrl: 'https://example.com/custom.jpg',
          salonPriceStartingAt: '90',
          salonDurationMinutes: 75,
        }),
      )
    })

    it('returns existing offering when patch has no changes but still refreshes professional', async () => {
      mocks.professionalServiceOffering.findFirst.mockResolvedValueOnce(
        makeOffering(),
      )

      const result = await PATCH(makeRequest({}), makeCtx())

      expect(result.status).toBe(200)
      expect(mocks.professionalServiceOffering.update).not.toHaveBeenCalled()
      expect(mocks.refreshProfessional).toHaveBeenCalledWith(
        'pro_123',
        'offering.update',
      )
    })

    it('returns 500 when PATCH throws unexpectedly', async () => {
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined)

      mocks.prisma.$transaction.mockRejectedValueOnce(new Error('db exploded'))

      const result = await PATCH(
        makeRequest({ description: 'Updated' }),
        makeCtx(),
      )

      const body = await readJson<{ ok: false; error: string }>(result)

      expect(result.status).toBe(500)
      expect(body).toEqual({
        ok: false,
        error: 'Internal server error.',
      })

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'PATCH /api/v1/pro/offerings/[id] error',
        expect.any(Error),
      )

      consoleErrorSpy.mockRestore()
    })
  })

  describe('DELETE', () => {
    it('passes through failed pro auth unchanged', async () => {
      const authRes = new Response(null, { status: 401 })

      mocks.requirePro.mockResolvedValueOnce({
        ok: false,
        res: authRes,
      })

      const result = await DELETE(makeDeleteRequest(), makeCtx())

      expect(result).toBe(authRes)
      expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
      expect(mocks.professionalServiceOffering.findFirst).not.toHaveBeenCalled()
    })

    it('passes through rate limit response unchanged', async () => {
      const limitedRes = new Response('rate limited', { status: 429 })

      mocks.enforceRateLimit.mockResolvedValueOnce(limitedRes)

      const result = await DELETE(makeDeleteRequest(), makeCtx())

      expect(result).toBe(limitedRes)
      expect(mocks.professionalServiceOffering.findFirst).not.toHaveBeenCalled()
    })

    it('returns 400 when offering id is missing', async () => {
      const result = await DELETE(makeDeleteRequest(), makeCtx('   '))
      const body = await readJson<{ ok: false; error: string }>(result)

      expect(result.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error: 'Missing offering id.',
      })

      expect(mocks.professionalServiceOffering.findFirst).not.toHaveBeenCalled()
    })

    it('returns 404 when offering is not found', async () => {
      mocks.professionalServiceOffering.findFirst.mockResolvedValueOnce(null)

      const result = await DELETE(makeDeleteRequest(), makeCtx())
      const body = await readJson<{ ok: false; error: string }>(result)

      expect(result.status).toBe(404)
      expect(body).toEqual({
        ok: false,
        error: 'Not found.',
      })

      expect(mocks.professionalServiceOffering.update).not.toHaveBeenCalled()
      expect(mocks.refreshProfessional).not.toHaveBeenCalled()
    })

    it('soft deletes the offering and refreshes professional search index', async () => {
      mocks.professionalServiceOffering.findFirst.mockResolvedValueOnce({
        id: 'offering_1',
      })

      mocks.professionalServiceOffering.update.mockResolvedValueOnce({
        id: 'offering_1',
        isActive: false,
      })

      const result = await DELETE(makeDeleteRequest(), makeCtx())
      const body = await readJson<{ ok: true }>(result)

      expect(result.status).toBe(200)
      expect(body).toEqual({ ok: true })

      expect(mocks.professionalServiceOffering.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'offering_1',
          professionalId: 'pro_123',
        },
        select: { id: true },
      })

      expect(mocks.professionalServiceOffering.update).toHaveBeenCalledWith({
        where: { id: 'offering_1' },
        data: { isActive: false },
      })

      expect(mocks.refreshProfessional).toHaveBeenCalledWith(
        'pro_123',
        'offering.delete',
      )
    })

    it('returns 500 when DELETE throws unexpectedly', async () => {
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined)

      mocks.professionalServiceOffering.findFirst.mockRejectedValueOnce(
        new Error('db exploded'),
      )

      const result = await DELETE(makeDeleteRequest(), makeCtx())
      const body = await readJson<{ ok: false; error: string }>(result)

      expect(result.status).toBe(500)
      expect(body).toEqual({
        ok: false,
        error: 'Internal server error.',
      })

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'DELETE /api/v1/pro/offerings/[id] error',
        expect.any(Error),
      )

      consoleErrorSpy.mockRestore()
    })
  })
})