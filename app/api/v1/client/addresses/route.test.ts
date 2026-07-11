// app/api/v1/client/addresses/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientAddressKind, Prisma } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),

  clientAddressCount: vi.fn(),
  clientAddressFindMany: vi.fn(),
  clientAddressUpdateMany: vi.fn(),
  clientAddressCreate: vi.fn(),
  transaction: vi.fn(),

  buildAddressPrivacyWriteData: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  requireClient: mocks.requireClient,
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    clientAddress: {
      count: mocks.clientAddressCount,
      findMany: mocks.clientAddressFindMany,
      updateMany: mocks.clientAddressUpdateMany,
      create: mocks.clientAddressCreate,
    },
    $transaction: mocks.transaction,
  },
}))

vi.mock('@/lib/security/addressEncryption', () => ({
  buildAddressPrivacyWriteData: mocks.buildAddressPrivacyWriteData,
}))

vi.mock('@/lib/booking/snapshots', () => ({
  decimalToNullableNumber: (value: Prisma.Decimal | null) =>
    value ? value.toNumber() : null,
}))

vi.mock('@/lib/pick', () => ({
  pickString: (value: unknown) =>
    typeof value === 'string' && value.trim() ? value.trim() : null,
  pickNumber: (value: unknown) => {
    if (typeof value === 'number') return value
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : null
    }
    return null
  },
}))

vi.mock('@/lib/guards', () => ({
  isRecord: (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value),
}))

import { POST } from './route'

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/client/addresses', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

