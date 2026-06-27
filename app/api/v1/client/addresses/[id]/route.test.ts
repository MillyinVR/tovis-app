// app/api/v1/client/addresses/[id]/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientAddressKind, Prisma } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),

  clientAddressFindFirst: vi.fn(),
  clientAddressFindUnique: vi.fn(),
  clientAddressUpdate: vi.fn(),
  clientAddressUpdateMany: vi.fn(),
  clientAddressDelete: vi.fn(),
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
      findFirst: mocks.clientAddressFindFirst,
      findUnique: mocks.clientAddressFindUnique,
      update: mocks.clientAddressUpdate,
      updateMany: mocks.clientAddressUpdateMany,
      delete: mocks.clientAddressDelete,
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

import { PATCH } from './route'

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/client/addresses/addr_1', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

function makeCtx(id = 'addr_1') {
  return {
    params: Promise.resolve({ id }),
  }
}

function makeExistingAddress(
  overrides: Partial<{
    id: string
    clientId: string
    kind: ClientAddressKind
    label: string | null
    isDefault: boolean
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
    createdAt: Date
    updatedAt: Date
  }> = {},
) {
  return {
    id: overrides.id ?? 'addr_1',
    clientId: overrides.clientId ?? 'client_1',
    kind: overrides.kind ?? ClientAddressKind.SERVICE_ADDRESS,
    label: overrides.label ?? 'Old Home',
    isDefault: overrides.isDefault ?? true,
    formattedAddress:
      overrides.formattedAddress ?? '111 Old St, Los Angeles, CA 90001',
    addressLine1: overrides.addressLine1 ?? '111 Old St',
    addressLine2: overrides.addressLine2 ?? null,
    city: overrides.city ?? 'Los Angeles',
    state: overrides.state ?? 'CA',
    postalCode: overrides.postalCode ?? '90001',
    countryCode: overrides.countryCode ?? 'US',
    placeId: overrides.placeId ?? 'old_place_1',
    lat: overrides.lat ?? new Prisma.Decimal('34.050000'),
    lng: overrides.lng ?? new Prisma.Decimal('-118.240000'),
    createdAt:
      overrides.createdAt ?? new Date('2026-03-11T18:00:00.000Z'),
    updatedAt:
      overrides.updatedAt ?? new Date('2026-03-11T18:30:00.000Z'),
  }
}

function makeUpdatedAddress() {
  return {
    id: 'addr_1',
    clientId: 'client_1',
    kind: ClientAddressKind.SERVICE_ADDRESS,
    label: 'New Home',
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
    createdAt: new Date('2026-03-11T18:00:00.000Z'),
    updatedAt: new Date('2026-03-11T19:00:00.000Z'),
  }
}

