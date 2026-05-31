import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientClaimStatus, Role } from '@prisma/client'

import {
  clearContactLookupHmacKeyringCacheForTests,
  CONTACT_LOOKUP_HMAC_KEY_VERSION,
  emailLookupHash,
  emailLookupHashV2,
  phoneLookupHash,
  phoneLookupHashV2,
} from '@/lib/security/crypto/hashLookup'

const TEST_HMAC_KEY = Buffer.alloc(32, 7).toString('base64')

const mocks = vi.hoisted(() => ({
  prisma: {
    clientProfile: {
      findMany: vi.fn(),
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

type TestUser = {
  id: string
  role: Role
  email: string | null
  emailHash: string | null
  emailHashV2: string | null
  emailHashKeyVersion: number | null
  phone: string | null
  phoneHash: string | null
  phoneHashV2: string | null
  phoneHashKeyVersion: number | null
}

type TestProfile = {
  id: string
  userId: string | null
  claimStatus: ClientClaimStatus
  claimedAt: Date | null
  firstName: string
  lastName: string
  email: string | null
  emailHash: string | null
  emailHashV2: string | null
  emailHashKeyVersion: number | null
  phone: string | null
  phoneHash: string | null
  phoneHashV2: string | null
  phoneHashKeyVersion: number | null
  user: TestUser | null
}

type MakeUserOverrides = Partial<TestUser> & {
  clientProfile?: TestProfile | null
}

type TestUserWithProfile = TestUser & {
  clientProfile: TestProfile | null
}

type MakeProfileOverrides = Partial<Omit<TestProfile, 'user'>> & {
  user?: TestUser | null
}

function expectedEmailLookupData(email: string | null) {
  const emailHashV2 = emailLookupHashV2(email)

  return {
    emailHash: emailLookupHash(email),
    emailHashV2: emailHashV2?.hash ?? null,
    emailHashKeyVersion: emailHashV2?.keyVersion ?? null,
  }
}

function expectedPhoneLookupData(phone: string | null) {
  const phoneHashV2 = phoneLookupHashV2(phone)

  return {
    phoneHash: phoneLookupHash(phone),
    phoneHashV2: phoneHashV2?.hash ?? null,
    phoneHashKeyVersion: phoneHashV2?.keyVersion ?? null,
  }
}

function makeProfile(overrides: MakeProfileOverrides = {}): TestProfile {
  const email = overrides.email ?? null
  const phone = overrides.phone ?? null

  const emailLookup = expectedEmailLookupData(email)
  const phoneLookup = expectedPhoneLookupData(phone)

  return {
    id: overrides.id ?? 'client_1',
    userId: overrides.userId ?? null,
    claimStatus: overrides.claimStatus ?? ClientClaimStatus.UNCLAIMED,
    claimedAt: overrides.claimedAt ?? null,
    firstName: overrides.firstName ?? '',
    lastName: overrides.lastName ?? '',
    email,
    emailHash: overrides.emailHash ?? emailLookup.emailHash,
    emailHashV2: overrides.emailHashV2 ?? emailLookup.emailHashV2,
    emailHashKeyVersion:
      overrides.emailHashKeyVersion ?? emailLookup.emailHashKeyVersion,
    phone,
    phoneHash: overrides.phoneHash ?? phoneLookup.phoneHash,
    phoneHashV2: overrides.phoneHashV2 ?? phoneLookup.phoneHashV2,
    phoneHashKeyVersion:
      overrides.phoneHashKeyVersion ?? phoneLookup.phoneHashKeyVersion,
    user: overrides.user ?? null,
  }
}

function makeUser(overrides: MakeUserOverrides = {}): TestUserWithProfile {
  const email = overrides.email ?? 'client@example.com'
  const phone = overrides.phone ?? null

  const emailLookup = expectedEmailLookupData(email)
  const phoneLookup = expectedPhoneLookupData(phone)

  return {
    id: overrides.id ?? 'user_1',
    role: overrides.role ?? Role.CLIENT,
    email,
    emailHash: overrides.emailHash ?? emailLookup.emailHash,
    emailHashV2: overrides.emailHashV2 ?? emailLookup.emailHashV2,
    emailHashKeyVersion:
      overrides.emailHashKeyVersion ?? emailLookup.emailHashKeyVersion,
    phone,
    phoneHash: overrides.phoneHash ?? phoneLookup.phoneHash,
    phoneHashV2: overrides.phoneHashV2 ?? phoneLookup.phoneHashV2,
    phoneHashKeyVersion:
      overrides.phoneHashKeyVersion ?? phoneLookup.phoneHashKeyVersion,
    clientProfile: overrides.clientProfile ?? null,
  }
}

function whereMatchesProfile(
  where: Record<string, unknown>,
  profile: TestProfile,
): boolean {
  if (where.emailHashV2 && profile.emailHashV2 === where.emailHashV2) {
    return true
  }

  if (
    where.emailHashKeyVersion &&
    profile.emailHashKeyVersion === where.emailHashKeyVersion
  ) {
    if (!where.emailHashV2 || profile.emailHashV2 === where.emailHashV2) {
      return true
    }
  }

  if (where.phoneHashV2 && profile.phoneHashV2 === where.phoneHashV2) {
    return true
  }

  if (
    where.phoneHashKeyVersion &&
    profile.phoneHashKeyVersion === where.phoneHashKeyVersion
  ) {
    if (!where.phoneHashV2 || profile.phoneHashV2 === where.phoneHashV2) {
      return true
    }
  }

  if (where.emailHash && profile.emailHash === where.emailHash) {
    return true
  }

  if (where.phoneHash && profile.phoneHash === where.phoneHash) {
    return true
  }

  if (where.id && profile.id === where.id) {
    return true
  }

  if (where.userId && profile.userId === where.userId) {
    return true
  }

  return false
}

function mockClientProfileLookupByWhere(profiles: TestProfile[]) {
  mocks.prisma.clientProfile.findMany.mockImplementation(
    async (args: { where?: { OR?: Record<string, unknown>[] } }) => {
      const orConditions = args.where?.OR ?? []

      return profiles.filter((profile) =>
        orConditions.some((where) => whereMatchesProfile(where, profile)),
      )
    },
  )

  mocks.prisma.clientProfile.findUnique.mockImplementation(
    async (args: { where?: Record<string, unknown> }) => {
      const where = args.where ?? {}

      return profiles.find((profile) => whereMatchesProfile(where, profile)) ?? null
    },
  )
}

describe('upsertProClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    process.env.PII_LOOKUP_HMAC_KEYS_JSON = JSON.stringify({
      [CONTACT_LOOKUP_HMAC_KEY_VERSION]: TEST_HMAC_KEY,
    })
    clearContactLookupHmacKeyringCacheForTests()

    mocks.prisma.clientProfile.findMany.mockResolvedValue([])
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

    expect(mocks.prisma.clientProfile.findMany).not.toHaveBeenCalled()
    expect(mocks.prisma.clientProfile.findUnique).not.toHaveBeenCalled()
  })

  it('returns IDENTITY_CONFLICT when email and phone match different client profiles', async () => {
    mockClientProfileLookupByWhere([
      makeProfile({
        id: 'client_email_match',
        email: 'tori@example.com',
        phone: null,
      }),
      makeProfile({
        id: 'client_phone_match',
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
        'That email and phone match different client profiles. Please double check with the client before continuing.',
      code: 'IDENTITY_CONFLICT',
    })

    expect(mocks.prisma.user.findMany).not.toHaveBeenCalled()
  })

  it('matches an existing client profile by emailHashV2 before legacy email hash without plaintext fallback', async () => {
    const existingProfile = makeProfile({
      id: 'client_hash_match',
      firstName: 'Existing',
      lastName: 'Client',
      email: 'tori@example.com',
      phone: null,
    })

    mockClientProfileLookupByWhere([existingProfile])

    const result = await upsertProClient({
      firstName: 'Tori',
      lastName: 'Morales',
      email: ' Tori@Example.COM ',
    })

    const emailHashV2 = emailLookupHashV2('tori@example.com')
    expect(emailHashV2).not.toBeNull()

    expect(mocks.prisma.clientProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: expect.arrayContaining([
            {
              emailHashV2: emailHashV2?.hash,
              emailHashKeyVersion: emailHashV2?.keyVersion,
            },
            {
              emailHash: emailLookupHash('tori@example.com'),
            },
          ]),
        },
      }),
    )

    const profileLookupCall = mocks.prisma.clientProfile.findMany.mock.calls[0]?.[0] as {
        where: { OR: Array<Record<string, unknown>> }
      }

      expect(profileLookupCall.where.OR).not.toContainEqual({
        email: 'tori@example.com',
      })

    expect(result).toEqual({
      ok: true,
      clientId: 'client_hash_match',
      userId: null,
      email: 'tori@example.com',
      claimStatus: ClientClaimStatus.UNCLAIMED,
    })
  })

  it('returns DATA_INTEGRITY_ERROR when a matched profile is linked to a non-client user', async () => {
    const existingProfile = makeProfile({
      id: 'client_1',
      email: 'tori@example.com',
      userId: 'user_pro_1',
      user: {
        id: 'user_pro_1',
        role: Role.PRO,
        email: 'tori@example.com',
        ...expectedEmailLookupData('tori@example.com'),
        phone: null,
        ...expectedPhoneLookupData(null),
      },
    })

    mockClientProfileLookupByWhere([existingProfile])

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

  it('does not include plaintext phone fallback in client profile lookup', async () => {
    mocks.prisma.clientProfile.findMany.mockResolvedValueOnce([])
    mocks.prisma.user.findMany.mockResolvedValueOnce([])
    mocks.prisma.clientProfile.create.mockResolvedValueOnce(
      makeProfile({
        id: 'client_phone_only_1',
        firstName: 'Tori',
        lastName: 'Morales',
        email: null,
        phone: '+16195551234',
      }),
    )

    const result = await upsertProClient({
      firstName: 'Tori',
      lastName: 'Morales',
      phone: '+16195551234',
    })

    expect(result.ok).toBe(true)

    const phoneHashV2 = phoneLookupHashV2('+16195551234')
    expect(phoneHashV2).not.toBeNull()

    const profileLookupCall = mocks.prisma.clientProfile.findMany.mock.calls[0]?.[0] as {
      where: { OR: Array<Record<string, unknown>> }
    }

    expect(profileLookupCall.where.OR).toEqual(
      expect.arrayContaining([
        {
          phoneHashV2: phoneHashV2?.hash,
          phoneHashKeyVersion: phoneHashV2?.keyVersion,
        },
        {
          phoneHash: phoneLookupHash('+16195551234'),
        },
      ]),
    )

    expect(profileLookupCall.where.OR).not.toContainEqual({
      phone: '+16195551234',
    })
  })  

  it('does not include plaintext email or phone fallback in user lookup', async () => {
    mocks.prisma.clientProfile.findMany.mockResolvedValueOnce([])
    mocks.prisma.user.findMany.mockResolvedValueOnce([])
    mocks.prisma.clientProfile.create.mockResolvedValueOnce(
      makeProfile({
        id: 'client_new_1',
        firstName: 'Tori',
        lastName: 'Morales',
        email: 'tori@example.com',
        phone: '+16195551234',
      }),
    )

    const result = await upsertProClient({
      firstName: 'Tori',
      lastName: 'Morales',
      email: 'tori@example.com',
      phone: '+16195551234',
    })

    expect(result.ok).toBe(true)

    const userLookupCall = mocks.prisma.user.findMany.mock.calls[0]?.[0] as {
      where: { OR: Array<Record<string, unknown>> }
    }

    expect(userLookupCall.where.OR).not.toContainEqual({
      email: 'tori@example.com',
    })

    expect(userLookupCall.where.OR).not.toContainEqual({
      phone: '+16195551234',
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

    mockClientProfileLookupByWhere([existingProfile])
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
        ...expectedPhoneLookupData('+16195551234'),
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
          ...expectedEmailLookupData('tori@example.com'),
          phone: '+16195551234',
          ...expectedPhoneLookupData('+16195551234'),
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
        ...expectedEmailLookupData('tori@example.com'),
        phone: '+16195551234',
        ...expectedPhoneLookupData('+16195551234'),
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
        ...expectedEmailLookupData('tori@example.com'),
        phone: '+16195551234',
        ...expectedPhoneLookupData('+16195551234'),
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
          ...expectedEmailLookupData('tori@example.com'),
          phone: '+16195551234',
          ...expectedPhoneLookupData('+16195551234'),
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
        ...expectedEmailLookupData('tori@example.com'),
        phone: '+16195551234',
        ...expectedPhoneLookupData('+16195551234'),
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
        ...expectedEmailLookupData('tori@example.com'),
        phone: null,
        ...expectedPhoneLookupData(null),
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

    mockClientProfileLookupByWhere([existingProfile])

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
        ...expectedEmailLookupData(null),
        phone: '+16195551234',
        ...expectedPhoneLookupData('+16195551234'),
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