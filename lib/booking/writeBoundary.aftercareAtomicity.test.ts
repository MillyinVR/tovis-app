// lib/booking/writeBoundary.aftercareAtomicity.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AftercareRebookMode,
  BookingCheckoutStatus,
  BookingStatus,
  Prisma,
  SessionStep,
} from '@prisma/client'

const TEST_NOW = new Date('2026-04-12T18:00:00.000Z')

const mocks = vi.hoisted(() => ({
  prismaTransaction: vi.fn(),

  withLockedProfessionalTransaction: vi.fn(),
  withLockedClientOwnedBookingTransaction: vi.fn(),

  txBookingFindUnique: vi.fn(),
  txAftercareSummaryUpsert: vi.fn(),
  txAftercareSummaryUpdate: vi.fn(),

  txAftercareRebookSlotDeleteMany: vi.fn(),
  txAftercareRebookSlotUpsert: vi.fn(),

  txProductRecommendationDeleteMany: vi.fn(),
  txProductRecommendationCreateMany: vi.fn(),
  txProductFindMany: vi.fn(),
  txReminderUpsert: vi.fn(),
  txReminderDeleteMany: vi.fn(),
  txMediaAssetCount: vi.fn(),
  txBookingUpdate: vi.fn(),

  createAftercareAccessDelivery: vi.fn(),

  createBookingCloseoutAuditLog: vi.fn(),
  areAuditValuesEqual: vi.fn(),

  upsertClientNotification: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.prismaTransaction,
  },
}))

vi.mock('@/lib/booking/scheduleTransaction', () => ({
  withLockedProfessionalTransaction: mocks.withLockedProfessionalTransaction,
  withLockedClientOwnedBookingTransaction:
    mocks.withLockedClientOwnedBookingTransaction,
}))

vi.mock('@/lib/clientActions/createAftercareAccessDelivery', () => ({
  createAftercareAccessDelivery: mocks.createAftercareAccessDelivery,
}))

vi.mock('@/lib/booking/closeoutAudit', () => ({
  createBookingCloseoutAuditLog: mocks.createBookingCloseoutAuditLog,
  areAuditValuesEqual: mocks.areAuditValuesEqual,
}))

vi.mock('@/lib/notifications/clientNotifications', () => ({
  upsertClientNotification: mocks.upsertClientNotification,
}))

import { upsertBookingAftercare } from './writeBoundary'

const tx = {
  booking: {
    findUnique: mocks.txBookingFindUnique,
    update: mocks.txBookingUpdate,
  },
  aftercareSummary: {
    upsert: mocks.txAftercareSummaryUpsert,
    update: mocks.txAftercareSummaryUpdate,
  },
  aftercareRebookSlot: {
    deleteMany: mocks.txAftercareRebookSlotDeleteMany,
    upsert: mocks.txAftercareRebookSlotUpsert,
  },
  productRecommendation: {
    deleteMany: mocks.txProductRecommendationDeleteMany,
    createMany: mocks.txProductRecommendationCreateMany,
  },
  product: {
    findMany: mocks.txProductFindMany,
  },
  reminder: {
    upsert: mocks.txReminderUpsert,
    deleteMany: mocks.txReminderDeleteMany,
  },
  mediaAsset: {
    count: mocks.txMediaAssetCount,
  },
}

function makeAftercareEligibleBooking() {
  return {
    id: 'booking_1',
    clientId: 'client_1',
    professionalId: 'pro_1',
    status: BookingStatus.IN_PROGRESS,
    sessionStep: SessionStep.AFTER_PHOTOS,
    scheduledFor: TEST_NOW,
    finishedAt: null,
    locationTimeZone: 'America/Los_Angeles',
    clientTimeZoneAtBooking: null,
    checkoutStatus: BookingCheckoutStatus.READY,
    paymentCollectedAt: null,
    service: {
      name: 'Haircut',
    },
    professional: {
      timeZone: 'America/Los_Angeles',
    },
    client: {
      id: 'client_1',
      userId: 'user_client_1',
      email: 'client@example.com',
      phone: null,
      preferredContactMethod: null,
      firstName: 'Client',
      lastName: 'One',
      user: {
        email: null,
        phone: null,
      },
    },
    aftercareSummary: null,
  }
}

