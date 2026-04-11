import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingStatus, NotificationEventKey } from '@prisma/client'

const TEST_NOW = new Date('2026-03-18T16:00:00.000Z')

const mocks = vi.hoisted(() => ({
  txBookingFindUnique: vi.fn(),

  cancelScheduledClientNotificationsForBooking: vi.fn(),
  scheduleClientNotification: vi.fn(),
}))

vi.mock('@/lib/notifications/clientNotifications', () => ({
  cancelScheduledClientNotificationsForBooking:
    mocks.cancelScheduledClientNotificationsForBooking,
  scheduleClientNotification: mocks.scheduleClientNotification,
}))

import {
  cancelBookingAppointmentReminders,
  syncBookingAppointmentReminders,
} from './appointmentReminders'

const tx = {
  booking: {
    findUnique: mocks.txBookingFindUnique,
  },
} as const

describe('lib/notifications/appointmentReminders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(TEST_NOW)

    mocks.cancelScheduledClientNotificationsForBooking.mockResolvedValue(
      undefined,
    )
    mocks.scheduleClientNotification.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('cancelBookingAppointmentReminders', () => {
    it('cancels pending appointment reminders for a booking with a client', async () => {
      mocks.txBookingFindUnique.mockResolvedValueOnce({
        id: 'booking_1',
        clientId: 'client_1',
      })

      await cancelBookingAppointmentReminders({
        tx: tx as never,
        bookingId: 'booking_1',
      })

      expect(mocks.txBookingFindUnique).toHaveBeenCalledWith({
        where: { id: 'booking_1' },
        select: {
          id: true,
          clientId: true,
        },
      })

      expect(
        mocks.cancelScheduledClientNotificationsForBooking,
      ).toHaveBeenCalledWith({
        tx,
        bookingId: 'booking_1',
        clientId: 'client_1',
        eventKeys: [NotificationEventKey.APPOINTMENT_REMINDER],
        onlyPending: true,
      })

      expect(mocks.scheduleClientNotification).not.toHaveBeenCalled()
    })

    it('no-ops when the booking has no client', async () => {
      mocks.txBookingFindUnique.mockResolvedValueOnce({
        id: 'booking_2',
        clientId: null,
      })

      await cancelBookingAppointmentReminders({
        tx: tx as never,
        bookingId: 'booking_2',
      })

      expect(
        mocks.cancelScheduledClientNotificationsForBooking,
      ).not.toHaveBeenCalled()
      expect(mocks.scheduleClientNotification).not.toHaveBeenCalled()
    })

    it('no-ops when the booking is missing', async () => {
      mocks.txBookingFindUnique.mockResolvedValueOnce(null)

      await cancelBookingAppointmentReminders({
        tx: tx as never,
        bookingId: 'missing_booking',
      })

      expect(
        mocks.cancelScheduledClientNotificationsForBooking,
      ).not.toHaveBeenCalled()
      expect(mocks.scheduleClientNotification).not.toHaveBeenCalled()
    })
  })

  describe('syncBookingAppointmentReminders', () => {
    it('cancels existing pending reminders and schedules one-week and day-before reminders', async () => {
      mocks.txBookingFindUnique.mockResolvedValueOnce({
        id: 'booking_3',
        clientId: 'client_3',
        scheduledFor: new Date('2026-03-28T16:00:00.000Z'),
        status: BookingStatus.ACCEPTED,
        finishedAt: null,
        locationTimeZone: 'America/Los_Angeles',
        clientTimeZoneAtBooking: 'America/New_York',
        service: {
          name: 'Silk Press',
        },
      })

      await syncBookingAppointmentReminders({
        tx: tx as never,
        bookingId: 'booking_3',
      })

      expect(
        mocks.cancelScheduledClientNotificationsForBooking,
      ).toHaveBeenCalledWith({
        tx,
        bookingId: 'booking_3',
        clientId: 'client_3',
        eventKeys: [NotificationEventKey.APPOINTMENT_REMINDER],
        onlyPending: true,
      })

      expect(mocks.scheduleClientNotification).toHaveBeenCalledTimes(2)

      expect(mocks.scheduleClientNotification).toHaveBeenNthCalledWith(1, {
        tx,
        clientId: 'client_3',
        bookingId: 'booking_3',
        eventKey: NotificationEventKey.APPOINTMENT_REMINDER,
        runAt: new Date('2026-03-21T16:00:00.000Z'),
        dedupeKey: 'CLIENT_REMINDER:ONE_WEEK:booking_3',
        href: '/client/bookings/booking_3?step=overview',
        data: {
          reminderKind: 'ONE_WEEK',
          bookingId: 'booking_3',
          scheduledFor: '2026-03-28T16:00:00.000Z',
          timeZone: 'America/Los_Angeles',
          serviceName: 'Silk Press',
          professionalName: null,
        },
      })

      expect(mocks.scheduleClientNotification).toHaveBeenNthCalledWith(2, {
        tx,
        clientId: 'client_3',
        bookingId: 'booking_3',
        eventKey: NotificationEventKey.APPOINTMENT_REMINDER,
        runAt: new Date('2026-03-27T16:00:00.000Z'),
        dedupeKey: 'CLIENT_REMINDER:DAY_BEFORE:booking_3',
        href: '/client/bookings/booking_3?step=overview',
        data: {
          reminderKind: 'DAY_BEFORE',
          bookingId: 'booking_3',
          scheduledFor: '2026-03-28T16:00:00.000Z',
          timeZone: 'America/Los_Angeles',
          serviceName: 'Silk Press',
          professionalName: null,
        },
      })
    })

    it('schedules only the day-before reminder when the one-week reminder is already in the past', async () => {
      mocks.txBookingFindUnique.mockResolvedValueOnce({
        id: 'booking_4',
        clientId: 'client_4',
        scheduledFor: new Date('2026-03-20T16:00:00.000Z'),
        status: BookingStatus.ACCEPTED,
        finishedAt: null,
        locationTimeZone: 'America/Chicago',
        clientTimeZoneAtBooking: 'America/New_York',
        service: {
          name: 'Blowout',
        },
      })

      await syncBookingAppointmentReminders({
        tx: tx as never,
        bookingId: 'booking_4',
      })

      expect(
        mocks.cancelScheduledClientNotificationsForBooking,
      ).toHaveBeenCalledTimes(1)

      expect(mocks.scheduleClientNotification).toHaveBeenCalledTimes(1)
      expect(mocks.scheduleClientNotification).toHaveBeenCalledWith({
        tx,
        clientId: 'client_4',
        bookingId: 'booking_4',
        eventKey: NotificationEventKey.APPOINTMENT_REMINDER,
        runAt: new Date('2026-03-19T16:00:00.000Z'),
        dedupeKey: 'CLIENT_REMINDER:DAY_BEFORE:booking_4',
        href: '/client/bookings/booking_4?step=overview',
        data: {
          reminderKind: 'DAY_BEFORE',
          bookingId: 'booking_4',
          scheduledFor: '2026-03-20T16:00:00.000Z',
          timeZone: 'America/Chicago',
          serviceName: 'Blowout',
          professionalName: null,
        },
      })
    })

    it('cancels existing reminders and schedules nothing for cancelled bookings', async () => {
      mocks.txBookingFindUnique.mockResolvedValueOnce({
        id: 'booking_5',
        clientId: 'client_5',
        scheduledFor: new Date('2026-03-28T16:00:00.000Z'),
        status: BookingStatus.CANCELLED,
        finishedAt: null,
        locationTimeZone: 'America/Los_Angeles',
        clientTimeZoneAtBooking: 'America/New_York',
        service: {
          name: 'Haircut',
        },
      })

      await syncBookingAppointmentReminders({
        tx: tx as never,
        bookingId: 'booking_5',
      })

      expect(
        mocks.cancelScheduledClientNotificationsForBooking,
      ).toHaveBeenCalledTimes(1)
      expect(mocks.scheduleClientNotification).not.toHaveBeenCalled()
    })

    it('cancels existing reminders and schedules nothing for completed bookings', async () => {
      mocks.txBookingFindUnique.mockResolvedValueOnce({
        id: 'booking_6',
        clientId: 'client_6',
        scheduledFor: new Date('2026-03-28T16:00:00.000Z'),
        status: BookingStatus.COMPLETED,
        finishedAt: null,
        locationTimeZone: 'America/Los_Angeles',
        clientTimeZoneAtBooking: 'America/New_York',
        service: {
          name: 'Color',
        },
      })

      await syncBookingAppointmentReminders({
        tx: tx as never,
        bookingId: 'booking_6',
      })

      expect(
        mocks.cancelScheduledClientNotificationsForBooking,
      ).toHaveBeenCalledTimes(1)
      expect(mocks.scheduleClientNotification).not.toHaveBeenCalled()
    })

    it('cancels existing reminders and schedules nothing for finished bookings', async () => {
      mocks.txBookingFindUnique.mockResolvedValueOnce({
        id: 'booking_7',
        clientId: 'client_7',
        scheduledFor: new Date('2026-03-28T16:00:00.000Z'),
        status: BookingStatus.ACCEPTED,
        finishedAt: new Date('2026-03-18T12:00:00.000Z'),
        locationTimeZone: 'America/Los_Angeles',
        clientTimeZoneAtBooking: 'America/New_York',
        service: {
          name: 'Trim',
        },
      })

      await syncBookingAppointmentReminders({
        tx: tx as never,
        bookingId: 'booking_7',
      })

      expect(
        mocks.cancelScheduledClientNotificationsForBooking,
      ).toHaveBeenCalledTimes(1)
      expect(mocks.scheduleClientNotification).not.toHaveBeenCalled()
    })

    it('uses clientTimeZoneAtBooking when locationTimeZone is missing', async () => {
      mocks.txBookingFindUnique.mockResolvedValueOnce({
        id: 'booking_8',
        clientId: 'client_8',
        scheduledFor: new Date('2026-03-28T16:00:00.000Z'),
        status: BookingStatus.ACCEPTED,
        finishedAt: null,
        locationTimeZone: null,
        clientTimeZoneAtBooking: 'America/New_York',
        service: {
          name: 'Extensions',
        },
      })

      await syncBookingAppointmentReminders({
        tx: tx as never,
        bookingId: 'booking_8',
      })

      expect(mocks.scheduleClientNotification).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          data: expect.objectContaining({
            timeZone: 'America/New_York',
          }),
        }),
      )
    })

    it('falls back to the default timezone when both booking timezones are missing or invalid', async () => {
      mocks.txBookingFindUnique.mockResolvedValueOnce({
        id: 'booking_9',
        clientId: 'client_9',
        scheduledFor: new Date('2026-03-28T16:00:00.000Z'),
        status: BookingStatus.ACCEPTED,
        finishedAt: null,
        locationTimeZone: 'not-a-real-time-zone',
        clientTimeZoneAtBooking: null,
        service: {
          name: 'Gloss',
        },
      })

      await syncBookingAppointmentReminders({
        tx: tx as never,
        bookingId: 'booking_9',
      })

      expect(mocks.scheduleClientNotification).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          data: expect.objectContaining({
            timeZone: 'UTC',
          }),
        }),
      )
    })

    it('uses Appointment as the fallback service name', async () => {
      mocks.txBookingFindUnique.mockResolvedValueOnce({
        id: 'booking_10',
        clientId: 'client_10',
        scheduledFor: new Date('2026-03-28T16:00:00.000Z'),
        status: BookingStatus.ACCEPTED,
        finishedAt: null,
        locationTimeZone: 'America/Los_Angeles',
        clientTimeZoneAtBooking: null,
        service: {
          name: '   ',
        },
      })

      await syncBookingAppointmentReminders({
        tx: tx as never,
        bookingId: 'booking_10',
      })

      expect(mocks.scheduleClientNotification).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          data: expect.objectContaining({
            serviceName: 'Appointment',
          }),
        }),
      )
    })

    it('throws when the booking does not exist', async () => {
      mocks.txBookingFindUnique.mockResolvedValueOnce(null)

      await expect(
        syncBookingAppointmentReminders({
          tx: tx as never,
          bookingId: 'missing_booking',
        }),
      ).rejects.toThrow(
        'Booking missing_booking not found while syncing appointment reminders.',
      )

      expect(
        mocks.cancelScheduledClientNotificationsForBooking,
      ).not.toHaveBeenCalled()
      expect(mocks.scheduleClientNotification).not.toHaveBeenCalled()
    })
  })
})