describe('PATCH /api/v1/client/addresses/[id]', () => {
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

    mocks.clientAddressFindFirst.mockResolvedValue(makeExistingAddress())
    mocks.clientAddressUpdateMany.mockResolvedValue({ count: 0 })
    mocks.clientAddressUpdate.mockResolvedValue({ id: 'addr_1' })
    mocks.clientAddressFindUnique.mockResolvedValue(makeUpdatedAddress())

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

    mocks.transaction.mockImplementation(async (callback: unknown) => {
      if (typeof callback !== 'function') {
        throw new Error('Expected transaction callback')
      }

      return callback({
        clientAddress: {
          findFirst: mocks.clientAddressFindFirst,
          findUnique: mocks.clientAddressFindUnique,
          update: mocks.clientAddressUpdate,
          updateMany: mocks.clientAddressUpdateMany,
          delete: mocks.clientAddressDelete,
        },
      })
    })
  })

  it('updates a client address with address privacy write fields from merged values', async () => {
    const result = await PATCH(
      makeRequest({
        label: 'New Home',
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
      }),
      makeCtx(),
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

    expect(mocks.clientAddressUpdate).toHaveBeenCalledWith({
      where: { id: 'addr_1' },
      data: {
        kind: ClientAddressKind.SERVICE_ADDRESS,
        label: 'New Home',
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
      select: { id: true },
    })

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: {
        address: {
          id: 'addr_1',
          kind: ClientAddressKind.SERVICE_ADDRESS,
          label: 'New Home',
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
          createdAt: '2026-03-11T18:00:00.000Z',
          updatedAt: '2026-03-11T19:00:00.000Z',
        },
      },
    })
  })

  it('builds address privacy data from existing values plus partial incoming changes', async () => {
    mocks.clientAddressFindFirst.mockResolvedValueOnce(
      makeExistingAddress({
        label: 'Old Home',
        formattedAddress: '111 Old St, Los Angeles, CA 90001',
        addressLine1: '111 Old St',
        addressLine2: null,
        city: 'Los Angeles',
        state: 'CA',
        postalCode: '90001',
        countryCode: 'US',
        placeId: 'old_place_1',
        lat: new Prisma.Decimal('34.050000'),
        lng: new Prisma.Decimal('-118.240000'),
      }),
    )

    await PATCH(
      makeRequest({
        addressLine2: 'Apt 9',
      }),
      makeCtx(),
    )

    expect(mocks.buildAddressPrivacyWriteData).toHaveBeenCalledWith({
      formattedAddress: '111 Old St, Los Angeles, CA 90001',
      addressLine1: '111 Old St',
      addressLine2: 'Apt 9',
      city: 'Los Angeles',
      state: 'CA',
      postalCode: '90001',
      countryCode: 'US',
      placeId: 'old_place_1',
      lat: 34.05,
      lng: -118.24,
    })

    expect(mocks.clientAddressUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          addressLine2: 'Apt 9',
          encryptedAddressJson: expect.any(Object),
          addressKeyVersion: 'address-json-v1',
          postalCodePrefix: '90001',
          latApprox: new Prisma.Decimal('34.0522'),
          lngApprox: new Prisma.Decimal('-118.2437'),
        }),
      }),
    )
  })

  it('does not build address privacy data when there is no change', async () => {
    const existing = makeExistingAddress()

    mocks.clientAddressFindFirst.mockResolvedValueOnce(existing)

    const result = await PATCH(makeRequest({}), makeCtx())

    expect(mocks.buildAddressPrivacyWriteData).not.toHaveBeenCalled()
    expect(mocks.clientAddressUpdate).not.toHaveBeenCalled()

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: {
        address: {
          id: existing.id,
          kind: existing.kind,
          label: existing.label,
          isDefault: existing.isDefault,
          formattedAddress: existing.formattedAddress,
          addressLine1: existing.addressLine1,
          addressLine2: existing.addressLine2,
          city: existing.city,
          state: existing.state,
          postalCode: existing.postalCode,
          countryCode: existing.countryCode,
          placeId: existing.placeId,
          lat: 34.05,
          lng: -118.24,
          createdAt: '2026-03-11T18:00:00.000Z',
          updatedAt: '2026-03-11T18:30:00.000Z',
        },
      },
    })
  })

  it('does not build address privacy data when validation fails', async () => {
    const result = await PATCH(
      makeRequest({
        formattedAddress: 'x'.repeat(501),
      }),
      makeCtx(),
    )

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Invalid formattedAddress.',
    })

    expect(mocks.buildAddressPrivacyWriteData).not.toHaveBeenCalled()
    expect(mocks.clientAddressUpdate).not.toHaveBeenCalled()
  })

  it('does not build address privacy data when updated service address is incomplete', async () => {
    mocks.clientAddressFindFirst.mockResolvedValueOnce(
      makeExistingAddress({
        formattedAddress: '111 Old St, Los Angeles, CA 90001',
        addressLine1: '111 Old St',
        city: 'Los Angeles',
        state: 'CA',
        postalCode: '90001',
        placeId: 'old_place_1',
        lat: new Prisma.Decimal('34.050000'),
        lng: new Prisma.Decimal('-118.240000'),
      }),
    )

    const result = await PATCH(
      makeRequest({
        formattedAddress: null,
        addressLine1: null,
        city: null,
        state: null,
        postalCode: null,
        placeId: null,
        lat: null,
        lng: null,
      }),
      makeCtx(),
    )

    expect(result).toEqual({
      ok: false,
      status: 400,
      error:
        'Service address needs a real address or formatted address before mobile booking.',
    })

    expect(mocks.buildAddressPrivacyWriteData).not.toHaveBeenCalled()
    expect(mocks.clientAddressUpdate).not.toHaveBeenCalled()
  })
})