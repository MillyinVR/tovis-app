import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingStatus,
  NotificationEventKey,
  Prisma,
} from '@prisma/client'

const TEST_NOW = new Date('2026-03-18T16:00:00.000Z')

const mocks = vi.hoisted(() => ({
  txBookingFindUnique: vi.fn(),
  txBookingFindMany: vi.fn(),
  txScheduledClientNotificationFindUnique: vi.fn(),
  txScheduledClientNotificationUpdateMany: vi.fn(),

  cancelScheduledClientNotificationsForBooking: vi.fn(),
  scheduleClientNotification: vi.fn(),
  resolveEnabledReminderOffsetMinutes: vi.fn(),
}))

vi.mock('@/lib/notifications/clientNotifications', () => ({
  cancelScheduledClientNotificationsForBooking:
    mocks.cancelScheduledClientNotificationsForBooking,
  scheduleClientNotification: mocks.scheduleClientNotification,
}))

vi.mock('@/lib/reminderSettings/settings', () => ({
  resolveEnabledReminderOffsetMinutes: mocks.resolveEnabledReminderOffsetMinutes,
}))

import {
  buildAppointmentReminderContent,
  buildAppointmentReminderPayload,
  cancelBookingAppointmentReminders,
  cancelDueAppointmentReminder,
  computeAppointmentReminderRunAt,
  MAX_CADENCE_RESYNC_BOOKINGS,
  parseAppointmentReminderPayload,
  rescheduleDueAppointmentReminder,
  syncBookingAppointmentReminders,
  syncUpcomingBookingRemindersForProfessional,
  validateDueAppointmentReminder,
} from './appointmentReminders'

type TxMock = {
  booking: {
    findUnique: typeof mocks.txBookingFindUnique
    findMany: typeof mocks.txBookingFindMany
  }
  scheduledClientNotification: {
    findUnique: typeof mocks.txScheduledClientNotificationFindUnique
    updateMany: typeof mocks.txScheduledClientNotificationUpdateMany
  }
}

