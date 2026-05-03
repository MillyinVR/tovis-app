// lib/booking/writeBoundary.lifecycleIntegration.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AftercareRebookMode,
  BookingCheckoutStatus,
  BookingStatus,
  MediaPhase,
  MediaType,
  MediaVisibility,
  PaymentMethod,
  Prisma,
  SessionStep,
} from '@prisma/client'

const TEST_NOW = new Date('2026-04-12T18:00:00.000Z')
const STARTED_AT = new Date('2026-04-12T17:00:00.000Z')
const FINISHED_AT = new Date('2026-04-12T18:00:00.000Z')
const AFTERCARE_SENT_AT = new Date('2026-04-12T18:05:00.000Z')
const PAYMENT_COLLECTED_AT = new Date('2026-04-12T18:10:00.000Z')
const REBOOKED_FOR = new Date('2030-05-01T18:00:00.000Z')

const mocks = vi.hoisted(() => ({
  prismaTransaction: vi.fn(),
  prismaBookingFindUnique: vi.fn(),

  withLockedProfessionalTransaction: vi.fn(),
  withLockedClientOwnedBookingTransaction: vi.fn(),

  txBookingFindUnique: vi.fn(),
  txBookingUpdate: vi.fn(),
  txBookingFindFirst: vi.fn(),

  txMediaAssetCount: vi.fn(),
  txMediaAssetCreate: vi.fn(),

  txAftercareSummaryFindUnique: vi.fn(),
  txAftercareSummaryUpsert: vi.fn(),

  txProductRecommendationDeleteMany: vi.fn(),
  txProductRecommendationCreateMany: vi.fn(),
  txProductFindMany: vi.fn(),

  txReminderUpsert: vi.fn(),
  txReminderDeleteMany: vi.fn(),

  txProfessionalProfileUpdate: vi.fn(),
  txExecuteRaw: vi.fn(),
  txQueryRaw: vi.fn(),

  createBookingCloseoutAuditLog: vi.fn(),
  areAuditValuesEqual: vi.fn(),

  upsertClientNotification: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.prismaTransaction,
    booking: {
      findUnique: mocks.prismaBookingFindUnique,
    },
  },
}))

vi.mock('@/lib/notifications/clientNotifications', () => ({
  upsertClientNotification: mocks.upsertClientNotification,
}))

vi.mock('@/lib/booking/scheduleTransaction', () => ({
  withLockedProfessionalTransaction: mocks.withLockedProfessionalTransaction,
  withLockedClientOwnedBookingTransaction:
    mocks.withLockedClientOwnedBookingTransaction,
}))

vi.mock('@/lib/booking/closeoutAudit', () => ({
  createBookingCloseoutAuditLog: mocks.createBookingCloseoutAuditLog,
  areAuditValuesEqual: mocks.areAuditValuesEqual,
}))

import {
  assertClientBookingReviewEligibility,
  createClientRebookedBookingFromAftercare,
  finishBookingSession,
  startBookingSession,
  transitionSessionStep,
  updateClientBookingCheckout,
  uploadProBookingMedia,
  upsertBookingAftercare,
} from './writeBoundary'

