// app/api/pro/working-hours/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProfessionalLocationType } from '@prisma/client'
import { defaultWorkingHours } from '@/lib/scheduling/workingHoursValidation'

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
    prisma,
  }
})

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
  requirePro: mocks.requirePro,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
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
      professionalId: 'pro_123',
    })
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
        location: { id: string; type: ProfessionalLocationType; isPrimary: boolean } | null
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
        location: { id: string; type: ProfessionalLocationType; isPrimary: boolean } | null
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
        workingHours: {
          mon: { enabled: true, start: '09:00', end: '17:00' },
          tue: { enabled: true, start: '09:00', end: '17:00' },
          wed: { enabled: true, start: '09:00', end: '17:00' },
          thu: { enabled: true, start: '09:00', end: '17:00' },
          fri: { enabled: true, start: '09:00', end: '17:00' },
          sat: { enabled: false, start: '09:00', end: '17:00' },
          sun: { enabled: false, start: '09:00', end: '17:00' },
        },
      })

      const res = await GET(
        makeRequest('GET', '/api/pro/working-hours?locationType=MOBILE'),
      )

      expect(res.status).toBe(200)

      const body = await readJson<{
        ok: true
        locationType: 'SALON' | 'MOBILE'
        locationId: string | null
        location: { id: string; type: ProfessionalLocationType; isPrimary: boolean } | null
        workingHours: ReturnType<typeof defaultWorkingHours>
        usedDefault: boolean
        missingLocation: boolean
      }>(res)

      expect(body.locationType).toBe('MOBILE')
      expect(body.locationId).toBe('loc_2')
      expect(body.usedDefault).toBe(false)
      expect(body.missingLocation).toBe(false)
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

      expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    })

    it('updates all matching bookable locations for the requested mode', async () => {
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
              updateMany: ReturnType<typeof vi.fn>
              findMany: ReturnType<typeof vi.fn>
            }
          }) => Promise<unknown>,
        ) => {
          const tx = {
            professionalLocation: {
              updateMany: vi.fn().mockResolvedValue({ count: 2 }),
              findMany: vi.fn().mockResolvedValue([
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
              ]),
            },
          }

          return callback(tx)
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
        location: { id: string; type: ProfessionalLocationType; isPrimary: boolean } | null
        workingHours: ReturnType<typeof defaultWorkingHours>
        usedDefault: boolean
        updatedCount: number
        updatedLocationIds: string[]
      }>(res)

      expect(body).toMatchObject({
        ok: true,
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

    it('returns 409 when updateMany affects zero rows inside the transaction', async () => {
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
              updateMany: ReturnType<typeof vi.fn>
              findMany: ReturnType<typeof vi.fn>
            }
          }) => Promise<unknown>,
        ) => {
          const tx = {
            professionalLocation: {
              updateMany: vi.fn().mockResolvedValue({ count: 0 }),
              findMany: vi.fn(),
            },
          }

          return callback(tx)
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
    })
  })
})