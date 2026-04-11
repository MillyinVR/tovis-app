import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingStatus,
  NotificationEventKey,
  Prisma,
} from '@prisma/client'

const TEST_NOW = new Date('2026-03-18T16:00:00.000Z')

const mocks = vi.hoisted(() => ({
  txBookingFindUnique: vi.fn(),
  txScheduledClientNotificationFindUnique: vi.fn(),
  txScheduledClientNotificationUpdateMany: vi.fn(),

  cancelScheduledClientNotificationsForBooking: vi.fn(),
  scheduleClientNotification: vi.fn(),
}))

vi.mock('@/lib/notifications/clientNotifications', () => ({
  cancelScheduledClientNotificationsForBooking:
    mocks.cancelScheduledClientNotificationsForBooking,
  scheduleClientNotification: mocks.scheduleClientNotification,
}))

import {
  buildAppointmentReminderContent,
  buildAppointmentReminderPayload,
  cancelBookingAppointmentReminders,
  cancelDueAppointmentReminder,
  computeAppointmentReminderRunAt,
  syncBookingAppointmentReminders,
  validateDueAppointmentReminder,
} from './appointmentReminders'

type TxMock = {
  booking: {
    findUnique: typeof mocks.txBookingFindUnique
  }
  scheduledClientNotification: {
    findUnique: typeof mocks.txScheduledClientNotificationFindUnique
    updateMany: typeof mocks.txScheduledClientNotificationUpdateMany
  }
}

const txMock: TxMock = {
  booking: {
    findUnique: mocks.txBookingFindUnique,
  },
  scheduledClientNotification: {
    findUnique: mocks.txScheduledClientNotificationFindUnique,
    updateMany: mocks.txScheduledClientNotificationUpdateMany,
  },
}

const tx = txMock as unknown as Prisma.TransactionClient

function makeBooking(
  overrides: Partial<{
    id: string
    clientId: string | null
    scheduledFor: Date
    status: BookingStatus
    finishedAt: Date | null
    locationTimeZone: string | null
    serviceName: string | null
  }> = {},
) {
  return {
    id: 'id' in overrides ? overrides.id! : 'booking_1',
    clientId: 'clientId' in overrides ? overrides.clientId! : 'client_1',
    scheduledFor:
      'scheduledFor' in overrides
        ? overrides.scheduledFor!
        : new Date('2026-03-28T16:00:00.000Z'),
    status: 'status' in overrides ? overrides.status! : BookingStatus.ACCEPTED,
    finishedAt: 'finishedAt' in overrides ? overrides.finishedAt! : null,
    locationTimeZone:
      'locationTimeZone' in overrides
        ? overrides.locationTimeZone!
        : 'America/Los_Angeles',
    service: {
      name: 'serviceName' in overrides ? overrides.serviceName! : 'Silk Press',
    },
  }
}

function makeReminderPayload(args: {
  bookingId: string
  kind: 'ONE_WEEK' | 'DAY_BEFORE'
  scheduledFor: Date
  timeZone: string
  serviceName?: string | null
  professionalName?: string | null
}) {
  return buildAppointmentReminderPayload({
    bookingId: args.bookingId,
    kind: args.kind,
    scheduledFor: args.scheduledFor,
    timeZone: args.timeZone,
    serviceName: args.serviceName,
    professionalName: args.professionalName ?? null,
  })
}

function makeDueRow(
  overrides: Partial<{
    id: string
    clientId: string
    bookingId: string | null
    eventKey: NotificationEventKey
    runAt: Date
    href: string
    dedupeKey: string
    data: Prisma.JsonValue | null
    cancelledAt: Date | null
    processedAt: Date | null
  }> = {},
) {
  return {
    id: 'id' in overrides ? overrides.id! : 'row_1',
    clientId: 'clientId' in overrides ? overrides.clientId! : 'client_1',
    bookingId: 'bookingId' in overrides ? overrides.bookingId! : 'booking_1',
    eventKey:
      'eventKey' in overrides
        ? overrides.eventKey!
        : NotificationEventKey.APPOINTMENT_REMINDER,
    runAt:
      'runAt' in overrides
        ? overrides.runAt!
        : new Date('2026-03-21T16:00:00.000Z'),
    href:
      'href' in overrides
        ? overrides.href!
        : '/client/bookings/booking_1?step=overview',
    dedupeKey:
      'dedupeKey' in overrides
        ? overrides.dedupeKey!
        : 'CLIENT_REMINDER:ONE_WEEK:booking_1',
    data:
      'data' in overrides
        ? overrides.data!
        : makeReminderPayload({
            bookingId: 'booking_1',
            kind: 'ONE_WEEK',
            scheduledFor: new Date('2026-03-28T16:00:00.000Z'),
            timeZone: 'America/Los_Angeles',
            serviceName: 'Silk Press',
          }),
    cancelledAt:
      'cancelledAt' in overrides ? overrides.cancelledAt! : null,
    processedAt:
      'processedAt' in overrides ? overrides.processedAt! : null,
  }
}