const tx = {
  booking: {
    findUnique: mocks.txBookingFindUnique,
    update: mocks.txBookingUpdate,
    findFirst: mocks.txBookingFindFirst,
  },
  mediaAsset: {
    count: mocks.txMediaAssetCount,
    create: mocks.txMediaAssetCreate,
  },
  aftercareSummary: {
    findUnique: mocks.txAftercareSummaryFindUnique,
    upsert: mocks.txAftercareSummaryUpsert,
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
  professionalProfile: {
    update: mocks.txProfessionalProfileUpdate,
  },
  $executeRaw: mocks.txExecuteRaw,
  $queryRaw: mocks.txQueryRaw,
}

function makeStartableBooking() {
  return {
    id: 'booking_1',
    clientId: 'client_1',
    professionalId: 'pro_1',
    status: BookingStatus.ACCEPTED,
    scheduledFor: TEST_NOW,
    startedAt: null,
    finishedAt: null,
    sessionStep: SessionStep.NONE,
  }
}

function makeTransitionBooking(overrides?: {
  startedAt?: Date | null
  sessionStep?: SessionStep
  consultationApproval?: { status: string } | null
}) {
  return {
    id: 'booking_1',
    professionalId: 'pro_1',
    status: BookingStatus.ACCEPTED,
    startedAt: overrides?.startedAt ?? STARTED_AT,
    finishedAt: null,
    sessionStep: overrides?.sessionStep ?? SessionStep.BEFORE_PHOTOS,
    consultationApproval:
      overrides && 'consultationApproval' in overrides
        ? overrides.consultationApproval
        : { status: 'APPROVED' },
  }
}

function makeMediaBooking(overrides?: {
  status?: BookingStatus
  sessionStep?: SessionStep
  finishedAt?: Date | null
}) {
  return {
    id: 'booking_1',
    professionalId: 'pro_1',
    status: overrides?.status ?? BookingStatus.ACCEPTED,
    startedAt: STARTED_AT,
    finishedAt: overrides?.finishedAt ?? null,
    sessionStep: overrides?.sessionStep ?? SessionStep.BEFORE_PHOTOS,
  }
}

function makeCreatedMedia(overrides?: {
  id?: string
  phase?: MediaPhase
  caption?: string | null
  storagePath?: string
}) {
  return {
    id: overrides?.id ?? 'media_1',
    mediaType: MediaType.IMAGE,
    visibility: MediaVisibility.PRO_CLIENT,
    phase: overrides?.phase ?? MediaPhase.BEFORE,
    caption: overrides?.caption ?? 'Before photo',
    createdAt: TEST_NOW,
    reviewId: null,
    isEligibleForLooks: false,
    isFeaturedInPortfolio: false,
    storageBucket: 'booking-media',
    storagePath: overrides?.storagePath ?? 'bookings/booking_1/before.jpg',
    thumbBucket: null,
    thumbPath: null,
    url: null,
    thumbUrl: null,
  }
}

function makeUploadArgs(
  overrides?: Partial<Parameters<typeof uploadProBookingMedia>[0]>,
) {
  return {
    bookingId: 'booking_1',
    professionalId: 'pro_1',
    uploadedByUserId: 'user_1',
    storageBucket: 'booking-media',
    storagePath: 'bookings/booking_1/before.jpg',
    thumbBucket: null,
    thumbPath: null,
    caption: 'Before photo',
    phase: MediaPhase.BEFORE,
    mediaType: MediaType.IMAGE,
    ...(overrides ?? {}),
  }
}

function makeFinishableBooking(
  overrides?: Partial<{
    status: BookingStatus
    startedAt: Date | null
    finishedAt: Date | null
    sessionStep: SessionStep | null
    consultationApproval: { status: string } | null
  }>,
) {
  return {
    id: 'booking_1',
    professionalId: 'pro_1',
    status: overrides?.status ?? BookingStatus.ACCEPTED,
    startedAt: overrides?.startedAt ?? STARTED_AT,
    finishedAt: overrides?.finishedAt ?? null,
    sessionStep: overrides?.sessionStep ?? SessionStep.SERVICE_IN_PROGRESS,
    consultationApproval:
      overrides && 'consultationApproval' in overrides
        ? overrides.consultationApproval
        : {
            status: 'APPROVED',
          },
  }
}

function makeClientCheckoutBooking(overrides?: {
  status?: BookingStatus
  sessionStep?: SessionStep
  finishedAt?: Date | null
  checkoutStatus?: BookingCheckoutStatus
  selectedPaymentMethod?: PaymentMethod | null
  paymentAuthorizedAt?: Date | null
  paymentCollectedAt?: Date | null
  aftercareSummary?: { id: string; sentToClientAt: Date | null } | null
}) {
  return {
    id: 'booking_1',
    clientId: 'client_1',
    professionalId: 'pro_1',
    status: overrides?.status ?? BookingStatus.ACCEPTED,
    sessionStep: overrides?.sessionStep ?? SessionStep.AFTER_PHOTOS,
    finishedAt: overrides?.finishedAt ?? FINISHED_AT,
    subtotalSnapshot: new Prisma.Decimal(100),
    serviceSubtotalSnapshot: new Prisma.Decimal(100),
    productSubtotalSnapshot: new Prisma.Decimal(20),
    tipAmount: new Prisma.Decimal(0),
    taxAmount: new Prisma.Decimal(0),
    discountAmount: new Prisma.Decimal(0),
    totalAmount: new Prisma.Decimal(120),
    checkoutStatus: overrides?.checkoutStatus ?? BookingCheckoutStatus.READY,
    selectedPaymentMethod:
      overrides?.selectedPaymentMethod ?? PaymentMethod.CASH,
    paymentAuthorizedAt: overrides?.paymentAuthorizedAt ?? null,
    paymentCollectedAt: overrides?.paymentCollectedAt ?? null,
    aftercareSummary:
      overrides && 'aftercareSummary' in overrides
        ? overrides.aftercareSummary
        : {
            id: 'aftercare_1',
            sentToClientAt: AFTERCARE_SENT_AT,
          },
    productSales: [
      {
        unitPrice: new Prisma.Decimal(10),
        quantity: 2,
      },
    ],
  }
}

function makeAftercareCloseoutBookingWithoutAfterPhotos() {
  return {
    id: 'booking_1',
    clientId: 'client_1',
    professionalId: 'pro_1',
    status: BookingStatus.ACCEPTED,
    sessionStep: SessionStep.AFTER_PHOTOS,
    finishedAt: FINISHED_AT,
    scheduledFor: TEST_NOW,
    locationTimeZone: 'America/Los_Angeles',
    checkoutStatus: BookingCheckoutStatus.PAID,
    paymentCollectedAt: PAYMENT_COLLECTED_AT,
    aftercareSummary: null,
    professional: {
      timeZone: 'America/Los_Angeles',
    },
    client: {
      firstName: 'Client',
      lastName: 'One',
    },
    service: {
      name: 'Haircut',
    },
  }
}

function makeSentAftercareResult() {
  return {
    id: 'aftercare_1',
    publicToken: 'public_aftercare_token_1',
    rebookMode: AftercareRebookMode.NONE,
    rebookedFor: null,
    rebookWindowStart: null,
    rebookWindowEnd: null,
    draftSavedAt: null,
    sentToClientAt: TEST_NOW,
    lastEditedAt: TEST_NOW,
    version: 1,
  }
}

function makeReviewEligibleBooking() {
  return {
    id: 'booking_1',
    clientId: 'client_1',
    professionalId: 'pro_1',
    status: BookingStatus.COMPLETED,
    finishedAt: FINISHED_AT,
    checkoutStatus: BookingCheckoutStatus.PAID,
    paymentCollectedAt: PAYMENT_COLLECTED_AT,
    aftercareSummary: {
      id: 'aftercare_1',
      sentToClientAt: AFTERCARE_SENT_AT,
    },
    reviews: [],
  }
}

function makeAftercareRef() {
  return {
    id: 'aftercare_1',
    bookingId: 'booking_1',
    booking: {
      id: 'booking_1',
      clientId: 'client_1',
      professionalId: 'pro_1',
    },
  }
}

function makeCompletedSourceBooking() {
  return {
    id: 'booking_1',
    clientId: 'client_1',
    professionalId: 'pro_1',
    status: BookingStatus.COMPLETED,
    finishedAt: FINISHED_AT,
    checkoutStatus: BookingCheckoutStatus.PAID,
    paymentCollectedAt: PAYMENT_COLLECTED_AT,
    aftercareSummary: {
      id: 'aftercare_1',
      sentToClientAt: AFTERCARE_SENT_AT,
    },
    locationId: 'location_1',
  }
}

function makeExistingRebook() {
  return {
    id: 'booking_rebook_1',
    status: BookingStatus.PENDING,
    scheduledFor: REBOOKED_FOR,
  }
}

function makeExistingAftercare() {
  return {
    id: 'aftercare_1',
    rebookMode: AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
    rebookedFor: REBOOKED_FOR,
  }
}

describe('lib/booking/writeBoundary lifecycle integration contract', () => {
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

    mocks.upsertClientNotification.mockResolvedValue(undefined)
    mocks.txProfessionalProfileUpdate.mockResolvedValue({ id: 'pro_1' })
    mocks.txExecuteRaw.mockResolvedValue(1)
    mocks.txQueryRaw.mockResolvedValue([])
  })

    it('sends aftercare but does not complete the booking when AFTER photos are missing', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeAftercareCloseoutBookingWithoutAfterPhotos(),
    )

    mocks.txAftercareSummaryUpsert.mockResolvedValueOnce(makeSentAftercareResult())

    mocks.txProductRecommendationDeleteMany.mockResolvedValueOnce({
      count: 0,
    })

    mocks.txReminderDeleteMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 })

    mocks.txMediaAssetCount.mockResolvedValueOnce(0)

    const updateCountBeforeAftercare = mocks.txBookingUpdate.mock.calls.length

    const result = await upsertBookingAftercare({
      bookingId: 'booking_1',
      professionalId: 'pro_1',
      notes: 'Use gentle cleanser tonight.',
      rebookMode: AftercareRebookMode.NONE,
      rebookedFor: null,
      rebookWindowStart: null,
      rebookWindowEnd: null,
      createRebookReminder: false,
      rebookReminderDaysBefore: 7,
      createProductReminder: false,
      productReminderDaysAfter: 14,
      recommendedProducts: [],
      sendToClient: true,
      version: null,
      requestId: 'req_aftercare_without_after_1',
      idempotencyKey: 'idem_aftercare_without_after_1',
    })

    expect(mocks.txMediaAssetCount).toHaveBeenCalledWith({
      where: {
        bookingId: 'booking_1',
        phase: MediaPhase.AFTER,
        uploadedByRole: 'PRO',
      },
    })

    expect(mocks.txBookingUpdate).toHaveBeenCalledTimes(
      updateCountBeforeAftercare,
    )

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
      remindersTouched: 0,
      clientNotified: true,
      bookingFinished: false,
      completionBlockers: ['AFTER_PHOTOS_REQUIRED'],
      booking: null,
      timeZoneUsed: 'America/Los_Angeles',
      meta: {
        mutated: true,
        noOp: false,
      },
    })
  })

  it('connects session start, media gates, finish review, checkout completion, review eligibility, and client rebook', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(makeStartableBooking())
    mocks.txBookingUpdate.mockResolvedValueOnce({
      id: 'booking_1',
      status: BookingStatus.ACCEPTED,
      startedAt: TEST_NOW,
      finishedAt: null,
      sessionStep: SessionStep.CONSULTATION,
    })

    await expect(
      startBookingSession({
        bookingId: 'booking_1',
        professionalId: 'pro_1',
        requestId: 'req_start_1',
        idempotencyKey: 'idem_start_1',
      }),
    ).resolves.toMatchObject({
      booking: {
        id: 'booking_1',
        sessionStep: SessionStep.CONSULTATION,
      },
      meta: {
        mutated: true,
        noOp: false,
      },
    })

    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeMediaBooking({
        sessionStep: SessionStep.SERVICE_IN_PROGRESS,
      }),
    )

    await expect(
      uploadProBookingMedia(
        makeUploadArgs({
          phase: MediaPhase.BEFORE,
        }),
      ),
    ).rejects.toMatchObject({
      code: 'STEP_MISMATCH',
    })

    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeMediaBooking({
        sessionStep: SessionStep.BEFORE_PHOTOS,
      }),
    )
    mocks.txMediaAssetCreate.mockResolvedValueOnce(
      makeCreatedMedia({
        phase: MediaPhase.BEFORE,
        caption: 'Before photo',
      }),
    )

    await expect(uploadProBookingMedia(makeUploadArgs())).resolves.toMatchObject(
      {
        created: {
          phase: MediaPhase.BEFORE,
          visibility: MediaVisibility.PRO_CLIENT,
        },
        advancedTo: null,
        meta: {
          mutated: true,
          noOp: false,
        },
      },
    )

    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeTransitionBooking({
        startedAt: STARTED_AT,
        sessionStep: SessionStep.BEFORE_PHOTOS,
        consultationApproval: { status: 'APPROVED' },
      }),
    )
    mocks.txMediaAssetCount.mockResolvedValueOnce(1)
    mocks.txBookingUpdate.mockResolvedValueOnce({
      id: 'booking_1',
      sessionStep: SessionStep.SERVICE_IN_PROGRESS,
      startedAt: STARTED_AT,
    })

    await expect(
      transitionSessionStep({
        bookingId: 'booking_1',
        professionalId: 'pro_1',
        nextStep: SessionStep.SERVICE_IN_PROGRESS,
        requestId: 'req_service_1',
        idempotencyKey: 'idem_service_1',
      }),
    ).resolves.toMatchObject({
      ok: true,
      booking: {
        id: 'booking_1',
        sessionStep: SessionStep.SERVICE_IN_PROGRESS,
      },
      meta: {
        mutated: true,
        noOp: false,
      },
    })

    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeFinishableBooking({
        sessionStep: SessionStep.SERVICE_IN_PROGRESS,
        consultationApproval: { status: 'APPROVED' },
      }),
    )
    mocks.txMediaAssetCount.mockResolvedValueOnce(0)
    mocks.txBookingUpdate.mockResolvedValueOnce({
      id: 'booking_1',
      status: BookingStatus.ACCEPTED,
      startedAt: STARTED_AT,
      finishedAt: null,
      sessionStep: SessionStep.FINISH_REVIEW,
    })

    await expect(
      finishBookingSession({
        bookingId: 'booking_1',
        professionalId: 'pro_1',
        requestId: 'req_finish_1',
        idempotencyKey: 'idem_finish_1',
      }),
    ).resolves.toMatchObject({
      booking: {
        id: 'booking_1',
        status: BookingStatus.ACCEPTED,
        startedAt: STARTED_AT,
        finishedAt: null,
        sessionStep: SessionStep.FINISH_REVIEW,
      },
      afterCount: 0,
      meta: {
        mutated: true,
        noOp: false,
      },
    })
    const checkoutWithoutAfterPhotos = makeClientCheckoutBooking({
        sessionStep: SessionStep.AFTER_PHOTOS,
        finishedAt: FINISHED_AT,
        selectedPaymentMethod: PaymentMethod.CASH,
        checkoutStatus: BookingCheckoutStatus.READY,
        })

        mocks.txBookingFindUnique
        .mockResolvedValueOnce(checkoutWithoutAfterPhotos)
        .mockResolvedValueOnce(checkoutWithoutAfterPhotos)

        mocks.txBookingUpdate.mockResolvedValueOnce({
        id: 'booking_1',
        checkoutStatus: BookingCheckoutStatus.PAID,
        selectedPaymentMethod: PaymentMethod.CASH,
        serviceSubtotalSnapshot: new Prisma.Decimal(100),
        productSubtotalSnapshot: new Prisma.Decimal(20),
        subtotalSnapshot: new Prisma.Decimal(100),
        tipAmount: new Prisma.Decimal(0),
        taxAmount: new Prisma.Decimal(0),
        discountAmount: new Prisma.Decimal(0),
        totalAmount: new Prisma.Decimal(120),
        paymentAuthorizedAt: TEST_NOW,
        paymentCollectedAt: TEST_NOW,
        })

        mocks.txMediaAssetCount.mockResolvedValueOnce(0)

        const updateCountBeforeCheckoutWithoutAfter =
        mocks.txBookingUpdate.mock.calls.length

        await expect(
        updateClientBookingCheckout({
            bookingId: 'booking_1',
            clientId: 'client_1',
            selectedPaymentMethod: PaymentMethod.CASH,
            checkoutStatus: BookingCheckoutStatus.PAID,
            markPaymentAuthorized: true,
            markPaymentCollected: true,
            requestId: 'req_checkout_without_after_1',
            idempotencyKey: 'idem_checkout_without_after_1',
        }),
        ).resolves.toMatchObject({
        booking: {
            id: 'booking_1',
            checkoutStatus: BookingCheckoutStatus.PAID,
            selectedPaymentMethod: PaymentMethod.CASH,
            paymentAuthorizedAt: TEST_NOW,
            paymentCollectedAt: TEST_NOW,
        },
        meta: {
            mutated: true,
            noOp: false,
        },
        })

        expect(mocks.txBookingUpdate).toHaveBeenCalledTimes(
        updateCountBeforeCheckoutWithoutAfter + 1,
        )

    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeMediaBooking({
        sessionStep: SessionStep.AFTER_PHOTOS,
      }),
    )
    mocks.txMediaAssetCreate.mockResolvedValueOnce(
      makeCreatedMedia({
        id: 'media_after_1',
        phase: MediaPhase.AFTER,
        caption: 'After photo',
        storagePath: 'bookings/booking_1/after.jpg',
      }),
    )

    await expect(
      uploadProBookingMedia(
        makeUploadArgs({
          phase: MediaPhase.AFTER,
          caption: 'After photo',
          storagePath: 'bookings/booking_1/after.jpg',
        }),
      ),
    ).resolves.toMatchObject({
      created: {
        phase: MediaPhase.AFTER,
        visibility: MediaVisibility.PRO_CLIENT,
      },
      advancedTo: null,
      meta: {
        mutated: true,
        noOp: false,
      },
    })

    mocks.txBookingFindUnique
      .mockResolvedValueOnce(
        makeClientCheckoutBooking({
          finishedAt: FINISHED_AT,
          selectedPaymentMethod: PaymentMethod.CASH,
          checkoutStatus: BookingCheckoutStatus.READY,
        }),
      )
      .mockResolvedValueOnce(
        makeClientCheckoutBooking({
          status: BookingStatus.COMPLETED,
          sessionStep: SessionStep.DONE,
          finishedAt: FINISHED_AT,
          selectedPaymentMethod: PaymentMethod.CASH,
          checkoutStatus: BookingCheckoutStatus.PAID,
          paymentAuthorizedAt: TEST_NOW,
          paymentCollectedAt: TEST_NOW,
        }),
      )

    mocks.txMediaAssetCount.mockResolvedValueOnce(1)
    mocks.txBookingUpdate.mockResolvedValueOnce(
      makeClientCheckoutBooking({
        status: BookingStatus.COMPLETED,
        sessionStep: SessionStep.DONE,
        finishedAt: FINISHED_AT,
        selectedPaymentMethod: PaymentMethod.CASH,
        checkoutStatus: BookingCheckoutStatus.PAID,
        paymentAuthorizedAt: TEST_NOW,
        paymentCollectedAt: TEST_NOW,
      }),
    )

    await expect(
      updateClientBookingCheckout({
        bookingId: 'booking_1',
        clientId: 'client_1',
        selectedPaymentMethod: PaymentMethod.CASH,
        checkoutStatus: BookingCheckoutStatus.PAID,
        markPaymentAuthorized: true,
        markPaymentCollected: true,
        requestId: 'req_checkout_1',
        idempotencyKey: 'idem_checkout_1',
      }),
    ).resolves.toMatchObject({
      booking: {
        id: 'booking_1',
        checkoutStatus: BookingCheckoutStatus.PAID,
        selectedPaymentMethod: PaymentMethod.CASH,
      },
      meta: {
        mutated: true,
        noOp: false,
      },
    })

    mocks.txBookingFindUnique.mockResolvedValueOnce(makeReviewEligibleBooking())

    await expect(
      assertClientBookingReviewEligibility({
        bookingId: 'booking_1',
        clientId: 'client_1',
      }),
    ).resolves.toMatchObject({
      booking: {
        id: 'booking_1',
        professionalId: 'pro_1',
        status: BookingStatus.COMPLETED,
        checkoutStatus: BookingCheckoutStatus.PAID,
        paymentCollectedAt: PAYMENT_COLLECTED_AT,
        aftercareSentAt: AFTERCARE_SENT_AT,
      },
      meta: {
        mutated: false,
        noOp: true,
      },
    })

    const aftercareRef = makeAftercareRef()

    mocks.txAftercareSummaryFindUnique
      .mockResolvedValueOnce(aftercareRef)
      .mockResolvedValueOnce(aftercareRef)
      .mockResolvedValueOnce(makeExistingAftercare())

    mocks.txBookingFindFirst
      .mockResolvedValueOnce(makeCompletedSourceBooking())
      .mockResolvedValueOnce(makeExistingRebook())

    await expect(
      createClientRebookedBookingFromAftercare({
        aftercareId: 'aftercare_1',
        bookingId: 'booking_1',
        clientId: 'client_1',
        scheduledFor: REBOOKED_FOR,
        requestId: 'req_rebook_1',
        idempotencyKey: 'idem_rebook_1',
      }),
    ).resolves.toEqual({
      booking: {
        id: 'booking_rebook_1',
        status: BookingStatus.PENDING,
        scheduledFor: REBOOKED_FOR,
      },
      aftercare: {
        id: 'aftercare_1',
        rebookMode: AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
        rebookedFor: REBOOKED_FOR,
      },
      meta: {
        mutated: false,
        noOp: true,
      },
    })
  })

  it('keeps direct DONE transitions blocked so closeout owns completion', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeTransitionBooking({
        sessionStep: SessionStep.AFTER_PHOTOS,
        consultationApproval: { status: 'APPROVED' },
      }),
    )

    const result = await transitionSessionStep({
      bookingId: 'booking_1',
      professionalId: 'pro_1',
      nextStep: SessionStep.DONE,
      requestId: 'req_transition_done',
      idempotencyKey: 'idem_transition_done',
    })

    expect(result).toEqual({
      ok: false,
      status: 409,
      error:
        'Use aftercare and checkout completion before marking the booking done.',
      forcedStep: SessionStep.AFTER_PHOTOS,
      meta: {
        mutated: false,
        noOp: true,
      },
    })

    expect(mocks.txBookingUpdate).not.toHaveBeenCalled()
  })
})