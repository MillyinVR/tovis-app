// lib/privacy/exportUserData.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma, Role } from '@prisma/client'

import { exportUserData, USER_DATA_EXPORT_VERSION } from './exportUserData'

const mocks = vi.hoisted(() => ({
  db: {
    user: {
      findUnique: vi.fn(),
    },
    clientAddress: {
      findMany: vi.fn(),
    },
    professionalLocation: {
      findMany: vi.fn(),
    },
    booking: {
      findMany: vi.fn(),
    },
    bookingHold: {
      findMany: vi.fn(),
    },
    clientActionToken: {
      findMany: vi.fn(),
    },
    mediaAsset: {
      findMany: vi.fn(),
    },
    message: {
      findMany: vi.fn(),
    },
    notification: {
      findMany: vi.fn(),
    },
    notificationDispatch: {
      findMany: vi.fn(),
    },
    tapIntent: {
      findMany: vi.fn(),
    },
  },
}))

function makeUser(args?: {
  id?: string
  clientProfile?: null | { id: string }
  professionalProfile?: null | { id: string }
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
    password: 'stored_hash',
    role: Role.CLIENT,
    authVersion: 1,
    phoneVerifiedAt: new Date('2026-04-01T10:00:00.000Z'),
    emailVerifiedAt: new Date('2026-04-01T10:05:00.000Z'),
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
            createdAt: new Date('2026-02-01T00:00:00.000Z'),
          }
        : args.clientProfile,
    professionalProfile:
      args?.professionalProfile === undefined
        ? {
            id: 'pro_1',
            userId: args?.id ?? 'user_1',
            firstName: 'Tori',
            lastName: 'Pro',
            phone: '+16195550000',
            createdAt: new Date('2026-03-01T00:00:00.000Z'),
          }
        : args.professionalProfile,
  }
}

function setupFindManyResults() {
  mocks.db.clientAddress.findMany.mockResolvedValue([
    {
      id: 'addr_1',
      clientId: 'client_1',
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
    },
  ])

  mocks.db.professionalLocation.findMany.mockResolvedValue([
    {
      id: 'loc_1',
      professionalId: 'pro_1',
      createdAt: new Date('2026-04-02T00:00:00.000Z'),
    },
  ])

    mocks.db.booking.findMany
    .mockResolvedValueOnce([
        {
        id: 'booking_client_1',
        clientId: 'client_1',
        total: new Prisma.Decimal('123.45'),
        createdAt: new Date('2026-04-03T00:00:00.000Z'),
        },
    ])
    .mockResolvedValueOnce([
        {
        id: 'booking_pro_1',
        professionalId: 'pro_1',
        largeCounter: BigInt('9007199254740993'),        createdAt: new Date('2026-04-04T00:00:00.000Z'),
        },
    ])

  mocks.db.bookingHold.findMany.mockResolvedValue([
    {
      id: 'hold_1',
      clientId: 'client_1',
      professionalId: 'pro_1',
      createdAt: new Date('2026-04-05T00:00:00.000Z'),
    },
  ])

  mocks.db.clientActionToken.findMany.mockResolvedValue([
    {
      id: 'token_1',
      clientId: 'client_1',
      createdAt: new Date('2026-04-06T00:00:00.000Z'),
    },
  ])

  mocks.db.mediaAsset.findMany.mockResolvedValue([
    {
      id: 'media_1',
      ownerUserId: 'user_1',
      clientId: 'client_1',
      professionalId: 'pro_1',
      createdAt: new Date('2026-04-07T00:00:00.000Z'),
    },
  ])

  mocks.db.message.findMany.mockResolvedValue([
    {
      id: 'message_1',
      senderUserId: 'user_1',
      recipientUserId: 'other_user',
      clientId: 'client_1',
      createdAt: new Date('2026-04-08T00:00:00.000Z'),
    },
  ])

  mocks.db.notification.findMany.mockResolvedValue([
    {
      id: 'notification_1',
      recipientUserId: 'user_1',
      clientId: 'client_1',
      createdAt: new Date('2026-04-09T00:00:00.000Z'),
    },
  ])

  mocks.db.notificationDispatch.findMany.mockResolvedValue([
    {
      id: 'dispatch_1',
      recipientUserId: 'user_1',
      professionalId: 'pro_1',
      createdAt: new Date('2026-04-10T00:00:00.000Z'),
    },
  ])

  mocks.db.tapIntent.findMany.mockResolvedValue([
    {
      id: 'tap_1',
      userId: 'user_1',
      clientId: 'client_1',
      createdAt: new Date('2026-04-11T00:00:00.000Z'),
    },
  ])
}

