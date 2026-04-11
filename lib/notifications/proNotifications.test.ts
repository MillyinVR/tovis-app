import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationEventKey, Prisma } from '@prisma/client'

const mockEnqueueDispatch = vi.hoisted(() => vi.fn())

const mockPrisma = vi.hoisted(() => ({
  $transaction: vi.fn(),
  notification: {
    create: vi.fn(),
    updateMany: vi.fn(),
    findFirst: vi.fn(),
  },
  professionalProfile: {
    findUnique: vi.fn(),
  },
  professionalNotificationPreference: {
    findUnique: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mockPrisma,
}))

vi.mock('./dispatch/enqueueDispatch', () => ({
  enqueueDispatch: mockEnqueueDispatch,
}))

import { createProNotification } from './proNotifications'
import { getNotificationEventDefinition } from './eventKeys'

const tx = {
  notification: mockPrisma.notification,
  professionalProfile: mockPrisma.professionalProfile,
  professionalNotificationPreference:
    mockPrisma.professionalNotificationPreference,
}

function resetMockGroup(group: Record<string, ReturnType<typeof vi.fn>>) {
  for (const fn of Object.values(group)) {
    fn.mockReset()
  }
}

function makeUniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed',
    {
      code: 'P2002',
      clientVersion: 'test',
    },
  )
}

function expectedPriorityFor(eventKey: NotificationEventKey) {
  return getNotificationEventDefinition(eventKey).defaultPriority
}