function queueBookingForSync(booking: ReturnType<typeof makeBooking>) {
  mocks.txBookingFindUnique
    .mockResolvedValueOnce(booking)
    .mockResolvedValueOnce({
      id: booking.id,
      clientId: booking.clientId,
    })
}

describe('lib/notifications/appointmentReminders', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.cancelScheduledClientNotificationsForBooking.mockResolvedValue(
      undefined,
    )
    mocks.scheduleClientNotification.mockResolvedValue(undefined)
    mocks.txScheduledClientNotificationUpdateMany.mockResolvedValue({
      count: 1,
    })
  })

  describe('computeAppointmentReminderRunAt', () => {
    it('preserves local wall-clock time across a DST fallback boundary', () => {
      const scheduledFor = new Date('2026-11-08T17:00:00.000Z') // 9:00 AM PST

      const runAt = computeAppointmentReminderRunAt({
        scheduledFor,
        timeZone: 'America/Los_Angeles',
        kind: 'ONE_WEEK',
      })

      expect(runAt).toEqual(new Date('2026-11-01T17:00:00.000Z'))
    })
  })

  describe('cancelBookingAppointmentReminders', () => {
    it('cancels pending appointment reminders for a booking with a client', async () => {
      mocks.txBookingFindUnique.mockResolvedValueOnce({
        id: 'booking_1',
        clientId: 'client_1',
      })

      await cancelBookingAppointmentReminders({
        tx,
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
        tx,
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
        tx,
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
      const booking = makeBooking({
        id: 'booking_3',
        clientId: 'client_3',
        scheduledFor: new Date('2026-03-28T16:00:00.000Z'),
        status: BookingStatus.ACCEPTED,
        finishedAt: null,
        locationTimeZone: 'America/Los_Angeles',
        serviceName: 'Silk Press',
      })

      queueBookingForSync(booking)

      await syncBookingAppointmentReminders({
        tx,
        bookingId: 'booking_3',
        now: TEST_NOW,
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
      const booking = makeBooking({
        id: 'booking_4',
        clientId: 'client_4',
        scheduledFor: new Date('2026-03-20T16:00:00.000Z'),
        status: BookingStatus.ACCEPTED,
        locationTimeZone: 'America/Chicago',
        serviceName: 'Blowout',
      })

      queueBookingForSync(booking)

      await syncBookingAppointmentReminders({
        tx,
        bookingId: 'booking_4',
        now: TEST_NOW,
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
      const booking = makeBooking({
        id: 'booking_5',
        clientId: 'client_5',
        status: BookingStatus.CANCELLED,
      })

      queueBookingForSync(booking)

      await syncBookingAppointmentReminders({
        tx,
        bookingId: 'booking_5',
        now: TEST_NOW,
      })

      expect(
        mocks.cancelScheduledClientNotificationsForBooking,
      ).toHaveBeenCalledTimes(1)
      expect(mocks.scheduleClientNotification).not.toHaveBeenCalled()
    })

    it('cancels existing reminders and schedules nothing for finished bookings', async () => {
      const booking = makeBooking({
        id: 'booking_7',
        clientId: 'client_7',
        status: BookingStatus.ACCEPTED,
        finishedAt: new Date('2026-03-18T12:00:00.000Z'),
      })

      queueBookingForSync(booking)

      await syncBookingAppointmentReminders({
        tx,
        bookingId: 'booking_7',
        now: TEST_NOW,
      })

      expect(
        mocks.cancelScheduledClientNotificationsForBooking,
      ).toHaveBeenCalledTimes(1)
      expect(mocks.scheduleClientNotification).not.toHaveBeenCalled()
    })

    it('falls back to UTC when locationTimeZone is missing', async () => {
      const booking = makeBooking({
        id: 'booking_8',
        clientId: 'client_8',
        locationTimeZone: null,
        serviceName: 'Extensions',
      })

      queueBookingForSync(booking)

      await syncBookingAppointmentReminders({
        tx,
        bookingId: 'booking_8',
        now: TEST_NOW,
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

    it('falls back to UTC when locationTimeZone is invalid', async () => {
      const booking = makeBooking({
        id: 'booking_9',
        clientId: 'client_9',
        locationTimeZone: 'not-a-real-time-zone',
        serviceName: 'Gloss',
      })

      queueBookingForSync(booking)

      await syncBookingAppointmentReminders({
        tx,
        bookingId: 'booking_9',
        now: TEST_NOW,
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
      const booking = makeBooking({
        id: 'booking_10',
        clientId: 'client_10',
        serviceName: '   ',
      })

      queueBookingForSync(booking)

      await syncBookingAppointmentReminders({
        tx,
        bookingId: 'booking_10',
        now: TEST_NOW,
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
          tx,
          bookingId: 'missing_booking',
          now: TEST_NOW,
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

  describe('validateDueAppointmentReminder', () => {
    it('returns PROCESS when the due row still matches canonical booking state', async () => {
      const booking = makeBooking({
        id: 'booking_1',
        clientId: 'client_1',
        scheduledFor: new Date('2026-03-28T16:00:00.000Z'),
        locationTimeZone: 'America/Los_Angeles',
        serviceName: 'Silk Press',
      })

      const payload = makeReminderPayload({
        bookingId: 'booking_1',
        kind: 'ONE_WEEK',
        scheduledFor: booking.scheduledFor,
        timeZone: 'America/Los_Angeles',
        serviceName: 'Silk Press',
      })

      const row = makeDueRow({
        id: 'row_process_1',
        clientId: 'client_1',
        bookingId: 'booking_1',
        eventKey: NotificationEventKey.APPOINTMENT_REMINDER,
        runAt: new Date('2026-03-21T16:00:00.000Z'),
        dedupeKey: 'CLIENT_REMINDER:ONE_WEEK:booking_1',
        data: payload,
      })

      mocks.txScheduledClientNotificationFindUnique.mockResolvedValueOnce(row)
      mocks.txBookingFindUnique.mockResolvedValueOnce(booking)

      const result = await validateDueAppointmentReminder({
        tx,
        scheduledClientNotificationId: 'row_process_1',
        now: new Date('2026-03-21T16:00:01.000Z'),
      })

      expect(result).toEqual({
        action: 'PROCESS',
        rowId: 'row_process_1',
        clientId: 'client_1',
        bookingId: 'booking_1',
        dedupeKey: 'CLIENT_REMINDER:ONE_WEEK:booking_1',
        href: '/client/bookings/booking_1?step=overview',
        notification: buildAppointmentReminderContent(payload),
      })
    })

    it('returns SKIP when the due row is not yet due', async () => {
      mocks.txScheduledClientNotificationFindUnique.mockResolvedValueOnce(
        makeDueRow({
          runAt: new Date('2026-03-21T16:00:00.000Z'),
        }),
      )

      const result = await validateDueAppointmentReminder({
        tx,
        scheduledClientNotificationId: 'row_future_1',
        now: new Date('2026-03-21T15:59:59.000Z'),
      })

      expect(result).toEqual({ action: 'SKIP' })
      expect(mocks.txBookingFindUnique).not.toHaveBeenCalled()
    })

    it('returns CANCEL when the due row has the wrong event key', async () => {
      mocks.txScheduledClientNotificationFindUnique.mockResolvedValueOnce(
        makeDueRow({
          eventKey: NotificationEventKey.BOOKING_CONFIRMED,
        }),
      )

      const result = await validateDueAppointmentReminder({
        tx,
        scheduledClientNotificationId: 'row_wrong_event',
        now: new Date('2026-03-21T16:00:01.000Z'),
      })

      expect(result).toEqual({
        action: 'CANCEL',
        reason: 'Scheduled notification has the wrong event key.',
      })
    })

    it('returns CANCEL when the due row is missing bookingId', async () => {
      mocks.txScheduledClientNotificationFindUnique.mockResolvedValueOnce(
        makeDueRow({
          bookingId: null,
        }),
      )

      const result = await validateDueAppointmentReminder({
        tx,
        scheduledClientNotificationId: 'row_missing_booking_id',
        now: new Date('2026-03-21T16:00:01.000Z'),
      })

      expect(result).toEqual({
        action: 'CANCEL',
        reason: 'Scheduled reminder is missing bookingId.',
      })
    })

    it('returns CANCEL when the linked booking no longer exists', async () => {
      mocks.txScheduledClientNotificationFindUnique.mockResolvedValueOnce(
        makeDueRow(),
      )
      mocks.txBookingFindUnique.mockResolvedValueOnce(null)

      const result = await validateDueAppointmentReminder({
        tx,
        scheduledClientNotificationId: 'row_missing_booking',
        now: new Date('2026-03-21T16:00:01.000Z'),
      })

      expect(result).toEqual({
        action: 'CANCEL',
        reason: 'Linked booking no longer exists.',
      })
    })

    it('returns CANCEL when the linked booking is no longer eligible', async () => {
      mocks.txScheduledClientNotificationFindUnique.mockResolvedValueOnce(
        makeDueRow(),
      )
      mocks.txBookingFindUnique.mockResolvedValueOnce(
        makeBooking({
          status: BookingStatus.CANCELLED,
        }),
      )

      const result = await validateDueAppointmentReminder({
        tx,
        scheduledClientNotificationId: 'row_ineligible_booking',
        now: new Date('2026-03-21T16:00:01.000Z'),
      })

      expect(result).toEqual({
        action: 'CANCEL',
        reason:
          'Linked booking is no longer eligible for appointment reminders.',
      })
    })

    it('returns CANCEL when row clientId does not match the linked booking', async () => {
      mocks.txScheduledClientNotificationFindUnique.mockResolvedValueOnce(
        makeDueRow({
          clientId: 'client_x',
        }),
      )
      mocks.txBookingFindUnique.mockResolvedValueOnce(
        makeBooking({
          id: 'booking_1',
          clientId: 'client_1',
        }),
      )

      const result = await validateDueAppointmentReminder({
        tx,
        scheduledClientNotificationId: 'row_client_mismatch',
        now: new Date('2026-03-21T16:00:01.000Z'),
      })

      expect(result).toEqual({
        action: 'CANCEL',
        reason: 'Scheduled reminder clientId does not match linked booking.',
      })
    })

    it('returns CANCEL when the payload is not canonical', async () => {
      mocks.txScheduledClientNotificationFindUnique.mockResolvedValueOnce(
        makeDueRow({
          data: {
            reminderKind: 'ONE_WEEK',
            bookingId: 'booking_1',
            scheduledFor: 'not-a-date',
            timeZone: 'America/Los_Angeles',
          },
        }),
      )
      mocks.txBookingFindUnique.mockResolvedValueOnce(makeBooking())

      const result = await validateDueAppointmentReminder({
        tx,
        scheduledClientNotificationId: 'row_bad_payload',
        now: new Date('2026-03-21T16:00:01.000Z'),
      })

      expect(result).toEqual({
        action: 'CANCEL',
        reason: 'Scheduled reminder payload is not in canonical format.',
      })
    })

    it('returns CANCEL when the dedupeKey no longer matches canonical booking state', async () => {
      const booking = makeBooking({
        id: 'booking_1',
        clientId: 'client_1',
        scheduledFor: new Date('2026-03-28T16:00:00.000Z'),
        locationTimeZone: 'America/Los_Angeles',
        serviceName: 'Silk Press',
      })

      const payload = makeReminderPayload({
        bookingId: 'booking_1',
        kind: 'ONE_WEEK',
        scheduledFor: booking.scheduledFor,
        timeZone: 'America/Los_Angeles',
        serviceName: 'Silk Press',
      })

      mocks.txScheduledClientNotificationFindUnique.mockResolvedValueOnce(
        makeDueRow({
          dedupeKey: 'CLIENT_REMINDER:ONE_WEEK:wrong_booking',
          data: payload,
        }),
      )
      mocks.txBookingFindUnique.mockResolvedValueOnce(booking)

      const result = await validateDueAppointmentReminder({
        tx,
        scheduledClientNotificationId: 'row_bad_dedupe',
        now: new Date('2026-03-21T16:00:01.000Z'),
      })

      expect(result).toEqual({
        action: 'CANCEL',
        reason:
          'Scheduled reminder dedupeKey does not match canonical reminder state.',
      })
    })
  })

  describe('cancelDueAppointmentReminder', () => {
    it('cancels only still-pending due reminder rows', async () => {
      const cancelledAt = new Date('2026-03-21T16:05:00.000Z')

      await cancelDueAppointmentReminder({
        tx,
        scheduledClientNotificationId: 'row_cancel_1',
        reason: 'Canonical reminder state changed.',
        cancelledAt,
      })

      expect(
        mocks.txScheduledClientNotificationUpdateMany,
      ).toHaveBeenCalledWith({
        where: {
          id: 'row_cancel_1',
          cancelledAt: null,
          processedAt: null,
        },
        data: {
          cancelledAt,
          lastError: 'Canonical reminder state changed.',
        },
      })
    })
  })
})