function makeDraftAftercare() {
  return {
    id: 'aftercare_1',
    rebookMode: AftercareRebookMode.NONE,
    rebookedFor: null,
    rebookWindowStart: null,
    rebookWindowEnd: null,
    draftSavedAt: TEST_NOW,
    sentToClientAt: null,
    lastEditedAt: TEST_NOW,
    version: 1,
  }
}

describe('lib/booking/writeBoundary aftercare atomicity', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(TEST_NOW)

    mocks.areAuditValuesEqual.mockImplementation(
      (left: unknown, right: unknown) =>
        JSON.stringify(left) === JSON.stringify(right),
    )

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

    mocks.txAftercareRebookSlotDeleteMany.mockResolvedValue({ count: 0 })
    mocks.txAftercareRebookSlotUpsert.mockResolvedValue({
      id: 'aftercare_rebook_slot_1',
    })
  })

  it('does not mark aftercare sent when access delivery cannot be queued', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeAftercareEligibleBooking(),
    )

    mocks.txAftercareSummaryUpsert.mockResolvedValueOnce(makeDraftAftercare())

    mocks.createAftercareAccessDelivery.mockRejectedValueOnce(
      new Error('delivery provider down'),
    )

    await expect(
      upsertBookingAftercare({
        bookingId: 'booking_1',
        professionalId: 'pro_1',
        actorUserId: 'user_pro_1',
        notes: 'Use gentle cleanser tonight.',
        rebookMode: AftercareRebookMode.NONE,
        rebookedFor: null,
        rebookWindowStart: null,
        rebookWindowEnd: null,
        rebookSlot: null,
        createRebookReminder: false,
        rebookReminderDaysBefore: 7,
        createProductReminder: false,
        productReminderDaysAfter: 14,
        recommendedProducts: [],
        sendToClient: true,
        version: null,
        requestId: 'req_aftercare_atomicity_1',
        idempotencyKey: 'idem_aftercare_atomicity_1',
      }),
    ).rejects.toMatchObject({
      code: 'AFTERCARE_DELIVERY_FAILED',
    })

    expect(mocks.txAftercareSummaryUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          sentToClientAt: null,
          draftSavedAt: TEST_NOW,
        }),
        update: expect.objectContaining({
          sentToClientAt: null,
        }),
      }),
    )

    expect(mocks.createAftercareAccessDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        tx,
        professionalId: 'pro_1',
        clientId: 'client_1',
        bookingId: 'booking_1',
        aftercareId: 'aftercare_1',
        aftercareVersion: 1,
        issuedByUserId: 'user_pro_1',
        recipientUserId: 'user_client_1',
        recipientEmail: 'client@example.com',
        recipientPhone: null,
        recipientTimeZone: 'America/Los_Angeles',
      }),
    )

    expect(mocks.txAftercareSummaryUpdate).not.toHaveBeenCalled()
    expect(mocks.txProductRecommendationDeleteMany).not.toHaveBeenCalled()
    expect(mocks.txProductRecommendationCreateMany).not.toHaveBeenCalled()
    expect(mocks.upsertClientNotification).not.toHaveBeenCalled()
    expect(mocks.txMediaAssetCount).not.toHaveBeenCalled()
    expect(mocks.txBookingUpdate).not.toHaveBeenCalled()
    expect(mocks.createBookingCloseoutAuditLog).not.toHaveBeenCalled()
  })

  it('marks aftercare sent only after access delivery is successfully queued', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeAftercareEligibleBooking(),
    )

    mocks.txAftercareSummaryUpsert.mockResolvedValueOnce(makeDraftAftercare())

    mocks.createAftercareAccessDelivery.mockResolvedValueOnce({
      link: {
        href: '/client/aftercare/access/token_1',
      },
    })

    mocks.txAftercareSummaryUpdate.mockResolvedValueOnce({
      ...makeDraftAftercare(),
      draftSavedAt: null,
      sentToClientAt: TEST_NOW,
    })

    mocks.txProductRecommendationDeleteMany.mockResolvedValueOnce({ count: 0 })

    mocks.txReminderDeleteMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 })

    mocks.txMediaAssetCount.mockResolvedValueOnce(0)
    mocks.upsertClientNotification.mockResolvedValueOnce(undefined)

    const result = await upsertBookingAftercare({
      bookingId: 'booking_1',
      professionalId: 'pro_1',
      actorUserId: 'user_pro_1',
      notes: 'Use gentle cleanser tonight.',
      rebookMode: AftercareRebookMode.NONE,
      rebookedFor: null,
      rebookWindowStart: null,
      rebookWindowEnd: null,
      rebookSlot: null,
      createRebookReminder: false,
      rebookReminderDaysBefore: 7,
      createProductReminder: false,
      productReminderDaysAfter: 14,
      recommendedProducts: [],
      sendToClient: true,
      version: null,
      requestId: 'req_aftercare_atomicity_2',
      idempotencyKey: 'idem_aftercare_atomicity_2',
    })

    expect(mocks.createAftercareAccessDelivery).toHaveBeenCalledTimes(1)

    expect(mocks.txAftercareSummaryUpdate).toHaveBeenCalledWith({
      where: { id: 'aftercare_1' },
      data: {
        sentToClientAt: TEST_NOW,
        draftSavedAt: null,
      },
      select: {
        id: true,
        rebookMode: true,
        rebookedFor: true,
        rebookWindowStart: true,
        rebookWindowEnd: true,
        draftSavedAt: true,
        sentToClientAt: true,
        lastEditedAt: true,
        version: true,
      },
    })

    expect(mocks.txAftercareRebookSlotDeleteMany).toHaveBeenCalledWith({
      where: {
        aftercareSummaryId: 'aftercare_1',
      },
    })

    expect(result).toMatchObject({
      aftercare: {
        id: 'aftercare_1',
        rebookMode: AftercareRebookMode.NONE,
        rebookedFor: null,
        rebookWindowStart: null,
        rebookWindowEnd: null,
        draftSavedAt: null,
        sentToClientAt: TEST_NOW,
        lastEditedAt: TEST_NOW,
        version: 1,
      },
      aftercareAccessDelivery: {
        attempted: true,
        queued: true,
        href: '/client/aftercare/access/token_1',
      },
      clientNotified: true,
      bookingFinished: false,
      completionBlockers: [
        'PAYMENT_NOT_COLLECTED',
        'CHECKOUT_NOT_COMPLETE',
        'AFTER_PHOTOS_REQUIRED',
      ],
      booking: null,
      timeZoneUsed: 'America/Los_Angeles',
      meta: {
        mutated: true,
        noOp: false,
      },
    })
  })

  it('rejects aftercare edits once the booking is completed (read-only)', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce({
      ...makeAftercareEligibleBooking(),
      status: BookingStatus.COMPLETED,
      sessionStep: SessionStep.DONE,
      finishedAt: TEST_NOW,
      checkoutStatus: BookingCheckoutStatus.PAID,
      paymentCollectedAt: TEST_NOW,
    })

    await expect(
      upsertBookingAftercare({
        bookingId: 'booking_1',
        professionalId: 'pro_1',
        actorUserId: 'user_pro_1',
        notes: 'Trying to edit a finished booking.',
        rebookMode: AftercareRebookMode.NONE,
        rebookedFor: null,
        rebookWindowStart: null,
        rebookWindowEnd: null,
        rebookSlot: null,
        createRebookReminder: false,
        rebookReminderDaysBefore: 7,
        createProductReminder: false,
        productReminderDaysAfter: 14,
        recommendedProducts: [],
        sendToClient: true,
        version: 1,
        requestId: 'req_aftercare_atomicity_completed',
        idempotencyKey: 'idem_aftercare_atomicity_completed',
      }),
    ).rejects.toMatchObject({
      code: 'BOOKING_CANNOT_EDIT_COMPLETED',
    })

    expect(mocks.txAftercareSummaryUpsert).not.toHaveBeenCalled()
    expect(mocks.txAftercareSummaryUpdate).not.toHaveBeenCalled()
    expect(mocks.createAftercareAccessDelivery).not.toHaveBeenCalled()
    expect(mocks.txBookingUpdate).not.toHaveBeenCalled()
  })
})