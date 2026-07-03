// lib/notifications/reviewRequests.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingStatus,
  ClientClaimStatus,
  NotificationEventKey,
} from '@prisma/client'

import { asTestTransactionClient } from '@/lib/typed/prismaTestClient'

const mocks = vi.hoisted(() => ({
  scheduleClientNotification: vi.fn(),
}))

vi.mock('@/lib/notifications/clientNotifications', () => ({
  scheduleClientNotification: mocks.scheduleClientNotification,
}))

import {
  REVIEW_REQUEST_DELAY_MS,
  buildReviewRequestContent,
  buildReviewRequestDedupeKey,
  buildReviewRequestHref,
  scheduleReviewRequestOnCompletion,
  validateDueReviewRequest,
} from './reviewRequests'

const NOW = new Date('2026-07-03T12:00:00.000Z')

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
    status: BookingStatus.COMPLETED,
    client: { claimStatus: ClientClaimStatus.CLAIMED },
    professional: PRO_ROW,
    ...overrides,
  }
}

function makeScheduledRow(overrides?: Record<string, unknown>) {
  return {
    id: 'row_1',
    eventKey: NotificationEventKey.REVIEW_REQUESTED,
    clientId: 'client_1',
    bookingId: 'booking_1',
    runAt: new Date('2026-07-03T11:00:00.000Z'),
    cancelledAt: null,
    processedAt: null,
    ...overrides,
  }
}

function makeTx(args: {
  booking?: unknown
  scheduledRow?: unknown
  existingReview?: unknown
}) {
  return asTestTransactionClient({
    booking: {
      findUnique: vi.fn().mockResolvedValue(args.booking ?? null),
    },
    scheduledClientNotification: {
      findUnique: vi.fn().mockResolvedValue(args.scheduledRow ?? null),
    },
    review: {
      findFirst: vi.fn().mockResolvedValue(args.existingReview ?? null),
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('scheduleReviewRequestOnCompletion', () => {
  it('schedules an idempotent review request 4h out for a claimed client', async () => {
    const tx = makeTx({ booking: makeBookingRow() })

    await scheduleReviewRequestOnCompletion({
      tx,
      bookingId: 'booking_1',
      now: NOW,
    })

    expect(mocks.scheduleClientNotification).toHaveBeenCalledWith({
      tx,
      clientId: 'client_1',
      bookingId: 'booking_1',
      eventKey: NotificationEventKey.REVIEW_REQUESTED,
      runAt: new Date(NOW.getTime() + REVIEW_REQUEST_DELAY_MS),
      dedupeKey: buildReviewRequestDedupeKey('booking_1'),
      href: buildReviewRequestHref('booking_1'),
      data: { bookingId: 'booking_1' },
    })
  })

  it('does nothing for unclaimed clients or non-completed bookings', async () => {
    await scheduleReviewRequestOnCompletion({
      tx: makeTx({
        booking: makeBookingRow({
          client: { claimStatus: ClientClaimStatus.UNCLAIMED },
        }),
      }),
      bookingId: 'booking_1',
      now: NOW,
    })

    await scheduleReviewRequestOnCompletion({
      tx: makeTx({
        booking: makeBookingRow({ status: BookingStatus.IN_PROGRESS }),
      }),
      bookingId: 'booking_1',
      now: NOW,
    })

    await scheduleReviewRequestOnCompletion({
      tx: makeTx({}),
      bookingId: 'booking_missing',
      now: NOW,
    })

    expect(mocks.scheduleClientNotification).not.toHaveBeenCalled()
  })
})

describe('validateDueReviewRequest', () => {
  it('PROCESSes a due request with pro-named content', async () => {
    const tx = makeTx({
      scheduledRow: makeScheduledRow(),
      booking: makeBookingRow(),
    })

    const result = await validateDueReviewRequest({
      tx,
      scheduledClientNotificationId: 'row_1',
      now: NOW,
    })

    expect(result).toEqual({
      action: 'PROCESS',
      rowId: 'row_1',
      clientId: 'client_1',
      bookingId: 'booking_1',
      eventKey: NotificationEventKey.REVIEW_REQUESTED,
      dedupeKey: 'REVIEW_REQUEST:booking_1',
      href: '/client/bookings/booking_1#review',
      notification: buildReviewRequestContent({
        bookingId: 'booking_1',
        professionalName: 'Tori Beauty Studio',
      }),
    })
  })

  it('CANCELs when a review already exists for the booking', async () => {
    const tx = makeTx({
      scheduledRow: makeScheduledRow(),
      booking: makeBookingRow(),
      existingReview: { id: 'review_1' },
    })

    const result = await validateDueReviewRequest({
      tx,
      scheduledClientNotificationId: 'row_1',
      now: NOW,
    })

    expect(result).toMatchObject({ action: 'CANCEL' })
  })

  it('CANCELs when the booking is no longer completed or the client is unclaimed', async () => {
    expect(
      await validateDueReviewRequest({
        tx: makeTx({
          scheduledRow: makeScheduledRow(),
          booking: makeBookingRow({ status: BookingStatus.CANCELLED }),
        }),
        scheduledClientNotificationId: 'row_1',
        now: NOW,
      }),
    ).toMatchObject({ action: 'CANCEL' })

    expect(
      await validateDueReviewRequest({
        tx: makeTx({
          scheduledRow: makeScheduledRow(),
          booking: makeBookingRow({
            client: { claimStatus: ClientClaimStatus.UNCLAIMED },
          }),
        }),
        scheduledClientNotificationId: 'row_1',
        now: NOW,
      }),
    ).toMatchObject({ action: 'CANCEL' })
  })

  it('SKIPs not-yet-due, processed, and missing rows', async () => {
    expect(
      await validateDueReviewRequest({
        tx: makeTx({
          scheduledRow: makeScheduledRow({
            runAt: new Date(NOW.getTime() + 60_000),
          }),
        }),
        scheduledClientNotificationId: 'row_1',
        now: NOW,
      }),
    ).toEqual({ action: 'SKIP' })

    expect(
      await validateDueReviewRequest({
        tx: makeTx({
          scheduledRow: makeScheduledRow({ processedAt: NOW }),
        }),
        scheduledClientNotificationId: 'row_1',
        now: NOW,
      }),
    ).toEqual({ action: 'SKIP' })

    expect(
      await validateDueReviewRequest({
        tx: makeTx({}),
        scheduledClientNotificationId: 'row_missing',
        now: NOW,
      }),
    ).toEqual({ action: 'SKIP' })
  })

  it('CANCELs on wrong event key or client mismatch', async () => {
    expect(
      await validateDueReviewRequest({
        tx: makeTx({
          scheduledRow: makeScheduledRow({
            eventKey: NotificationEventKey.APPOINTMENT_REMINDER,
          }),
        }),
        scheduledClientNotificationId: 'row_1',
        now: NOW,
      }),
    ).toMatchObject({ action: 'CANCEL' })

    expect(
      await validateDueReviewRequest({
        tx: makeTx({
          scheduledRow: makeScheduledRow({ clientId: 'client_other' }),
          booking: makeBookingRow(),
        }),
        scheduledClientNotificationId: 'row_1',
        now: NOW,
      }),
    ).toMatchObject({ action: 'CANCEL' })
  })
})
