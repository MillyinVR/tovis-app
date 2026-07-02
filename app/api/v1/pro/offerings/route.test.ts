// app/api/v1/pro/offerings/route.test.ts

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

  const service = {
    findUnique: vi.fn(),
  }

  const professionalLocation = {
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
  }

  const professionalServiceOffering = {
    findMany: vi.fn(),
    create: vi.fn(),
  }

  const prisma = {
    service,
    professionalLocation,
    professionalServiceOffering,
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
    service,
    professionalLocation,
    professionalServiceOffering,
    prisma,
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
  pickBool: (value: unknown) => (typeof value === 'boolean' ? value : null),
  pickInt: (value: unknown) => (typeof value === 'number' ? value : null),
  pickString: (value: unknown) =>
    typeof value === 'string' && value.trim() ? value.trim() : null,
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

import { GET, POST } from './route'

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

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/pro/offerings', {
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

function makeService(overrides?: {
  id?: string
  isActive?: boolean
  categoryActive?: boolean
  minPrice?: string
}) {
  return {
    id: overrides?.id ?? 'service_1',
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

describe('app/api/v1/pro/offerings/route.ts', () => {
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

    mocks.service.findUnique.mockResolvedValue(makeService())

    mocks.professionalLocation.findMany.mockResolvedValue([])
    mocks.professionalLocation.count.mockResolvedValue(0)
    mocks.professionalLocation.create.mockResolvedValue({ id: 'loc_1' })

    mocks.professionalServiceOffering.findMany.mockResolvedValue([
      makeOffering(),
    ])
    mocks.professionalServiceOffering.create.mockResolvedValue(makeOffering())

    const tx = {
      professionalLocation: mocks.professionalLocation,
      professionalServiceOffering: mocks.professionalServiceOffering,
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

      const result = await GET()

      expect(result).toBe(authRes)
      expect(mocks.professionalServiceOffering.findMany).not.toHaveBeenCalled()
    })

    it('returns active offerings for the authenticated pro', async () => {
      mocks.professionalServiceOffering.findMany.mockResolvedValueOnce([
        makeOffering({
          id: 'offering_1',
          offersInSalon: true,
          offersMobile: false,
          salonPriceStartingAt: new Prisma.Decimal('75.00'),
          salonDurationMinutes: 60,
        }),
      ])

      const result = await GET()

      const body = await readJson<{
        ok: true
        offerings: Array<{
          id: string
          serviceId: string
          serviceName: string
          salonPriceStartingAt: string | null
        }>
      }>(result)

      expect(result.status).toBe(200)

      expect(mocks.professionalServiceOffering.findMany).toHaveBeenCalledWith({
        where: {
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
        orderBy: [{ createdAt: 'asc' }],
      })

      expect(body.offerings).toHaveLength(1)
      expect(body.offerings[0]).toEqual(
        expect.objectContaining({
          id: 'offering_1',
          serviceId: 'service_1',
          serviceName: 'Haircut',
          salonPriceStartingAt: '75',
        }),
      )
    })

    it('returns 500 when GET throws unexpectedly', async () => {
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined)

      mocks.professionalServiceOffering.findMany.mockRejectedValueOnce(
        new Error('db exploded'),
      )

      const result = await GET()

      const body = await readJson<{ ok: false; error: string }>(result)

      expect(result.status).toBe(500)
      expect(body).toEqual({
        ok: false,
        error: 'Internal server error',
      })

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'GET /api/v1/pro/offerings error',
        expect.any(Error),
      )

      consoleErrorSpy.mockRestore()
    })
  })

  describe('POST', () => {
    it('passes through failed pro auth unchanged', async () => {
      const authRes = new Response(null, { status: 401 })

      mocks.requirePro.mockResolvedValueOnce({
        ok: false,
        res: authRes,
      })

      const result = await POST(makeRequest({ serviceId: 'service_1' }))

      expect(result).toBe(authRes)
      expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
      expect(mocks.service.findUnique).not.toHaveBeenCalled()
      expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    })

    it('passes through rate limit response unchanged', async () => {
      const limitedRes = new Response('rate limited', { status: 429 })

      mocks.enforceRateLimit.mockResolvedValueOnce(limitedRes)

      const result = await POST(makeRequest({ serviceId: 'service_1' }))

      expect(result).toBe(limitedRes)
      expect(mocks.rateLimitIdentity).toHaveBeenCalledWith('user_123')
      expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
        bucket: 'pro:offerings:write',
        identity: 'user_123',
      })
      expect(mocks.service.findUnique).not.toHaveBeenCalled()
      expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    })

    it('returns 400 for invalid JSON body shape', async () => {
      const result = await POST(makeRequest(['nope']))

      const body = await readJson<{ ok: false; error: string }>(result)

      expect(result.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error: 'Invalid JSON body.',
      })

      expect(mocks.service.findUnique).not.toHaveBeenCalled()
      expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    })

    it('returns 400 when serviceId is missing', async () => {
      const result = await POST(
        makeRequest({
          salonPriceStartingAt: '75',
          salonDurationMinutes: 60,
        }),
      )

      const body = await readJson<{ ok: false; error: string }>(result)

      expect(result.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error: 'Missing serviceId.',
      })

      expect(mocks.service.findUnique).not.toHaveBeenCalled()
      expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    })

    it('returns 400 when description is not string or null', async () => {
      const result = await POST(
        makeRequest({
          serviceId: 'service_1',
          description: 123,
        }),
      )

      const body = await readJson<{ ok: false; error: string }>(result)

      expect(result.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error: 'description must be string or null.',
      })

      expect(mocks.service.findUnique).not.toHaveBeenCalled()
      expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    })

    it('returns 400 when customImageUrl is not string or null', async () => {
      const result = await POST(
        makeRequest({
          serviceId: 'service_1',
          customImageUrl: 123,
        }),
      )

      const body = await readJson<{ ok: false; error: string }>(result)

      expect(result.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error: 'customImageUrl must be string or null.',
      })

      expect(mocks.service.findUnique).not.toHaveBeenCalled()
      expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    })

    it('returns 400 when offersInSalon is not boolean', async () => {
      const result = await POST(
        makeRequest({
          serviceId: 'service_1',
          offersInSalon: 'yes',
        }),
      )

      const body = await readJson<{ ok: false; error: string }>(result)

      expect(result.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error: 'offersInSalon must be boolean.',
      })

      expect(mocks.service.findUnique).not.toHaveBeenCalled()
      expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    })

    it('returns 400 when offersMobile is not boolean', async () => {
      const result = await POST(
        makeRequest({
          serviceId: 'service_1',
          offersMobile: 'yes',
        }),
      )

      const body = await readJson<{ ok: false; error: string }>(result)

      expect(result.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error: 'offersMobile must be boolean.',
      })

      expect(mocks.service.findUnique).not.toHaveBeenCalled()
      expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    })

    it('returns 400 when both salon and mobile are disabled', async () => {
      const result = await POST(
        makeRequest({
          serviceId: 'service_1',
          offersInSalon: false,
          offersMobile: false,
        }),
      )

      const body = await readJson<{ ok: false; error: string }>(result)

      expect(result.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error: 'Enable at least Salon or Mobile.',
      })

      expect(mocks.service.findUnique).not.toHaveBeenCalled()
      expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    })

    it('returns 400 when service is unavailable', async () => {
      mocks.service.findUnique.mockResolvedValueOnce(
        makeService({
          isActive: false,
        }),
      )

      const result = await POST(
        makeRequest({
          serviceId: 'service_1',
          offersInSalon: true,
          salonPriceStartingAt: '75',
          salonDurationMinutes: 60,
        }),
      )

      const body = await readJson<{ ok: false; error: string }>(result)

      expect(result.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error: 'This service is currently unavailable.',
      })

      expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    })

    it('returns 400 when salon duration is invalid', async () => {
      const result = await POST(
        makeRequest({
          serviceId: 'service_1',
          offersInSalon: true,
          salonPriceStartingAt: '75',
          salonDurationMinutes: 0,
        }),
      )

      const body = await readJson<{ ok: false; error: string }>(result)

      expect(result.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error: 'Invalid salonDurationMinutes.',
      })

      expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    })

    it('returns 400 when mobile duration is invalid', async () => {
      const result = await POST(
        makeRequest({
          serviceId: 'service_1',
          offersInSalon: false,
          offersMobile: true,
          mobilePriceStartingAt: '100',
          mobileDurationMinutes: null,
        }),
      )

      const body = await readJson<{ ok: false; error: string }>(result)

      expect(result.status).toBe(400)
      expect(body).toEqual({
        ok: false,
        error: 'Invalid mobileDurationMinutes.',
      })

      expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    })

    it('returns 400 when salon price is below service minimum', async () => {
      mocks.service.findUnique.mockResolvedValueOnce(
        makeService({
          minPrice: '50.00',
        }),
      )

      const result = await POST(
        makeRequest({
          serviceId: 'service_1',
          offersInSalon: true,
          salonPriceStartingAt: '25.00',
          salonDurationMinutes: 60,
        }),
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

      expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    })

    it('creates a salon offering and salon placeholder with empty address privacy fields', async () => {
      mocks.professionalServiceOffering.create.mockResolvedValueOnce(
        makeOffering({
          offersInSalon: true,
          offersMobile: false,
          salonPriceStartingAt: new Prisma.Decimal('75.00'),
          salonDurationMinutes: 60,
        }),
      )

      const result = await POST(
        makeRequest({
          serviceId: 'service_1',
          description: '  Fresh cut  ',
          customImageUrl: null,
          offersInSalon: true,
          offersMobile: false,
          salonPriceStartingAt: '75',
          salonDurationMinutes: 60,
        }),
      )

      const body = await readJson<{
        ok: true
        offering: {
          id: string
          description: string | null
          offersInSalon: boolean
          offersMobile: boolean
          salonPriceStartingAt: string | null
          salonDurationMinutes: number | null
        }
      }>(result)

      expect(result.status).toBe(201)

      expect(mocks.service.findUnique).toHaveBeenCalledWith({
        where: { id: 'service_1' },
        select: {
          id: true,
          isActive: true,
          minPrice: true,
          isAddOnEligible: true,
          addOnGroup: true,
          defaultImageUrl: true,
          name: true,
          category: {
            select: {
              isActive: true,
              name: true,
            },
          },
        },
      })

      expect(mocks.professionalLocation.findMany).toHaveBeenCalledWith({
        where: {
          professionalId: 'pro_123',
          type: {
            in: [
              ProfessionalLocationType.SALON,
              ProfessionalLocationType.SUITE,
            ],
          },
          archivedAt: null,
        },
        select: { type: true },
        take: 50,
      })

      expect(mocks.professionalLocation.count).toHaveBeenCalledWith({
        where: { professionalId: 'pro_123', archivedAt: null },
      })

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

      const createLocationCall = mocks.professionalLocation.create.mock
        .calls[0]?.[0]

      expect(createLocationCall).toBeDefined()
      expectOnlyEmptyAddressPrivacyWriteData(createLocationCall.data)

      expect(mocks.professionalServiceOffering.create).toHaveBeenCalledWith({
        data: {
          professionalId: 'pro_123',
          serviceId: 'service_1',
          title: null,
          description: 'Fresh cut',
          customImageUrl: null,
          offersInSalon: true,
          offersMobile: false,
          salonPriceStartingAt: expect.any(Prisma.Decimal),
          salonDurationMinutes: 60,
          mobilePriceStartingAt: null,
          mobileDurationMinutes: null,
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
        'offering.create',
      )

      expect(body.offering).toEqual(
        expect.objectContaining({
          id: 'offering_1',
          description: 'Fresh cut',
          offersInSalon: true,
          offersMobile: false,
          salonPriceStartingAt: '75',
          salonDurationMinutes: 60,
        }),
      )
    })

    it('creates a mobile offering and mobile placeholder with empty address privacy fields', async () => {
      mocks.professionalServiceOffering.create.mockResolvedValueOnce(
        makeOffering({
          offersInSalon: false,
          offersMobile: true,
          salonPriceStartingAt: null,
          salonDurationMinutes: null,
          mobilePriceStartingAt: new Prisma.Decimal('100.00'),
          mobileDurationMinutes: 75,
        }),
      )

      const result = await POST(
        makeRequest({
          serviceId: 'service_1',
          offersInSalon: false,
          offersMobile: true,
          mobilePriceStartingAt: '100',
          mobileDurationMinutes: 75,
        }),
      )

      expect(result.status).toBe(201)

      expect(mocks.professionalLocation.findMany).toHaveBeenCalledWith({
        where: {
          professionalId: 'pro_123',
          type: {
            in: [ProfessionalLocationType.MOBILE_BASE],
          },
          archivedAt: null,
        },
        select: { type: true },
        take: 50,
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

      const createLocationCall = mocks.professionalLocation.create.mock
        .calls[0]?.[0]

      expect(createLocationCall).toBeDefined()
      expectOnlyEmptyAddressPrivacyWriteData(createLocationCall.data)

      expect(mocks.professionalServiceOffering.create).toHaveBeenCalledWith({
        data: {
          professionalId: 'pro_123',
          serviceId: 'service_1',
          title: null,
          description: null,
          customImageUrl: null,
          offersInSalon: false,
          offersMobile: true,
          salonPriceStartingAt: null,
          salonDurationMinutes: null,
          mobilePriceStartingAt: expect.any(Prisma.Decimal),
          mobileDurationMinutes: 75,
        },
        include: {
          service: {
            include: {
              category: true,
            },
          },
        },
      })
    })

    it('creates both salon and mobile placeholders when both modes are enabled and none exist', async () => {
      mocks.professionalServiceOffering.create.mockResolvedValueOnce(
        makeOffering({
          offersInSalon: true,
          offersMobile: true,
          salonPriceStartingAt: new Prisma.Decimal('75.00'),
          salonDurationMinutes: 60,
          mobilePriceStartingAt: new Prisma.Decimal('100.00'),
          mobileDurationMinutes: 75,
        }),
      )

      const result = await POST(
        makeRequest({
          serviceId: 'service_1',
          offersInSalon: true,
          offersMobile: true,
          salonPriceStartingAt: '75',
          salonDurationMinutes: 60,
          mobilePriceStartingAt: '100',
          mobileDurationMinutes: 75,
        }),
      )

      expect(result.status).toBe(201)

      expect(mocks.professionalLocation.create).toHaveBeenCalledTimes(2)

      expect(mocks.professionalLocation.create).toHaveBeenNthCalledWith(1, {
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

      expect(mocks.professionalLocation.create).toHaveBeenNthCalledWith(2, {
        data: {
          professionalId: 'pro_123',
          type: ProfessionalLocationType.MOBILE_BASE,
          name: 'Set mobile base',
          isPrimary: false,
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

      const firstCreateCall = mocks.professionalLocation.create.mock.calls[0]?.[0]
      const secondCreateCall = mocks.professionalLocation.create.mock.calls[1]?.[0]

      expect(firstCreateCall).toBeDefined()
      expect(secondCreateCall).toBeDefined()

      expectOnlyEmptyAddressPrivacyWriteData(firstCreateCall.data)
      expectOnlyEmptyAddressPrivacyWriteData(secondCreateCall.data)
    })

    it('does not create placeholder locations when compatible locations already exist', async () => {
      mocks.professionalLocation.findMany.mockResolvedValueOnce([
        { type: ProfessionalLocationType.SUITE },
        { type: ProfessionalLocationType.MOBILE_BASE },
      ])

      mocks.professionalServiceOffering.create.mockResolvedValueOnce(
        makeOffering({
          offersInSalon: true,
          offersMobile: true,
          salonPriceStartingAt: new Prisma.Decimal('75.00'),
          salonDurationMinutes: 60,
          mobilePriceStartingAt: new Prisma.Decimal('100.00'),
          mobileDurationMinutes: 75,
        }),
      )

      const result = await POST(
        makeRequest({
          serviceId: 'service_1',
          offersInSalon: true,
          offersMobile: true,
          salonPriceStartingAt: '75',
          salonDurationMinutes: 60,
          mobilePriceStartingAt: '100',
          mobileDurationMinutes: 75,
        }),
      )

      expect(result.status).toBe(201)

      expect(mocks.professionalLocation.create).not.toHaveBeenCalled()
      expect(mocks.buildAddressPrivacyWriteData).not.toHaveBeenCalled()
      expect(mocks.professionalServiceOffering.create).toHaveBeenCalled()
    })

    it('returns 409 when creating a duplicate offering', async () => {
      const duplicateError = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        {
          code: 'P2002',
          clientVersion: 'test',
        },
      )

      mocks.prisma.$transaction.mockRejectedValueOnce(duplicateError)

      const result = await POST(
        makeRequest({
          serviceId: 'service_1',
          offersInSalon: true,
          salonPriceStartingAt: '75',
          salonDurationMinutes: 60,
        }),
      )

      const body = await readJson<{ ok: false; error: string }>(result)

      expect(result.status).toBe(409)
      expect(body).toEqual({
        ok: false,
        error: 'You already added this service to your menu.',
      })

      expect(mocks.refreshProfessional).not.toHaveBeenCalled()
    })

    it('returns 500 when POST throws unexpectedly', async () => {
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined)

      mocks.prisma.$transaction.mockRejectedValueOnce(new Error('db exploded'))

      const result = await POST(
        makeRequest({
          serviceId: 'service_1',
          offersInSalon: true,
          salonPriceStartingAt: '75',
          salonDurationMinutes: 60,
        }),
      )

      const body = await readJson<{ ok: false; error: string }>(result)

      expect(result.status).toBe(500)
      expect(body).toEqual({
        ok: false,
        error: 'Internal server error',
      })

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'POST /api/v1/pro/offerings error',
        expect.any(Error),
      )

      expect(mocks.refreshProfessional).not.toHaveBeenCalled()

      consoleErrorSpy.mockRestore()
    })
  })
})