describe('lib/notifications/proNotifications', () => {
  beforeEach(() => {
    mockPrisma.$transaction.mockReset()
    resetMockGroup(mockPrisma.notification)
    resetMockGroup(mockPrisma.professionalProfile)
    resetMockGroup(mockPrisma.professionalNotificationPreference)
    mockEnqueueDispatch.mockReset()

    mockPrisma.$transaction.mockImplementation(
      async (run: (db: typeof tx) => Promise<unknown>) => run(tx),
    )

    mockPrisma.professionalProfile.findUnique.mockResolvedValue({
      id: 'pro_1',
      userId: 'user_1',
      phone: '+15551234567',
      phoneVerifiedAt: new Date('2026-04-08T09:00:00.000Z'),
      timeZone: 'America/Los_Angeles',
      user: {
        email: 'pro@example.com',
        emailVerifiedAt: new Date('2026-04-08T07:00:00.000Z'),
        phone: '+15557654321',
        phoneVerifiedAt: new Date('2026-04-08T08:00:00.000Z'),
      },
    })

    mockPrisma.professionalNotificationPreference.findUnique.mockResolvedValue(
      null,
    )
    mockEnqueueDispatch.mockResolvedValue(undefined)
  })

  it('creates a new pro notification and passes timezone into enqueueDispatch', async () => {
    mockPrisma.notification.create.mockResolvedValue({ id: 'notif_1' })

    const eventKey = NotificationEventKey.REVIEW_RECEIVED
    const expectedPriority = expectedPriorityFor(eventKey)

    const result = await createProNotification({
      professionalId: 'pro_1',
      eventKey,
      title: ' New review received ',
      body: ' A client left you a review. ',
      href: ' /pro/reviews/review_1 ',
      data: {
        reviewId: 'review_1',
      },
      bookingId: 'booking_1',
      reviewId: 'review_1',
    })

    expect(result).toEqual({ id: 'notif_1' })
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)

    expect(mockPrisma.notification.create).toHaveBeenCalledWith({
      data: {
        professionalId: 'pro_1',
        eventKey,
        priority: expectedPriority,
        title: 'New review received',
        body: 'A client left you a review.',
        href: '/pro/reviews/review_1',
        dedupeKey: null,
        actorUserId: null,
        bookingId: 'booking_1',
        reviewId: 'review_1',
        seenAt: null,
        readAt: null,
        clickedAt: null,
        archivedAt: null,
        data: {
          reviewId: 'review_1',
        },
      },
      select: { id: true },
    })

    expect(mockPrisma.professionalProfile.findUnique).toHaveBeenCalledWith({
      where: {
        id: 'pro_1',
      },
      select: {
        id: true,
        userId: true,
        phone: true,
        phoneVerifiedAt: true,
        timeZone: true,
        user: {
          select: {
            email: true,
            emailVerifiedAt: true,
            phone: true,
            phoneVerifiedAt: true,
          },
        },
      },
    })

    expect(
      mockPrisma.professionalNotificationPreference.findUnique,
    ).toHaveBeenCalledWith({
      where: {
        professionalId_eventKey: {
          professionalId: 'pro_1',
          eventKey,
        },
      },
      select: {
        inAppEnabled: true,
        smsEnabled: true,
        emailEnabled: true,
        quietHoursStartMinutes: true,
        quietHoursEndMinutes: true,
      },
    })

    expect(mockEnqueueDispatch).toHaveBeenCalledWith({
      key: eventKey,
      sourceKey: 'pro-notification:notif_1',
      recipient: {
        kind: 'PRO',
        professionalId: 'pro_1',
        userId: 'user_1',
        inAppTargetId: 'pro_1',
        phone: '+15551234567',
        phoneVerifiedAt: new Date('2026-04-08T09:00:00.000Z'),
        email: 'pro@example.com',
        emailVerifiedAt: new Date('2026-04-08T07:00:00.000Z'),
        timeZone: 'America/Los_Angeles',
        preference: null,
      },
      title: 'New review received',
      body: 'A client left you a review.',
      href: '/pro/reviews/review_1',
      payload: {
        reviewId: 'review_1',
      },
      priority: expectedPriority,
      notificationId: 'notif_1',
      tx,
    })
  })

  it('falls back to the user phone when the profile phone is missing', async () => {
    mockPrisma.notification.create.mockResolvedValue({ id: 'notif_2' })

    mockPrisma.professionalProfile.findUnique.mockResolvedValue({
      id: 'pro_1',
      userId: 'user_1',
      phone: null,
      phoneVerifiedAt: null,
      timeZone: 'America/Los_Angeles',
      user: {
        email: 'pro@example.com',
        emailVerifiedAt: new Date('2026-04-08T07:00:00.000Z'),
        phone: '+15557654321',
        phoneVerifiedAt: new Date('2026-04-08T08:00:00.000Z'),
      },
    })

    await createProNotification({
      professionalId: 'pro_1',
      eventKey: NotificationEventKey.BOOKING_REQUEST_CREATED,
      title: 'New booking request',
      body: 'A client wants to book with you.',
      href: '/pro/bookings/booking_1',
    })

    expect(mockEnqueueDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        tx,
        recipient: expect.objectContaining({
          phone: '+15557654321',
          phoneVerifiedAt: new Date('2026-04-08T08:00:00.000Z'),
          emailVerifiedAt: new Date('2026-04-08T07:00:00.000Z'),
          timeZone: 'America/Los_Angeles',
        }),
      }),
    )
  })

  it('updates an existing deduped pro notification instead of creating a new one', async () => {
    mockPrisma.notification.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.notification.findFirst.mockResolvedValue({
      id: 'notif_existing',
    })

    const eventKey = NotificationEventKey.BOOKING_CONFIRMED
    const expectedPriority = expectedPriorityFor(eventKey)

    const result = await createProNotification({
      professionalId: 'pro_1',
      eventKey,
      title: 'Booking confirmed',
      body: 'Your booking has been confirmed.',
      href: '/pro/bookings/booking_1',
      dedupeKey: 'BOOKING_CONFIRMED:booking_1',
      bookingId: 'booking_1',
      actorUserId: 'user_actor',
      data: {
        bookingId: 'booking_1',
      },
    })

    expect(result).toEqual({ id: 'notif_existing' })
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)

    expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
      where: {
        professionalId: 'pro_1',
        dedupeKey: 'BOOKING_CONFIRMED:booking_1',
      },
      data: {
        eventKey,
        priority: expectedPriority,
        title: 'Booking confirmed',
        body: 'Your booking has been confirmed.',
        href: '/pro/bookings/booking_1',
        dedupeKey: 'BOOKING_CONFIRMED:booking_1',
        actorUserId: 'user_actor',
        bookingId: 'booking_1',
        reviewId: null,
        seenAt: null,
        readAt: null,
        clickedAt: null,
        archivedAt: null,
        data: {
          bookingId: 'booking_1',
        },
      },
    })

    expect(mockPrisma.notification.findFirst).toHaveBeenCalledWith({
      where: {
        professionalId: 'pro_1',
        dedupeKey: 'BOOKING_CONFIRMED:booking_1',
      },
      select: { id: true },
    })

    expect(mockPrisma.notification.create).not.toHaveBeenCalled()
    expect(mockEnqueueDispatch).not.toHaveBeenCalled()
    expect(mockPrisma.professionalProfile.findUnique).not.toHaveBeenCalled()
    expect(
      mockPrisma.professionalNotificationPreference.findUnique,
    ).not.toHaveBeenCalled()
  })

  it('retries with update after a create race on a deduped pro notification', async () => {
    mockPrisma.notification.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })

    mockPrisma.notification.create.mockRejectedValueOnce(
      makeUniqueConstraintError(),
    )

    mockPrisma.notification.findFirst.mockResolvedValue({
      id: 'notif_raced',
    })

    const eventKey = NotificationEventKey.BOOKING_RESCHEDULED

    const result = await createProNotification({
      professionalId: 'pro_1',
      eventKey,
      title: 'Booking rescheduled',
      body: 'One of your bookings was rescheduled.',
      href: '/pro/bookings/booking_1',
      dedupeKey: 'BOOKING_RESCHEDULED:booking_1',
      bookingId: 'booking_1',
    })

    expect(result).toEqual({ id: 'notif_raced' })
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
    expect(mockPrisma.notification.create).toHaveBeenCalledTimes(1)
    expect(mockPrisma.notification.updateMany).toHaveBeenCalledTimes(2)

    expect(mockPrisma.notification.findFirst).toHaveBeenCalledWith({
      where: {
        professionalId: 'pro_1',
        dedupeKey: 'BOOKING_RESCHEDULED:booking_1',
      },
      select: { id: true },
    })

    expect(mockEnqueueDispatch).not.toHaveBeenCalled()
    expect(mockPrisma.professionalProfile.findUnique).not.toHaveBeenCalled()
    expect(
      mockPrisma.professionalNotificationPreference.findUnique,
    ).not.toHaveBeenCalled()
  })

  it('throws when the professional cannot be loaded for dispatch enqueue', async () => {
    mockPrisma.notification.create.mockResolvedValue({ id: 'notif_missing_pro' })
    mockPrisma.professionalProfile.findUnique.mockResolvedValue(null)

    await expect(
      createProNotification({
        professionalId: 'pro_missing',
        eventKey: NotificationEventKey.REVIEW_RECEIVED,
        title: 'Review received',
      }),
    ).rejects.toThrow(
      'createProNotification: professional not found for dispatch enqueue',
    )

    expect(mockEnqueueDispatch).not.toHaveBeenCalled()
  })
})