describe('exportUserData', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-27T12:00:00.000Z'))
    vi.clearAllMocks()

    setupFindManyResults()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('exports a stable privacy export contract version', () => {
    expect(USER_DATA_EXPORT_VERSION).toBe(1)
  })

  it('throws when the subject user does not exist', async () => {
    mocks.db.user.findUnique.mockResolvedValueOnce(null)

    await expect(
      exportUserData({
        db: mocks.db as never,
        userId: 'missing_user',
      }),
    ).rejects.toThrow(
      'Cannot export user data: user not found (missing_user)',
    )

    expect(mocks.db.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'missing_user' },
      include: {
        clientProfile: true,
        professionalProfile: true,
      },
    })

    expect(mocks.db.clientAddress.findMany).not.toHaveBeenCalled()
    expect(mocks.db.booking.findMany).not.toHaveBeenCalled()
    expect(mocks.db.mediaAsset.findMany).not.toHaveBeenCalled()
  })

  it('exports user-linked records and normalizes Date, Decimal, and bigint values', async () => {
    mocks.db.user.findUnique.mockResolvedValueOnce(
      makeUser({
        id: 'user_1',
        clientProfile: { id: 'client_1' },
        professionalProfile: { id: 'pro_1' },
      }),
    )

    const result = await exportUserData({
      db: mocks.db as never,
      userId: 'user_1',
    })

    expect(result).toEqual({
      exportedAt: '2026-05-27T12:00:00.000Z',
      subject: {
        userId: 'user_1',
        clientProfileId: 'client_1',
        professionalProfileId: 'pro_1',
      },
      data: {
        user: expect.objectContaining({
          id: 'user_1',
          email: 'person@example.com',
          phone: '+16195551234',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        }),
        clientProfile: {
          id: 'client_1',
        },
        professionalProfile: {
          id: 'pro_1',
        },
        clientAddresses: [
          {
            id: 'addr_1',
            clientId: 'client_1',
            createdAt: '2026-04-01T00:00:00.000Z',
          },
        ],
        professionalLocations: [
          {
            id: 'loc_1',
            professionalId: 'pro_1',
            createdAt: '2026-04-02T00:00:00.000Z',
          },
        ],
        bookingsAsClient: [
          {
            id: 'booking_client_1',
            clientId: 'client_1',
            total: '123.45',
            createdAt: '2026-04-03T00:00:00.000Z',
          },
        ],
        bookingsAsProfessional: [
          {
            id: 'booking_pro_1',
            professionalId: 'pro_1',
            largeCounter: '9007199254740993',
            createdAt: '2026-04-04T00:00:00.000Z',
          },
        ],
        bookingHolds: [
          {
            id: 'hold_1',
            clientId: 'client_1',
            professionalId: 'pro_1',
            createdAt: '2026-04-05T00:00:00.000Z',
          },
        ],
        clientActionTokens: [
          {
            id: 'token_1',
            clientId: 'client_1',
            createdAt: '2026-04-06T00:00:00.000Z',
          },
        ],
        aftercareSummaries: [],
        mediaAssets: [
          {
            id: 'media_1',
            ownerUserId: 'user_1',
            clientId: 'client_1',
            professionalId: 'pro_1',
            createdAt: '2026-04-07T00:00:00.000Z',
          },
        ],
        messages: [
          {
            id: 'message_1',
            senderUserId: 'user_1',
            recipientUserId: 'other_user',
            clientId: 'client_1',
            createdAt: '2026-04-08T00:00:00.000Z',
          },
        ],
        notifications: [
          {
            id: 'notification_1',
            recipientUserId: 'user_1',
            clientId: 'client_1',
            createdAt: '2026-04-09T00:00:00.000Z',
          },
        ],
        notificationDispatches: [
          {
            id: 'dispatch_1',
            recipientUserId: 'user_1',
            professionalId: 'pro_1',
            createdAt: '2026-04-10T00:00:00.000Z',
          },
        ],
        notificationDeliveries: [],
        attributionEvents: [],
        tapIntents: [
          {
            id: 'tap_1',
            userId: 'user_1',
            clientId: 'client_1',
            createdAt: '2026-04-11T00:00:00.000Z',
          },
        ],
        adminActionLogs: [],
      },
      limitations: [
        'This export covers user-linked records known to the privacy export boundary.',
        'Tenant-level exports, aggregate analytics, provider-side records, and storage object bytes are separate workflows.',
        'If Prisma schema adds new user-linked models, update this boundary and its schema-completeness test.',
        'AftercareSummary export is temporarily omitted until wired through the real Booking/Aftercare relation.',
        'NotificationDelivery export is temporarily omitted until wired through the real dispatch/recipient relation.',
        'AttributionEvent export is temporarily omitted until wired through the real attribution identity fields.',
        'AdminActionLog export is temporarily omitted until wired through the real admin audit schema fields.',
      ],
    })
  })

  it('queries all supported user-linked models with explicit scoped filters', async () => {
    mocks.db.user.findUnique.mockResolvedValueOnce(
      makeUser({
        id: 'user_1',
        clientProfile: { id: 'client_1' },
        professionalProfile: { id: 'pro_1' },
      }),
    )

    await exportUserData({
      db: mocks.db as never,
      userId: 'user_1',
    })

    expect(mocks.db.clientAddress.findMany).toHaveBeenCalledWith({
      where: { clientId: 'client_1' },
      orderBy: { createdAt: 'asc' },
    })

    expect(mocks.db.professionalLocation.findMany).toHaveBeenCalledWith({
      where: { professionalId: 'pro_1' },
      orderBy: { createdAt: 'asc' },
    })

    expect(mocks.db.booking.findMany).toHaveBeenNthCalledWith(1, {
      where: { clientId: 'client_1' },
      orderBy: { createdAt: 'asc' },
    })

    expect(mocks.db.booking.findMany).toHaveBeenNthCalledWith(2, {
      where: { professionalId: 'pro_1' },
      orderBy: { createdAt: 'asc' },
    })

    expect(mocks.db.bookingHold.findMany).toHaveBeenCalledWith({
      where: {
        OR: [{ clientId: 'client_1' }, { professionalId: 'pro_1' }],
      },
      orderBy: { createdAt: 'asc' },
    })

    expect(mocks.db.clientActionToken.findMany).toHaveBeenCalledWith({
      where: { clientId: 'client_1' },
      orderBy: { createdAt: 'asc' },
    })

    expect(mocks.db.mediaAsset.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { ownerUserId: 'user_1' },
          { clientId: 'client_1' },
          { professionalId: 'pro_1' },
        ],
      },
      orderBy: { createdAt: 'asc' },
    })

    expect(mocks.db.message.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { senderUserId: 'user_1' },
          { recipientUserId: 'user_1' },
          { clientId: 'client_1' },
          { professionalId: 'pro_1' },
        ],
      },
      orderBy: { createdAt: 'asc' },
    })

    expect(mocks.db.notification.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { recipientUserId: 'user_1' },
          { clientId: 'client_1' },
          { professionalId: 'pro_1' },
        ],
      },
      orderBy: { createdAt: 'asc' },
    })

    expect(mocks.db.notificationDispatch.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { recipientUserId: 'user_1' },
          { clientId: 'client_1' },
          { professionalId: 'pro_1' },
        ],
      },
      orderBy: { createdAt: 'asc' },
    })

    expect(mocks.db.tapIntent.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { userId: 'user_1' },
          { clientId: 'client_1' },
          { professionalId: 'pro_1' },
        ],
      },
      orderBy: { createdAt: 'asc' },
    })
  })

  it('skips client/professional scoped queries when the user has no profiles', async () => {
    mocks.db.user.findUnique.mockResolvedValueOnce(
      makeUser({
        id: 'user_no_profiles',
        clientProfile: null,
        professionalProfile: null,
      }),
    )

    const result = await exportUserData({
      db: mocks.db as never,
      userId: 'user_no_profiles',
    })

    expect(result.subject).toEqual({
      userId: 'user_no_profiles',
      clientProfileId: null,
      professionalProfileId: null,
    })

    expect(result.data.clientProfile).toBeNull()
    expect(result.data.professionalProfile).toBeNull()
    expect(result.data.clientAddresses).toEqual([])
    expect(result.data.professionalLocations).toEqual([])
    expect(result.data.bookingsAsClient).toEqual([])
    expect(result.data.bookingsAsProfessional).toEqual([])
    expect(result.data.bookingHolds).toEqual([])
    expect(result.data.clientActionTokens).toEqual([])

    expect(mocks.db.clientAddress.findMany).not.toHaveBeenCalled()
    expect(mocks.db.professionalLocation.findMany).not.toHaveBeenCalled()
    expect(mocks.db.booking.findMany).not.toHaveBeenCalled()
    expect(mocks.db.bookingHold.findMany).not.toHaveBeenCalled()
    expect(mocks.db.clientActionToken.findMany).not.toHaveBeenCalled()

    expect(mocks.db.mediaAsset.findMany).toHaveBeenCalledWith({
      where: {
        OR: [{ ownerUserId: 'user_no_profiles' }],
      },
      orderBy: { createdAt: 'asc' },
    })

    expect(mocks.db.message.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { senderUserId: 'user_no_profiles' },
          { recipientUserId: 'user_no_profiles' },
        ],
      },
      orderBy: { createdAt: 'asc' },
    })

    expect(mocks.db.notification.findMany).toHaveBeenCalledWith({
      where: {
        OR: [{ recipientUserId: 'user_no_profiles' }],
      },
      orderBy: { createdAt: 'asc' },
    })

    expect(mocks.db.notificationDispatch.findMany).toHaveBeenCalledWith({
      where: {
        OR: [{ recipientUserId: 'user_no_profiles' }],
      },
      orderBy: { createdAt: 'asc' },
    })

    expect(mocks.db.tapIntent.findMany).toHaveBeenCalledWith({
      where: {
        OR: [{ userId: 'user_no_profiles' }],
      },
      orderBy: { createdAt: 'asc' },
    })
  })

  it('keeps intentionally omitted schema areas empty and documented', async () => {
    mocks.db.user.findUnique.mockResolvedValueOnce(
      makeUser({
        id: 'user_1',
        clientProfile: { id: 'client_1' },
        professionalProfile: { id: 'pro_1' },
      }),
    )

    const result = await exportUserData({
      db: mocks.db as never,
      userId: 'user_1',
    })

    expect(result.data.aftercareSummaries).toEqual([])
    expect(result.data.notificationDeliveries).toEqual([])
    expect(result.data.attributionEvents).toEqual([])
    expect(result.data.adminActionLogs).toEqual([])

    expect(result.limitations).toEqual(
      expect.arrayContaining([
        'AftercareSummary export is temporarily omitted until wired through the real Booking/Aftercare relation.',
        'NotificationDelivery export is temporarily omitted until wired through the real dispatch/recipient relation.',
        'AttributionEvent export is temporarily omitted until wired through the real attribution identity fields.',
        'AdminActionLog export is temporarily omitted until wired through the real admin audit schema fields.',
      ]),
    )
  })
})