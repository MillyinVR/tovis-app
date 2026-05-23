// app/api/pro/schedule/publish/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  const checkProReadiness = vi.fn()
  const evaluatePublishableLocation = vi.fn()
  const captureBookingException = vi.fn()
  const refreshLocation = vi.fn()

  const professionalLocation = {
    findMany: vi.fn(),
    updateMany: vi.fn(),
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
    checkProReadiness,
    evaluatePublishableLocation,
    captureBookingException,
    refreshLocation,
    professionalLocation,
    professionalProfile,
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

vi.mock('@/lib/pro/readiness/proReadiness', () => ({
  checkProReadiness: mocks.checkProReadiness,
  evaluatePublishableLocation: mocks.evaluatePublishableLocation,
}))

vi.mock('@/lib/observability/bookingEvents', () => ({
  captureBookingException: mocks.captureBookingException,
}))

vi.mock('@/lib/search/index/refreshSearchIndex', () => ({
  refreshLocation: mocks.refreshLocation,
}))

import { POST } from './route'

type JsonBody = Record<string, unknown>

async function readJson(res: Response): Promise<JsonBody> {
  return (await res.json()) as JsonBody
}

const draftSalonLocation = {
  id: 'loc_salon',
  type: 'SALON',
  formattedAddress: '123 Main St, San Diego, CA',
  timeZone: 'America/Los_Angeles',
  workingHours: {
    mon: { enabled: true, start: '09:00', end: '17:00' },
    tue: { enabled: false, start: '', end: '' },
    wed: { enabled: false, start: '', end: '' },
    thu: { enabled: false, start: '', end: '' },
    fri: { enabled: false, start: '', end: '' },
    sat: { enabled: false, start: '', end: '' },
    sun: { enabled: false, start: '', end: '' },
  },
}

const blockedDraftLocation = {
  ...draftSalonLocation,
  id: 'loc_blocked',
  timeZone: null,
}

describe('POST /api/pro/schedule/publish', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requirePro.mockResolvedValue({
      ok: true,
      professionalId: 'pro_123',
      userId: 'user_123',
      proId: 'pro_123',
      user: {
        id: 'user_123',
      },
    })

    mocks.professionalLocation.findMany.mockResolvedValue([draftSalonLocation])

    mocks.evaluatePublishableLocation.mockReturnValue({
      ok: true,
      locationId: 'loc_salon',
    })

    mocks.professionalLocation.updateMany.mockResolvedValue({
      count: 1,
    })

    mocks.professionalProfile.update.mockResolvedValue({
      scheduleConfigVersion: 42,
    })

    const tx = {
      professionalLocation: mocks.professionalLocation,
      professionalProfile: mocks.professionalProfile,
    }

    mocks.prisma.$transaction.mockImplementation(
      async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx),
    )

    mocks.refreshLocation.mockResolvedValue(undefined)

    mocks.checkProReadiness.mockResolvedValue({
      ok: true,
      liveModes: ['SALON'],
      readyLocationIds: ['loc_salon'],
    })
  })

  it('passes through failed pro auth unchanged', async () => {
    const authRes = new Response(null, { status: 401 })

    mocks.requirePro.mockResolvedValueOnce({
      ok: false,
      res: authRes,
    })

    const result = await POST()

    expect(result).toBe(authRes)
    expect(result.status).toBe(401)

    expect(mocks.professionalLocation.findMany).not.toHaveBeenCalled()
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    expect(mocks.refreshLocation).not.toHaveBeenCalled()
    expect(mocks.checkProReadiness).not.toHaveBeenCalled()
  })

  it('returns readiness blockers when there are no draft locations and the pro is not ready', async () => {
    mocks.professionalLocation.findMany.mockResolvedValueOnce([])
    mocks.checkProReadiness.mockResolvedValueOnce({
      ok: false,
      blockers: ['NO_ACTIVE_OFFERING', 'NO_BOOKABLE_LOCATION'],
    })

    const result = await POST()
    const body = await readJson(result)

    expect(result.status).toBe(422)

    expect(body).toEqual({
      ok: false,
      error: 'Schedule cannot be published until all blockers are resolved.',
      blockers: ['NO_ACTIVE_OFFERING', 'NO_BOOKABLE_LOCATION'],
    })

    expect(mocks.professionalLocation.findMany).toHaveBeenCalledWith({
      where: {
        professionalId: 'pro_123',
        isBookable: false,
      },
      select: {
        id: true,
        type: true,
        formattedAddress: true,
        timeZone: true,
        workingHours: true,
      },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      take: 100,
    })

    expect(mocks.checkProReadiness).toHaveBeenCalledWith('pro_123')
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    expect(mocks.refreshLocation).not.toHaveBeenCalled()
  })

  it('returns success with zero published locations when there are no drafts and the pro is already ready', async () => {
    mocks.professionalLocation.findMany.mockResolvedValueOnce([])
    mocks.checkProReadiness.mockResolvedValueOnce({
      ok: true,
      liveModes: ['SALON'],
      readyLocationIds: ['loc_existing'],
    })

    const result = await POST()
    const body = await readJson(result)

    expect(result.status).toBe(200)

    expect(body).toEqual({
      ok: true,
      liveModes: ['SALON'],
      locationsPublished: 0,
      scheduleConfigVersion: null,
    })

    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    expect(mocks.refreshLocation).not.toHaveBeenCalled()
  })

  it('returns location blockers when no draft locations are publishable', async () => {
    const blockedResult = {
      ok: false,
      locationId: 'loc_blocked',
      blockers: ['LOCATION_MISSING_TIMEZONE'],
    }

    mocks.professionalLocation.findMany.mockResolvedValueOnce([
      blockedDraftLocation,
    ])

    mocks.evaluatePublishableLocation.mockReturnValueOnce(blockedResult)

    const result = await POST()
    const body = await readJson(result)

    expect(result.status).toBe(422)

    expect(body).toEqual({
      ok: false,
      error:
        'Schedule cannot be published until all location blockers are resolved.',
      blockedLocations: [blockedResult],
    })

    expect(mocks.evaluatePublishableLocation).toHaveBeenCalledWith(
      blockedDraftLocation,
    )
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    expect(mocks.refreshLocation).not.toHaveBeenCalled()
    expect(mocks.checkProReadiness).not.toHaveBeenCalled()
  })

  it('publishes only publishable draft locations without rewriting address privacy fields', async () => {
    const publishableResult = {
      ok: true,
      locationId: 'loc_salon',
    }

    const blockedResult = {
      ok: false,
      locationId: 'loc_blocked',
      blockers: ['LOCATION_MISSING_TIMEZONE'],
    }

    mocks.professionalLocation.findMany.mockResolvedValueOnce([
      draftSalonLocation,
      blockedDraftLocation,
    ])

    mocks.evaluatePublishableLocation
      .mockReturnValueOnce(publishableResult)
      .mockReturnValueOnce(blockedResult)

    mocks.professionalLocation.updateMany.mockResolvedValueOnce({
      count: 1,
    })

    mocks.professionalProfile.update.mockResolvedValueOnce({
      scheduleConfigVersion: 43,
    })

    mocks.checkProReadiness.mockResolvedValueOnce({
      ok: true,
      liveModes: ['SALON'],
      readyLocationIds: ['loc_salon'],
    })

    const result = await POST()
    const body = await readJson(result)

    expect(result.status).toBe(200)

    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1)

    expect(mocks.professionalLocation.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['loc_salon'] },
        professionalId: 'pro_123',
        isBookable: false,
      },
      data: {
        isBookable: true,
      },
    })

    const updateCall = mocks.professionalLocation.updateMany.mock.calls[0]?.[0]
    expect(updateCall).toBeDefined()
    expectNoAddressPrivacyWrites(updateCall.data)

    expect(mocks.professionalProfile.update).toHaveBeenCalledWith({
      where: { id: 'pro_123' },
      data: {
        scheduleConfigVersion: { increment: 1 },
      },
      select: {
        scheduleConfigVersion: true,
      },
    })

    expect(mocks.refreshLocation).toHaveBeenCalledTimes(1)
    expect(mocks.refreshLocation).toHaveBeenCalledWith(
      'loc_salon',
      'location.update',
    )

    expect(mocks.checkProReadiness).toHaveBeenCalledWith('pro_123')

    expect(body).toEqual({
      ok: true,
      liveModes: ['SALON'],
      locationsPublished: 1,
      scheduleConfigVersion: 43,
      blockedLocations: [blockedResult],
    })
  })

  it('returns 422 when locations publish but full pro readiness still fails', async () => {
    const blockedResult = {
      ok: false,
      locationId: 'loc_blocked',
      blockers: ['LOCATION_MISSING_TIMEZONE'],
    }

    mocks.professionalLocation.findMany.mockResolvedValueOnce([
      draftSalonLocation,
      blockedDraftLocation,
    ])

    mocks.evaluatePublishableLocation
      .mockReturnValueOnce({
        ok: true,
        locationId: 'loc_salon',
      })
      .mockReturnValueOnce(blockedResult)

    mocks.professionalLocation.updateMany.mockResolvedValueOnce({
      count: 1,
    })

    mocks.professionalProfile.update.mockResolvedValueOnce({
      scheduleConfigVersion: 44,
    })

    mocks.checkProReadiness.mockResolvedValueOnce({
      ok: false,
      blockers: ['NO_ACTIVE_OFFERING'],
    })

    const result = await POST()
    const body = await readJson(result)

    expect(result.status).toBe(422)

    expect(mocks.professionalLocation.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['loc_salon'] },
        professionalId: 'pro_123',
        isBookable: false,
      },
      data: {
        isBookable: true,
      },
    })

    const updateCall = mocks.professionalLocation.updateMany.mock.calls[0]?.[0]
    expect(updateCall).toBeDefined()
    expectNoAddressPrivacyWrites(updateCall.data)

    expect(mocks.refreshLocation).toHaveBeenCalledWith(
      'loc_salon',
      'location.update',
    )

    expect(body).toEqual({
      ok: false,
      error:
        'Locations were published, but the professional is still not ready for booking.',
      locationsPublished: 1,
      scheduleConfigVersion: 44,
      blockers: ['NO_ACTIVE_OFFERING'],
      blockedLocations: [blockedResult],
    })
  })

  it('refreshes every publishable location after publishing', async () => {
    const secondDraftLocation = {
      ...draftSalonLocation,
      id: 'loc_suite',
      type: 'SUITE',
    }

    mocks.professionalLocation.findMany.mockResolvedValueOnce([
      draftSalonLocation,
      secondDraftLocation,
    ])

    mocks.evaluatePublishableLocation
      .mockReturnValueOnce({
        ok: true,
        locationId: 'loc_salon',
      })
      .mockReturnValueOnce({
        ok: true,
        locationId: 'loc_suite',
      })

    mocks.professionalLocation.updateMany.mockResolvedValueOnce({
      count: 2,
    })

    mocks.professionalProfile.update.mockResolvedValueOnce({
      scheduleConfigVersion: 45,
    })

    mocks.checkProReadiness.mockResolvedValueOnce({
      ok: true,
      liveModes: ['SALON'],
      readyLocationIds: ['loc_salon', 'loc_suite'],
    })

    const result = await POST()
    const body = await readJson(result)

    expect(result.status).toBe(200)

    expect(mocks.professionalLocation.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['loc_salon', 'loc_suite'] },
        professionalId: 'pro_123',
        isBookable: false,
      },
      data: {
        isBookable: true,
      },
    })

    const updateCall = mocks.professionalLocation.updateMany.mock.calls[0]?.[0]
    expect(updateCall).toBeDefined()
    expectNoAddressPrivacyWrites(updateCall.data)

    expect(mocks.refreshLocation).toHaveBeenCalledTimes(2)
    expect(mocks.refreshLocation).toHaveBeenCalledWith(
      'loc_salon',
      'location.update',
    )
    expect(mocks.refreshLocation).toHaveBeenCalledWith(
      'loc_suite',
      'location.update',
    )

    expect(body).toEqual({
      ok: true,
      liveModes: ['SALON'],
      locationsPublished: 2,
      scheduleConfigVersion: 45,
      blockedLocations: [],
    })
  })

  it('returns 500 and captures unexpected errors', async () => {
    const error = new Error('db exploded')
    mocks.professionalLocation.findMany.mockRejectedValueOnce(error)

    const result = await POST()
    const body = await readJson(result)

    expect(result.status).toBe(500)

    expect(body).toEqual({
      ok: false,
      error: 'Internal server error.',
    })

    expect(mocks.captureBookingException).toHaveBeenCalledWith({
      error,
      route: 'POST /api/pro/schedule/publish',
    })

    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    expect(mocks.refreshLocation).not.toHaveBeenCalled()
  })
})