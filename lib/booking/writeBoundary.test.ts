import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'
import {
  BookingStatus,
  NotificationEventKey,
  SessionStep,
} from '@prisma/client'

const TEST_NOW = new Date('2026-03-18T16:00:00.000Z')

const mocks = vi.hoisted(() => ({
  prismaTransaction: vi.fn(),
  prismaBookingFindUnique: vi.fn(),

  withLockedProfessionalTransaction: vi.fn(),
  withLockedClientOwnedBookingTransaction: vi.fn(),
  lockProfessionalSchedule: vi.fn(),

  txBookingFindUnique: vi.fn(),
  txBookingUpdate: vi.fn(),

  upsertClientNotification: vi.fn(),
  scheduleClientNotification: vi.fn(),
  cancelScheduledClientNotificationsForBooking: vi.fn(),

  createProNotification: vi.fn(),

  txBookingHoldFindUnique: vi.fn(),
  txBookingHoldDelete: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.prismaTransaction,
    booking: {
      findUnique: mocks.prismaBookingFindUnique,
    },
  },
}))

vi.mock('@/lib/booking/scheduleTransaction', () => ({
  withLockedProfessionalTransaction: mocks.withLockedProfessionalTransaction,
  withLockedClientOwnedBookingTransaction:
    mocks.withLockedClientOwnedBookingTransaction,
}))

vi.mock('@/lib/booking/scheduleLock', () => ({
  lockProfessionalSchedule: mocks.lockProfessionalSchedule,
}))

vi.mock('@/lib/notifications/clientNotifications', () => ({
  upsertClientNotification: mocks.upsertClientNotification,
  scheduleClientNotification: mocks.scheduleClientNotification,
  cancelScheduledClientNotificationsForBooking:
    mocks.cancelScheduledClientNotificationsForBooking,
}))

vi.mock('@/lib/notifications/proNotifications', () => ({
  createProNotification: mocks.createProNotification,
}))

import { cancelBooking, releaseHold } from './writeBoundary'

const tx = {
  booking: {
    findUnique: mocks.txBookingFindUnique,
    update: mocks.txBookingUpdate,
  },
  bookingHold: {
    findUnique: mocks.txBookingHoldFindUnique,
    delete: mocks.txBookingHoldDelete,
  },
}

