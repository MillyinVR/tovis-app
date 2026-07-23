// lib/notifications/depositReminders.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingDepositStatus, BookingStatus, NotificationEventKey } from '@prisma/client'

import { asTestTransactionClient } from '@/lib/typed/prismaTestClient'

const mocks = vi.hoisted(() => ({
  scheduleClientNotification: vi.fn(),
}))

vi.mock('@/lib/notifications/clientNotifications', () => ({
  scheduleClientNotification: mocks.scheduleClientNotification,
}))

import {
  buildDepositReminderContent,
  buildDepositReminderDedupeKey,
  buildDepositReminderHref,
  scheduleDepositReminderOnBooking,
  validateDueDepositReminder,
} from './depositReminders'

// Defaults: 24h deadline, 4h lead → reminder fires 20h after createdAt.
const NOW = new Date('2026-07-03T12:00:00.000Z')
const REMINDER_OFFSET_MS = 20 * 60 * 60 * 1000
const FUTURE_APPOINTMENT = new Date(NOW.getTime() + 30 * 60 * 60 * 1000)

const PRO_ROW = {
  businessName: 'Tori Beauty Studio',
  firstName: 'Tori',
  lastName: 'M',
  handle: 'tori',
  nameDisplay: null,
}

function makeBookingRow(overrides?: Record<string, unknown>) {
  return {
    id: 'booking_1',
    clientId: 'client_1',
    status: BookingStatus.PENDING,
    depositStatus: BookingDepositStatus.PENDING,
    depositAmount: 20,
    scheduledFor: FUTURE_APPOINTMENT,
    service: { name: 'Balayage' },
    professional: PRO_ROW,
    ...overrides,
  }
}

function makeScheduledRow(overrides?: Record<string, unknown>) {
  return {
    id: 'row_1',
    eventKey: NotificationEventKey.DEPOSIT_REMINDER,
    clientId: 'client_1',
    bookingId: 'booking_1',
    runAt: new Date(NOW.getTime() - 60 * 1000), // due
    cancelledAt: null,
    processedAt: null,
    ...overrides,
  }
}

