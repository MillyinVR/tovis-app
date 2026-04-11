import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationEventKey, Prisma } from '@prisma/client'

const mockEnqueueDispatch = vi.hoisted(() => vi.fn())

const mockPrisma = vi.hoisted(() => ({
  clientNotification: {
    create: vi.fn(),
    updateMany: vi.fn(),
    findFirst: vi.fn(),
    count: vi.fn(),
  },
  scheduledClientNotification: {
    create: vi.fn(),
    updateMany: vi.fn(),
    findFirst: vi.fn(),
  },
  clientProfile: {
    findUnique: vi.fn(),
  },
  clientNotificationPreference: {
    findUnique: vi.fn(),
  },
  booking: {
    findUnique: vi.fn(),
  },
  aftercareSummary: {
    findUnique: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mockPrisma,
}))

vi.mock('./dispatch/enqueueDispatch', () => ({
  enqueueDispatch: mockEnqueueDispatch,
}))

import {
  cancelScheduledClientNotificationsForBooking,
  createClientNotification,
  getUnreadClientNotificationCount,
  markClientNotificationsRead,
  scheduleClientNotification,
  upsertClientNotification,
} from './clientNotifications'

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

describe('lib/notifications/clientNotifications', () => {
  beforeEach(() => {
    resetMockGroup(mockPrisma.clientNotification)
    resetMockGroup(mockPrisma.scheduledClientNotification)
    resetMockGroup(mockPrisma.clientProfile)
    resetMockGroup(mockPrisma.clientNotificationPreference)
    resetMockGroup(mockPrisma.booking)
    resetMockGroup(mockPrisma.aftercareSummary)
    mockEnqueueDispatch.mockReset()

    mockPrisma.clientProfile.findUnique.mockResolvedValue({
      id: 'client_1',
      userId: 'user_1',
      phone: null,
      phoneVerifiedAt: null,
      user: {
        email: 'client@example.com',
        emailVerifiedAt: new Date('2026-04-08T12:00:00.000Z'),
        phone: null,
        phoneVerifiedAt: null,
      },
    })

    mockPrisma.clientNotificationPreference.findUnique.mockResolvedValue(null)
    mockPrisma.booking.findUnique.mockResolvedValue(null)
    mockPrisma.aftercareSummary.findUnique.mockResolvedValue(null)
    mockEnqueueDispatch.mockResolvedValue(undefined)
  })

  it('creates a new client notification when no dedupeKey is provided', async () => {
    mockPrisma.clientNotification.create.mockResolvedValue({ id: 'notif_1' })
    mockPrisma.booking.findUnique.mockResolvedValue({
      locationTimeZone: 'America/Los_Angeles',
      clientTimeZoneAtBooking: null,
    })

    const result = await createClientNotification({
      clientId: 'client_1',
      eventKey: NotificationEventKey.AFTERCARE_READY,
      title: 'Aftercare ready',
      body: ' Your aftercare summary is ready. ',
      bookingId: 'booking_1',
      aftercareId: 'aftercare_1',
      href: ' /client/bookings/booking_1?step=aftercare ',
      data: {
        bookingId: 'booking_1',
        aftercareId: 'aftercare_1',
      },
    })

    expect(result).toEqual({ id: 'notif_1' })

    expect(mockPrisma.clientNotification.create).toHaveBeenCalledWith({
      data: {
        clientId: 'client_1',
        dedupeKey: null,
        eventKey: NotificationEventKey.AFTERCARE_READY,
        title: 'Aftercare ready',
        body: 'Your aftercare summary is ready.',
        href: '/client/bookings/booking_1?step=aftercare',
        bookingId: 'booking_1',
        aftercareId: 'aftercare_1',
        readAt: null,
        data: {
          bookingId: 'booking_1',
          aftercareId: 'aftercare_1',
        },
      },
      select: { id: true },
    })

    expect(mockPrisma.clientNotification.updateMany).not.toHaveBeenCalled()

    expect(mockPrisma.booking.findUnique).toHaveBeenCalledWith({
      where: {
        id: 'booking_1',
      },
      select: {
        locationTimeZone: true,
        clientTimeZoneAtBooking: true,
      },
    })

    expect(mockEnqueueDispatch).toHaveBeenCalledWith({
      key: NotificationEventKey.AFTERCARE_READY,
      sourceKey: 'client-notification:notif_1',
      recipient: {
        kind: 'CLIENT',
        clientId: 'client_1',
        userId: 'user_1',
        inAppTargetId: 'client_1',
        phone: null,
        phoneVerifiedAt: null,
        email: 'client@example.com',
        emailVerifiedAt: new Date('2026-04-08T12:00:00.000Z'),
        timeZone: 'America/Los_Angeles',
        preference: null,
      },
      title: 'Aftercare ready',
      body: 'Your aftercare summary is ready.',
      href: '/client/bookings/booking_1?step=aftercare',
      payload: {
        bookingId: 'booking_1',
        aftercareId: 'aftercare_1',
      },
      clientNotificationId: 'notif_1',
      tx: undefined,
    })
  })

  it('uses aftercare booking timezone when booking lookup is unavailable', async () => {
    mockPrisma.clientNotification.create.mockResolvedValue({
      id: 'notif_aftercare',
    })
    mockPrisma.booking.findUnique.mockResolvedValue(null)
    mockPrisma.aftercareSummary.findUnique.mockResolvedValue({
      booking: {
        locationTimeZone: 'America/New_York',
        clientTimeZoneAtBooking: 'America/Chicago',
      },
    })

    const result = await createClientNotification({
      clientId: 'client_1',
      eventKey: NotificationEventKey.AFTERCARE_READY,
      title: 'Aftercare ready',
      aftercareId: 'aftercare_1',
      body: 'Review your aftercare plan.',
    })

    expect(result).toEqual({ id: 'notif_aftercare' })

    expect(mockPrisma.booking.findUnique).not.toHaveBeenCalled()

    expect(mockPrisma.aftercareSummary.findUnique).toHaveBeenCalledWith({
      where: {
        id: 'aftercare_1',
      },
      select: {
        booking: {
          select: {
            locationTimeZone: true,
            clientTimeZoneAtBooking: true,
          },
        },
      },
    })

    expect(mockEnqueueDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: expect.objectContaining({
          timeZone: 'America/Chicago',
          emailVerifiedAt: new Date('2026-04-08T12:00:00.000Z'),
        }),
      }),
    )
  })

  it('updates an existing deduped notification instead of creating a new one', async () => {
    mockPrisma.clientNotification.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.clientNotification.findFirst.mockResolvedValue({
      id: 'notif_existing',
    })

    const result = await createClientNotification({
      clientId: 'client_1',
      eventKey: NotificationEventKey.CONSULTATION_PROPOSAL_SENT,
      title: 'Consultation proposal ready',
      body: 'Review your proposal.',
      bookingId: 'booking_1',
      dedupeKey: 'CONSULTATION_PROPOSAL:booking_1',
      href: '/client/bookings/booking_1?step=consult',
      data: {
        bookingId: 'booking_1',
        reason: 'CONSULTATION_PROPOSAL_READY',
      },
    })

    expect(result).toEqual({ id: 'notif_existing' })

    expect(mockPrisma.clientNotification.updateMany).toHaveBeenCalledWith({
      where: {
        clientId: 'client_1',
        dedupeKey: 'CONSULTATION_PROPOSAL:booking_1',
      },
      data: {
        eventKey: NotificationEventKey.CONSULTATION_PROPOSAL_SENT,
        title: 'Consultation proposal ready',
        body: 'Review your proposal.',
        href: '/client/bookings/booking_1?step=consult',
        bookingId: 'booking_1',
        aftercareId: null,
        dedupeKey: 'CONSULTATION_PROPOSAL:booking_1',
        readAt: null,
        data: {
          bookingId: 'booking_1',
          reason: 'CONSULTATION_PROPOSAL_READY',
        },
      },
    })

    expect(mockPrisma.clientNotification.create).not.toHaveBeenCalled()
  })

  it('retries with update after a create race on a deduped notification', async () => {
    mockPrisma.clientNotification.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })

    mockPrisma.clientNotification.create.mockRejectedValueOnce(
      makeUniqueConstraintError(),
    )

    mockPrisma.clientNotification.findFirst.mockResolvedValue({
      id: 'notif_raced',
    })

    const result = await createClientNotification({
      clientId: 'client_1',
      eventKey: NotificationEventKey.BOOKING_CONFIRMED,
      title: 'Appointment confirmed',
      body: 'Your appointment has been confirmed.',
      bookingId: 'booking_1',
      dedupeKey: 'BOOKING_CONFIRMED:booking_1',
      href: '/client/bookings/booking_1?step=overview',
    })

    expect(result).toEqual({ id: 'notif_raced' })
    expect(mockPrisma.clientNotification.create).toHaveBeenCalledTimes(1)
    expect(mockPrisma.clientNotification.updateMany).toHaveBeenCalledTimes(2)

    expect(mockPrisma.clientNotification.findFirst).toHaveBeenCalledWith({
      where: {
        clientId: 'client_1',
        dedupeKey: 'BOOKING_CONFIRMED:booking_1',
      },
      select: { id: true },
    })
  })

  it('requires a dedupeKey for upsertClientNotification', async () => {
    await expect(
      upsertClientNotification({
        clientId: 'client_1',
        eventKey: NotificationEventKey.BOOKING_CANCELLED_BY_PRO,
        title: 'Appointment cancelled',
        body: 'Your appointment was cancelled.',
        bookingId: 'booking_1',
        dedupeKey: '',
      }),
    ).rejects.toThrow('upsertClientNotification: missing dedupeKey')
  })

  it('creates a non-deduped scheduled notification when no dedupeKey is provided', async () => {
    const runAt = new Date('2026-04-13T10:00:00.000Z')
    mockPrisma.scheduledClientNotification.create.mockResolvedValue({
      id: 'scheduled_create_1',
    })

    const result = await scheduleClientNotification({
      clientId: 'client_1',
      bookingId: 'booking_1',
      eventKey: NotificationEventKey.APPOINTMENT_REMINDER,
      runAt,
      href: ' /client/bookings/booking_1?step=overview ',
      data: {
        bookingId: 'booking_1',
        reminderKind: 'DAY_BEFORE',
      },
    })

    expect(result).toEqual({ id: 'scheduled_create_1' })

    expect(mockPrisma.scheduledClientNotification.create).toHaveBeenCalledWith({
      data: {
        clientId: 'client_1',
        dedupeKey: null,
        eventKey: NotificationEventKey.APPOINTMENT_REMINDER,
        runAt,
        href: '/client/bookings/booking_1?step=overview',
        bookingId: 'booking_1',
        processedAt: null,
        cancelledAt: null,
        failedAt: null,
        lastError: null,
        data: {
          bookingId: 'booking_1',
          reminderKind: 'DAY_BEFORE',
        },
      },
      select: { id: true },
    })

    expect(
      mockPrisma.scheduledClientNotification.updateMany,
    ).not.toHaveBeenCalled()
  })

  it('schedules a deduped client notification by updating an existing row', async () => {
    const runAt = new Date('2026-04-13T10:00:00.000Z')

    mockPrisma.scheduledClientNotification.updateMany.mockResolvedValue({
      count: 1,
    })
    mockPrisma.scheduledClientNotification.findFirst.mockResolvedValue({
      id: 'scheduled_1',
    })

    const result = await scheduleClientNotification({
      clientId: 'client_1',
      bookingId: 'booking_1',
      eventKey: NotificationEventKey.APPOINTMENT_REMINDER,
      runAt,
      dedupeKey: 'CLIENT_REMINDER:1W:booking_1',
      href: '/client/bookings/booking_1?step=overview',
      data: {
        bookingId: 'booking_1',
        reminderKind: 'ONE_WEEK',
      },
    })

    expect(result).toEqual({ id: 'scheduled_1' })

    expect(
      mockPrisma.scheduledClientNotification.updateMany,
    ).toHaveBeenCalledWith({
      where: {
        clientId: 'client_1',
        dedupeKey: 'CLIENT_REMINDER:1W:booking_1',
      },
      data: {
        eventKey: NotificationEventKey.APPOINTMENT_REMINDER,
        runAt,
        href: '/client/bookings/booking_1?step=overview',
        bookingId: 'booking_1',
        processedAt: null,
        cancelledAt: null,
        failedAt: null,
        lastError: null,
        data: {
          bookingId: 'booking_1',
          reminderKind: 'ONE_WEEK',
        },
      },
    })

    expect(
      mockPrisma.scheduledClientNotification.findFirst,
    ).toHaveBeenCalledWith({
      where: {
        clientId: 'client_1',
        dedupeKey: 'CLIENT_REMINDER:1W:booking_1',
      },
      select: { id: true },
    })
  })

  it('retries scheduled notification update after a create race on a deduped row', async () => {
    const runAt = new Date('2026-04-13T10:00:00.000Z')

    mockPrisma.scheduledClientNotification.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })

    mockPrisma.scheduledClientNotification.create.mockRejectedValueOnce(
      makeUniqueConstraintError(),
    )

    mockPrisma.scheduledClientNotification.findFirst.mockResolvedValue({
      id: 'scheduled_raced',
    })

    const result = await scheduleClientNotification({
      clientId: 'client_1',
      bookingId: 'booking_1',
      eventKey: NotificationEventKey.APPOINTMENT_REMINDER,
      runAt,
      dedupeKey: 'CLIENT_REMINDER:DAY_BEFORE:booking_1',
      href: '/client/bookings/booking_1?step=overview',
      data: {
        bookingId: 'booking_1',
        reminderKind: 'DAY_BEFORE',
      },
    })

    expect(result).toEqual({ id: 'scheduled_raced' })
    expect(mockPrisma.scheduledClientNotification.create).toHaveBeenCalledTimes(1)
    expect(
      mockPrisma.scheduledClientNotification.updateMany,
    ).toHaveBeenCalledTimes(2)

    expect(
      mockPrisma.scheduledClientNotification.findFirst,
    ).toHaveBeenCalledWith({
      where: {
        clientId: 'client_1',
        dedupeKey: 'CLIENT_REMINDER:DAY_BEFORE:booking_1',
      },
      select: { id: true },
    })
  })

  it('cancels pending scheduled notifications for a booking', async () => {
    mockPrisma.scheduledClientNotification.updateMany.mockResolvedValue({
      count: 2,
    })

    const result = await cancelScheduledClientNotificationsForBooking({
      bookingId: 'booking_1',
      clientId: 'client_1',
      eventKeys: [NotificationEventKey.APPOINTMENT_REMINDER],
    })

    expect(result).toEqual({ count: 2 })

    expect(
      mockPrisma.scheduledClientNotification.updateMany,
    ).toHaveBeenCalledWith({
      where: {
        bookingId: 'booking_1',
        clientId: 'client_1',
        eventKey: { in: [NotificationEventKey.APPOINTMENT_REMINDER] },
        cancelledAt: null,
        processedAt: null,
      },
      data: {
        cancelledAt: expect.any(Date),
        failedAt: null,
        lastError: null,
      },
    })
  })

  it('can cancel scheduled notifications regardless of processed state when onlyPending is false', async () => {
    mockPrisma.scheduledClientNotification.updateMany.mockResolvedValue({
      count: 3,
    })

    const result = await cancelScheduledClientNotificationsForBooking({
      bookingId: 'booking_1',
      clientId: 'client_1',
      eventKeys: [NotificationEventKey.APPOINTMENT_REMINDER],
      onlyPending: false,
    })

    expect(result).toEqual({ count: 3 })

    expect(
      mockPrisma.scheduledClientNotification.updateMany,
    ).toHaveBeenCalledWith({
      where: {
        bookingId: 'booking_1',
        clientId: 'client_1',
        eventKey: { in: [NotificationEventKey.APPOINTMENT_REMINDER] },
        cancelledAt: null,
      },
      data: {
        cancelledAt: expect.any(Date),
        failedAt: null,
        lastError: null,
      },
    })
  })

  it('marks selected notifications read by id', async () => {
    mockPrisma.clientNotification.updateMany.mockResolvedValue({ count: 2 })

    const result = await markClientNotificationsRead({
      clientId: 'client_1',
      ids: ['notif_1', 'notif_2'],
    })

    expect(result).toEqual({ count: 2 })

    expect(mockPrisma.clientNotification.updateMany).toHaveBeenCalledWith({
      where: {
        clientId: 'client_1',
        readAt: null,
        id: { in: ['notif_1', 'notif_2'] },
      },
      data: {
        readAt: expect.any(Date),
      },
    })
  })

  it('returns a no-op when ids are provided but sanitize to an empty list', async () => {
    const result = await markClientNotificationsRead({
      clientId: 'client_1',
      ids: ['   ', ''],
    })

    expect(result).toEqual({ count: 0 })
    expect(mockPrisma.clientNotification.updateMany).not.toHaveBeenCalled()
  })

  it('counts unread notifications with optional eventKey filters', async () => {
    mockPrisma.clientNotification.count.mockResolvedValue(3)

    const result = await getUnreadClientNotificationCount({
      clientId: 'client_1',
      eventKeys: [
        NotificationEventKey.BOOKING_CONFIRMED,
        NotificationEventKey.BOOKING_RESCHEDULED,
      ],
    })

    expect(result).toBe(3)

    expect(mockPrisma.clientNotification.count).toHaveBeenCalledWith({
      where: {
        clientId: 'client_1',
        readAt: null,
        eventKey: {
          in: [
            NotificationEventKey.BOOKING_CONFIRMED,
            NotificationEventKey.BOOKING_RESCHEDULED,
          ],
        },
      },
    })
  })
})