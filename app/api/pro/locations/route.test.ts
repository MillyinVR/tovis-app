// app/api/pro/locations/route.test.ts

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

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/pro/locations', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

function makeCreatedLocation() {
  return {
    id: 'loc_1',
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
    timeZone: 'America/Los_Angeles',
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

describe('POST /api/pro/locations', () => {
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

    mocks.buildAddressPrivacyWriteData.mockReturnValue({
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
    })
  })

  it('creates a pro location with address privacy write fields', async () => {
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

        timeZone: 'America/Los_Angeles',
        workingHours: expect.any(Object),

        bufferMinutes: 15,
        stepMinutes: 15,
        advanceNoticeMinutes: 60,
        maxDaysAhead: 365,
      },
      select: expect.any(Object),
    })

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

  it('does not build address privacy data when validation fails before create', async () => {
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
    expect(mocks.buildAddressPrivacyWriteData).not.toHaveBeenCalled()
    expect(mocks.professionalLocationCreate).not.toHaveBeenCalled()
  })
})