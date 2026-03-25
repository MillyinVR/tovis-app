// lib/booking/writeBoundary.idempotency.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingCheckoutStatus,
  BookingStatus,
  PaymentMethod,
  Prisma,
  SessionStep,
} from '@prisma/client'

const TEST_NOW = new Date('2026-03-25T16:00:00.000Z')
const SCHEDULED_FOR = new Date('2026-03-25T16:00:00.000Z')
const STARTED_AT = new Date('2026-03-25T15:00:00.000Z')
const FINISHED_AT = new Date('2026-03-25T15:30:00.000Z')
const AFTERCARE_SENT_AT = new Date('2026-03-25T15:45:00.000Z')

const mocks = vi.hoisted(() => ({
  prismaTransaction: vi.fn(),
  prismaBookingFindUnique: vi.fn(),

  withLockedProfessionalTransaction: vi.fn(),
  withLockedClientOwnedBookingTransaction: vi.fn(),

  txBookingFindUnique: vi.fn(),
  txBookingUpdate: vi.fn(),
  txMediaAssetCount: vi.fn(),

  createBookingCloseoutAuditLog: vi.fn(),
  areAuditValuesEqual: vi.fn(),
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

vi.mock('@/lib/booking/closeoutAudit', () => ({
  createBookingCloseoutAuditLog: mocks.createBookingCloseoutAuditLog,
  areAuditValuesEqual: mocks.areAuditValuesEqual,
}))

import {
  finishBookingSession,
  startBookingSession,
  transitionSessionStep,
  updateClientBookingCheckout,
} from './writeBoundary'

const tx = {
  booking: {
    findUnique: mocks.txBookingFindUnique,
    update: mocks.txBookingUpdate,
  },
  mediaAsset: {
    count: mocks.txMediaAssetCount,
  },
}

function makeStartedBooking(
  overrides?: Partial<{
    status: BookingStatus
    startedAt: Date | null
    finishedAt: Date | null
    sessionStep: SessionStep | null
  }>,
) {
  return {
    id: 'booking_1',
    professionalId: 'pro_1',
    status: overrides?.status ?? BookingStatus.ACCEPTED,
    scheduledFor: SCHEDULED_FOR,
    startedAt: overrides?.startedAt ?? STARTED_AT,
    finishedAt: overrides?.finishedAt ?? null,
    sessionStep: overrides?.sessionStep ?? SessionStep.CONSULTATION,
  }
}

function makeTransitionBooking(
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
    sessionStep: overrides?.sessionStep ?? SessionStep.BEFORE_PHOTOS,
    consultationApproval: overrides?.consultationApproval ?? null,
  }
}

function makeClientCheckoutBooking(
  overrides?: Partial<{
    clientId: string
    professionalId: string
    status: BookingStatus
    sessionStep: SessionStep
    finishedAt: Date | null
    subtotalSnapshot: Prisma.Decimal | null
    serviceSubtotalSnapshot: Prisma.Decimal | null
    productSubtotalSnapshot: Prisma.Decimal | null
    tipAmount: Prisma.Decimal | null
    taxAmount: Prisma.Decimal | null
    discountAmount: Prisma.Decimal | null
    totalAmount: Prisma.Decimal | null
    checkoutStatus: BookingCheckoutStatus
    selectedPaymentMethod: PaymentMethod | null
    paymentAuthorizedAt: Date | null
    paymentCollectedAt: Date | null
    aftercareSummary: { id: string; sentToClientAt: Date | null } | null
    productSales: Array<{
      unitPrice: Prisma.Decimal | null
      quantity: number | null
    }>
  }>,
) {
  return {
    id: 'booking_1',
    clientId: overrides?.clientId ?? 'client_1',
    professionalId: overrides?.professionalId ?? 'pro_1',
    status: overrides?.status ?? BookingStatus.ACCEPTED,
    sessionStep: overrides?.sessionStep ?? SessionStep.AFTER_PHOTOS,
    finishedAt: overrides?.finishedAt ?? FINISHED_AT,
    subtotalSnapshot:
      overrides?.subtotalSnapshot ?? new Prisma.Decimal(100),
    serviceSubtotalSnapshot:
      overrides?.serviceSubtotalSnapshot ?? new Prisma.Decimal(100),
    productSubtotalSnapshot:
      overrides?.productSubtotalSnapshot ?? new Prisma.Decimal(20),
    tipAmount: overrides?.tipAmount ?? new Prisma.Decimal(15),
    taxAmount: overrides?.taxAmount ?? new Prisma.Decimal(0),
    discountAmount: overrides?.discountAmount ?? new Prisma.Decimal(0),
    totalAmount: overrides?.totalAmount ?? new Prisma.Decimal(135),
    checkoutStatus: overrides?.checkoutStatus ?? BookingCheckoutStatus.READY,
    selectedPaymentMethod:
      overrides?.selectedPaymentMethod ?? PaymentMethod.CASH,
    paymentAuthorizedAt: overrides?.paymentAuthorizedAt ?? null,
    paymentCollectedAt: overrides?.paymentCollectedAt ?? null,
    aftercareSummary:
      overrides?.aftercareSummary ?? {
        id: 'aftercare_1',
        sentToClientAt: AFTERCARE_SENT_AT,
      },
    productSales: overrides?.productSales ?? [
      {
        unitPrice: new Prisma.Decimal(10),
        quantity: 2,
      },
    ],
  }
}

describe('lib/booking/writeBoundary idempotency', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(TEST_NOW)

    mocks.areAuditValuesEqual.mockImplementation(
      (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b),
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
  })

  it('returns a no-op when startBookingSession is retried after the session already started', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeStartedBooking({
        sessionStep: SessionStep.CONSULTATION,
      }),
    )

    const result = await startBookingSession({
      bookingId: 'booking_1',
      professionalId: 'pro_1',
      requestId: 'req_start_retry',
      idempotencyKey: 'idem_start_retry',
    })

    expect(mocks.withLockedProfessionalTransaction).toHaveBeenCalledWith(
      'pro_1',
      expect.any(Function),
    )

    expect(mocks.txBookingUpdate).not.toHaveBeenCalled()
    expect(mocks.createBookingCloseoutAuditLog).not.toHaveBeenCalled()

    expect(result).toEqual({
      booking: {
        id: 'booking_1',
        status: BookingStatus.ACCEPTED,
        startedAt: STARTED_AT,
        finishedAt: null,
        sessionStep: SessionStep.CONSULTATION,
      },
      meta: {
        mutated: false,
        noOp: true,
      },
    })
  })

  it('returns a no-op when finishBookingSession is retried after wrap-up already advanced', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeStartedBooking({
        sessionStep: SessionStep.AFTER_PHOTOS,
      }),
    )
    mocks.txMediaAssetCount.mockResolvedValueOnce(2)

    const result = await finishBookingSession({
      bookingId: 'booking_1',
      professionalId: 'pro_1',
      requestId: 'req_finish_retry',
      idempotencyKey: 'idem_finish_retry',
    })

    expect(mocks.withLockedProfessionalTransaction).toHaveBeenCalledWith(
      'pro_1',
      expect.any(Function),
    )

    expect(mocks.txMediaAssetCount).toHaveBeenCalledWith({
      where: {
        bookingId: 'booking_1',
        phase: 'AFTER',
        uploadedByRole: 'PRO',
      },
    })

    expect(mocks.txBookingUpdate).not.toHaveBeenCalled()
    expect(mocks.createBookingCloseoutAuditLog).not.toHaveBeenCalled()

    expect(result).toEqual({
      booking: {
        id: 'booking_1',
        status: BookingStatus.ACCEPTED,
        startedAt: STARTED_AT,
        finishedAt: null,
        sessionStep: SessionStep.AFTER_PHOTOS,
      },
      afterCount: 2,
      meta: {
        mutated: false,
        noOp: true,
      },
    })
  })

  it('returns a no-op when transitionSessionStep is asked to move to the current step', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeTransitionBooking({
        sessionStep: SessionStep.BEFORE_PHOTOS,
      }),
    )

    const result = await transitionSessionStep({
      bookingId: 'booking_1',
      professionalId: 'pro_1',
      nextStep: SessionStep.BEFORE_PHOTOS,
      requestId: 'req_transition_retry',
      idempotencyKey: 'idem_transition_retry',
    })

    expect(mocks.withLockedProfessionalTransaction).toHaveBeenCalledWith(
      'pro_1',
      expect.any(Function),
    )

    expect(mocks.txBookingUpdate).not.toHaveBeenCalled()
    expect(mocks.txMediaAssetCount).not.toHaveBeenCalled()
    expect(mocks.createBookingCloseoutAuditLog).not.toHaveBeenCalled()

    expect(result).toEqual({
      ok: true,
      booking: {
        id: 'booking_1',
        sessionStep: SessionStep.BEFORE_PHOTOS,
        startedAt: STARTED_AT,
      },
      meta: {
        mutated: false,
        noOp: true,
      },
    })
  })

  it('returns a no-op when updateClientBookingCheckout receives the same effective checkout state', async () => {
    const booking = makeClientCheckoutBooking({
      tipAmount: new Prisma.Decimal(15),
      selectedPaymentMethod: PaymentMethod.CASH,
      checkoutStatus: BookingCheckoutStatus.READY,
      paymentAuthorizedAt: null,
      paymentCollectedAt: null,
    })

    mocks.txBookingFindUnique
      .mockResolvedValueOnce(booking)
      .mockResolvedValueOnce(booking)

    const result = await updateClientBookingCheckout({
      bookingId: 'booking_1',
      clientId: 'client_1',
      tipAmount: '15.00',
      selectedPaymentMethod: PaymentMethod.CASH,
      requestId: 'req_checkout_retry',
      idempotencyKey: 'idem_checkout_retry',
    })

    expect(
      mocks.withLockedClientOwnedBookingTransaction,
    ).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      clientId: 'client_1',
      run: expect.any(Function),
    })

    expect(mocks.txBookingFindUnique).toHaveBeenCalledTimes(2)
    expect(mocks.txBookingUpdate).not.toHaveBeenCalled()
    expect(mocks.createBookingCloseoutAuditLog).not.toHaveBeenCalled()

    expect(result).toEqual({
      booking: {
        id: 'booking_1',
        checkoutStatus: BookingCheckoutStatus.READY,
        selectedPaymentMethod: PaymentMethod.CASH,
        serviceSubtotalSnapshot: new Prisma.Decimal(100),
        productSubtotalSnapshot: new Prisma.Decimal(20),
        subtotalSnapshot: new Prisma.Decimal(100),
        tipAmount: new Prisma.Decimal(15),
        taxAmount: new Prisma.Decimal(0),
        discountAmount: new Prisma.Decimal(0),
        totalAmount: new Prisma.Decimal(135),
        paymentAuthorizedAt: null,
        paymentCollectedAt: null,
      },
      meta: {
        mutated: false,
        noOp: true,
      },
    })
  })
})