function makeTx(args: { booking?: unknown; scheduledRow?: unknown }) {
  return asTestTransactionClient({
    booking: {
      findUnique: vi.fn().mockResolvedValue(args.booking ?? null),
    },
    scheduledClientNotification: {
      findUnique: vi.fn().mockResolvedValue(args.scheduledRow ?? null),
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('buildDepositReminderContent', () => {
  it('names the amount and the pro', () => {
    const content = buildDepositReminderContent({
      bookingId: 'booking_1',
      professionalName: 'Tori Beauty Studio',
      depositAmount: 20,
    })
    expect(content.title).toBe('Finish your $20.00 deposit')
    expect(content.body).toContain('Tori Beauty Studio')
    expect(content.data).toEqual({ bookingId: 'booking_1' })
  })

  it('falls back gracefully without amount or pro name', () => {
    const content = buildDepositReminderContent({
      bookingId: 'booking_1',
      professionalName: null,
      depositAmount: null,
    })
    expect(content.title).toBe('Finish your deposit')
    expect(content.body).not.toContain('with ')
  })
})

describe('scheduleDepositReminderOnBooking', () => {
  it('schedules the nudge 20h out for an unpaid future deposit booking', async () => {
    const tx = makeTx({ booking: makeBookingRow() })

    await scheduleDepositReminderOnBooking({ tx, bookingId: 'booking_1', now: NOW })

    expect(mocks.scheduleClientNotification).toHaveBeenCalledWith({
      tx,
      clientId: 'client_1',
      bookingId: 'booking_1',
      eventKey: NotificationEventKey.DEPOSIT_REMINDER,
      runAt: new Date(NOW.getTime() + REMINDER_OFFSET_MS),
      dedupeKey: buildDepositReminderDedupeKey('booking_1'),
      href: buildDepositReminderHref('booking_1'),
      data: { bookingId: 'booking_1' },
    })
  })

  it('no-ops for a non-pending deposit (paid / none)', async () => {
    await scheduleDepositReminderOnBooking({
      tx: makeTx({ booking: makeBookingRow({ depositStatus: BookingDepositStatus.PAID }) }),
      bookingId: 'booking_1',
      now: NOW,
    })
    await scheduleDepositReminderOnBooking({
      tx: makeTx({ booking: makeBookingRow({ depositStatus: BookingDepositStatus.NONE }) }),
      bookingId: 'booking_1',
      now: NOW,
    })
    expect(mocks.scheduleClientNotification).not.toHaveBeenCalled()
  })

  it('no-ops for a non-occupying status and a missing booking', async () => {
    await scheduleDepositReminderOnBooking({
      tx: makeTx({ booking: makeBookingRow({ status: BookingStatus.CANCELLED }) }),
      bookingId: 'booking_1',
      now: NOW,
    })
    await scheduleDepositReminderOnBooking({
      tx: makeTx({}),
      bookingId: 'missing',
      now: NOW,
    })
    expect(mocks.scheduleClientNotification).not.toHaveBeenCalled()
  })

  it('no-ops when the reminder would land at/after the appointment (last-minute booking)', async () => {
    // Appointment only 2h out — the 20h reminder offset is past it.
    await scheduleDepositReminderOnBooking({
      tx: makeTx({
        booking: makeBookingRow({
          scheduledFor: new Date(NOW.getTime() + 2 * 60 * 60 * 1000),
        }),
      }),
      bookingId: 'booking_1',
      now: NOW,
    })
    expect(mocks.scheduleClientNotification).not.toHaveBeenCalled()
  })
})

describe('validateDueDepositReminder', () => {
  it('PROCESSes a due reminder for a still-unpaid future booking', async () => {
    const tx = makeTx({ scheduledRow: makeScheduledRow(), booking: makeBookingRow() })

    const result = await validateDueDepositReminder({
      tx,
      scheduledClientNotificationId: 'row_1',
      now: NOW,
    })

    expect(result).toEqual({
      action: 'PROCESS',
      rowId: 'row_1',
      clientId: 'client_1',
      bookingId: 'booking_1',
      eventKey: NotificationEventKey.DEPOSIT_REMINDER,
      dedupeKey: 'DEPOSIT_REMINDER:booking_1',
      href: '/client/bookings/booking_1?step=overview',
      notification: buildDepositReminderContent({
        bookingId: 'booking_1',
        professionalName: 'Tori Beauty Studio',
        depositAmount: 20,
      }),
    })
  })

  it('SKIPs when not yet due, cancelled, processed, or missing', async () => {
    await expect(
      validateDueDepositReminder({ tx: makeTx({}), scheduledClientNotificationId: 'row_1', now: NOW }),
    ).resolves.toEqual({ action: 'SKIP' })

    await expect(
      validateDueDepositReminder({
        tx: makeTx({
          scheduledRow: makeScheduledRow({ runAt: new Date(NOW.getTime() + 60 * 1000) }),
        }),
        scheduledClientNotificationId: 'row_1',
        now: NOW,
      }),
    ).resolves.toEqual({ action: 'SKIP' })

    await expect(
      validateDueDepositReminder({
        tx: makeTx({ scheduledRow: makeScheduledRow({ processedAt: NOW }) }),
        scheduledClientNotificationId: 'row_1',
        now: NOW,
      }),
    ).resolves.toEqual({ action: 'SKIP' })
  })

  it('CANCELs once the deposit is paid', async () => {
    const result = await validateDueDepositReminder({
      tx: makeTx({
        scheduledRow: makeScheduledRow(),
        booking: makeBookingRow({ depositStatus: BookingDepositStatus.PAID }),
      }),
      scheduledClientNotificationId: 'row_1',
      now: NOW,
    })
    expect(result).toEqual({ action: 'CANCEL', reason: 'Deposit is no longer pending.' })
  })

  it('CANCELs once the booking no longer holds a slot', async () => {
    const result = await validateDueDepositReminder({
      tx: makeTx({
        scheduledRow: makeScheduledRow(),
        booking: makeBookingRow({ status: BookingStatus.CANCELLED }),
      }),
      scheduledClientNotificationId: 'row_1',
      now: NOW,
    })
    expect(result).toEqual({ action: 'CANCEL', reason: 'Booking is no longer holding a slot.' })
  })

  it('CANCELs a reminder whose appointment has already passed', async () => {
    const result = await validateDueDepositReminder({
      tx: makeTx({
        scheduledRow: makeScheduledRow(),
        booking: makeBookingRow({
          scheduledFor: new Date(NOW.getTime() - 60 * 60 * 1000),
        }),
      }),
      scheduledClientNotificationId: 'row_1',
      now: NOW,
    })
    expect(result).toEqual({ action: 'CANCEL', reason: 'Appointment has already passed.' })
  })

  it('CANCELs on a clientId mismatch or wrong event key', async () => {
    await expect(
      validateDueDepositReminder({
        tx: makeTx({
          scheduledRow: makeScheduledRow({ eventKey: NotificationEventKey.REVIEW_REQUESTED }),
        }),
        scheduledClientNotificationId: 'row_1',
        now: NOW,
      }),
    ).resolves.toEqual({
      action: 'CANCEL',
      reason: 'Scheduled notification has the wrong event key.',
    })

    await expect(
      validateDueDepositReminder({
        tx: makeTx({
          scheduledRow: makeScheduledRow(),
          booking: makeBookingRow({ clientId: 'other_client' }),
        }),
        scheduledClientNotificationId: 'row_1',
        now: NOW,
      }),
    ).resolves.toEqual({
      action: 'CANCEL',
      reason: 'Scheduled deposit reminder clientId does not match booking.',
    })
  })
})
