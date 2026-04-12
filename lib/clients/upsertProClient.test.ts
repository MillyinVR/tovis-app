import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientClaimStatus, Role } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  prisma: {
    clientProfile: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

import { upsertProClient } from './upsertProClient'

function makeProfile(overrides?: {
  id?: string
  userId?: string | null
  claimStatus?: ClientClaimStatus
  claimedAt?: Date | null
  firstName?: string
  lastName?: string
  email?: string | null
  phone?: string | null
  user?: {
    id: string
    role: Role
    email: string | null
    phone: string | null
  } | null
}) {
  return {
    id: overrides?.id ?? 'client_1',
    userId: overrides?.userId ?? null,
    claimStatus: overrides?.claimStatus ?? ClientClaimStatus.UNCLAIMED,
    claimedAt: overrides?.claimedAt ?? null,
    firstName: overrides?.firstName ?? '',
    lastName: overrides?.lastName ?? '',
    email: overrides?.email ?? null,
    phone: overrides?.phone ?? null,
    user: overrides?.user ?? null,
  }
}

function makeUser(overrides?: {
  id?: string
  role?: Role
  email?: string | null
  phone?: string | null
  clientProfile?: ReturnType<typeof makeProfile> | null
}) {
  return {
    id: overrides?.id ?? 'user_1',
    role: overrides?.role ?? Role.CLIENT,
    email: overrides?.email ?? 'client@example.com',
    phone: overrides?.phone ?? null,
    clientProfile: overrides?.clientProfile ?? null,
  }
}

describe('upsertProClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.prisma.clientProfile.findUnique.mockResolvedValue(null)
    mocks.prisma.clientProfile.update.mockResolvedValue(null)
    mocks.prisma.clientProfile.create.mockResolvedValue(null)
    mocks.prisma.user.findMany.mockResolvedValue([])
  })

  it('returns VALIDATION_ERROR when first name, last name, and both contact fields are missing', async () => {
    const result = await upsertProClient({
      firstName: '',
      lastName: '  ',
      email: undefined,
      phone: undefined,
    })

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'First name, last name, and either email or phone are required.',
      code: 'VALIDATION_ERROR',
    })

    expect(mocks.prisma.clientProfile.findUnique).not.toHaveBeenCalled()
    expect(mocks.prisma.user.findMany).not.toHaveBeenCalled()
  })

  it('returns IDENTITY_CONFLICT when email and phone match different client profiles', async () => {
    mocks.prisma.clientProfile.findUnique
      .mockResolvedValueOnce(
        makeProfile({
          id: 'client_email_match',
          email: 'tori@example.com',
        }),
      )
      .mockResolvedValueOnce(
        makeProfile({
          id: 'client_phone_match',
          phone: '+16195551234',
        }),
      )

    const result = await upsertProClient({
      firstName: 'Tori',
      lastName: 'Morales',
      email: 'tori@example.com',
      phone: '+16195551234',
    })

    expect(result).toEqual({
      ok: false,
      status: 409,
      error:
        'That email and phone match different client profiles. Please double check with the client before continuing.',
      code: 'IDENTITY_CONFLICT',
    })

    expect(mocks.prisma.user.findMany).not.toHaveBeenCalled()
  })

  it('returns DATA_INTEGRITY_ERROR when a matched profile is linked to a non-client user', async () => {
    mocks.prisma.clientProfile.findUnique
      .mockResolvedValueOnce(
        makeProfile({
          id: 'client_1',
          email: 'tori@example.com',
          userId: 'user_pro_1',
          user: {
            id: 'user_pro_1',
            role: Role.PRO,
            email: 'tori@example.com',
            phone: null,
          },
        }),
      )
      .mockResolvedValueOnce(null)

    const result = await upsertProClient({
      firstName: 'Tori',
      lastName: 'Morales',
      email: 'tori@example.com',
    })

    expect(result).toEqual({
      ok: false,
      status: 409,
      error:
        'Matched client profile is linked to a non-client user. Please resolve this before continuing.',
      code: 'DATA_INTEGRITY_ERROR',
    })
  })

  it('reuses a matched client profile and fills only missing fields', async () => {
    const existingProfile = makeProfile({
      id: 'client_1',
      firstName: '',
      lastName: '',
      email: 'tori@example.com',
      phone: null,
      claimStatus: ClientClaimStatus.UNCLAIMED,
      userId: null,
    })

    const updatedProfile = makeProfile({
      ...existingProfile,
      firstName: 'Tori',
      lastName: 'Morales',
      phone: '+16195551234',
    })

    mocks.prisma.clientProfile.findUnique
      .mockResolvedValueOnce(existingProfile)
      .mockResolvedValueOnce(null)

    mocks.prisma.clientProfile.update.mockResolvedValueOnce(updatedProfile)

    const result = await upsertProClient({
      firstName: 'Tori',
      lastName: 'Morales',
      email: 'tori@example.com',
      phone: '+16195551234',
    })

    expect(mocks.prisma.clientProfile.update).toHaveBeenCalledWith({
      where: { id: 'client_1' },
      data: {
        firstName: 'Tori',
        lastName: 'Morales',
        phone: '+16195551234',
      },
      select: expect.any(Object),
    })

    expect(result).toEqual({
      ok: true,
      clientId: 'client_1',
      userId: null,
      email: 'tori@example.com',
      claimStatus: ClientClaimStatus.UNCLAIMED,
    })
  })

  it('returns CONTACT_IN_USE_BY_NON_CLIENT when a matching user is not a client', async () => {
    mocks.prisma.clientProfile.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)

    mocks.prisma.user.findMany.mockResolvedValueOnce([
      makeUser({
        id: 'user_pro_1',
        role: Role.PRO,
        email: 'tori@example.com',
      }),
    ])

    const result = await upsertProClient({
      firstName: 'Tori',
      lastName: 'Morales',
      email: 'tori@example.com',
    })

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'That email or phone is already used by a non-client account.',
      code: 'CONTACT_IN_USE_BY_NON_CLIENT',
    })
  })

  it('creates a claimed profile for an existing matched client user without a client profile', async () => {
    mocks.prisma.clientProfile.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)

    mocks.prisma.user.findMany.mockResolvedValueOnce([
      makeUser({
        id: 'user_client_1',
        role: Role.CLIENT,
        email: 'tori@example.com',
        phone: '+16195551234',
        clientProfile: null,
      }),
    ])

    mocks.prisma.clientProfile.create.mockResolvedValueOnce(
      makeProfile({
        id: 'client_1',
        userId: 'user_client_1',
        claimStatus: ClientClaimStatus.CLAIMED,
        claimedAt: new Date('2026-04-12T00:00:00.000Z'),
        firstName: 'Tori',
        lastName: 'Morales',
        email: 'tori@example.com',
        phone: '+16195551234',
        user: {
          id: 'user_client_1',
          role: Role.CLIENT,
          email: 'tori@example.com',
          phone: '+16195551234',
        },
      }),
    )

    const result = await upsertProClient({
      firstName: 'Tori',
      lastName: 'Morales',
      email: 'tori@example.com',
      phone: '+16195551234',
    })

    expect(mocks.prisma.clientProfile.create).toHaveBeenCalledWith({
      data: {
        userId: 'user_client_1',
        firstName: 'Tori',
        lastName: 'Morales',
        claimStatus: ClientClaimStatus.CLAIMED,
        claimedAt: expect.any(Date),
        email: 'tori@example.com',
        phone: '+16195551234',
      },
      select: expect.any(Object),
    })

    expect(result).toEqual({
      ok: true,
      clientId: 'client_1',
      userId: 'user_client_1',
      email: 'tori@example.com',
      claimStatus: ClientClaimStatus.CLAIMED,
    })
  })

  it('reuses an existing client user profile and repairs claim state when needed', async () => {
    mocks.prisma.clientProfile.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)

    const existingUserProfile = makeProfile({
      id: 'client_1',
      userId: 'user_client_1',
      claimStatus: ClientClaimStatus.UNCLAIMED,
      claimedAt: null,
      firstName: '',
      lastName: '',
      email: null,
      phone: null,
      user: {
        id: 'user_client_1',
        role: Role.CLIENT,
        email: 'tori@example.com',
        phone: '+16195551234',
      },
    })

    mocks.prisma.user.findMany.mockResolvedValueOnce([
      makeUser({
        id: 'user_client_1',
        role: Role.CLIENT,
        email: 'tori@example.com',
        phone: '+16195551234',
        clientProfile: existingUserProfile,
      }),
    ])

    mocks.prisma.clientProfile.update.mockResolvedValueOnce(
      makeProfile({
        id: 'client_1',
        userId: 'user_client_1',
        claimStatus: ClientClaimStatus.CLAIMED,
        claimedAt: new Date('2026-04-12T00:00:00.000Z'),
        firstName: 'Tori',
        lastName: 'Morales',
        email: 'tori@example.com',
        phone: '+16195551234',
        user: {
          id: 'user_client_1',
          role: Role.CLIENT,
          email: 'tori@example.com',
          phone: '+16195551234',
        },
      }),
    )

    const result = await upsertProClient({
      firstName: 'Tori',
      lastName: 'Morales',
      email: 'tori@example.com',
      phone: '+16195551234',
    })

    expect(mocks.prisma.clientProfile.update).toHaveBeenCalledWith({
      where: { id: 'client_1' },
      data: {
        firstName: 'Tori',
        lastName: 'Morales',
        email: 'tori@example.com',
        phone: '+16195551234',
        claimStatus: ClientClaimStatus.CLAIMED,
        claimedAt: expect.any(Date),
      },
      select: expect.any(Object),
    })

    expect(result).toEqual({
      ok: true,
      clientId: 'client_1',
      userId: 'user_client_1',
      email: 'tori@example.com',
      claimStatus: ClientClaimStatus.CLAIMED,
    })
  })

  it('creates a new unclaimed client profile when no match exists', async () => {
    mocks.prisma.clientProfile.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)

    mocks.prisma.user.findMany.mockResolvedValueOnce([])

    mocks.prisma.clientProfile.create.mockResolvedValueOnce(
      makeProfile({
        id: 'client_new_1',
        userId: null,
        claimStatus: ClientClaimStatus.UNCLAIMED,
        claimedAt: null,
        firstName: 'Tori',
        lastName: 'Morales',
        email: 'tori@example.com',
        phone: null,
        user: null,
      }),
    )

    const result = await upsertProClient({
      firstName: 'Tori',
      lastName: 'Morales',
      email: 'tori@example.com',
    })

    expect(mocks.prisma.clientProfile.create).toHaveBeenCalledWith({
      data: {
        userId: null,
        firstName: 'Tori',
        lastName: 'Morales',
        claimStatus: ClientClaimStatus.UNCLAIMED,
        claimedAt: null,
        email: 'tori@example.com',
        phone: null,
      },
      select: expect.any(Object),
    })

    expect(result).toEqual({
      ok: true,
      clientId: 'client_new_1',
      userId: null,
      email: 'tori@example.com',
      claimStatus: ClientClaimStatus.UNCLAIMED,
    })
  })
    it('returns IDENTITY_CONFLICT when email and phone match different user accounts', async () => {
    mocks.prisma.clientProfile.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)

    mocks.prisma.user.findMany.mockResolvedValueOnce([
      makeUser({
        id: 'user_email_1',
        role: Role.CLIENT,
        email: 'tori@example.com',
        phone: null,
      }),
      makeUser({
        id: 'user_phone_1',
        role: Role.CLIENT,
        email: null,
        phone: '+16195551234',
      }),
    ])

    const result = await upsertProClient({
      firstName: 'Tori',
      lastName: 'Morales',
      email: 'tori@example.com',
      phone: '+16195551234',
    })

    expect(result).toEqual({
      ok: false,
      status: 409,
      error:
        'That email and phone match different user accounts. Please double check with the client before continuing.',
      code: 'IDENTITY_CONFLICT',
    })
  })

  it('does not overwrite populated fields on a matched client profile', async () => {
    const existingProfile = makeProfile({
      id: 'client_1',
      userId: null,
      claimStatus: ClientClaimStatus.UNCLAIMED,
      claimedAt: null,
      firstName: 'Existing',
      lastName: 'Client',
      email: 'existing@example.com',
      phone: '+16195550000',
      user: null,
    })

    mocks.prisma.clientProfile.findUnique
      .mockResolvedValueOnce(existingProfile)
      .mockResolvedValueOnce(null)

    const result = await upsertProClient({
      firstName: 'New',
      lastName: 'Name',
      email: 'existing@example.com',
      phone: '+16195559999',
    })

    expect(mocks.prisma.clientProfile.update).not.toHaveBeenCalled()

    expect(result).toEqual({
      ok: true,
      clientId: 'client_1',
      userId: null,
      email: 'existing@example.com',
      claimStatus: ClientClaimStatus.UNCLAIMED,
    })
  })

  it('creates a new unclaimed client profile when only phone is provided and no match exists', async () => {
    mocks.prisma.clientProfile.findUnique.mockResolvedValueOnce(null)
    mocks.prisma.user.findMany.mockResolvedValueOnce([])

    mocks.prisma.clientProfile.create.mockResolvedValueOnce(
      makeProfile({
        id: 'client_phone_only_1',
        userId: null,
        claimStatus: ClientClaimStatus.UNCLAIMED,
        claimedAt: null,
        firstName: 'Phone',
        lastName: 'Only',
        email: null,
        phone: '+16195551234',
        user: null,
      }),
    )

    const result = await upsertProClient({
      firstName: 'Phone',
      lastName: 'Only',
      phone: '+16195551234',
    })

    expect(mocks.prisma.clientProfile.create).toHaveBeenCalledWith({
      data: {
        userId: null,
        firstName: 'Phone',
        lastName: 'Only',
        claimStatus: ClientClaimStatus.UNCLAIMED,
        claimedAt: null,
        email: null,
        phone: '+16195551234',
      },
      select: expect.any(Object),
    })

    expect(result).toEqual({
      ok: true,
      clientId: 'client_phone_only_1',
      userId: null,
      email: null,
      claimStatus: ClientClaimStatus.UNCLAIMED,
    })
  })
})