const txMock: TxMock = {
  booking: {
    findUnique: mocks.txBookingFindUnique,
    findMany: mocks.txBookingFindMany,
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
    professionalId: string
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
    professionalId:
      'professionalId' in overrides ? overrides.professionalId! : 'pro_1',
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
  offsetMinutes: number
  scheduledFor: Date
  timeZone: string
  serviceName?: string | null
  professionalName?: string | null
}) {
  return buildAppointmentReminderPayload({
    bookingId: args.bookingId,
    offsetMinutes: args.offsetMinutes,
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
        : 'CLIENT_REMINDER:M10080:booking_1',
    data:
      'data' in overrides
        ? overrides.data!
        : makeReminderPayload({
            bookingId: 'booking_1',
            offsetMinutes: 10080,
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
    // Default cadence: one week + three days + day before, all enabled (minutes).
    mocks.resolveEnabledReminderOffsetMinutes.mockResolvedValue([
      10080, 4320, 1440,
    ])
  })

  describe('computeAppointmentReminderRunAt', () => {
    it('preserves local wall-clock time across a DST fallback boundary for whole-day leads', () => {
      const scheduledFor = new Date('2026-11-08T17:00:00.000Z') // 9:00 AM PST

      const runAt = computeAppointmentReminderRunAt({
        scheduledFor,
        timeZone: 'America/Los_Angeles',
        offsetMinutes: 10080,
      })

      expect(runAt).toEqual(new Date('2026-11-01T17:00:00.000Z'))
    })

    it('subtracts an exact instant offset for sub-day leads', () => {
      const scheduledFor = new Date('2026-03-28T16:00:00.000Z')

      const runAt = computeAppointmentReminderRunAt({
        scheduledFor,
        timeZone: 'America/Los_Angeles',
        offsetMinutes: 240, // 4 hours
      })

      expect(runAt).toEqual(new Date('2026-03-28T12:00:00.000Z'))
    })
  })

  describe('parseAppointmentReminderPayload', () => {
    const base = {
      bookingId: 'booking_1',
      scheduledFor: '2026-03-28T16:00:00.000Z',
      timeZone: 'America/Los_Angeles',
      serviceName: 'Silk Press',
    }

    it('reads the canonical offsetMinutes field', () => {
      const parsed = parseAppointmentReminderPayload({
        ...base,
        offsetMinutes: 240,
      })
      expect(parsed?.offsetMinutes).toBe(240)
    })

    it('maps a legacy reminderKind onto minutes', () => {
      expect(
        parseAppointmentReminderPayload({ ...base, reminderKind: 'ONE_WEEK' })
          ?.offsetMinutes,
      ).toBe(10080)
      expect(
        parseAppointmentReminderPayload({ ...base, reminderKind: 'THREE_DAYS' })
          ?.offsetMinutes,
      ).toBe(4320)
      expect(
        parseAppointmentReminderPayload({ ...base, reminderKind: 'DAY_BEFORE' })
          ?.offsetMinutes,
      ).toBe(1440)
    })

    it('prefers offsetMinutes over a stale legacy kind', () => {
      const parsed = parseAppointmentReminderPayload({
        ...base,
        offsetMinutes: 240,
        reminderKind: 'ONE_WEEK',
      })
      expect(parsed?.offsetMinutes).toBe(240)
    })

    it('returns null when neither offsetMinutes nor a known kind is present', () => {
      expect(parseAppointmentReminderPayload({ ...base })).toBeNull()
    })
  })

  describe('buildAppointmentReminderContent (lead-time humanizer)', () => {
    function contentFor(offsetMinutes: number) {
      return buildAppointmentReminderContent(
        makeReminderPayload({
          bookingId: 'booking_1',
          offsetMinutes,
          scheduledFor: new Date('2026-03-28T16:00:00.000Z'),
          timeZone: 'America/Los_Angeles',
          serviceName: 'Silk Press',
        }),
      )
    }

    it('reads "in one week" for a 7-day lead', () => {
      const content = contentFor(10080)
      expect(content.title).toBe('Appointment reminder')
      expect(content.body).toContain('in one week')
    })

    it('reads "in 3 days" for a 3-day lead', () => {
      expect(contentFor(4320).body).toContain('in 3 days')
    })

    it('reads "tomorrow" and the tomorrow title for a 1-day lead', () => {
      const content = contentFor(1440)
      expect(content.title).toBe('Appointment tomorrow')
      expect(content.body).toContain('tomorrow')
    })

    it('reads "in 2 days" for a 2-day lead', () => {
      expect(contentFor(2880).body).toContain('in 2 days')
    })

    it('reads "in 4 hours" for a 4-hour lead', () => {
      expect(contentFor(240).body).toContain('in 4 hours')
    })

    it('reads "in 1 hour" for a 1-hour lead', () => {
      expect(contentFor(60).body).toContain('in 1 hour')
    })

    it('reads "in 90 minutes" for a sub-hour lead', () => {
      expect(contentFor(90).body).toContain('in 90 minutes')
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
    it('cancels existing pending reminders and schedules the configured cadence (one week + three days + day before)', async () => {
      const booking = makeBooking({
        id: 'booking_3',
        clientId: 'client_3',
        professionalId: 'pro_3',
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

      expect(mocks.resolveEnabledReminderOffsetMinutes).toHaveBeenCalledWith({
        professionalId: 'pro_3',
        db: tx,
      })

      expect(mocks.scheduleClientNotification).toHaveBeenCalledTimes(3)

      expect(mocks.scheduleClientNotification).toHaveBeenNthCalledWith(1, {
        tx,
        clientId: 'client_3',
        bookingId: 'booking_3',
        eventKey: NotificationEventKey.APPOINTMENT_REMINDER,
        runAt: new Date('2026-03-21T16:00:00.000Z'),
        dedupeKey: 'CLIENT_REMINDER:M10080:booking_3',
        href: '/client/bookings/booking_3?step=overview',
        data: {
          offsetMinutes: 10080,
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
        runAt: new Date('2026-03-25T16:00:00.000Z'),
        dedupeKey: 'CLIENT_REMINDER:M4320:booking_3',
        href: '/client/bookings/booking_3?step=overview',
        data: {
          offsetMinutes: 4320,
          bookingId: 'booking_3',
          scheduledFor: '2026-03-28T16:00:00.000Z',
          timeZone: 'America/Los_Angeles',
          serviceName: 'Silk Press',
          professionalName: null,
        },
      })

      expect(mocks.scheduleClientNotification).toHaveBeenNthCalledWith(3, {
        tx,
        clientId: 'client_3',
        bookingId: 'booking_3',
        eventKey: NotificationEventKey.APPOINTMENT_REMINDER,
        runAt: new Date('2026-03-27T16:00:00.000Z'),
        dedupeKey: 'CLIENT_REMINDER:M1440:booking_3',
        href: '/client/bookings/booking_3?step=overview',
        data: {
          offsetMinutes: 1440,
          bookingId: 'booking_3',
          scheduledFor: '2026-03-28T16:00:00.000Z',
          timeZone: 'America/Los_Angeles',
          serviceName: 'Silk Press',
          professionalName: null,
        },
      })
    })

    it('schedules a sub-day (hour-scale) lead at an exact instant offset', async () => {
      mocks.resolveEnabledReminderOffsetMinutes.mockResolvedValue([240])

      const booking = makeBooking({
        id: 'booking_hours',
        clientId: 'client_hours',
        professionalId: 'pro_hours',
        scheduledFor: new Date('2026-03-28T16:00:00.000Z'),
        locationTimeZone: 'America/Los_Angeles',
        serviceName: 'Silk Press',
      })

      queueBookingForSync(booking)

      await syncBookingAppointmentReminders({
        tx,
        bookingId: 'booking_hours',
        now: TEST_NOW,
      })

      expect(mocks.scheduleClientNotification).toHaveBeenCalledTimes(1)
      expect(mocks.scheduleClientNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          runAt: new Date('2026-03-28T12:00:00.000Z'),
          dedupeKey: 'CLIENT_REMINDER:M240:booking_hours',
          data: expect.objectContaining({ offsetMinutes: 240 }),
        }),
      )
    })

    it('schedules only the pro-enabled offsets', async () => {
      mocks.resolveEnabledReminderOffsetMinutes.mockResolvedValue([10080])

      const booking = makeBooking({
        id: 'booking_offsets',
        clientId: 'client_offsets',
        professionalId: 'pro_offsets',
        scheduledFor: new Date('2026-03-28T16:00:00.000Z'),
        locationTimeZone: 'America/Los_Angeles',
        serviceName: 'Silk Press',
      })

      queueBookingForSync(booking)

      await syncBookingAppointmentReminders({
        tx,
        bookingId: 'booking_offsets',
        now: TEST_NOW,
      })

      expect(mocks.scheduleClientNotification).toHaveBeenCalledTimes(1)
      expect(mocks.scheduleClientNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          dedupeKey: 'CLIENT_REMINDER:M10080:booking_offsets',
        }),
      )
    })

    it('schedules nothing when the pro has reminders disabled', async () => {
      mocks.resolveEnabledReminderOffsetMinutes.mockResolvedValue([])

      const booking = makeBooking({
        id: 'booking_off',
        clientId: 'client_off',
        professionalId: 'pro_off',
        scheduledFor: new Date('2026-03-28T16:00:00.000Z'),
        locationTimeZone: 'America/Los_Angeles',
      })

      queueBookingForSync(booking)

      await syncBookingAppointmentReminders({
        tx,
        bookingId: 'booking_off',
        now: TEST_NOW,
      })

      expect(
        mocks.cancelScheduledClientNotificationsForBooking,
      ).toHaveBeenCalledTimes(1)
      expect(mocks.scheduleClientNotification).not.toHaveBeenCalled()
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
        dedupeKey: 'CLIENT_REMINDER:M1440:booking_4',
        href: '/client/bookings/booking_4?step=overview',
        data: {
          offsetMinutes: 1440,
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
        offsetMinutes: 10080,
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
        dedupeKey: 'CLIENT_REMINDER:M10080:booking_1',
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
        dedupeKey: 'CLIENT_REMINDER:M10080:booking_1',
        href: '/client/bookings/booking_1?step=overview',
        notification: buildAppointmentReminderContent(payload),
      })
    })

    it('processes a legacy reminderKind row (rewritten dedupeKey) at parity', async () => {
      const booking = makeBooking({
        id: 'booking_1',
        clientId: 'client_1',
        scheduledFor: new Date('2026-03-28T16:00:00.000Z'),
        locationTimeZone: 'America/Los_Angeles',
        serviceName: 'Silk Press',
      })

      // A pre-cutover payload (legacy reminderKind), with the dedupeKey the deploy
      // migration rewrites it to.
      const legacyData = {
        reminderKind: 'ONE_WEEK',
        bookingId: 'booking_1',
        scheduledFor: '2026-03-28T16:00:00.000Z',
        timeZone: 'America/Los_Angeles',
        serviceName: 'Silk Press',
        professionalName: null,
      }

      mocks.txScheduledClientNotificationFindUnique.mockResolvedValueOnce(
        makeDueRow({
          dedupeKey: 'CLIENT_REMINDER:M10080:booking_1',
          data: legacyData,
        }),
      )
      mocks.txBookingFindUnique.mockResolvedValueOnce(booking)

      const result = await validateDueAppointmentReminder({
        tx,
        scheduledClientNotificationId: 'row_legacy',
        now: new Date('2026-03-21T16:00:01.000Z'),
      })

      expect(result.action).toBe('PROCESS')
    })

    it('returns CANCEL when the pro no longer schedules that reminder offset', async () => {
      const booking = makeBooking({
        id: 'booking_1',
        clientId: 'client_1',
        professionalId: 'pro_1',
        scheduledFor: new Date('2026-03-28T16:00:00.000Z'),
        locationTimeZone: 'America/Los_Angeles',
        serviceName: 'Silk Press',
      })

      const payload = makeReminderPayload({
        bookingId: 'booking_1',
        offsetMinutes: 10080,
        scheduledFor: booking.scheduledFor,
        timeZone: 'America/Los_Angeles',
        serviceName: 'Silk Press',
      })

      mocks.txScheduledClientNotificationFindUnique.mockResolvedValueOnce(
        makeDueRow({
          dedupeKey: 'CLIENT_REMINDER:M10080:booking_1',
          data: payload,
        }),
      )
      mocks.txBookingFindUnique.mockResolvedValueOnce(booking)
      // Pro dropped the one-week offset, keeping only three-days + day-before.
      mocks.resolveEnabledReminderOffsetMinutes.mockResolvedValue([4320, 1440])

      const result = await validateDueAppointmentReminder({
        tx,
        scheduledClientNotificationId: 'row_disabled_offset',
        now: new Date('2026-03-21T16:00:01.000Z'),
      })

      expect(result).toEqual({
        action: 'CANCEL',
        reason:
          'Linked pro no longer schedules this appointment reminder offset.',
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
            offsetMinutes: 10080,
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
        offsetMinutes: 10080,
        scheduledFor: booking.scheduledFor,
        timeZone: 'America/Los_Angeles',
        serviceName: 'Silk Press',
      })

      mocks.txScheduledClientNotificationFindUnique.mockResolvedValueOnce(
        makeDueRow({
          dedupeKey: 'CLIENT_REMINDER:M10080:wrong_booking',
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

    // B7: the drain is the last thing that looks at a reminder before it goes
    // out. It re-derives the canonical plan anyway, so drift is a reason to
    // CORRECT the row, not to cancel it — a cancel is terminal and nothing in
    // the system re-plans a cancelled row.
    it('returns RESCHEDULE (not CANCEL) when the booking moved later and the canonical reminder is still ahead', async () => {
      const movedTo = new Date('2026-04-04T16:00:00.000Z')
      const booking = makeBooking({
        id: 'booking_1',
        clientId: 'client_1',
        scheduledFor: movedTo,
        locationTimeZone: 'America/Los_Angeles',
        serviceName: 'Silk Press',
      })

      // The row still carries the plan for the ORIGINAL 2026-03-28 appointment.
      const stalePayload = makeReminderPayload({
        bookingId: 'booking_1',
        offsetMinutes: 10080,
        scheduledFor: new Date('2026-03-28T16:00:00.000Z'),
        timeZone: 'America/Los_Angeles',
        serviceName: 'Silk Press',
      })

      mocks.txScheduledClientNotificationFindUnique.mockResolvedValueOnce(
        makeDueRow({
          id: 'row_moved_later',
          runAt: new Date('2026-03-21T16:00:00.000Z'),
          data: stalePayload,
        }),
      )
      mocks.txBookingFindUnique.mockResolvedValueOnce(booking)

      const result = await validateDueAppointmentReminder({
        tx,
        scheduledClientNotificationId: 'row_moved_later',
        now: new Date('2026-03-21T16:00:01.000Z'),
      })

      expect(result).toEqual({
        action: 'RESCHEDULE',
        rowId: 'row_moved_later',
        // One week before the NEW appointment, same local wall clock.
        runAt: new Date('2026-03-28T16:00:00.000Z'),
        data: makeReminderPayload({
          bookingId: 'booking_1',
          offsetMinutes: 10080,
          scheduledFor: movedTo,
          timeZone: 'America/Los_Angeles',
          serviceName: 'Silk Press',
        }),
        reason:
          'Scheduled reminder runAt no longer matches canonical reminder state.',
      })
    })

    it('sends with refreshed content when the stored service label drifted', async () => {
      const scheduledFor = new Date('2026-03-28T16:00:00.000Z')
      const booking = makeBooking({
        id: 'booking_1',
        clientId: 'client_1',
        scheduledFor,
        locationTimeZone: 'America/Los_Angeles',
        // Renamed since the row was written.
        serviceName: 'Silk Press & Trim',
      })

      mocks.txScheduledClientNotificationFindUnique.mockResolvedValueOnce(
        makeDueRow({
          id: 'row_stale_label',
          runAt: new Date('2026-03-21T16:00:00.000Z'),
          data: makeReminderPayload({
            bookingId: 'booking_1',
            offsetMinutes: 10080,
            scheduledFor,
            timeZone: 'America/Los_Angeles',
            serviceName: 'Silk Press',
          }),
        }),
      )
      mocks.txBookingFindUnique.mockResolvedValueOnce(booking)

      const result = await validateDueAppointmentReminder({
        tx,
        scheduledClientNotificationId: 'row_stale_label',
        now: new Date('2026-03-21T16:00:01.000Z'),
      })

      expect(result).toMatchObject({
        action: 'PROCESS',
        rowId: 'row_stale_label',
      })
      expect(
        result.action === 'PROCESS' ? result.notification.body : null,
      ).toContain('Silk Press & Trim')
    })

    it('sends late (rather than cancelling) when the booking moved earlier and the canonical reminder has passed', async () => {
      const movedTo = new Date('2026-03-24T16:00:00.000Z')
      const booking = makeBooking({
        id: 'booking_1',
        clientId: 'client_1',
        scheduledFor: movedTo,
        locationTimeZone: 'America/Los_Angeles',
        serviceName: 'Silk Press',
      })

      mocks.txScheduledClientNotificationFindUnique.mockResolvedValueOnce(
        makeDueRow({
          id: 'row_moved_earlier',
          runAt: new Date('2026-03-21T16:00:00.000Z'),
          data: makeReminderPayload({
            bookingId: 'booking_1',
            offsetMinutes: 10080,
            scheduledFor: new Date('2026-03-28T16:00:00.000Z'),
            timeZone: 'America/Los_Angeles',
            serviceName: 'Silk Press',
          }),
        }),
      )
      mocks.txBookingFindUnique.mockResolvedValueOnce(booking)

      // Canonical runAt for the moved booking (2026-03-17) is already behind us,
      // but the appointment itself is still ahead — send it.
      const result = await validateDueAppointmentReminder({
        tx,
        scheduledClientNotificationId: 'row_moved_earlier',
        now: new Date('2026-03-24T15:00:00.000Z'),
      })

      expect(result).toEqual({
        action: 'PROCESS',
        rowId: 'row_moved_earlier',
        clientId: 'client_1',
        bookingId: 'booking_1',
        dedupeKey: 'CLIENT_REMINDER:M10080:booking_1',
        href: '/client/bookings/booking_1?step=overview',
        notification: buildAppointmentReminderContent(
          makeReminderPayload({
            bookingId: 'booking_1',
            offsetMinutes: 10080,
            scheduledFor: movedTo,
            timeZone: 'America/Los_Angeles',
            serviceName: 'Silk Press',
          }),
        ),
      })
    })

    // Nothing has drifted here — the row is exactly canonical — the drain is
    // simply reaching it after the appointment (a long-stalled or repeatedly
    // failing row). Without the floor this sends "your appointment is in one
    // week" about an appointment that already happened.
    it('returns CANCEL when the appointment itself has already started, even with a canonical row', async () => {
      const scheduledFor = new Date('2026-03-20T16:00:00.000Z')
      const booking = makeBooking({
        id: 'booking_1',
        clientId: 'client_1',
        // Still ACCEPTED (the pro never started it) but already in the past.
        scheduledFor,
        locationTimeZone: 'America/Los_Angeles',
        serviceName: 'Silk Press',
      })

      mocks.txScheduledClientNotificationFindUnique.mockResolvedValueOnce(
        makeDueRow({
          id: 'row_past_appointment',
          // Exactly what the planner would compute for this booking.
          runAt: new Date('2026-03-13T16:00:00.000Z'),
          data: makeReminderPayload({
            bookingId: 'booking_1',
            offsetMinutes: 10080,
            scheduledFor,
            timeZone: 'America/Los_Angeles',
            serviceName: 'Silk Press',
          }),
        }),
      )
      mocks.txBookingFindUnique.mockResolvedValueOnce(booking)

      const result = await validateDueAppointmentReminder({
        tx,
        scheduledClientNotificationId: 'row_past_appointment',
        now: new Date('2026-03-21T16:00:01.000Z'),
      })

      expect(result).toEqual({
        action: 'CANCEL',
        reason: 'Linked appointment has already started.',
      })
    })
  })

  describe('rescheduleDueAppointmentReminder', () => {
    it('re-arms only still-pending rows, with the canonical runAt and payload', async () => {
      const runAt = new Date('2026-03-28T16:00:00.000Z')
      const data = makeReminderPayload({
        bookingId: 'booking_1',
        offsetMinutes: 10080,
        scheduledFor: new Date('2026-04-04T16:00:00.000Z'),
        timeZone: 'America/Los_Angeles',
        serviceName: 'Silk Press',
      })

      mocks.txScheduledClientNotificationUpdateMany.mockResolvedValueOnce({
        count: 1,
      })

      await rescheduleDueAppointmentReminder({
        tx,
        scheduledClientNotificationId: 'row_1',
        runAt,
        data,
      })

      expect(mocks.txScheduledClientNotificationUpdateMany).toHaveBeenCalledWith({
        where: {
          id: 'row_1',
          cancelledAt: null,
          processedAt: null,
        },
        data: {
          runAt,
          data: { ...data },
          failedAt: null,
          lastError: null,
        },
      })
    })
  })

  describe('syncUpcomingBookingRemindersForProfessional', () => {
    it('re-plans every upcoming booking against the CURRENT cadence, reading it once', async () => {
      mocks.resolveEnabledReminderOffsetMinutes.mockResolvedValue([1440])
      mocks.txBookingFindMany.mockResolvedValueOnce([
        { id: 'booking_a' },
        { id: 'booking_b' },
      ])

      queueBookingForSync(makeBooking({ id: 'booking_a' }))
      queueBookingForSync(makeBooking({ id: 'booking_b' }))

      const result = await syncUpcomingBookingRemindersForProfessional({
        tx,
        professionalId: 'pro_1',
        now: TEST_NOW,
      })

      expect(result).toEqual({ syncedCount: 2, hitCap: false })

      expect(mocks.txBookingFindMany).toHaveBeenCalledWith({
        where: {
          professionalId: 'pro_1',
          status: { in: [BookingStatus.ACCEPTED] },
          finishedAt: null,
          scheduledFor: { gt: TEST_NOW },
        },
        orderBy: { scheduledFor: 'asc' },
        take: MAX_CADENCE_RESYNC_BOOKINGS + 1,
        select: { id: true },
      })

      // One cadence read for the whole batch, not one per booking.
      expect(mocks.resolveEnabledReminderOffsetMinutes).toHaveBeenCalledTimes(1)

      expect(mocks.scheduleClientNotification).toHaveBeenCalledTimes(2)
      expect(
        mocks.scheduleClientNotification.mock.calls.map(
          (call) => (call[0] as { bookingId: string }).bookingId,
        ),
      ).toEqual(['booking_a', 'booking_b'])
    })

    it('reports hitting the cap instead of silently truncating', async () => {
      mocks.resolveEnabledReminderOffsetMinutes.mockResolvedValue([])
      mocks.txBookingFindMany.mockResolvedValueOnce(
        Array.from({ length: MAX_CADENCE_RESYNC_BOOKINGS + 1 }, (_, index) => ({
          id: `booking_${index}`,
        })),
      )

      for (let index = 0; index < MAX_CADENCE_RESYNC_BOOKINGS; index += 1) {
        queueBookingForSync(makeBooking({ id: `booking_${index}` }))
      }

      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const result = await syncUpcomingBookingRemindersForProfessional({
        tx,
        professionalId: 'pro_1',
        now: TEST_NOW,
      })

      expect(result).toEqual({
        syncedCount: MAX_CADENCE_RESYNC_BOOKINGS,
        hitCap: true,
      })
      expect(warn).toHaveBeenCalledWith(
        'appointmentReminders: cadence resync hit its booking cap',
        expect.objectContaining({ professionalId: 'pro_1' }),
      )

      warn.mockRestore()
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
