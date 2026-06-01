// lib/privacy/deleteUserData.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Role } from '@prisma/client'

import { deleteUserData, USER_DATA_DELETE_VERSION } from './deleteUserData'

const mocks = vi.hoisted(() => ({
  db: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    clientProfile: {
      update: vi.fn(),
    },
    professionalProfile: {
      update: vi.fn(),
    },
    clientAddress: {
      count: vi.fn(),
      deleteMany: vi.fn(),
    },
    professionalLocation: {
      count: vi.fn(),
      deleteMany: vi.fn(),
    },
    bookingHold: {
      count: vi.fn(),
      deleteMany: vi.fn(),
    },
    clientActionToken: {
      count: vi.fn(),
      deleteMany: vi.fn(),
    },
    mediaAsset: {
      count: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}))

function makeUser(args?: {
  id?: string
  clientProfile?: null | {
    id: string
  }
  professionalProfile?: null | {
    id: string
  }
}) {
  return {
    id: args?.id ?? 'user_1',
    email: 'person@example.com',
    emailHash: 'legacy_email_hash',
    emailHashV2: 'hmac_email_hash_v2',
    emailHashKeyVersion: 1,
    phone: '+16195551234',
    phoneHash: 'legacy_phone_hash',
    phoneHashV2: 'hmac_phone_hash_v2',
    phoneHashKeyVersion: 1,
    phoneVerifiedAt: new Date('2026-04-01T10:00:00.000Z'),
    emailVerifiedAt: new Date('2026-04-01T10:05:00.000Z'),
    password: 'stored_hash',
    role: Role.CLIENT,
    authVersion: 1,
    loginAttempts: 0,
    lockedUntil: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    tosAcceptedAt: null,
    tosVersion: null,
    transactionalSmsConsentAt: null,
    transactionalSmsConsentVersion: null,
    transactionalSmsConsentSource: null,
    transactionalSmsConsentIp: null,
    transactionalSmsConsentUserAgent: null,
    clientProfile:
      args?.clientProfile === undefined
        ? {
            id: 'client_1',
            userId: args?.id ?? 'user_1',
            firstName: 'Tori',
            lastName: 'Morales',
            email: 'person@example.com',
            phone: '+16195551234',
          }
        : args.clientProfile,
    professionalProfile:
      args?.professionalProfile === undefined
        ? null
        : args.professionalProfile,
  }
}

function setupCounts(counts?: {
  clientAddress?: number
  professionalLocation?: number
  bookingHold?: number
  clientActionToken?: number
  mediaAsset?: number
}) {
  mocks.db.clientAddress.count.mockResolvedValue(counts?.clientAddress ?? 2)
  mocks.db.professionalLocation.count.mockResolvedValue(
    counts?.professionalLocation ?? 3,
  )
  mocks.db.bookingHold.count.mockResolvedValue(counts?.bookingHold ?? 4)
  mocks.db.clientActionToken.count.mockResolvedValue(
    counts?.clientActionToken ?? 5,
  )
  mocks.db.mediaAsset.count.mockResolvedValue(counts?.mediaAsset ?? 6)
}

function setupDeleteManyResults(counts?: {
  clientAddress?: number
  professionalLocation?: number
  bookingHold?: number
  clientActionToken?: number
  mediaAsset?: number
}) {
  mocks.db.clientAddress.deleteMany.mockResolvedValue({
    count: counts?.clientAddress ?? 2,
  })
  mocks.db.professionalLocation.deleteMany.mockResolvedValue({
    count: counts?.professionalLocation ?? 3,
  })
  mocks.db.bookingHold.deleteMany.mockResolvedValue({
    count: counts?.bookingHold ?? 4,
  })
  mocks.db.clientActionToken.deleteMany.mockResolvedValue({
    count: counts?.clientActionToken ?? 5,
  })
  mocks.db.mediaAsset.deleteMany.mockResolvedValue({
    count: counts?.mediaAsset ?? 6,
  })
}

describe('deleteUserData', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-27T12:00:00.000Z'))
    vi.clearAllMocks()

    setupCounts()
    setupDeleteManyResults()

    mocks.db.user.update.mockResolvedValue({})
    mocks.db.clientProfile.update.mockResolvedValue({})
    mocks.db.professionalProfile.update.mockResolvedValue({})
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('exports a stable privacy delete contract version', () => {
    expect(USER_DATA_DELETE_VERSION).toBe(1)
  })

  it('throws when the subject user does not exist', async () => {
    mocks.db.user.findUnique.mockResolvedValueOnce(null)

    await expect(
      deleteUserData({
        db: mocks.db as never,
        userId: 'missing_user',
        mode: 'DRY_RUN',
        requestedByUserId: 'admin_1',
        reason: 'privacy request',
      }),
    ).rejects.toThrow(
      'Cannot delete user data: user not found (missing_user)',
    )

    expect(mocks.db.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'missing_user' },
      include: {
        clientProfile: true,
        professionalProfile: true,
      },
    })

    expect(mocks.db.user.update).not.toHaveBeenCalled()
    expect(mocks.db.clientProfile.update).not.toHaveBeenCalled()
    expect(mocks.db.clientAddress.deleteMany).not.toHaveBeenCalled()
  })

  it('returns a dry-run plan without mutating data for a client user', async () => {
    mocks.db.user.findUnique.mockResolvedValueOnce(
      makeUser({
        id: 'user_1',
        clientProfile: { id: 'client_1' },
        professionalProfile: null,
      }),
    )

    const result = await deleteUserData({
      db: mocks.db as never,
      userId: 'user_1',
      mode: 'DRY_RUN',
      requestedByUserId: 'admin_1',
      reason: 'user requested deletion',
    })

    expect(result).toEqual({
      executedAt: '2026-05-27T12:00:00.000Z',
      mode: 'DRY_RUN',
      subject: {
        userId: 'user_1',
        clientProfileId: 'client_1',
        professionalProfileId: null,
      },
      requestedByUserId: 'admin_1',
      reason: 'user requested deletion',
      actions: [
        {
          model: 'ClientAddress',
          action: 'WOULD_DELETE',
          count: 2,
        },
        {
          model: 'ProfessionalLocation',
          action: 'SKIPPED',
          count: 0,
          notes: 'No professional profile.',
        },
        {
          model: 'BookingHold',
          action: 'WOULD_DELETE',
          count: 4,
        },
        {
          model: 'ClientActionToken',
          action: 'WOULD_DELETE',
          count: 5,
        },
        {
          model: 'MediaAsset',
          action: 'WOULD_DELETE',
          count: 6,
          notes:
            'Deletes DB rows only. Storage object deletion must run through the media/storage write boundary.',
        },
        {
          model: 'ClientProfile',
          action: 'WOULD_ANONYMIZE',
          count: 1,
        },
        {
          model: 'ProfessionalProfile',
          action: 'SKIPPED',
          count: 0,
          notes: 'No professional profile.',
        },
        {
          model: 'User',
          action: 'WOULD_ANONYMIZE',
          count: 1,
        },
      ],
      limitations: expect.arrayContaining([
        'Bookings are not hard-deleted because they are financial/operational records; implement booking-level anonymization after legal retention policy is finalized.',
        'Storage object bytes are not deleted here; MediaAsset DB rows are handled, but Supabase object deletion requires a separate storage write boundary.',
        'Tenant-level deletion/export is a separate workflow.',
      ]),
    })

    expect(mocks.db.clientAddress.count).toHaveBeenCalledWith({
      where: { clientId: 'client_1' },
    })

    expect(mocks.db.bookingHold.count).toHaveBeenCalledWith({
      where: {
        OR: [{ clientId: 'client_1' }],
      },
    })

    expect(mocks.db.clientActionToken.count).toHaveBeenCalledWith({
      where: { clientId: 'client_1' },
    })

    expect(mocks.db.mediaAsset.count).toHaveBeenCalledWith({
      where: {
        OR: [{ ownerUserId: 'user_1' }, { clientId: 'client_1' }],
      },
    })

    expect(mocks.db.clientAddress.deleteMany).not.toHaveBeenCalled()
    expect(mocks.db.bookingHold.deleteMany).not.toHaveBeenCalled()
    expect(mocks.db.clientActionToken.deleteMany).not.toHaveBeenCalled()
    expect(mocks.db.mediaAsset.deleteMany).not.toHaveBeenCalled()
    expect(mocks.db.clientProfile.update).not.toHaveBeenCalled()
    expect(mocks.db.professionalProfile.update).not.toHaveBeenCalled()
    expect(mocks.db.user.update).not.toHaveBeenCalled()
  })

  it('anonymizes and deletes supported records for a client and professional user', async () => {
    mocks.db.user.findUnique.mockResolvedValueOnce(
      makeUser({
        id: 'user_both',
        clientProfile: { id: 'client_1' },
        professionalProfile: { id: 'pro_1' },
      }),
    )

    const result = await deleteUserData({
      db: mocks.db as never,
      userId: 'user_both',
      mode: 'ANONYMIZE',
      requestedByUserId: 'admin_1',
      reason: 'verified privacy deletion request',
    })

    expect(result).toMatchObject({
      executedAt: '2026-05-27T12:00:00.000Z',
      mode: 'ANONYMIZE',
      subject: {
        userId: 'user_both',
        clientProfileId: 'client_1',
        professionalProfileId: 'pro_1',
      },
      requestedByUserId: 'admin_1',
      reason: 'verified privacy deletion request',
      actions: [
        {
          model: 'ClientAddress',
          action: 'DELETED',
          count: 2,
        },
        {
          model: 'ProfessionalLocation',
          action: 'DELETED',
          count: 3,
        },
        {
          model: 'BookingHold',
          action: 'DELETED',
          count: 4,
        },
        {
          model: 'ClientActionToken',
          action: 'DELETED',
          count: 5,
        },
        {
          model: 'MediaAsset',
          action: 'DELETED',
          count: 6,
          notes:
            'Deleted DB rows only. Storage object deletion must run through the media/storage write boundary.',
        },
        {
          model: 'ClientProfile',
          action: 'ANONYMIZED',
          count: 1,
        },
        {
          model: 'ProfessionalProfile',
          action: 'ANONYMIZED',
          count: 1,
        },
        {
          model: 'User',
          action: 'ANONYMIZED',
          count: 1,
        },
      ],
    })

    expect(mocks.db.clientAddress.deleteMany).toHaveBeenCalledWith({
      where: { clientId: 'client_1' },
    })

    expect(mocks.db.professionalLocation.deleteMany).toHaveBeenCalledWith({
      where: { professionalId: 'pro_1' },
    })

    expect(mocks.db.bookingHold.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [{ clientId: 'client_1' }, { professionalId: 'pro_1' }],
      },
    })

    expect(mocks.db.clientActionToken.deleteMany).toHaveBeenCalledWith({
      where: { clientId: 'client_1' },
    })

    expect(mocks.db.mediaAsset.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { ownerUserId: 'user_both' },
          { clientId: 'client_1' },
          { professionalId: 'pro_1' },
        ],
      },
    })

    expect(mocks.db.clientProfile.update).toHaveBeenCalledWith({
      where: { id: 'client_1' },
      data: {
        firstName: 'Deleted',
        lastName: 'User',
        email: null,
        phone: null,
        dateOfBirth: null,
        emailHash: null,
        phoneHash: null,
        emailHashV2: null,
        emailHashKeyVersion: null,
        phoneHashV2: null,
        phoneHashKeyVersion: null,
      },
    })

    expect(mocks.db.professionalProfile.update).toHaveBeenCalledWith({
      where: { id: 'pro_1' },
      data: {
        firstName: 'Deleted',
        lastName: 'Professional',
        phone: null,
        bio: null,
      },
    })

    expect(mocks.db.user.update).toHaveBeenCalledWith({
      where: { id: 'user_both' },
      data: {
        email: 'deleted-user_both@deleted.tovis.local',
        phone: null,
        emailHash: null,
        phoneHash: null,
        emailHashV2: null,
        emailHashKeyVersion: null,
        phoneHashV2: null,
        phoneHashKeyVersion: null,
        password: expect.stringMatching(/^\$2b\$12\$/),
      },
    })
  })

  it('skips profile-scoped deletes when the user has no client or professional profile', async () => {
    mocks.db.user.findUnique.mockResolvedValueOnce(
      makeUser({
        id: 'user_no_profiles',
        clientProfile: null,
        professionalProfile: null,
      }),
    )

    const result = await deleteUserData({
      db: mocks.db as never,
      userId: 'user_no_profiles',
      mode: 'ANONYMIZE',
      requestedByUserId: 'admin_1',
      reason: 'privacy request',
    })

    expect(result.subject).toEqual({
      userId: 'user_no_profiles',
      clientProfileId: null,
      professionalProfileId: null,
    })

    expect(result.actions).toEqual([
      {
        model: 'ClientAddress',
        action: 'SKIPPED',
        count: 0,
        notes: 'No client profile.',
      },
      {
        model: 'ProfessionalLocation',
        action: 'SKIPPED',
        count: 0,
        notes: 'No professional profile.',
      },
      {
        model: 'BookingHold',
        action: 'SKIPPED',
        count: 0,
        notes: 'No client/professional profile.',
      },
      {
        model: 'ClientActionToken',
        action: 'SKIPPED',
        count: 0,
        notes: 'No client profile.',
      },
      {
        model: 'MediaAsset',
        action: 'DELETED',
        count: 6,
        notes:
          'Deleted DB rows only. Storage object deletion must run through the media/storage write boundary.',
      },
      {
        model: 'ClientProfile',
        action: 'SKIPPED',
        count: 0,
        notes: 'No client profile.',
      },
      {
        model: 'ProfessionalProfile',
        action: 'SKIPPED',
        count: 0,
        notes: 'No professional profile.',
      },
      {
        model: 'User',
        action: 'ANONYMIZED',
        count: 1,
      },
    ])

    expect(mocks.db.clientAddress.count).not.toHaveBeenCalled()
    expect(mocks.db.professionalLocation.count).not.toHaveBeenCalled()
    expect(mocks.db.bookingHold.count).not.toHaveBeenCalled()
    expect(mocks.db.clientActionToken.count).not.toHaveBeenCalled()

    expect(mocks.db.mediaAsset.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [{ ownerUserId: 'user_no_profiles' }],
      },
    })

    expect(mocks.db.user.update).toHaveBeenCalledTimes(1)
  })

  it('does not leak raw user PII into the result payload', async () => {
    mocks.db.user.findUnique.mockResolvedValueOnce(
      makeUser({
        id: 'user_1',
        clientProfile: { id: 'client_1' },
        professionalProfile: { id: 'pro_1' },
      }),
    )

    const result = await deleteUserData({
      db: mocks.db as never,
      userId: 'user_1',
      mode: 'ANONYMIZE',
      requestedByUserId: 'admin_1',
      reason: 'privacy request',
    })

    const serialized = JSON.stringify(result)

    expect(serialized).not.toContain('person@example.com')
    expect(serialized).not.toContain('+16195551234')
    expect(serialized).not.toContain('legacy_email_hash')
    expect(serialized).not.toContain('legacy_phone_hash')
    expect(serialized).not.toContain('hmac_email_hash_v2')
    expect(serialized).not.toContain('hmac_phone_hash_v2')
    expect(serialized).not.toContain('stored_hash')
  })
})