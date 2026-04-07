import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NotificationPriority,
  NotificationType,
  ProNotificationReason,
} from '@prisma/client'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    notification: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

import {
  getProNotificationSummary,
  listProNotifications,
  markAllProNotificationsRead,
  markProNotificationRead,
} from '@/lib/notifications/proNotificationQueries'

describe('proNotificationQueries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getProNotificationSummary', () => {
    it('counts only unread active notifications', async () => {
      prismaMock.notification.count.mockResolvedValueOnce(3)

      const result = await getProNotificationSummary({
        professionalId: 'pro_123',
      })

      expect(prismaMock.notification.count).toHaveBeenCalledWith({
        where: {
          professionalId: 'pro_123',
          archivedAt: null,
          readAt: null,
        },
      })

      expect(result).toEqual({
        hasUnread: true,
        count: 3,
      })
    })

    it('returns hasUnread false when count is zero', async () => {
      prismaMock.notification.count.mockResolvedValueOnce(0)

      const result = await getProNotificationSummary({
        professionalId: 'pro_123',
      })

      expect(result).toEqual({
        hasUnread: false,
        count: 0,
      })
    })
  })

  describe('markProNotificationRead', () => {
    it('marks one owned active notification as seen and read', async () => {
      prismaMock.notification.updateMany.mockResolvedValueOnce({ count: 1 })

      const result = await markProNotificationRead({
        professionalId: 'pro_123',
        notificationId: 'notif_1',
      })

      expect(prismaMock.notification.updateMany).toHaveBeenCalledTimes(1)

      const call = prismaMock.notification.updateMany.mock.calls[0]?.[0]
      expect(call.where).toEqual({
        id: 'notif_1',
        professionalId: 'pro_123',
        archivedAt: null,
      })
      expect(call.data.readAt).toBeInstanceOf(Date)
      expect(call.data.seenAt).toBeInstanceOf(Date)

      expect(result).toBe(true)
    })

    it('returns false when notification is not found', async () => {
      prismaMock.notification.updateMany.mockResolvedValueOnce({ count: 0 })

      const result = await markProNotificationRead({
        professionalId: 'pro_123',
        notificationId: 'missing_notif',
      })

      expect(result).toBe(false)
    })
  })

  describe('markAllProNotificationsRead', () => {
    it('marks all unread active notifications as seen and read', async () => {
      prismaMock.notification.updateMany.mockResolvedValueOnce({ count: 4 })

      const result = await markAllProNotificationsRead({
        professionalId: 'pro_123',
      })

      expect(prismaMock.notification.updateMany).toHaveBeenCalledTimes(1)

      const call = prismaMock.notification.updateMany.mock.calls[0]?.[0]
      expect(call.where).toEqual({
        professionalId: 'pro_123',
        archivedAt: null,
        readAt: null,
      })
      expect(call.data.readAt).toBeInstanceOf(Date)
      expect(call.data.seenAt).toBeInstanceOf(Date)

      expect(result).toEqual({ count: 4 })
    })
  })

  describe('listProNotifications', () => {
    it('returns unread-only notifications when unreadOnly is true', async () => {
      prismaMock.notification.findMany.mockResolvedValueOnce([
        {
          id: 'notif_2',
          type: NotificationType.BOOKING_REQUEST,
          reason: ProNotificationReason.BOOKING_REQUEST_CREATED,
          priority: NotificationPriority.HIGH,
          title: 'New booking request',
          body: 'Someone requested a booking.',
          href: '/pro/bookings/booking_1',
          data: null,
          createdAt: new Date('2026-04-01T10:00:00.000Z'),
          seenAt: null,
          readAt: null,
          bookingId: 'booking_1',
          reviewId: null,
        },
      ])

      const result = await listProNotifications({
        professionalId: 'pro_123',
        take: 20,
        unreadOnly: true,
      })

      expect(prismaMock.notification.findMany).toHaveBeenCalledWith({
        where: {
          professionalId: 'pro_123',
          archivedAt: null,
          readAt: null,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 21,
        select: expect.any(Object),
      })

      expect(result.items).toHaveLength(1)
      expect(result.nextCursor).toBeNull()
    })

    it('supports type filtering', async () => {
      prismaMock.notification.findMany.mockResolvedValueOnce([])

      await listProNotifications({
        professionalId: 'pro_123',
        take: 20,
        type: NotificationType.REVIEW,
      })

      expect(prismaMock.notification.findMany).toHaveBeenCalledWith({
        where: {
          professionalId: 'pro_123',
          archivedAt: null,
          type: NotificationType.REVIEW,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 21,
        select: expect.any(Object),
      })
    })

    it('returns nextCursor when more rows exist', async () => {
      prismaMock.notification.findMany.mockResolvedValueOnce([
        {
          id: 'notif_3',
          type: NotificationType.BOOKING_UPDATE,
          reason: ProNotificationReason.BOOKING_RESCHEDULED,
          priority: NotificationPriority.HIGH,
          title: 'Booking rescheduled',
          body: 'A booking was rescheduled.',
          href: '/pro/bookings/booking_2',
          data: null,
          createdAt: new Date('2026-04-02T10:00:00.000Z'),
          seenAt: null,
          readAt: null,
          bookingId: 'booking_2',
          reviewId: null,
        },
        {
          id: 'notif_2',
          type: NotificationType.BOOKING_UPDATE,
          reason: ProNotificationReason.BOOKING_CONFIRMED,
          priority: NotificationPriority.HIGH,
          title: 'Booking confirmed',
          body: 'Booking confirmed.',
          href: '/pro/bookings/booking_1',
          data: null,
          createdAt: new Date('2026-04-01T10:00:00.000Z'),
          seenAt: null,
          readAt: null,
          bookingId: 'booking_1',
          reviewId: null,
        },
        {
          id: 'notif_1',
          type: NotificationType.REVIEW,
          reason: ProNotificationReason.REVIEW_RECEIVED,
          priority: NotificationPriority.NORMAL,
          title: 'New review received',
          body: 'A client left a review.',
          href: '/pro/bookings/booking_0',
          data: null,
          createdAt: new Date('2026-03-31T10:00:00.000Z'),
          seenAt: null,
          readAt: null,
          bookingId: 'booking_0',
          reviewId: 'review_1',
        },
      ])

      const result = await listProNotifications({
        professionalId: 'pro_123',
        take: 2,
      })

      expect(result.items).toHaveLength(2)
      expect(result.nextCursor).toBe('notif_2')
    })

    it('applies cursor paging when cursor row exists', async () => {
      prismaMock.notification.findFirst.mockResolvedValueOnce({
        id: 'notif_cursor',
        createdAt: new Date('2026-04-02T12:00:00.000Z'),
      })

      prismaMock.notification.findMany.mockResolvedValueOnce([])

      await listProNotifications({
        professionalId: 'pro_123',
        take: 20,
        cursorId: 'notif_cursor',
      })

      expect(prismaMock.notification.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'notif_cursor',
          professionalId: 'pro_123',
          archivedAt: null,
        },
        select: {
          id: true,
          createdAt: true,
        },
      })

      expect(prismaMock.notification.findMany).toHaveBeenCalledWith({
        where: {
          AND: [
            {
              professionalId: 'pro_123',
              archivedAt: null,
            },
            {
              OR: [
                {
                  createdAt: {
                    lt: new Date('2026-04-02T12:00:00.000Z'),
                  },
                },
                {
                  createdAt: new Date('2026-04-02T12:00:00.000Z'),
                  id: {
                    lt: 'notif_cursor',
                  },
                },
              ],
            },
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 21,
        select: expect.any(Object),
      })
    })

    it('falls back to first page behavior if cursor row is missing', async () => {
      prismaMock.notification.findFirst.mockResolvedValueOnce(null)
      prismaMock.notification.findMany.mockResolvedValueOnce([])

      await listProNotifications({
        professionalId: 'pro_123',
        take: 20,
        cursorId: 'missing_cursor',
      })

      expect(prismaMock.notification.findMany).toHaveBeenCalledWith({
        where: {
          professionalId: 'pro_123',
          archivedAt: null,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 21,
        select: expect.any(Object),
      })
    })
  })
})