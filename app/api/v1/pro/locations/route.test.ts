// app/api/v1/pro/locations/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma, ProfessionalLocationType } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),

  professionalLocationFindMany: vi.fn(),
  professionalLocationCount: vi.fn(),
  professionalLocationUpdateMany: vi.fn(),
  professionalLocationCreate: vi.fn(),
  transaction: vi.fn(),

  enforceRateLimit: vi.fn(),
  rateLimitIdentity: vi.fn(),
  bumpScheduleConfigVersion: vi.fn(),
  refreshLocation: vi.fn(),
  buildAddressPrivacyWriteData: vi.fn(),
}))

vi.mock('@/app/api/_utils/auth/requirePro', () => ({
  requirePro: mocks.requirePro,
}))

vi.mock('@/app/api/_utils/responses', () => ({
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
}))

vi.mock('@/app/api/_utils/rateLimit', () => ({
  enforceRateLimit: mocks.enforceRateLimit,
  rateLimitIdentity: mocks.rateLimitIdentity,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    professionalLocation: {
      findMany: mocks.professionalLocationFindMany,
      count: mocks.professionalLocationCount,
      updateMany: mocks.professionalLocationUpdateMany,
      create: mocks.professionalLocationCreate,
    },
    $transaction: mocks.transaction,
  },
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
    value === 'America/Los_Angeles' || value === 'UTC',
}))

vi.mock('@/app/api/_utils/pick', () => ({
  pickEnum: (value: unknown, values: readonly unknown[]) =>
    values.includes(value) ? value : null,
  pickString: (value: unknown) =>
    typeof value === 'string' && value.trim() ? value.trim() : null,
  pickNumber: (value: unknown) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null

    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : null
    }

    return null
  },
  pickInt: (value: unknown) => {
    if (typeof value === 'number' && Number.isInteger(value)) return value

    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value)
      return Number.isInteger(parsed) ? parsed : null
    }

    return null
  },
  clampInt: (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value)),
}))

vi.mock('@/lib/guards', () => ({
  hasOwn: (value: object, key: PropertyKey) =>
    Object.prototype.hasOwnProperty.call(value, key),
  isRecord: (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value),
}))

vi.mock('@/lib/scheduling/workingHoursValidation', () => ({
  defaultWorkingHours: () => ({
    mon: { enabled: true, start: '09:00', end: '17:00' },
    tue: { enabled: true, start: '09:00', end: '17:00' },
    wed: { enabled: true, start: '09:00', end: '17:00' },
    thu: { enabled: true, start: '09:00', end: '17:00' },
    fri: { enabled: true, start: '09:00', end: '17:00' },
    sat: { enabled: false, start: '09:00', end: '17:00' },
    sun: { enabled: false, start: '09:00', end: '17:00' },
  }),
  normalizeWorkingHours: (value: unknown) =>
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : null,
  safeHoursFromDb: (value: unknown) => value,
  toInputJsonValue: (value: unknown) => value,
}))

import { POST } from './route'

const addressPrivacyWriteData = {
  encryptedAddressJson: {
    v: 1,
    algorithm: 'plaintext-json-expand-phase',
    keyVersion: 'address-json-v1',
    address: {
      formattedAddress: '123 Main St, Los Angeles, CA 90001',
      addressLine1: '123 Main St',
      addressLine2: 'Suite 4',
      city: 'Los Angeles',
      state: 'CA',
      postalCode: '90001',
      countryCode: 'US',
      placeId: 'place_123',
      lat: '34.052235',
      lng: '-118.243683',
    },
  },
  addressKeyVersion: 'address-json-v1',
  postalCodePrefix: '90001',
  latApprox: new Prisma.Decimal('34.0522'),
  lngApprox: new Prisma.Decimal('-118.2437'),
}

