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
    aftercareSummary: {
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
    notificationDelivery: {
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
            claimStatus: 'CLAIMED',
            claimedAt: new Date('2026-02-02T00:00:00.000Z'),
            email: 'person@example.com',
            phone: '+16195551234',
            phoneVerifiedAt: new Date('2026-04-01T10:00:00.000Z'),
            avatarUrl: 'https://example.com/avatar.jpg',
            dateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
            preferredContactMethod: 'EMAIL',
            alertBanner: null,
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
            phoneVerifiedAt: new Date('2026-04-01T10:00:00.000Z'),
            businessName: 'TOVIS Beauty',
            handle: 'tovisbeauty',
            isPremium: true,
            bio: 'Launch gremlin, but make it polished.',
            avatarUrl: 'https://example.com/pro-avatar.jpg',
            location: 'San Diego, CA',
            timeZone: 'America/Los_Angeles',
          }
        : args.professionalProfile,
  }
}

function resetFindManyMocks() {
  mocks.db.clientAddress.findMany.mockResolvedValue([])
  mocks.db.professionalLocation.findMany.mockResolvedValue([])
  mocks.db.booking.findMany.mockResolvedValue([])
  mocks.db.bookingHold.findMany.mockResolvedValue([])
  mocks.db.clientActionToken.findMany.mockResolvedValue([])
  mocks.db.aftercareSummary.findMany.mockResolvedValue([])
  mocks.db.mediaAsset.findMany.mockResolvedValue([])
  mocks.db.message.findMany.mockResolvedValue([])
  mocks.db.notification.findMany.mockResolvedValue([])
  mocks.db.notificationDispatch.findMany.mockResolvedValue([])
  mocks.db.notificationDelivery.findMany.mockResolvedValue([])
  mocks.db.tapIntent.findMany.mockResolvedValue([])
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
        professionalId: 'pro_1',
        serviceId: 'service_1',
        offeringId: 'offering_1',
        scheduledFor: new Date('2026-04-03T17:00:00.000Z'),
        status: 'COMPLETED',
        locationType: 'SALON',
        locationId: 'loc_1',
        clientAddressId: null,
        clientTimeZoneAtBooking: 'America/Los_Angeles',
        subtotalSnapshot: new Prisma.Decimal('123.45'),
        totalAmount: new Prisma.Decimal('145.67'),
        depositAmount: null,
        tipAmount: new Prisma.Decimal('20.00'),
        taxAmount: new Prisma.Decimal('2.22'),
        discountAmount: null,
        serviceSubtotalSnapshot: new Prisma.Decimal('123.45'),
        productSubtotalSnapshot: null,
        checkoutStatus: 'PAID',
        selectedPaymentMethod: 'STRIPE_CARD',
        paymentCollectedAt: new Date('2026-04-03T18:00:00.000Z'),
        paymentAuthorizedAt: new Date('2026-04-03T16:50:00.000Z'),
        paymentProvider: 'STRIPE',
        totalDurationMinutes: 90,
        bufferMinutes: 15,
        source: 'DISCOVERY',
        rebookOfBookingId: null,
        clientNotes: 'Please be gentle.',
        startedAt: new Date('2026-04-03T17:00:00.000Z'),
        finishedAt: new Date('2026-04-03T18:30:00.000Z'),
        createdAt: new Date('2026-04-03T00:00:00.000Z'),
        updatedAt: new Date('2026-04-03T19:00:00.000Z'),
      },
    ])
    .mockResolvedValueOnce([
      {
        id: 'booking_pro_1',
        clientId: 'client_2',
        professionalId: 'pro_1',
        serviceId: 'service_2',
        offeringId: null,
        scheduledFor: new Date('2026-04-04T17:00:00.000Z'),
        status: 'ACCEPTED',
        locationType: 'MOBILE',
        locationId: 'loc_1',
        clientAddressId: 'addr_2',
        clientTimeZoneAtBooking: 'America/Los_Angeles',
        subtotalSnapshot: new Prisma.Decimal('200.00'),
        totalAmount: new Prisma.Decimal('200.00'),
        depositAmount: null,
        tipAmount: null,
        taxAmount: null,
        discountAmount: null,
        serviceSubtotalSnapshot: new Prisma.Decimal('200.00'),
        productSubtotalSnapshot: null,
        checkoutStatus: 'READY',
        selectedPaymentMethod: 'CASH',
        paymentCollectedAt: null,
        paymentAuthorizedAt: null,
        paymentProvider: 'MANUAL',
        totalDurationMinutes: 120,
        bufferMinutes: 15,
        source: 'REQUESTED',
        rebookOfBookingId: null,
        clientNotes: null,
        startedAt: null,
        finishedAt: null,
        createdAt: new Date('2026-04-04T00:00:00.000Z'),
        updatedAt: new Date('2026-04-04T01:00:00.000Z'),
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

  mocks.db.aftercareSummary.findMany.mockResolvedValue([
  {
    id: 'aftercare_1',
    bookingId: 'booking_client_1',
    notes: 'Use gentle cleanser.',
    rebookMode: 'RECOMMENDED_WINDOW',
    rebookedFor: null,
    rebookWindowStart: new Date('2026-05-01T00:00:00.000Z'),
    rebookWindowEnd: new Date('2026-05-15T00:00:00.000Z'),
    draftSavedAt: new Date('2026-04-03T18:40:00.000Z'),
    sentToClientAt: new Date('2026-04-03T19:00:00.000Z'),
    lastEditedAt: new Date('2026-04-03T18:50:00.000Z'),
    version: 1,
    createdAt: new Date('2026-04-03T18:35:00.000Z'),
    updatedAt: new Date('2026-04-03T19:00:00.000Z'),
  },
])

  mocks.db.mediaAsset.findMany.mockResolvedValue([
    {
      id: 'media_1',
      professionalId: 'pro_1',
      bookingId: 'booking_client_1',
      reviewId: null,
      uploadedByUserId: 'user_1',
      uploadedByRole: 'CLIENT',
      url: 'https://example.com/media.jpg',
      thumbUrl: 'https://example.com/thumb.jpg',
      mediaType: 'IMAGE',
      caption: 'Before photo',
      visibility: 'PRO_CLIENT',
      isFeaturedInPortfolio: false,
      isEligibleForLooks: false,
      reviewLocked: false,
      phase: 'BEFORE',
      createdAt: new Date('2026-04-07T00:00:00.000Z'),
    },
  ])

  mocks.db.message.findMany.mockResolvedValue([
    {
      id: 'message_1',
      threadId: 'thread_1',
      senderUserId: 'user_1',
      body: 'Hello!',
      createdAt: new Date('2026-04-08T00:00:00.000Z'),
    },
  ])

  mocks.db.notification.findMany.mockResolvedValue([
    {
      id: 'notification_1',
      eventKey: 'BOOKING_CONFIRMED',
      priority: 'NORMAL',
      professionalId: 'pro_1',
      actorUserId: 'user_1',
      bookingId: 'booking_client_1',
      reviewId: null,
      title: 'Booking confirmed',
      body: 'Your booking is confirmed.',
      href: '/pro/bookings/booking_client_1',
      seenAt: null,
      readAt: null,
      clickedAt: null,
      archivedAt: null,
      createdAt: new Date('2026-04-09T00:00:00.000Z'),
      updatedAt: new Date('2026-04-09T01:00:00.000Z'),
    },
  ])

  mocks.db.notificationDispatch.findMany.mockResolvedValue([
    {
      id: 'dispatch_1',
      sourceKey: 'pro-notification:notification_1',
      eventKey: 'BOOKING_CONFIRMED',
      recipientKind: 'PRO',
      priority: 'NORMAL',
      userId: 'user_1',
      professionalId: 'pro_1',
      clientId: null,
      notificationId: 'notification_1',
      clientNotificationId: null,
      title: 'Booking confirmed',
      body: 'Your booking is confirmed.',
      href: '/pro/bookings/booking_client_1',
      scheduledFor: new Date('2026-04-10T00:00:00.000Z'),
      cancelledAt: null,
      createdAt: new Date('2026-04-10T00:00:00.000Z'),
      updatedAt: new Date('2026-04-10T01:00:00.000Z'),
    },
  ])

  mocks.db.notificationDelivery.findMany.mockResolvedValue([
  {
    id: 'delivery_1',
    dispatchId: 'dispatch_1',
    channel: 'EMAIL',
    provider: 'POSTMARK',
    status: 'SENT',
    templateKey: 'booking-confirmed',
    templateVersion: 1,
    attemptCount: 1,
    maxAttempts: 5,
    nextAttemptAt: new Date('2026-04-10T00:00:00.000Z'),
    lastAttemptAt: new Date('2026-04-10T00:01:00.000Z'),
    sentAt: new Date('2026-04-10T00:01:00.000Z'),
    deliveredAt: null,
    failedAt: null,
    suppressedAt: null,
    cancelledAt: null,
    createdAt: new Date('2026-04-10T00:00:00.000Z'),
    updatedAt: new Date('2026-04-10T00:01:00.000Z'),
  },
])

  mocks.db.tapIntent.findMany.mockResolvedValue([
    {
      id: 'tap_1',
      cardId: 'card_1',
      userId: 'user_1',
      intentType: 'SIGNUP_CLIENT',
      expiresAt: new Date('2026-04-12T00:00:00.000Z'),
      createdAt: new Date('2026-04-11T00:00:00.000Z'),
    },
  ])
}

describe('exportUserData', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-27T12:00:00.000Z'))
    vi.clearAllMocks()

    resetFindManyMocks()
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
      select: expect.objectContaining({
        id: true,
        email: true,
        phone: true,
        clientProfile: expect.any(Object),
        professionalProfile: expect.any(Object),
      }),
    })

    expect(mocks.db.clientAddress.findMany).not.toHaveBeenCalled()
    expect(mocks.db.booking.findMany).not.toHaveBeenCalled()
    expect(mocks.db.mediaAsset.findMany).not.toHaveBeenCalled()
  })

  it('exports user-linked records and normalizes Date, Decimal, and bigint values', async () => {
    mocks.db.user.findUnique.mockResolvedValueOnce(
      makeUser({
        id: 'user_1',
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
        clientProfile: expect.objectContaining({
          id: 'client_1',
          userId: 'user_1',
          firstName: 'Tori',
          lastName: 'Morales',
          email: 'person@example.com',
          phone: '+16195551234',
        }),
        professionalProfile: expect.objectContaining({
          id: 'pro_1',
          userId: 'user_1',
          firstName: 'Tori',
          lastName: 'Pro',
          phone: '+16195550000',
          businessName: 'TOVIS Beauty',
        }),
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
          expect.objectContaining({
            id: 'booking_client_1',
            clientId: 'client_1',
            professionalId: 'pro_1',
            subtotalSnapshot: '123.45',
            totalAmount: '145.67',
            createdAt: '2026-04-03T00:00:00.000Z',
          }),
        ],
        bookingsAsProfessional: [
          expect.objectContaining({
            id: 'booking_pro_1',
            professionalId: 'pro_1',
            subtotalSnapshot: '200',
            totalAmount: '200',
            createdAt: '2026-04-04T00:00:00.000Z',
          }),
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
        aftercareSummaries: [
          expect.objectContaining({
            id: 'aftercare_1',
            bookingId: 'booking_client_1',
            notes: 'Use gentle cleanser.',
            createdAt: '2026-04-03T18:35:00.000Z',
          }),
        ],
        mediaAssets: [
          {
            id: 'media_1',
            professionalId: 'pro_1',
            bookingId: 'booking_client_1',
            reviewId: null,
            uploadedByUserId: 'user_1',
            uploadedByRole: 'CLIENT',
            url: 'https://example.com/media.jpg',
            thumbUrl: 'https://example.com/thumb.jpg',
            mediaType: 'IMAGE',
            caption: 'Before photo',
            visibility: 'PRO_CLIENT',
            isFeaturedInPortfolio: false,
            isEligibleForLooks: false,
            reviewLocked: false,
            phase: 'BEFORE',
            createdAt: '2026-04-07T00:00:00.000Z',
          },
        ],
        messages: [
          {
            id: 'message_1',
            threadId: 'thread_1',
            senderUserId: 'user_1',
            body: 'Hello!',
            createdAt: '2026-04-08T00:00:00.000Z',
          },
        ],
        notifications: [
          expect.objectContaining({
            id: 'notification_1',
            eventKey: 'BOOKING_CONFIRMED',
            professionalId: 'pro_1',
            title: 'Booking confirmed',
            createdAt: '2026-04-09T00:00:00.000Z',
          }),
        ],
        notificationDispatches: [
          expect.objectContaining({
            id: 'dispatch_1',
            sourceKey: 'pro-notification:notification_1',
            eventKey: 'BOOKING_CONFIRMED',
            userId: 'user_1',
            professionalId: 'pro_1',
            createdAt: '2026-04-10T00:00:00.000Z',
          }),
        ],
        notificationDeliveries: [
          expect.objectContaining({
            id: 'delivery_1',
            dispatchId: 'dispatch_1',
            channel: 'EMAIL',
            provider: 'POSTMARK',
            status: 'SENT',
            createdAt: '2026-04-10T00:00:00.000Z',
          }),
        ],
        attributionEvents: [],
        tapIntents: [
          {
            id: 'tap_1',
            cardId: 'card_1',
            userId: 'user_1',
            intentType: 'SIGNUP_CLIENT',
            expiresAt: '2026-04-12T00:00:00.000Z',
            createdAt: '2026-04-11T00:00:00.000Z',
          },
        ],
        adminActionLogs: [],
      },
      limitations: [
        'This export covers user-linked records known to the privacy export boundary.',
        'Tenant-level exports, aggregate analytics, provider-side records, and storage object bytes are separate workflows.',
        'If Prisma schema adds new user-linked models, update this boundary and its schema-completeness test.',
        'MediaAsset export includes product-facing URLs and metadata but excludes storage bucket/path internals.',
        'Notification dispatch/delivery exports exclude recipient contact snapshots, provider payloads, lease tokens, and provider message details.',
        'AttributionEvent export is omitted pending a disclosure decision for attribution/admin-adjacent records.',
        'AdminActionLog export is omitted from the default user export because it is an internal security/operational record.',
      ],
    })
  })

  it('queries all supported user-linked models with explicit scoped filters', async () => {
    mocks.db.user.findUnique.mockResolvedValueOnce(
      makeUser({
        id: 'user_1',
      }),
    )

    await exportUserData({
      db: mocks.db as never,
      userId: 'user_1',
    })

    expect(mocks.db.clientAddress.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientId: 'client_1' },
        orderBy: { createdAt: 'asc' },
        select: expect.any(Object),
      }),
    )

    expect(mocks.db.professionalLocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { professionalId: 'pro_1' },
        orderBy: { createdAt: 'asc' },
        select: expect.any(Object),
      }),
    )

    expect(mocks.db.booking.findMany).toHaveBeenNthCalledWith(1, {
      where: { clientId: 'client_1' },
      orderBy: { createdAt: 'asc' },
      select: expect.any(Object),
    })

    expect(mocks.db.booking.findMany).toHaveBeenNthCalledWith(2, {
      where: { professionalId: 'pro_1' },
      orderBy: { createdAt: 'asc' },
      select: expect.any(Object),
    })

    expect(mocks.db.bookingHold.findMany).toHaveBeenCalledWith({
      where: {
        OR: [{ clientId: 'client_1' }, { professionalId: 'pro_1' }],
      },
      orderBy: { createdAt: 'asc' },
      select: expect.any(Object),
    })

    expect(mocks.db.clientActionToken.findMany).toHaveBeenCalledWith({
      where: { clientId: 'client_1' },
      orderBy: { createdAt: 'asc' },
      select: expect.any(Object),
    })

  expect(mocks.db.mediaAsset.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        OR: [
          { uploadedByUserId: 'user_1' },
          {
            booking: {
              clientId: 'client_1',
            },
          },
          { professionalId: 'pro_1' },
        ],
      },
      orderBy: { createdAt: 'asc' },
      select: expect.any(Object),
    }),
  )

  expect(mocks.db.message.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        OR: [
          { senderUserId: 'user_1' },
          {
            thread: {
              clientId: 'client_1',
            },
          },
          {
            thread: {
              professionalId: 'pro_1',
            },
          },
        ],
      },
      orderBy: { createdAt: 'asc' },
      select: expect.any(Object),
    }),
  )

    expect(mocks.db.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { professionalId: 'pro_1' },
        orderBy: { createdAt: 'asc' },
        select: expect.any(Object),
      }),
    )

    expect(mocks.db.notificationDispatch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { userId: 'user_1' },
            { clientId: 'client_1' },
            { professionalId: 'pro_1' },
          ],
        },
        orderBy: { createdAt: 'asc' },
        select: expect.any(Object),
      }),
    )

    expect(mocks.db.tapIntent.findMany).toHaveBeenCalledWith({
      where: { userId: 'user_1' },
      orderBy: { createdAt: 'asc' },
      select: expect.any(Object),
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

    expect(mocks.db.mediaAsset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ uploadedByUserId: 'user_no_profiles' }],
        },
        orderBy: { createdAt: 'asc' },
        select: expect.any(Object),
      }),
    )

    expect(mocks.db.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ senderUserId: 'user_no_profiles' }],
        },
        orderBy: { createdAt: 'asc' },
        select: expect.any(Object),
      }),
    )

    expect(mocks.db.notification.findMany).not.toHaveBeenCalled()

    expect(mocks.db.notificationDispatch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ userId: 'user_no_profiles' }],
        },
        orderBy: { createdAt: 'asc' },
        select: expect.any(Object),
      }),
    )

    expect(mocks.db.notificationDelivery.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          dispatch: {
            OR: [{ userId: 'user_no_profiles' }],
          },
        },
        orderBy: { createdAt: 'asc' },
        select: expect.any(Object),
      }),
    )

    expect(mocks.db.tapIntent.findMany).toHaveBeenCalledWith({
      where: { userId: 'user_no_profiles' },
      orderBy: { createdAt: 'asc' },
      select: expect.any(Object),
    })
  })
  it('does not export internal security, token, storage, raw payload, or encryption fields', async () => {
    mocks.db.user.findUnique.mockResolvedValueOnce(
      makeUser({
        id: 'user_1',
      }),
    )

    const result = await exportUserData({
      db: mocks.db as never,
      userId: 'user_1',
    })

    const serialized = JSON.stringify(result.data)

    expect(serialized).not.toContain('password')
    expect(serialized).not.toContain('emailHash')
    expect(serialized).not.toContain('phoneHash')
    expect(serialized).not.toContain('emailHashV2')
    expect(serialized).not.toContain('phoneHashV2')
    expect(serialized).not.toContain('tokenHash')
    expect(serialized).not.toContain('encryptedAddressJson')
    expect(serialized).not.toContain('addressKeyVersion')
    expect(serialized).not.toContain('storagePath')
    expect(serialized).not.toContain('storageBucket')
    expect(serialized).not.toContain('recipientEmail')
    expect(serialized).not.toContain('recipientPhone')
    expect(serialized).not.toContain('payloadJson')
    expect(serialized).not.toContain('metaJson')
  })

  it('omits attribution and admin audit records by default and documents the decision', async () => {
    mocks.db.user.findUnique.mockResolvedValueOnce(
      makeUser({
        id: 'user_1',
      }),
    )

    const result = await exportUserData({
      db: mocks.db as never,
      userId: 'user_1',
    })

    expect(result.data.attributionEvents).toEqual([])
    expect(result.data.adminActionLogs).toEqual([])

    expect(result.limitations).toEqual(
      expect.arrayContaining([
        'AttributionEvent export is omitted pending a disclosure decision for attribution/admin-adjacent records.',
        'AdminActionLog export is omitted from the default user export because it is an internal security/operational record.',
      ]),
    )
  })
})