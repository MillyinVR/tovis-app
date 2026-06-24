// lib/booking/writeBoundary.aftercareSendNudge.test.ts
//
// Focused tests for the pro aftercare-list actions: sendExistingAftercareDraft
// (the "Send" button) and nudgeAftercareRebook (the "Nudge" button). Both reuse
// the shared delivery + notification helpers, so we assert the resend mode,
// the sent-flip, the notification, and the ownership / state guards.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AftercareRebookMode, BookingStatus, SessionStep } from '@prisma/client'

const TEST_NOW = new Date('2026-06-23T18:00:00.000Z')

const mocks = vi.hoisted(() => ({
  prismaTransaction: vi.fn(),
  txBookingFindUnique: vi.fn(),
  txAftercareSummaryUpdate: vi.fn(),
  createAftercareAccessDelivery: vi.fn(),
  upsertClientNotification: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { $transaction: mocks.prismaTransaction },
}))

vi.mock('@/lib/clientActions/createAftercareAccessDelivery', () => ({
  createAftercareAccessDelivery: mocks.createAftercareAccessDelivery,
}))

vi.mock('@/lib/notifications/clientNotifications', () => ({
  upsertClientNotification: mocks.upsertClientNotification,
}))

import { nudgeAftercareRebook, sendExistingAftercareDraft } from './writeBoundary'

const tx = {
  booking: { findUnique: mocks.txBookingFindUnique },
  aftercareSummary: { update: mocks.txAftercareSummaryUpdate },
}

function makeBooking(aftercareSummary: unknown) {
  return {
    id: 'booking_1',
    clientId: 'client_1',
    professionalId: 'pro_1',
    status: BookingStatus.IN_PROGRESS,
    sessionStep: SessionStep.AFTER_PHOTOS,
    scheduledFor: TEST_NOW,
    finishedAt: null,
    checkoutStatus: null,
    paymentCollectedAt: null,
    locationTimeZone: 'America/Los_Angeles',
    clientTimeZoneAtBooking: null,
    service: { name: 'Balayage' },
    client: {
      id: 'client_1',
      userId: 'user_client_1',
      email: 'client@example.com',
      phone: null,
      preferredContactMethod: null,
      firstName: 'Maya',
      lastName: 'Chen',
      user: { email: null, phone: null },
    },
    professional: { timeZone: 'America/Los_Angeles' },
    aftercareSummary,
  }
}

const draftSummary = {
  id: 'aftercare_1',
  notes: 'Use the purple shampoo twice a week.',
  rebookMode: AftercareRebookMode.RECOMMENDED_WINDOW,
  rebookedFor: null,
  rebookWindowStart: TEST_NOW,
  rebookWindowEnd: TEST_NOW,
  draftSavedAt: TEST_NOW,
  sentToClientAt: null,
  lastEditedAt: TEST_NOW,
  version: 2,
  rebookSlot: null,
  recommendedProducts: [],
}

const sentSummary = { ...draftSummary, draftSavedAt: null, sentToClientAt: TEST_NOW }

describe('sendExistingAftercareDraft', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.prismaTransaction.mockImplementation(
      async (run: (db: typeof tx) => Promise<unknown>) => run(tx),
    )
    mocks.createAftercareAccessDelivery.mockResolvedValue({
      link: { href: '/client/aftercare/access/token_1' },
    })
    mocks.upsertClientNotification.mockResolvedValue(undefined)
    mocks.txAftercareSummaryUpdate.mockResolvedValue(sentSummary)
  })

  it('delivers (INITIAL_SEND), flips the draft to sent, and notifies the client', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(makeBooking(draftSummary))

    const result = await sendExistingAftercareDraft({
      bookingId: 'booking_1',
      professionalId: 'pro_1',
      actorUserId: 'user_pro_1',
    })

    expect(result).toEqual({ ok: true })
    expect(mocks.createAftercareAccessDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'booking_1',
        aftercareId: 'aftercare_1',
        aftercareVersion: 2,
        resendMode: 'INITIAL_SEND',
      }),
    )
    expect(mocks.txAftercareSummaryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'aftercare_1' },
        data: expect.objectContaining({ draftSavedAt: null }),
      }),
    )
    expect(mocks.upsertClientNotification).toHaveBeenCalledTimes(1)
  })

  it('is a no-op when the summary was already sent', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(makeBooking(sentSummary))

    const result = await sendExistingAftercareDraft({
      bookingId: 'booking_1',
      professionalId: 'pro_1',
      actorUserId: 'user_pro_1',
    })

    expect(result).toEqual({ ok: true })
    expect(mocks.createAftercareAccessDelivery).not.toHaveBeenCalled()
    expect(mocks.txAftercareSummaryUpdate).not.toHaveBeenCalled()
    expect(mocks.upsertClientNotification).not.toHaveBeenCalled()
  })

  it('404s a booking owned by another professional without leaking', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce({
      ...makeBooking(draftSummary),
      professionalId: 'pro_other',
    })

    await expect(
      sendExistingAftercareDraft({
        bookingId: 'booking_1',
        professionalId: 'pro_1',
        actorUserId: 'user_pro_1',
      }),
    ).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' })
    expect(mocks.createAftercareAccessDelivery).not.toHaveBeenCalled()
  })

  it('rejects when no aftercare draft exists', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(makeBooking(null))

    await expect(
      sendExistingAftercareDraft({
        bookingId: 'booking_1',
        professionalId: 'pro_1',
        actorUserId: 'user_pro_1',
      }),
    ).rejects.toMatchObject({ code: 'AFTERCARE_NOT_COMPLETED' })
  })
})

describe('nudgeAftercareRebook', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.prismaTransaction.mockImplementation(
      async (run: (db: typeof tx) => Promise<unknown>) => run(tx),
    )
    mocks.createAftercareAccessDelivery.mockResolvedValue({
      link: { href: '/client/aftercare/access/token_2' },
    })
    mocks.upsertClientNotification.mockResolvedValue(undefined)
  })

  it('re-delivers (RESEND) and refreshes the notification for a sent summary', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(makeBooking(sentSummary))

    const result = await nudgeAftercareRebook({
      bookingId: 'booking_1',
      professionalId: 'pro_1',
      actorUserId: 'user_pro_1',
    })

    expect(result).toEqual({ ok: true })
    expect(mocks.createAftercareAccessDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ resendMode: 'RESEND', aftercareId: 'aftercare_1' }),
    )
    expect(mocks.upsertClientNotification).toHaveBeenCalledTimes(1)
    // A nudge never mutates the summary's sent/draft state.
    expect(mocks.txAftercareSummaryUpdate).not.toHaveBeenCalled()
  })

  it('rejects nudging an aftercare that was never sent', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(makeBooking(draftSummary))

    await expect(
      nudgeAftercareRebook({
        bookingId: 'booking_1',
        professionalId: 'pro_1',
        actorUserId: 'user_pro_1',
      }),
    ).rejects.toMatchObject({ code: 'AFTERCARE_NOT_COMPLETED' })
    expect(mocks.createAftercareAccessDelivery).not.toHaveBeenCalled()
  })

  it('404s a booking owned by another professional', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce({
      ...makeBooking(sentSummary),
      professionalId: 'pro_other',
    })

    await expect(
      nudgeAftercareRebook({
        bookingId: 'booking_1',
        professionalId: 'pro_1',
        actorUserId: 'user_pro_1',
      }),
    ).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' })
  })
})