describe('POST /api/v1/client/addresses', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
      user: {
        id: 'user_1',
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

    mocks.clientAddressCount.mockResolvedValue(0)
    mocks.clientAddressUpdateMany.mockResolvedValue({ count: 0 })

    mocks.buildAddressPrivacyWriteData.mockReturnValue({
      encryptedAddressJson: {
        v: 1,
        algorithm: 'plaintext-json-expand-phase',
        keyVersion: 'address-json-v1',
        address: {
          formattedAddress: '123 Main St, Los Angeles, CA 90001',
          addressLine1: '123 Main St',
          addressLine2: 'Unit 4',
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

    mocks.clientAddressCreate.mockResolvedValue({
      id: 'addr_1',
      kind: ClientAddressKind.SERVICE_ADDRESS,
      label: 'Home',
      isDefault: true,
      formattedAddress: '123 Main St, Los Angeles, CA 90001',
      addressLine1: '123 Main St',
      addressLine2: 'Unit 4',
      city: 'Los Angeles',
      state: 'CA',
      postalCode: '90001',
      countryCode: 'US',
      placeId: 'place_123',
      lat: new Prisma.Decimal('34.052235'),
      lng: new Prisma.Decimal('-118.243683'),
      createdAt: new Date('2026-03-11T19:00:00.000Z'),
      updatedAt: new Date('2026-03-11T19:00:00.000Z'),
    })

    mocks.transaction.mockImplementation(async (callback: unknown) => {
      if (typeof callback !== 'function') {
        throw new Error('Expected transaction callback')
      }

      return callback({
        clientAddress: {
          updateMany: mocks.clientAddressUpdateMany,
          create: mocks.clientAddressCreate,
        },
      })
    })
  })

  it('creates a client service address with address privacy write fields', async () => {
    const result = await POST(
      makeRequest({
        kind: 'SERVICE_ADDRESS',
        label: 'Home',
        formattedAddress: '123 Main St, Los Angeles, CA 90001',
        addressLine1: '123 Main St',
        addressLine2: 'Unit 4',
        city: 'Los Angeles',
        state: 'CA',
        postalCode: '90001',
        countryCode: 'US',
        placeId: 'place_123',
        lat: 34.052235,
        lng: -118.243683,
        isDefault: true,
      }),
    )

    expect(mocks.buildAddressPrivacyWriteData).toHaveBeenCalledWith({
      formattedAddress: '123 Main St, Los Angeles, CA 90001',
      addressLine1: '123 Main St',
      addressLine2: 'Unit 4',
      city: 'Los Angeles',
      state: 'CA',
      postalCode: '90001',
      countryCode: 'US',
      placeId: 'place_123',
      lat: 34.052235,
      lng: -118.243683,
    })

    expect(mocks.clientAddressCreate).toHaveBeenCalledWith({
      data: {
        clientId: 'client_1',
        kind: ClientAddressKind.SERVICE_ADDRESS,
        isDefault: true,
        label: 'Home',
        formattedAddress: '123 Main St, Los Angeles, CA 90001',
        addressLine1: '123 Main St',
        addressLine2: 'Unit 4',
        city: 'Los Angeles',
        state: 'CA',
        postalCode: '90001',
        countryCode: 'US',
        placeId: 'place_123',
        lat: new Prisma.Decimal('34.052235'),
        lng: new Prisma.Decimal('-118.243683'),
        radiusMiles: null,
        encryptedAddressJson: {
          v: 1,
          algorithm: 'plaintext-json-expand-phase',
          keyVersion: 'address-json-v1',
          address: {
            formattedAddress: '123 Main St, Los Angeles, CA 90001',
            addressLine1: '123 Main St',
            addressLine2: 'Unit 4',
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
      },
      select: expect.any(Object),
    })

    expect(result).toEqual({
      ok: true,
      status: 201,
      data: {
        address: {
          id: 'addr_1',
          kind: ClientAddressKind.SERVICE_ADDRESS,
          label: 'Home',
          isDefault: true,
          formattedAddress: '123 Main St, Los Angeles, CA 90001',
          addressLine1: '123 Main St',
          addressLine2: 'Unit 4',
          city: 'Los Angeles',
          state: 'CA',
          postalCode: '90001',
          countryCode: 'US',
          placeId: 'place_123',
          lat: 34.052235,
          lng: -118.243683,
          radiusMiles: null,
          createdAt: '2026-03-11T19:00:00.000Z',
          updatedAt: '2026-03-11T19:00:00.000Z',
        },
      },
    })
  })

  it('persists a clamped radiusMiles for a search area and returns it in the DTO', async () => {
    mocks.clientAddressCreate.mockResolvedValueOnce({
      id: 'addr_search_2',
      kind: ClientAddressKind.SEARCH_AREA,
      label: null,
      isDefault: true,
      formattedAddress: 'San Diego, CA, USA',
      addressLine1: null,
      addressLine2: null,
      city: 'San Diego',
      state: 'CA',
      postalCode: null,
      countryCode: 'US',
      placeId: 'pl_sd',
      lat: new Prisma.Decimal('32.7157'),
      lng: new Prisma.Decimal('-117.1611'),
      radiusMiles: 50,
      createdAt: new Date('2026-03-11T19:00:00.000Z'),
      updatedAt: new Date('2026-03-11T19:00:00.000Z'),
    })

    const result = await POST(
      makeRequest({
        kind: 'SEARCH_AREA',
        placeId: 'pl_sd',
        lat: 32.7157,
        lng: -117.1611,
        radiusMiles: 999, // out of range → clamped to the 50mi max
      }),
    )

    expect(mocks.clientAddressCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: ClientAddressKind.SEARCH_AREA,
          radiusMiles: 50,
        }),
      }),
    )

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        status: 201,
        data: expect.objectContaining({
          address: expect.objectContaining({ radiusMiles: 50 }),
        }),
      }),
    )
  })

  it('rejects a non-numeric radiusMiles', async () => {
    const result = await POST(
      makeRequest({
        kind: 'SEARCH_AREA',
        placeId: 'pl_sd',
        lat: 32.7157,
        lng: -117.1611,
        radiusMiles: 'wide',
      }),
    )

    expect(result).toEqual({ ok: false, status: 400, error: 'Invalid radiusMiles.' })
    expect(mocks.clientAddressCreate).not.toHaveBeenCalled()
  })

  it('creates a client search area with address privacy write fields', async () => {
    mocks.clientAddressCreate.mockResolvedValueOnce({
      id: 'addr_search_1',
      kind: ClientAddressKind.SEARCH_AREA,
      label: 'Near home',
      isDefault: true,
      formattedAddress: null,
      addressLine1: null,
      addressLine2: null,
      city: 'Los Angeles',
      state: 'CA',
      postalCode: '90001',
      countryCode: 'US',
      placeId: null,
      lat: null,
      lng: null,
      createdAt: new Date('2026-03-11T19:00:00.000Z'),
      updatedAt: new Date('2026-03-11T19:00:00.000Z'),
    })

    mocks.buildAddressPrivacyWriteData.mockReturnValueOnce({
      encryptedAddressJson: {
        v: 1,
        algorithm: 'plaintext-json-expand-phase',
        keyVersion: 'address-json-v1',
        address: {
          formattedAddress: null,
          addressLine1: null,
          addressLine2: null,
          city: 'Los Angeles',
          state: 'CA',
          postalCode: '90001',
          countryCode: 'US',
          placeId: null,
          lat: null,
          lng: null,
        },
      },
      addressKeyVersion: 'address-json-v1',
      postalCodePrefix: '90001',
      latApprox: null,
      lngApprox: null,
    })

    const result = await POST(
      makeRequest({
        kind: 'SEARCH_AREA',
        label: 'Near home',
        city: 'Los Angeles',
        state: 'CA',
        postalCode: '90001',
        countryCode: 'US',
      }),
    )

    expect(mocks.buildAddressPrivacyWriteData).toHaveBeenCalledWith({
      formattedAddress: null,
      addressLine1: null,
      addressLine2: null,
      city: 'Los Angeles',
      state: 'CA',
      postalCode: '90001',
      countryCode: 'US',
      placeId: null,
      lat: undefined,
      lng: undefined,
    })

    expect(mocks.clientAddressCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: ClientAddressKind.SEARCH_AREA,
          encryptedAddressJson: expect.objectContaining({
            v: 1,
            keyVersion: 'address-json-v1',
          }),
          addressKeyVersion: 'address-json-v1',
          postalCodePrefix: '90001',
          latApprox: null,
          lngApprox: null,
        }),
      }),
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
        kind: 'SERVICE_ADDRESS',
        label: 'Bad address',
      }),
    )

    expect(result).toEqual({
      ok: false,
      status: 400,
      error:
        'Service address needs a real address or formatted address before mobile booking.',
    })

    expect(mocks.buildAddressPrivacyWriteData).not.toHaveBeenCalled()
    expect(mocks.clientAddressCreate).not.toHaveBeenCalled()
  })
})