import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ClientAddressKind,
  ClientClaimStatus,
  Prisma,
  ServiceLocationType,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  prisma: {
    clientProfile: {
      findUnique: vi.fn(),
    },
    clientAddress: {
      findFirst: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  upsertProClient: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/lib/clients/upsertProClient', () => ({
  upsertProClient: mocks.upsertProClient,
}))

import { resolveProBookingClient } from './resolveProBookingClient'

function makeResolvedClient(overrides?: {
  id?: string
  userId?: string | null
  claimStatus?: ClientClaimStatus
  email?: string | null
  userEmail?: string | null
}) {
  return {
    id: overrides?.id !== undefined ? overrides.id : 'client_1',
    userId: overrides?.userId !== undefined ? overrides.userId : 'user_client_1',
    claimStatus:
      overrides?.claimStatus !== undefined
        ? overrides.claimStatus
        : ClientClaimStatus.CLAIMED,
    email: overrides?.email !== undefined ? overrides.email : 'client@example.com',
    user: {
      email:
        overrides?.userEmail !== undefined
          ? overrides.userEmail
          : 'client@example.com',
    },
  }
}

describe('resolveProBookingClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.prisma.clientProfile.findUnique.mockResolvedValue(null)
    mocks.prisma.clientAddress.findFirst.mockResolvedValue(null)
    mocks.prisma.clientAddress.count.mockResolvedValue(0)
    mocks.prisma.clientAddress.updateMany.mockResolvedValue({ count: 0 })
    mocks.prisma.clientAddress.create.mockResolvedValue({ id: 'addr_new_1' })

    mocks.prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mocks.prisma) => Promise<unknown>) =>
        callback(mocks.prisma),
    )

    mocks.upsertProClient.mockResolvedValue({
      ok: true,
      clientId: 'client_new_1',
      userId: null,
      email: 'newclient@example.com',
      claimStatus: ClientClaimStatus.UNCLAIMED,
    })
  })

  it('returns real DB truth for an existing non-mobile clientId path', async () => {
    mocks.prisma.clientProfile.findUnique.mockResolvedValueOnce(
      makeResolvedClient({
        id: 'client_existing_1',
        userId: 'user_existing_1',
        claimStatus: ClientClaimStatus.CLAIMED,
        email: null,
        userEmail: 'claimed@example.com',
      }),
    )

    const result = await resolveProBookingClient({
      locationType: ServiceLocationType.SALON,
      clientId: 'client_existing_1',
    })

    expect(mocks.prisma.clientProfile.findUnique).toHaveBeenCalledWith({
      where: { id: 'client_existing_1' },
      select: expect.any(Object),
    })

    expect(mocks.upsertProClient).not.toHaveBeenCalled()

    expect(result).toEqual({
      ok: true,
      clientId: 'client_existing_1',
      clientUserId: 'user_existing_1',
      clientEmail: 'claimed@example.com',
      clientClaimStatus: ClientClaimStatus.CLAIMED,
      clientAddressId: null,
    })
  })

  it('returns CLIENT_NOT_FOUND when an existing clientId does not exist', async () => {
    mocks.prisma.clientProfile.findUnique.mockResolvedValueOnce(null)

    const result = await resolveProBookingClient({
      locationType: ServiceLocationType.SALON,
      clientId: 'missing_client',
    })

    expect(result).toEqual({
      ok: false,
      status: 404,
      error: 'Client not found.',
      code: 'CLIENT_NOT_FOUND',
    })

    expect(mocks.upsertProClient).not.toHaveBeenCalled()
  })

  it('delegates new client creation/reuse to upsertProClient and returns claim status', async () => {
    const result = await resolveProBookingClient({
      locationType: ServiceLocationType.SALON,
      client: {
        firstName: 'Tori',
        lastName: 'Morales',
        email: 'tori@example.com',
        phone: '+16195551234',
      },
    })

    expect(mocks.upsertProClient).toHaveBeenCalledWith({
      firstName: 'Tori',
      lastName: 'Morales',
      email: 'tori@example.com',
      phone: '+16195551234',
      tx: undefined,
    })

    expect(result).toEqual({
      ok: true,
      clientId: 'client_new_1',
      clientUserId: null,
      clientEmail: 'newclient@example.com',
      clientClaimStatus: ClientClaimStatus.UNCLAIMED,
      clientAddressId: null,
    })
  })

  it('passes through helper failures from upsertProClient unchanged', async () => {
    mocks.upsertProClient.mockResolvedValueOnce({
      ok: false,
      status: 409,
      error:
        'That email and phone match different client profiles. Please double check with the client before continuing.',
      code: 'IDENTITY_CONFLICT',
    })

    const result = await resolveProBookingClient({
      locationType: ServiceLocationType.SALON,
      client: {
        firstName: 'Tori',
        lastName: 'Morales',
        email: 'tori@example.com',
        phone: '+16195551234',
      },
    })

    expect(result).toEqual({
      ok: false,
      status: 409,
      error:
        'That email and phone match different client profiles. Please double check with the client before continuing.',
      code: 'IDENTITY_CONFLICT',
    })
  })

  it('returns a valid saved mobile service address when clientAddressId belongs to the client', async () => {
    mocks.prisma.clientProfile.findUnique.mockResolvedValueOnce(
      makeResolvedClient({
        id: 'client_mobile_1',
        userId: null,
        claimStatus: ClientClaimStatus.UNCLAIMED,
        email: 'mobile@example.com',
      }),
    )

    mocks.prisma.clientAddress.findFirst.mockResolvedValueOnce({
      id: 'addr_existing_1',
    })

    const result = await resolveProBookingClient({
      locationType: ServiceLocationType.MOBILE,
      clientId: 'client_mobile_1',
      clientAddressId: 'addr_existing_1',
    })

    expect(mocks.prisma.clientAddress.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'addr_existing_1',
        clientId: 'client_mobile_1',
        kind: ClientAddressKind.SERVICE_ADDRESS,
      },
      select: {
        id: true,
      },
    })

    expect(result).toEqual({
      ok: true,
      clientId: 'client_mobile_1',
      clientUserId: null,
      clientEmail: 'mobile@example.com',
      clientClaimStatus: ClientClaimStatus.UNCLAIMED,
      clientAddressId: 'addr_existing_1',
    })
  })

  it('returns CLIENT_SERVICE_ADDRESS_INVALID when a provided mobile clientAddressId is not owned by the client', async () => {
    mocks.prisma.clientProfile.findUnique.mockResolvedValueOnce(
      makeResolvedClient({
        id: 'client_mobile_1',
        userId: null,
        claimStatus: ClientClaimStatus.UNCLAIMED,
        email: 'mobile@example.com',
      }),
    )

    mocks.prisma.clientAddress.findFirst.mockResolvedValueOnce(null)

    const result = await resolveProBookingClient({
      locationType: ServiceLocationType.MOBILE,
      clientId: 'client_mobile_1',
      clientAddressId: 'addr_wrong_1',
    })

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Please choose a valid saved service address.',
      code: 'CLIENT_SERVICE_ADDRESS_INVALID',
    })
  })

  it('returns CLIENT_SERVICE_ADDRESS_REQUIRED for mobile bookings without a saved address or address payload', async () => {
    mocks.prisma.clientProfile.findUnique.mockResolvedValueOnce(
      makeResolvedClient({
        id: 'client_mobile_1',
        userId: null,
        claimStatus: ClientClaimStatus.UNCLAIMED,
        email: 'mobile@example.com',
      }),
    )

    const result = await resolveProBookingClient({
      locationType: ServiceLocationType.MOBILE,
      clientId: 'client_mobile_1',
    })

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Mobile bookings require a saved client service address.',
      code: 'CLIENT_SERVICE_ADDRESS_REQUIRED',
    })

    expect(mocks.prisma.clientAddress.create).not.toHaveBeenCalled()
  })

  it('returns CLIENT_SERVICE_ADDRESS_INVALID when a new service address payload is malformed', async () => {
    mocks.prisma.clientProfile.findUnique.mockResolvedValueOnce(
      makeResolvedClient({
        id: 'client_mobile_1',
        userId: null,
        claimStatus: ClientClaimStatus.UNCLAIMED,
        email: 'mobile@example.com',
      }),
    )

    const result = await resolveProBookingClient({
      locationType: ServiceLocationType.MOBILE,
      clientId: 'client_mobile_1',
      serviceAddress: {
        formattedAddress: '123 Main St, San Diego, CA',
        addressLine1: '123 Main St',
        city: 'San Diego',
        state: 'CA',
        postalCode: '92101',
        lat: 'not-a-number',
      },
    })

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Invalid lat.',
      code: 'CLIENT_SERVICE_ADDRESS_INVALID',
    })

    expect(mocks.prisma.clientAddress.create).not.toHaveBeenCalled()
  })

  it('creates a new mobile service address and returns its id', async () => {
    mocks.prisma.clientProfile.findUnique.mockResolvedValueOnce(
      makeResolvedClient({
        id: 'client_mobile_1',
        userId: null,
        claimStatus: ClientClaimStatus.UNCLAIMED,
        email: 'mobile@example.com',
      }),
    )

    mocks.prisma.clientAddress.count.mockResolvedValueOnce(0)
    mocks.prisma.clientAddress.updateMany.mockResolvedValueOnce({ count: 0 })
    mocks.prisma.clientAddress.create.mockResolvedValueOnce({
      id: 'addr_new_1',
    })

    const result = await resolveProBookingClient({
      locationType: ServiceLocationType.MOBILE,
      clientId: 'client_mobile_1',
      serviceAddress: {
        label: 'Home',
        formattedAddress: '123 Main St, San Diego, CA 92101',
        addressLine1: '123 Main St',
        addressLine2: 'Apt 2',
        city: 'San Diego',
        state: 'CA',
        postalCode: '92101',
        countryCode: 'US',
        placeId: 'place_123',
        lat: 32.7157,
        lng: -117.1611,
        isDefault: true,
      },
    })

    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(mocks.prisma.clientAddress.count).toHaveBeenCalledWith({
      where: {
        clientId: 'client_mobile_1',
        kind: ClientAddressKind.SERVICE_ADDRESS,
      },
    })
    expect(mocks.prisma.clientAddress.updateMany).toHaveBeenCalledWith({
      where: {
        clientId: 'client_mobile_1',
        kind: ClientAddressKind.SERVICE_ADDRESS,
        isDefault: true,
      },
      data: {
        isDefault: false,
      },
    })

    const createCallArg = mocks.prisma.clientAddress.create.mock.calls[0]?.[0]
    expect(createCallArg).toBeDefined()
    expect(createCallArg).toMatchObject({
      data: {
        clientId: 'client_mobile_1',
        kind: ClientAddressKind.SERVICE_ADDRESS,
        isDefault: true,
        label: 'Home',
        formattedAddress: '123 Main St, San Diego, CA 92101',
        addressLine1: '123 Main St',
        addressLine2: 'Apt 2',
        city: 'San Diego',
        state: 'CA',
        postalCode: '92101',
        countryCode: 'US',
        placeId: 'place_123',
      },
      select: {
        id: true,
      },
    })

    expect(createCallArg.data.lat).toBeInstanceOf(Prisma.Decimal)
    expect(createCallArg.data.lng).toBeInstanceOf(Prisma.Decimal)
    expect(createCallArg.data.lat.toString()).toBe('32.7157')
    expect(createCallArg.data.lng.toString()).toBe('-117.1611')

    expect(result).toEqual({
      ok: true,
      clientId: 'client_mobile_1',
      clientUserId: null,
      clientEmail: 'mobile@example.com',
      clientClaimStatus: ClientClaimStatus.UNCLAIMED,
      clientAddressId: 'addr_new_1',
    })
  })
})