describe('lib/booking/writeBoundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(TEST_NOW)

    mocks.withLockedProfessionalTransaction.mockImplementation(
      async (
        _professionalId: string,
        run: (ctx: { tx: typeof tx; now: Date }) => Promise<unknown>,
      ) => run({ tx, now: TEST_NOW }),
    )

    mocks.withLockedClientOwnedBookingTransaction.mockImplementation(
      async ({
        run,
      }: {
        bookingId: string
        clientId: string
        run: (ctx: {
          tx: typeof tx
          now: Date
          professionalId: string
        }) => Promise<unknown>
      }) => run({ tx, now: TEST_NOW, professionalId: 'pro_1' }),
    )

    mocks.prismaTransaction.mockImplementation(
      async (run: (db: typeof tx) => Promise<unknown>) => run(tx),
    )

    mocks.createProNotification.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('cancels a client-owned booking through the locked client-owned booking transaction', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce({
      id: 'booking_1',
      status: BookingStatus.PENDING,
      clientId: 'client_1',
      professionalId: 'pro_1',
      startedAt: null,
      finishedAt: null,
      sessionStep: SessionStep.NONE,
    })

    mocks.txBookingUpdate.mockResolvedValueOnce({
      id: 'booking_1',
      status: BookingStatus.CANCELLED,
      sessionStep: SessionStep.NONE,
    })

    const result = await cancelBooking({
      bookingId: 'booking_1',
      actor: {
        kind: 'client',
        clientId: 'client_1',
      },
      notifyClient: true,
      reason: 'Need to reschedule',
    })

    expect(
      mocks.withLockedClientOwnedBookingTransaction,
    ).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      clientId: 'client_1',
      run: expect.any(Function),
    })

    expect(mocks.txBookingUpdate).toHaveBeenCalledWith({
      where: { id: 'booking_1' },
      data: {
        status: BookingStatus.CANCELLED,
        sessionStep: SessionStep.NONE,
        startedAt: null,
        finishedAt: null,
      },
      select: {
        id: true,
        status: true,
        sessionStep: true,
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

    expect(mocks.upsertClientNotification).toHaveBeenCalledWith({
      tx,
      clientId: 'client_1',
      bookingId: 'booking_1',
      aftercareId: null,
      eventKey: NotificationEventKey.BOOKING_CANCELLED_BY_CLIENT,
      title: 'Appointment cancelled',
      body: 'Your appointment was cancelled. Reason: Need to reschedule',
      dedupeKey: 'BOOKING_CANCELLED:booking_1',
      href: '/client/bookings/booking_1?step=overview',
      data: {
        bookingId: 'booking_1',
        reason: 'Need to reschedule',
        cancelledBy: 'client',
        eventKey: NotificationEventKey.BOOKING_CANCELLED_BY_CLIENT,
      },
    })

    expect(mocks.createProNotification).toHaveBeenCalledWith({
      tx,
      professionalId: 'pro_1',
      eventKey: NotificationEventKey.BOOKING_CANCELLED_BY_CLIENT,
      priority: 'HIGH',
      title: 'Booking cancelled by client',
      body: 'Client cancelled this booking. Reason: Need to reschedule',
      href: '/pro/bookings/booking_1',
      actorUserId: null,
      bookingId: 'booking_1',
      dedupeKey: `PRO_NOTIF:${NotificationEventKey.BOOKING_CANCELLED_BY_CLIENT}:booking_1`,
      data: {
        bookingId: 'booking_1',
        cancelledBy: 'client',
        reason: 'Need to reschedule',
        previousStatus: BookingStatus.PENDING,
        previousSessionStep: SessionStep.NONE,
      },
    })

    expect(result).toEqual({
      booking: {
        id: 'booking_1',
        status: BookingStatus.CANCELLED,
        sessionStep: SessionStep.NONE,
      },
      meta: {
        mutated: true,
        noOp: false,
      },
    })
  })

  it('returns a no-op for an already cancelled booking and does not write again', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce({
      id: 'booking_2',
      status: BookingStatus.CANCELLED,
      clientId: 'client_1',
      professionalId: 'pro_1',
      startedAt: null,
      finishedAt: null,
      sessionStep: SessionStep.NONE,
    })

    const result = await cancelBooking({
      bookingId: 'booking_2',
      actor: {
        kind: 'client',
        clientId: 'client_1',
      },
      notifyClient: true,
    })

    expect(mocks.txBookingUpdate).not.toHaveBeenCalled()
    expect(mocks.upsertClientNotification).not.toHaveBeenCalled()
    expect(mocks.createProNotification).not.toHaveBeenCalled()
    expect(
      mocks.cancelScheduledClientNotificationsForBooking,
    ).not.toHaveBeenCalled()

    expect(result).toEqual({
      booking: {
        id: 'booking_2',
        status: BookingStatus.CANCELLED,
        sessionStep: SessionStep.NONE,
      },
      meta: {
        mutated: false,
        noOp: true,
      },
    })
  })

  it('releases a client-owned hold only after acquiring the professional schedule lock', async () => {
    mocks.txBookingHoldFindUnique
      .mockResolvedValueOnce({
        id: 'hold_1',
        clientId: 'client_1',
        professionalId: 'pro_9',
      })
      .mockResolvedValueOnce({
        id: 'hold_1',
        clientId: 'client_1',
        professionalId: 'pro_9',
      })

    mocks.txBookingHoldDelete.mockResolvedValueOnce({
      id: 'hold_1',
    })

    const result = await releaseHold({
      holdId: 'hold_1',
      clientId: 'client_1',
    })

    expect(mocks.lockProfessionalSchedule).toHaveBeenCalledWith(tx, 'pro_9')
    expect(mocks.txBookingHoldDelete).toHaveBeenCalledWith({
      where: { id: 'hold_1' },
    })

    expect(result).toEqual({
      holdId: 'hold_1',
      meta: {
        mutated: true,
        noOp: false,
      },
    })
  })

  it('throws HOLD_FORBIDDEN when the hold belongs to another client', async () => {
    mocks.txBookingHoldFindUnique.mockResolvedValueOnce({
      id: 'hold_2',
      clientId: 'different_client',
      professionalId: 'pro_9',
    })

    await expect(
      releaseHold({
        holdId: 'hold_2',
        clientId: 'client_1',
      }),
    ).rejects.toMatchObject({
      code: 'HOLD_FORBIDDEN',
    })

    expect(mocks.lockProfessionalSchedule).not.toHaveBeenCalled()
    expect(mocks.txBookingHoldDelete).not.toHaveBeenCalled()
  })
})