const emptyAddressPrivacyWriteData = {
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

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/pro/locations', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

function makeCreatedLocation(
  overrides: Partial<{
    id: string
    type: ProfessionalLocationType
    name: string | null
    isPrimary: boolean
    isBookable: boolean
    formattedAddress: string | null
    addressLine1: string | null
    addressLine2: string | null
    city: string | null
    state: string | null
    postalCode: string | null
    countryCode: string | null
    placeId: string | null
    lat: Prisma.Decimal | null
    lng: Prisma.Decimal | null
    timeZone: string | null
  }> = {},
) {
  return {
    id: overrides.id ?? 'loc_1',
    type: overrides.type ?? ProfessionalLocationType.SALON,
    name: overrides.name ?? 'Main Studio',
    isPrimary: overrides.isPrimary ?? true,
    isBookable: overrides.isBookable ?? true,

    formattedAddress:
      overrides.formattedAddress ?? '123 Main St, Los Angeles, CA 90001',
    addressLine1: overrides.addressLine1 ?? '123 Main St',
    addressLine2: overrides.addressLine2 ?? 'Suite 4',
    city: overrides.city ?? 'Los Angeles',
    state: overrides.state ?? 'CA',
    postalCode: overrides.postalCode ?? '90001',
    countryCode: overrides.countryCode ?? 'US',
    placeId: overrides.placeId ?? 'place_123',

    lat:
      overrides.lat !== undefined
        ? overrides.lat
        : new Prisma.Decimal('34.052235'),
    lng:
      overrides.lng !== undefined
        ? overrides.lng
        : new Prisma.Decimal('-118.243683'),

    timeZone: overrides.timeZone ?? 'America/Los_Angeles',
    workingHours: {
      mon: { enabled: true, start: '09:00', end: '17:00' },
    },

    bufferMinutes: 15,
    stepMinutes: 15,
    advanceNoticeMinutes: 60,
    maxDaysAhead: 365,

    createdAt: new Date('2026-03-11T19:00:00.000Z'),
    updatedAt: new Date('2026-03-11T19:00:00.000Z'),
  }
}

function expectAddressPrivacyWriteData(data: Record<string, unknown>) {
  for (const key of ADDRESS_PRIVACY_WRITE_KEYS) {
    expect(data[key]).toEqual(
      addressPrivacyWriteData[key as keyof typeof addressPrivacyWriteData],
    )
  }
}

function expectEmptyAddressPrivacyWriteData(data: Record<string, unknown>) {
  for (const key of ADDRESS_PRIVACY_WRITE_KEYS) {
    expect(data[key]).toEqual(
      emptyAddressPrivacyWriteData[
        key as keyof typeof emptyAddressPrivacyWriteData
      ],
    )
  }
}

function getCreateData() {
  const createCall = mocks.professionalLocationCreate.mock.calls[0]?.[0]
  expect(createCall).toBeDefined()

  const data = createCall.data as Record<string, unknown>
  expect(data).toBeDefined()

  return data
}

describe('POST /api/v1/pro/locations', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requirePro.mockResolvedValue({
      ok: true,
      professionalId: 'pro_123',
      userId: 'user_123',
      user: {
        id: 'user_123',
      },
    })

    mocks.jsonFail.mockImplementation(
      (status: number, error: string, extra?: Record<string, unknown>) => ({
        ok: false,
        status,
        error,
        ...(extra ?? {}),
      }),
    )

    mocks.jsonOk.mockImplementation((data: unknown, status = 200) => ({
      ok: true,
      status,
      data,
    }))

    mocks.rateLimitIdentity.mockResolvedValue('user:user_123')
    mocks.enforceRateLimit.mockResolvedValue(null)

    mocks.professionalLocationCount.mockResolvedValue(0)
    mocks.professionalLocationUpdateMany.mockResolvedValue({ count: 0 })
    mocks.professionalLocationCreate.mockResolvedValue(makeCreatedLocation())

    mocks.transaction.mockImplementation(async (callback: unknown) => {
      if (typeof callback !== 'function') {
        throw new Error('Expected transaction callback')
      }

      return callback({
        professionalLocation: {
          count: mocks.professionalLocationCount,
          updateMany: mocks.professionalLocationUpdateMany,
          create: mocks.professionalLocationCreate,
        },
      })
    })

    mocks.bumpScheduleConfigVersion.mockResolvedValue(undefined)
    mocks.refreshLocation.mockResolvedValue(undefined)
    mocks.buildAddressPrivacyWriteData.mockReturnValue(addressPrivacyWriteData)
  })

  it('passes through failed pro auth unchanged', async () => {
    const authRes = new Response(null, { status: 401 })

    mocks.requirePro.mockResolvedValueOnce({
      ok: false,
      res: authRes,
    })

    const result = await POST(
      makeRequest({
        type: ProfessionalLocationType.SALON,
      }),
    )

    expect(result).toBe(authRes)
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
    expect(mocks.buildAddressPrivacyWriteData).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('returns rate-limit response before building address privacy data', async () => {
    const limitedResponse = {
      ok: false,
      status: 429,
      error: 'Too many requests.',
    }

    mocks.enforceRateLimit.mockResolvedValueOnce(limitedResponse)

    const result = await POST(
      makeRequest({
        type: ProfessionalLocationType.MOBILE_BASE,
        isBookable: false,
      }),
    )

    expect(result).toBe(limitedResponse)
    expect(mocks.rateLimitIdentity).toHaveBeenCalledWith('user_123')
    expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
      bucket: 'pro:locations:write',
      identity: 'user:user_123',
    })

    expect(mocks.buildAddressPrivacyWriteData).not.toHaveBeenCalled()
    expect(mocks.professionalLocationCreate).not.toHaveBeenCalled()
  })

  it('returns 400 for missing or invalid type before building address privacy data', async () => {
    const result = await POST(
      makeRequest({
        isBookable: false,
      }),
    )

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Missing/invalid type.',
    })

    expect(mocks.buildAddressPrivacyWriteData).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('returns 400 when isBookable is not boolean', async () => {
    const result = await POST(
      makeRequest({
        type: ProfessionalLocationType.SALON,
        isBookable: 'yes',
      }),
    )

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'isBookable must be boolean.',
    })

    expect(mocks.buildAddressPrivacyWriteData).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('returns 400 when isPrimary is not boolean', async () => {
    const result = await POST(
      makeRequest({
        type: ProfessionalLocationType.SALON,
        isPrimary: 'yes',
      }),
    )

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'isPrimary must be boolean.',
    })

    expect(mocks.buildAddressPrivacyWriteData).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('returns 400 when lat is invalid', async () => {
    const result = await POST(
      makeRequest({
        type: ProfessionalLocationType.SALON,
        lat: 'nope',
      }),
    )

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'lat must be a number or null.',
    })

    expect(mocks.buildAddressPrivacyWriteData).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('returns 400 when lng is invalid', async () => {
    const result = await POST(
      makeRequest({
        type: ProfessionalLocationType.SALON,
        lng: 'nope',
      }),
    )

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'lng must be a number or null.',
    })

    expect(mocks.buildAddressPrivacyWriteData).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('does not build address privacy data when bookable validation fails before create', async () => {
    const result = await POST(
      makeRequest({
        type: ProfessionalLocationType.SALON,
        isBookable: true,
        formattedAddress: '123 Main St, Los Angeles, CA 90001',
        placeId: 'place_123',
        lat: 34.052235,
        lng: -118.243683,
      }),
    )

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Bookable locations must have a valid IANA timeZone.',
    })

    expect(mocks.buildAddressPrivacyWriteData).not.toHaveBeenCalled()
    expect(mocks.professionalLocationCreate).not.toHaveBeenCalled()
  })

  it('requires lat and lng for bookable locations', async () => {
    const result = await POST(
      makeRequest({
        type: ProfessionalLocationType.MOBILE_BASE,
        isBookable: true,
        timeZone: 'America/Los_Angeles',
      }),
    )

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Bookable locations must include lat/lng.',
    })

    expect(mocks.buildAddressPrivacyWriteData).not.toHaveBeenCalled()
    expect(mocks.professionalLocationCreate).not.toHaveBeenCalled()
  })

  it('requires placeId and formattedAddress for bookable salon and suite locations', async () => {
    const result = await POST(
      makeRequest({
        type: ProfessionalLocationType.SALON,
        isBookable: true,
        timeZone: 'America/Los_Angeles',
        lat: 34.052235,
        lng: -118.243683,
      }),
    )

    expect(result).toEqual({
      ok: false,
      status: 400,
      error:
        'Salon/Suite bookable locations require placeId and formattedAddress.',
    })

    expect(mocks.buildAddressPrivacyWriteData).not.toHaveBeenCalled()
    expect(mocks.professionalLocationCreate).not.toHaveBeenCalled()
  })

  it('creates a bookable salon location with address privacy write fields', async () => {
    const result = await POST(
      makeRequest({
        type: ProfessionalLocationType.SALON,
        name: 'Main Studio',
        isBookable: true,
        isPrimary: true,
        formattedAddress: '123 Main St, Los Angeles, CA 90001',
        addressLine1: '123 Main St',
        addressLine2: 'Suite 4',
        city: 'Los Angeles',
        state: 'CA',
        postalCode: '90001',
        countryCode: 'US',
        placeId: 'place_123',
        lat: 34.052235,
        lng: -118.243683,
        timeZone: 'America/Los_Angeles',
        bufferMinutes: 15,
        stepMinutes: 15,
        advanceNoticeMinutes: 60,
        maxDaysAhead: 365,
      }),
    )

    expect(mocks.buildAddressPrivacyWriteData).toHaveBeenCalledWith({
      formattedAddress: '123 Main St, Los Angeles, CA 90001',
      addressLine1: '123 Main St',
      addressLine2: 'Suite 4',
      city: 'Los Angeles',
      state: 'CA',
      postalCode: '90001',
      countryCode: 'US',
      placeId: 'place_123',
      lat: 34.052235,
      lng: -118.243683,
    })

    expect(mocks.professionalLocationUpdateMany).toHaveBeenCalledWith({
      where: {
        professionalId: 'pro_123',
        isPrimary: true,
      },
      data: {
        isPrimary: false,
      },
    })

    expect(mocks.professionalLocationCreate).toHaveBeenCalledWith({
      data: {
        professionalId: 'pro_123',
        type: ProfessionalLocationType.SALON,
        name: 'Main Studio',

        isPrimary: true,
        isBookable: true,

        formattedAddress: '123 Main St, Los Angeles, CA 90001',
        addressLine1: '123 Main St',
        addressLine2: 'Suite 4',
        city: 'Los Angeles',
        state: 'CA',
        postalCode: '90001',
        countryCode: 'US',
        placeId: 'place_123',

        lat: new Prisma.Decimal('34.052235'),
        lng: new Prisma.Decimal('-118.243683'),

        ...addressPrivacyWriteData,

        timeZone: 'America/Los_Angeles',
        workingHours: expect.any(Object),

        bufferMinutes: 15,
        stepMinutes: 15,
        advanceNoticeMinutes: 60,
        maxDaysAhead: 365,
      },
      select: expect.any(Object),
    })

    const createData = getCreateData()
    expectAddressPrivacyWriteData(createData)

    expect(mocks.bumpScheduleConfigVersion).toHaveBeenCalledWith('pro_123')
    expect(mocks.refreshLocation).toHaveBeenCalledWith(
      'loc_1',
      'location.create',
    )

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        status: 201,
      }),
    )
  })

  it('creates a non-bookable mobile base with empty address privacy fields', async () => {
    mocks.buildAddressPrivacyWriteData.mockReturnValueOnce(
      emptyAddressPrivacyWriteData,
    )

    mocks.professionalLocationCreate.mockResolvedValueOnce(
      makeCreatedLocation({
        type: ProfessionalLocationType.MOBILE_BASE,
        name: 'Mobile Base',
        isBookable: false,
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
        timeZone: null,
      }),
    )

    const result = await POST(
      makeRequest({
        type: ProfessionalLocationType.MOBILE_BASE,
        name: 'Mobile Base',
        isBookable: false,
      }),
    )

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        status: 201,
      }),
    )

    expect(mocks.buildAddressPrivacyWriteData).toHaveBeenCalledWith({
      formattedAddress: null,
      addressLine1: null,
      addressLine2: null,
      city: null,
      state: null,
      postalCode: null,
      countryCode: null,
      placeId: null,
      lat: undefined,
      lng: undefined,
    })

    expect(mocks.professionalLocationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        professionalId: 'pro_123',
        type: ProfessionalLocationType.MOBILE_BASE,
        name: 'Mobile Base',
        isPrimary: true,
        isBookable: false,

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

        timeZone: null,
        workingHours: expect.any(Object),
      }),
      select: expect.any(Object),
    })

    const createData = getCreateData()
    expectEmptyAddressPrivacyWriteData(createData)
  })

  it('does not unset existing primary location when creating a non-primary non-first location', async () => {
    mocks.professionalLocationCount.mockResolvedValueOnce(2)

    const result = await POST(
      makeRequest({
        type: ProfessionalLocationType.MOBILE_BASE,
        name: 'Mobile Base',
        isBookable: false,
        isPrimary: false,
      }),
    )

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        status: 201,
      }),
    )

    expect(mocks.professionalLocationUpdateMany).not.toHaveBeenCalled()

    expect(mocks.professionalLocationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        isPrimary: false,
        isBookable: false,
      }),
      select: expect.any(Object),
    })
  })

  it('unsets existing primary location when creating a requested primary location', async () => {
    mocks.professionalLocationCount.mockResolvedValueOnce(2)

    const result = await POST(
      makeRequest({
        type: ProfessionalLocationType.MOBILE_BASE,
        name: 'Mobile Base',
        isBookable: false,
        isPrimary: true,
      }),
    )

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        status: 201,
      }),
    )

    expect(mocks.professionalLocationUpdateMany).toHaveBeenCalledWith({
      where: {
        professionalId: 'pro_123',
        isPrimary: true,
      },
      data: {
        isPrimary: false,
      },
    })

    expect(mocks.professionalLocationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        isPrimary: true,
        isBookable: false,
      }),
      select: expect.any(Object),
    })
  })

  it('returns 500 when create throws unexpectedly', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    const error = new Error('db exploded')
    mocks.transaction.mockRejectedValueOnce(error)

    const result = await POST(
      makeRequest({
        type: ProfessionalLocationType.MOBILE_BASE,
        isBookable: false,
      }),
    )

    expect(result).toEqual({
      ok: false,
      status: 500,
      error: 'Failed to create location',
    })

    expect(mocks.bumpScheduleConfigVersion).not.toHaveBeenCalled()
    expect(mocks.refreshLocation).not.toHaveBeenCalled()

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'POST /api/v1/pro/locations error',
      error,
    )

    consoleErrorSpy.mockRestore()
  })
})