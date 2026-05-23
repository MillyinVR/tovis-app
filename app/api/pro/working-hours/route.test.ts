// app/api/pro/working-hours/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProfessionalLocationType } from '@prisma/client'
import { defaultWorkingHours } from '@/lib/scheduling/workingHoursValidation'

const ADDRESS_PRIVACY_WRITE_KEYS = [
  'encryptedAddressJson',
  'addressKeyVersion',
  'postalCodePrefix',
  'latApprox',
  'lngApprox',
  'formattedAddress',
] as const

function expectNoAddressPrivacyWrites(data: Record<string, unknown>) {
  for (const key of ADDRESS_PRIVACY_WRITE_KEYS) {
    expect(data).not.toHaveProperty(key)
  }
}

const mocks = vi.hoisted(() => {
  const jsonOk = vi.fn((data: unknown, status = 200) => {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  })

  const jsonFail = vi.fn((status: number, message: string) => {
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  })

  const requirePro = vi.fn()
  const enforceRateLimit = vi.fn()
  const rateLimitIdentity = vi.fn()
  const bumpScheduleConfigVersion = vi.fn()
  const refreshProfessional = vi.fn()

  const prisma = {
    professionalLocation: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  }

  return {
    jsonOk,
    jsonFail,
    requirePro,
    enforceRateLimit,
    rateLimitIdentity,
    bumpScheduleConfigVersion,
    refreshProfessional,
    prisma,
  }
})

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
  requirePro: mocks.requirePro,
}))

vi.mock('@/app/api/_utils/rateLimit', () => ({
  enforceRateLimit: mocks.enforceRateLimit,
  rateLimitIdentity: mocks.rateLimitIdentity,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/lib/booking/cacheVersion', () => ({
  bumpScheduleConfigVersion: mocks.bumpScheduleConfigVersion,
}))

vi.mock('@/lib/search/index/refreshSearchIndex', () => ({
  refreshLocation: vi.fn(),
  refreshProfessional: mocks.refreshProfessional,
  deleteLocationFromIndex: vi.fn(),
}))

import { GET, POST } from './route'

