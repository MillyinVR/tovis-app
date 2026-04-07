import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientNotificationType } from '@prisma/client'

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
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mockPrisma,
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

describe('lib/notifications/clientNotifications', () => {
  beforeEach(() => {
    resetMockGroup(mockPrisma.clientNotification)
    resetMockGroup(mockPrisma.scheduledClientNotification)
  })

  it('creates a new client notification when no dedupeKey is provided', async () => {
    mockPrisma.clientNotification.create.mockResolvedValue({ id: 'notif_1' })

    const result = await createClientNotification({
      clientId: 'client_1',
      type: ClientNotificationType.AFTERCARE,
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
        type: ClientNotificationType.AFTERCARE,
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
  })

  it('updates an existing deduped notification instead of creating a new one', async () => {
    mockPrisma.clientNotification.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.clientNotification.findFirst.mockResolvedValue({ id: 'notif_existing' })

    const result = await createClientNotification({
      clientId: 'client_1',
      type: ClientNotificationType.CONSULTATION_PROPOSAL,
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
        type: ClientNotificationType.CONSULTATION_PROPOSAL,
        title: 'Consultation proposal ready',
        body: 'Review your proposal.',
        href: '/client/bookings/booking_1?step=consult',
        bookingId: 'booking_1',
        aftercareId: null,
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
      new Error('Unique constraint failed'),
    )
    mockPrisma.clientNotification.findFirst.mockResolvedValue({ id: 'notif_raced' })

    const result = await createClientNotification({
      clientId: 'client_1',
      type: ClientNotificationType.BOOKING_CONFIRMED,
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
        type: ClientNotificationType.BOOKING_CANCELLED,
        title: 'Appointment cancelled',
        body: 'Your appointment was cancelled.',
        bookingId: 'booking_1',
        dedupeKey: '',
      }),
    ).rejects.toThrow('upsertClientNotification: missing dedupeKey')
  })

  it('schedules a deduped client notification by updating an existing row', async () => {
    const runAt = new Date('2026-04-13T10:00:00.000Z')

    mockPrisma.scheduledClientNotification.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.scheduledClientNotification.findFirst.mockResolvedValue({
      id: 'scheduled_1',
    })

    const result = await scheduleClientNotification({
      clientId: 'client_1',
      bookingId: 'booking_1',
      type: ClientNotificationType.APPOINTMENT_REMINDER,
      runAt,
      dedupeKey: 'CLIENT_REMINDER:1W:booking_1',
      href: '/client/bookings/booking_1?step=overview',
      data: {
        bookingId: 'booking_1',
        reminderKind: 'ONE_WEEK',
      },
    })

    expect(result).toEqual({ id: 'scheduled_1' })
    expect(mockPrisma.scheduledClientNotification.updateMany).toHaveBeenCalledWith({
      where: {
        clientId: 'client_1',
        dedupeKey: 'CLIENT_REMINDER:1W:booking_1',
      },
      data: {
        type: ClientNotificationType.APPOINTMENT_REMINDER,
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
  })

  it('cancels pending scheduled notifications for a booking', async () => {
    mockPrisma.scheduledClientNotification.updateMany.mockResolvedValue({ count: 2 })

    const result = await cancelScheduledClientNotificationsForBooking({
      bookingId: 'booking_1',
      clientId: 'client_1',
      types: [ClientNotificationType.APPOINTMENT_REMINDER],
    })

    expect(result).toEqual({ count: 2 })
    expect(mockPrisma.scheduledClientNotification.updateMany).toHaveBeenCalledWith({
      where: {
        bookingId: 'booking_1',
        clientId: 'client_1',
        type: { in: [ClientNotificationType.APPOINTMENT_REMINDER] },
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

  it('counts unread notifications with optional type filters', async () => {
    mockPrisma.clientNotification.count.mockResolvedValue(3)

    const result = await getUnreadClientNotificationCount({
      clientId: 'client_1',
      types: [
        ClientNotificationType.BOOKING_CONFIRMED,
        ClientNotificationType.BOOKING_RESCHEDULED,
      ],
    })

    expect(result).toBe(3)
    expect(mockPrisma.clientNotification.count).toHaveBeenCalledWith({
      where: {
        clientId: 'client_1',
        readAt: null,
        type: {
          in: [
            ClientNotificationType.BOOKING_CONFIRMED,
            ClientNotificationType.BOOKING_RESCHEDULED,
          ],
        },
      },
    })
  })
})