function makeRequest(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers:
      body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

describe('app/api/pro/working-hours/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requirePro.mockResolvedValue({
      ok: true,
      userId: 'user_123',
      professionalId: 'pro_123',
    })

    mocks.rateLimitIdentity.mockResolvedValue({
      kind: 'user',
      id: 'user_123',
    })

    mocks.enforceRateLimit.mockResolvedValue(null)
    mocks.bumpScheduleConfigVersion.mockResolvedValue(undefined)
    mocks.refreshProfessional.mockResolvedValue(undefined)
  })

  describe('GET', () => {
    it('returns defaults when no matching bookable location exists', async () => {
      mocks.prisma.professionalLocation.findFirst.mockResolvedValue(null)

      const res = await GET(
        makeRequest('GET', '/api/pro/working-hours?locationType=SALON'),
      )

      expect(res.status).toBe(200)

      const body = await readJson<{
        ok: true
        locationType: 'SALON' | 'MOBILE'
        locationId: string | null
        location: {
          id: string
          type: ProfessionalLocationType
          isPrimary: boolean
        } | null
        workingHours: ReturnType<typeof defaultWorkingHours>
        usedDefault: boolean
        missingLocation: boolean
      }>(res)

      expect(body).toEqual({
        ok: true,
        locationType: 'SALON',
        locationId: null,
        location: null,
        workingHours: defaultWorkingHours(),
        usedDefault: true,
        missingLocation: true,
      })

      expect(mocks.prisma.professionalLocation.findFirst).toHaveBeenCalledWith({
        where: {
          professionalId: 'pro_123',
          isBookable: true,
          type: {
            in: [
              ProfessionalLocationType.SALON,
              ProfessionalLocationType.SUITE,
            ],
          },
        },
        select: {
          id: true,
          type: true,
          isPrimary: true,
          workingHours: true,
        },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      })
    })

    it('falls back to defaults when stored workingHours are invalid', async () => {
      mocks.prisma.professionalLocation.findFirst.mockResolvedValue({
        id: 'loc_1',
        type: ProfessionalLocationType.SALON,
        isPrimary: true,
        workingHours: {
          mon: { enabled: true, start: 'nope', end: '17:00' },
        },
      })

      const res = await GET(
        makeRequest('GET', '/api/pro/working-hours?locationType=SALON'),
      )

      expect(res.status).toBe(200)

      const body = await readJson<{
        ok: true
        locationType: 'SALON' | 'MOBILE'
        locationId: string | null
        location: {
          id: string
          type: ProfessionalLocationType
          isPrimary: boolean
        } | null
        workingHours: ReturnType<typeof defaultWorkingHours>
        usedDefault: boolean
        missingLocation: boolean
      }>(res)

      expect(body.locationId).toBe('loc_1')
      expect(body.location).toEqual({
        id: 'loc_1',
        type: ProfessionalLocationType.SALON,
        isPrimary: true,
      })
      expect(body.usedDefault).toBe(true)
      expect(body.missingLocation).toBe(false)
      expect(body.workingHours).toEqual(defaultWorkingHours())
    })

    it('returns normalized stored workingHours when valid', async () => {
      mocks.prisma.professionalLocation.findFirst.mockResolvedValue({
        id: 'loc_2',
        type: ProfessionalLocationType.MOBILE_BASE,
        isPrimary: false,
        workingHours: defaultWorkingHours(),
      })

      const res = await GET(
        makeRequest('GET', '/api/pro/working-hours?locationType=MOBILE'),
      )

      expect(res.status).toBe(200)

      const body = await readJson<{
        ok: true
        locationType: 'SALON' | 'MOBILE'
        locationId: string | null
        location: {
          id: string
          type: ProfessionalLocationType
          isPrimary: boolean
        } | null
        workingHours: ReturnType<typeof defaultWorkingHours>
        usedDefault: boolean
        missingLocation: boolean
      }>(res)

      expect(body.locationType).toBe('MOBILE')
      expect(body.locationId).toBe('loc_2')
      expect(body.usedDefault).toBe(false)
      expect(body.missingLocation).toBe(false)

      expect(mocks.prisma.professionalLocation.findFirst).toHaveBeenCalledWith({
        where: {
          professionalId: 'pro_123',
          isBookable: true,
          type: {
            in: [ProfessionalLocationType.MOBILE_BASE],
          },
        },
        select: {
          id: true,
          type: true,
          isPrimary: true,
          workingHours: true,
        },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      })
    })
  })

  describe('POST', () => {
    it('rejects missing or invalid locationType', async () => {
      const res = await POST(
        makeRequest('POST', '/api/pro/working-hours', {
          workingHours: defaultWorkingHours(),
        }),
      )

      expect(res.status).toBe(400)

      const body = await readJson<{ ok: false; error: string }>(res)
      expect(body.error).toBe('Missing or invalid locationType.')

      expect(mocks.rateLimitIdentity).toHaveBeenCalledWith('user_123')
      expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
        bucket: 'pro:working-hours:write',
        identity: {
          kind: 'user',
          id: 'user_123',
        },
      })

      expect(mocks.prisma.professionalLocation.findMany).not.toHaveBeenCalled()
      expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    })

    it('passes through rate limit response unchanged', async () => {
      const limited = new Response(
        JSON.stringify({
          ok: false,
          error: 'Too many requests.',
          code: 'RATE_LIMITED',
        }),
        {
          status: 429,
          headers: { 'content-type': 'application/json' },
        },
      )

      mocks.enforceRateLimit.mockResolvedValueOnce(limited)

      const res = await POST(
        makeRequest('POST', '/api/pro/working-hours?locationType=SALON', {
          workingHours: defaultWorkingHours(),
        }),
      )

      expect(res).toBe(limited)
      expect(res.status).toBe(429)

      expect(mocks.prisma.professionalLocation.findMany).not.toHaveBeenCalled()
      expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    })

    it('rejects invalid request body', async () => {
      const req = new Request(
        'http://localhost/api/pro/working-hours?locationType=SALON',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify('hello'),
        },
      )

      const res = await POST(req)

      expect(res.status).toBe(400)

      const body = await readJson<{ ok: false; error: string }>(res)
      expect(body.error).toBe('Invalid body.')

      expect(mocks.prisma.professionalLocation.findMany).not.toHaveBeenCalled()
      expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    })

    it('rejects malformed workingHours', async () => {
      const res = await POST(
        makeRequest('POST', '/api/pro/working-hours?locationType=SALON', {
          workingHours: {
            mon: { enabled: true, start: '09:00', end: '17:00' },
          },
        }),
      )

      expect(res.status).toBe(400)

      const body = await readJson<{ ok: false; error: string }>(res)
      expect(body.error).toBe(
        'workingHours must contain mon..sun with { enabled, start, end } and valid HH:MM times. Overnight ranges are allowed.',
      )

      expect(mocks.prisma.professionalLocation.findMany).not.toHaveBeenCalled()
      expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    })

    it('returns 409 when no matching bookable location exists and does not auto-create one', async () => {
      mocks.prisma.professionalLocation.findMany.mockResolvedValue([])

      const res = await POST(
        makeRequest('POST', '/api/pro/working-hours?locationType=MOBILE', {
          workingHours: defaultWorkingHours(),
        }),
      )

      expect(res.status).toBe(409)

      const body = await readJson<{ ok: false; error: string }>(res)
      expect(body.error).toBe(
        'No bookable mobile location exists yet. Create and finish a bookable location first, then save working hours.',
      )

      expect(mocks.prisma.professionalLocation.findMany).toHaveBeenCalledWith({
        where: {
          professionalId: 'pro_123',
          isBookable: true,
          type: { in: [ProfessionalLocationType.MOBILE_BASE] },
        },
        select: {
          id: true,
          type: true,
          isPrimary: true,
        },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        take: 50,
      })

      expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    })

    it('updates all matching bookable locations for the requested mode without rewriting address privacy fields', async () => {
      const txUpdateMany = vi.fn().mockResolvedValue({ count: 2 })
      const txFindMany = vi.fn().mockResolvedValue([
        {
          id: 'loc_salon_1',
          type: ProfessionalLocationType.SALON,
          isPrimary: true,
        },
        {
          id: 'loc_suite_1',
          type: ProfessionalLocationType.SUITE,
          isPrimary: false,
        },
      ])

      mocks.prisma.professionalLocation.findMany.mockResolvedValue([
        {
          id: 'loc_salon_1',
          type: ProfessionalLocationType.SALON,
          isPrimary: true,
        },
        {
          id: 'loc_suite_1',
          type: ProfessionalLocationType.SUITE,
          isPrimary: false,
        },
      ])

      mocks.prisma.$transaction.mockImplementation(
        async (
          callback: (tx: {
            professionalLocation: {
              updateMany: typeof txUpdateMany
              findMany: typeof txFindMany
            }
          }) => Promise<unknown>,
        ) => {
          return callback({
            professionalLocation: {
              updateMany: txUpdateMany,
              findMany: txFindMany,
            },
          })
        },
      )

      const workingHours = defaultWorkingHours()

      const res = await POST(
        makeRequest('POST', '/api/pro/working-hours?locationType=SALON', {
          workingHours,
        }),
      )

      expect(res.status).toBe(200)

      const body = await readJson<{
        ok: true
        locationType: 'SALON' | 'MOBILE'
        locationId: string | null
        location: {
          id: string
          type: ProfessionalLocationType
          isPrimary: boolean
        } | null
        workingHours: ReturnType<typeof defaultWorkingHours>
        usedDefault: boolean
        updatedCount: number
        updatedLocationIds: string[]
      }>(res)

      expect(txUpdateMany).toHaveBeenCalledWith({
        where: {
          professionalId: 'pro_123',
          isBookable: true,
          type: {
            in: [
              ProfessionalLocationType.SALON,
              ProfessionalLocationType.SUITE,
            ],
          },
        },
        data: {
          workingHours,
        },
      })

      const updateCall = txUpdateMany.mock.calls[0]?.[0]
      expect(updateCall).toBeDefined()
      expectNoAddressPrivacyWrites(updateCall.data)

      expect(txFindMany).toHaveBeenCalledWith({
        where: {
          professionalId: 'pro_123',
          isBookable: true,
          type: {
            in: [
              ProfessionalLocationType.SALON,
              ProfessionalLocationType.SUITE,
            ],
          },
        },
        select: {
          id: true,
          type: true,
          isPrimary: true,
        },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        take: 50,
      })

      expect(mocks.bumpScheduleConfigVersion).toHaveBeenCalledWith('pro_123')
      expect(mocks.refreshProfessional).toHaveBeenCalledWith(
        'pro_123',
        'workingHours.update',
      )

      expect(body).toMatchObject({
        locationType: 'SALON',
        locationId: 'loc_salon_1',
        location: {
          id: 'loc_salon_1',
          type: ProfessionalLocationType.SALON,
          isPrimary: true,
        },
        workingHours,
        usedDefault: false,
        updatedCount: 2,
        updatedLocationIds: ['loc_salon_1', 'loc_suite_1'],
      })
    })

    it('updates only matching mobile base locations for mobile mode without rewriting address privacy fields', async () => {
      const txUpdateMany = vi.fn().mockResolvedValue({ count: 1 })
      const txFindMany = vi.fn().mockResolvedValue([
        {
          id: 'loc_mobile_1',
          type: ProfessionalLocationType.MOBILE_BASE,
          isPrimary: true,
        },
      ])

      mocks.prisma.professionalLocation.findMany.mockResolvedValue([
        {
          id: 'loc_mobile_1',
          type: ProfessionalLocationType.MOBILE_BASE,
          isPrimary: true,
        },
      ])

      mocks.prisma.$transaction.mockImplementation(
        async (
          callback: (tx: {
            professionalLocation: {
              updateMany: typeof txUpdateMany
              findMany: typeof txFindMany
            }
          }) => Promise<unknown>,
        ) => {
          return callback({
            professionalLocation: {
              updateMany: txUpdateMany,
              findMany: txFindMany,
            },
          })
        },
      )

      const workingHours = defaultWorkingHours()

      const res = await POST(
        makeRequest('POST', '/api/pro/working-hours?locationType=MOBILE', {
          workingHours,
        }),
      )

      expect(res.status).toBe(200)

      expect(txUpdateMany).toHaveBeenCalledWith({
        where: {
          professionalId: 'pro_123',
          isBookable: true,
          type: {
            in: [ProfessionalLocationType.MOBILE_BASE],
          },
        },
        data: {
          workingHours,
        },
      })

      const updateCall = txUpdateMany.mock.calls[0]?.[0]
      expect(updateCall).toBeDefined()
      expectNoAddressPrivacyWrites(updateCall.data)

      expect(txFindMany).toHaveBeenCalledWith({
        where: {
          professionalId: 'pro_123',
          isBookable: true,
          type: {
            in: [ProfessionalLocationType.MOBILE_BASE],
          },
        },
        select: {
          id: true,
          type: true,
          isPrimary: true,
        },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        take: 50,
      })

      expect(mocks.bumpScheduleConfigVersion).toHaveBeenCalledWith('pro_123')
      expect(mocks.refreshProfessional).toHaveBeenCalledWith(
        'pro_123',
        'workingHours.update',
      )
    })

    it('returns 409 when updateMany affects zero rows inside the transaction', async () => {
      const txUpdateMany = vi.fn().mockResolvedValue({ count: 0 })
      const txFindMany = vi.fn()

      mocks.prisma.professionalLocation.findMany.mockResolvedValue([
        {
          id: 'loc_salon_1',
          type: ProfessionalLocationType.SALON,
          isPrimary: true,
        },
      ])

      mocks.prisma.$transaction.mockImplementation(
        async (
          callback: (tx: {
            professionalLocation: {
              updateMany: typeof txUpdateMany
              findMany: typeof txFindMany
            }
          }) => Promise<unknown>,
        ) => {
          return callback({
            professionalLocation: {
              updateMany: txUpdateMany,
              findMany: txFindMany,
            },
          })
        },
      )

      const res = await POST(
        makeRequest('POST', '/api/pro/working-hours?locationType=SALON', {
          workingHours: defaultWorkingHours(),
        }),
      )

      expect(res.status).toBe(409)

      const body = await readJson<{ ok: false; error: string }>(res)
      expect(body.error).toBe(
        'No bookable locations were updated. Check your location types and isBookable flags.',
      )

      expect(txFindMany).not.toHaveBeenCalled()
      expect(mocks.bumpScheduleConfigVersion).not.toHaveBeenCalled()
      expect(mocks.refreshProfessional).not.toHaveBeenCalled()
    })
  })
})