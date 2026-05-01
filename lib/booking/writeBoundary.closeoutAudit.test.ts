// lib/booking/writeBoundary.closeoutAudit.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingCheckoutStatus,
  BookingCloseoutAuditAction,
  BookingStatus,
  MediaPhase,
  PaymentMethod,
  Prisma,
  Role,
  SessionStep,
} from '@prisma/client'

const TEST_NOW = new Date('2026-03-25T16:00:00.000Z')
const SCHEDULED_FOR = new Date('2026-03-25T16:00:00.000Z')
const STARTED_AT = new Date('2026-03-25T15:00:00.000Z')
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

vi.mock('@/lib/notifications/clientNotifications', () => ({
  upsertClientNotification: vi.fn().mockResolvedValue(undefined),
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

function makeStartableBooking(
  overrides?: Partial<{
    status: BookingStatus
    scheduledFor: Date
    startedAt: Date | null
    finishedAt: Date | null
    sessionStep: SessionStep | null
    clientId: string
  }>,
) {
  return {
    id: 'booking_1',
    clientId: overrides?.clientId ?? 'client_1',
    professionalId: 'pro_1',
    status: overrides?.status ?? BookingStatus.ACCEPTED,
    scheduledFor: overrides?.scheduledFor ?? SCHEDULED_FOR,
    startedAt: overrides?.startedAt ?? null,
    finishedAt: overrides?.finishedAt ?? null,
    sessionStep: overrides?.sessionStep ?? SessionStep.NONE,
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
    consultationApproval: overrides?.consultationApproval ?? {
      status: 'APPROVED',
    },
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
    startedAt: overrides?.startedAt ?? null,
    finishedAt: overrides?.finishedAt ?? null,
    sessionStep: overrides?.sessionStep ?? SessionStep.BEFORE_PHOTOS,
    consultationApproval: overrides?.consultationApproval ?? {
      status: 'APPROVED',
    },
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
    finishedAt: overrides?.finishedAt ?? null,
    subtotalSnapshot:
      overrides?.subtotalSnapshot ?? new Prisma.Decimal(100),
    serviceSubtotalSnapshot:
      overrides?.serviceSubtotalSnapshot ?? new Prisma.Decimal(100),
    productSubtotalSnapshot:
      overrides?.productSubtotalSnapshot ?? new Prisma.Decimal(20),
    tipAmount: overrides?.tipAmount ?? new Prisma.Decimal(0),
    taxAmount: overrides?.taxAmount ?? new Prisma.Decimal(0),
    discountAmount: overrides?.discountAmount ?? new Prisma.Decimal(0),
    totalAmount: overrides?.totalAmount ?? new Prisma.Decimal(120),
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

describe('lib/booking/writeBoundary closeout audit behavior', () => {
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
  })

  it('writes SESSION_STARTED audit when startBookingSession starts a booking', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeStartableBooking({
        startedAt: null,
        sessionStep: SessionStep.NONE,
      }),
    )

    mocks.txBookingUpdate.mockResolvedValueOnce({
      id: 'booking_1',
      status: BookingStatus.ACCEPTED,
      startedAt: TEST_NOW,
      finishedAt: null,
      sessionStep: SessionStep.CONSULTATION,
    })

    const result = await startBookingSession({
      bookingId: 'booking_1',
      professionalId: 'pro_1',
      requestId: 'req_start_1',
      idempotencyKey: 'idem_start_1',
    })

    expect(mocks.txBookingUpdate).toHaveBeenCalledWith({
      where: { id: 'booking_1' },
      data: {
        startedAt: TEST_NOW,
        sessionStep: SessionStep.CONSULTATION,
        status: BookingStatus.IN_PROGRESS,
      },
      select: {
        id: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        sessionStep: true,
      },
    })

    expect(mocks.createBookingCloseoutAuditLog).toHaveBeenCalledTimes(1)
    expect(mocks.createBookingCloseoutAuditLog).toHaveBeenCalledWith({
      tx,
      bookingId: 'booking_1',
      professionalId: 'pro_1',
      action: BookingCloseoutAuditAction.SESSION_STARTED,
      route: 'lib/booking/writeBoundary.ts:startBookingSession',
      requestId: 'req_start_1',
      idempotencyKey: 'idem_start_1',
      oldValue: {
        startedAt: null,
        finishedAt: null,
        sessionStep: SessionStep.NONE,
        status: BookingStatus.ACCEPTED,
      },
      newValue: {
        startedAt: TEST_NOW.toISOString(),
        finishedAt: null,
        sessionStep: SessionStep.CONSULTATION,
        status: BookingStatus.ACCEPTED,
      },
    })

    expect(result).toEqual({
      booking: {
        id: 'booking_1',
        status: BookingStatus.ACCEPTED,
        startedAt: TEST_NOW,
        finishedAt: null,
        sessionStep: SessionStep.CONSULTATION,
      },
      meta: {
        mutated: true,
        noOp: false,
      },
    })
  })

  it('writes SESSION_FINISHED and SESSION_STEP_CHANGED audits when finishBookingSession advances to finish review', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeFinishableBooking({
        sessionStep: SessionStep.SERVICE_IN_PROGRESS,
        consultationApproval: { status: 'APPROVED' },
      }),
    )
    mocks.txMediaAssetCount.mockResolvedValueOnce(2)
    mocks.txBookingUpdate.mockResolvedValueOnce({
      id: 'booking_1',
      status: BookingStatus.ACCEPTED,
      startedAt: STARTED_AT,
      finishedAt: null,
      sessionStep: SessionStep.FINISH_REVIEW,
    })

    const result = await finishBookingSession({
      bookingId: 'booking_1',
      professionalId: 'pro_1',
      requestId: 'req_finish_1',
      idempotencyKey: 'idem_finish_1',
    })

    expect(mocks.txMediaAssetCount).toHaveBeenCalledWith({
      where: {
        bookingId: 'booking_1',
        phase: MediaPhase.AFTER,
        uploadedByRole: Role.PRO,
      },
    })

    expect(mocks.txBookingUpdate).toHaveBeenCalledWith({
      where: { id: 'booking_1' },
      data: { sessionStep: SessionStep.FINISH_REVIEW },
      select: {
        id: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        sessionStep: true,
      },
    })

    expect(mocks.createBookingCloseoutAuditLog).toHaveBeenCalledTimes(2)

    expect(mocks.createBookingCloseoutAuditLog).toHaveBeenNthCalledWith(1, {
      tx,
      bookingId: 'booking_1',
      professionalId: 'pro_1',
      action: BookingCloseoutAuditAction.SESSION_FINISHED,
      route: 'lib/booking/writeBoundary.ts:finishBookingSession',
      requestId: 'req_finish_1',
      idempotencyKey: 'idem_finish_1',
      oldValue: {
        status: BookingStatus.ACCEPTED,
        startedAt: STARTED_AT.toISOString(),
        finishedAt: null,
        sessionStep: SessionStep.SERVICE_IN_PROGRESS,
      },
      newValue: {
        status: BookingStatus.ACCEPTED,
        startedAt: STARTED_AT.toISOString(),
        finishedAt: null,
        sessionStep: SessionStep.FINISH_REVIEW,
      },
      metadata: {
        previousStep: SessionStep.SERVICE_IN_PROGRESS,
        nextStep: SessionStep.FINISH_REVIEW,
        afterCount: 2,
      },
    })

    expect(mocks.createBookingCloseoutAuditLog).toHaveBeenNthCalledWith(2, {
      tx,
      bookingId: 'booking_1',
      professionalId: 'pro_1',
      action: BookingCloseoutAuditAction.SESSION_STEP_CHANGED,
      route: 'lib/booking/writeBoundary.ts:finishBookingSession',
      requestId: 'req_finish_1',
      idempotencyKey: 'idem_finish_1',
      oldValue: {
        sessionStep: SessionStep.SERVICE_IN_PROGRESS,
      },
      newValue: {
        sessionStep: SessionStep.FINISH_REVIEW,
      },
      metadata: {
        trigger: 'finish_booking_session',
        afterCount: 2,
      },
    })

    expect(result).toEqual({
      booking: {
        id: 'booking_1',
        status: BookingStatus.ACCEPTED,
        startedAt: STARTED_AT,
        finishedAt: null,
        sessionStep: SessionStep.FINISH_REVIEW,
      },
      afterCount: 2,
      meta: {
        mutated: true,
        noOp: false,
      },
    })
  })

  it('writes SESSION_STARTED and SESSION_STEP_CHANGED audits when transitionSessionStep implicitly starts service', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeTransitionBooking({
        startedAt: null,
        sessionStep: SessionStep.BEFORE_PHOTOS,
        consultationApproval: { status: 'APPROVED' },
      }),
    )

    mocks.txMediaAssetCount.mockResolvedValueOnce(1)

    mocks.txBookingUpdate.mockResolvedValueOnce({
      id: 'booking_1',
      status: BookingStatus.ACCEPTED,
      sessionStep: SessionStep.SERVICE_IN_PROGRESS,
      startedAt: TEST_NOW,
      finishedAt: null,
    })

    const result = await transitionSessionStep({
      bookingId: 'booking_1',
      professionalId: 'pro_1',
      nextStep: SessionStep.SERVICE_IN_PROGRESS,
      requestId: 'req_transition_1',
      idempotencyKey: 'idem_transition_1',
    })

    expect(mocks.txMediaAssetCount).toHaveBeenCalledWith({
      where: {
        bookingId: 'booking_1',
        phase: MediaPhase.BEFORE,
        uploadedByRole: Role.PRO,
      },
    })

    expect(mocks.txBookingUpdate).toHaveBeenCalledWith({
      where: { id: 'booking_1' },
      data: {
        sessionStep: SessionStep.SERVICE_IN_PROGRESS,
        startedAt: TEST_NOW,
        status: BookingStatus.IN_PROGRESS,
      },
      select: {
        id: true,
        status: true,
        sessionStep: true,
        startedAt: true,
        finishedAt: true,
      },
    })

    expect(mocks.createBookingCloseoutAuditLog).toHaveBeenCalledTimes(2)

    expect(mocks.createBookingCloseoutAuditLog).toHaveBeenNthCalledWith(1, {
      tx,
      bookingId: 'booking_1',
      professionalId: 'pro_1',
      action: BookingCloseoutAuditAction.SESSION_STARTED,
      route: 'lib/booking/writeBoundary.ts:transitionSessionStep',
      requestId: 'req_transition_1',
      idempotencyKey: 'idem_transition_1',
      oldValue: {
        status: BookingStatus.ACCEPTED,
        startedAt: null,
        finishedAt: null,
        sessionStep: SessionStep.BEFORE_PHOTOS,
      },
      newValue: {
        status: BookingStatus.ACCEPTED,
        startedAt: TEST_NOW.toISOString(),
        finishedAt: null,
        sessionStep: SessionStep.SERVICE_IN_PROGRESS,
      },
      metadata: {
        trigger: 'implicit_start_from_session_step_transition',
        previousStep: SessionStep.BEFORE_PHOTOS,
        nextStep: SessionStep.SERVICE_IN_PROGRESS,
      },
    })

    expect(mocks.createBookingCloseoutAuditLog).toHaveBeenNthCalledWith(2, {
      tx,
      bookingId: 'booking_1',
      professionalId: 'pro_1',
      action: BookingCloseoutAuditAction.SESSION_STEP_CHANGED,
      route: 'lib/booking/writeBoundary.ts:transitionSessionStep',
      requestId: 'req_transition_1',
      idempotencyKey: 'idem_transition_1',
      oldValue: {
        sessionStep: SessionStep.BEFORE_PHOTOS,
      },
      newValue: {
        sessionStep: SessionStep.SERVICE_IN_PROGRESS,
      },
      metadata: {
        previousStep: SessionStep.BEFORE_PHOTOS,
        nextStep: SessionStep.SERVICE_IN_PROGRESS,
        implicitStart: true,
      },
    })

    expect(result).toEqual({
      ok: true,
      booking: {
        id: 'booking_1',
        sessionStep: SessionStep.SERVICE_IN_PROGRESS,
        startedAt: TEST_NOW,
      },
      meta: {
        mutated: true,
        noOp: false,
      },
    })
  })

  it('writes checkout and payment audit rows when client checkout confirms payment', async () => {
    const booking = makeClientCheckoutBooking({
      finishedAt: null,
      selectedPaymentMethod: PaymentMethod.CASH,
      checkoutStatus: BookingCheckoutStatus.READY,
      paymentAuthorizedAt: null,
      paymentCollectedAt: null,
      tipAmount: new Prisma.Decimal(0),
      totalAmount: new Prisma.Decimal(120),
    })

    mocks.txBookingFindUnique
      .mockResolvedValueOnce(booking)
      .mockResolvedValueOnce(booking)

    mocks.txBookingUpdate.mockResolvedValueOnce({
      id: 'booking_1',
      checkoutStatus: BookingCheckoutStatus.PAID,
      selectedPaymentMethod: PaymentMethod.ZELLE,
      serviceSubtotalSnapshot: new Prisma.Decimal(100),
      productSubtotalSnapshot: new Prisma.Decimal(20),
      subtotalSnapshot: new Prisma.Decimal(100),
      tipAmount: new Prisma.Decimal(10),
      taxAmount: new Prisma.Decimal(0),
      discountAmount: new Prisma.Decimal(0),
      totalAmount: new Prisma.Decimal(130),
      paymentAuthorizedAt: TEST_NOW,
      paymentCollectedAt: TEST_NOW,
    })

    const result = await updateClientBookingCheckout({
      bookingId: 'booking_1',
      clientId: 'client_1',
      tipAmount: '10.00',
      selectedPaymentMethod: PaymentMethod.ZELLE,
      checkoutStatus: BookingCheckoutStatus.PAID,
      markPaymentAuthorized: true,
      markPaymentCollected: true,
      requestId: 'req_checkout_1',
      idempotencyKey: 'idem_checkout_1',
    })

    expect(mocks.txBookingUpdate).toHaveBeenCalledTimes(1)
    expect(mocks.createBookingCloseoutAuditLog).toHaveBeenCalledTimes(4)

    const actions = mocks.createBookingCloseoutAuditLog.mock.calls.map(
      (call) => call[0]?.action,
    )

    expect(actions).toEqual([
      BookingCloseoutAuditAction.CHECKOUT_UPDATED,
      BookingCloseoutAuditAction.PAYMENT_METHOD_UPDATED,
      BookingCloseoutAuditAction.PAYMENT_AUTHORIZED,
      BookingCloseoutAuditAction.PAYMENT_COLLECTED,
    ])

    expect(mocks.createBookingCloseoutAuditLog).toHaveBeenNthCalledWith(1, {
      tx,
      bookingId: 'booking_1',
      professionalId: 'pro_1',
      action: BookingCloseoutAuditAction.CHECKOUT_UPDATED,
      route: 'lib/booking/writeBoundary.ts:updateClientBookingCheckout',
      requestId: 'req_checkout_1',
      idempotencyKey: 'idem_checkout_1',
      oldValue: {
        checkoutStatus: BookingCheckoutStatus.READY,
        selectedPaymentMethod: PaymentMethod.CASH,
        serviceSubtotalSnapshot: '100.00',
        productSubtotalSnapshot: '20.00',
        subtotalSnapshot: '100.00',
        tipAmount: '0.00',
        taxAmount: '0.00',
        discountAmount: '0.00',
        totalAmount: '120.00',
        paymentAuthorizedAt: null,
        paymentCollectedAt: null,
      },
      newValue: {
        checkoutStatus: BookingCheckoutStatus.PAID,
        selectedPaymentMethod: PaymentMethod.ZELLE,
        serviceSubtotalSnapshot: '100.00',
        productSubtotalSnapshot: '20.00',
        subtotalSnapshot: '100.00',
        tipAmount: '10.00',
        taxAmount: '0.00',
        discountAmount: '0.00',
        totalAmount: '130.00',
        paymentAuthorizedAt: TEST_NOW.toISOString(),
        paymentCollectedAt: TEST_NOW.toISOString(),
      },
    })

    expect(mocks.createBookingCloseoutAuditLog).toHaveBeenNthCalledWith(2, {
      tx,
      bookingId: 'booking_1',
      professionalId: 'pro_1',
      action: BookingCloseoutAuditAction.PAYMENT_METHOD_UPDATED,
      route: 'lib/booking/writeBoundary.ts:updateClientBookingCheckout',
      requestId: 'req_checkout_1',
      idempotencyKey: 'idem_checkout_1',
      oldValue: {
        selectedPaymentMethod: PaymentMethod.CASH,
      },
      newValue: {
        selectedPaymentMethod: PaymentMethod.ZELLE,
      },
    })

    expect(mocks.createBookingCloseoutAuditLog).toHaveBeenNthCalledWith(3, {
      tx,
      bookingId: 'booking_1',
      professionalId: 'pro_1',
      action: BookingCloseoutAuditAction.PAYMENT_AUTHORIZED,
      route: 'lib/booking/writeBoundary.ts:updateClientBookingCheckout',
      requestId: 'req_checkout_1',
      idempotencyKey: 'idem_checkout_1',
      oldValue: {
        paymentAuthorizedAt: null,
        checkoutStatus: BookingCheckoutStatus.READY,
        totalAmount: '120.00',
      },
      newValue: {
        paymentAuthorizedAt: TEST_NOW.toISOString(),
        checkoutStatus: BookingCheckoutStatus.PAID,
        totalAmount: '130.00',
      },
    })

    expect(mocks.createBookingCloseoutAuditLog).toHaveBeenNthCalledWith(4, {
      tx,
      bookingId: 'booking_1',
      professionalId: 'pro_1',
      action: BookingCloseoutAuditAction.PAYMENT_COLLECTED,
      route: 'lib/booking/writeBoundary.ts:updateClientBookingCheckout',
      requestId: 'req_checkout_1',
      idempotencyKey: 'idem_checkout_1',
      oldValue: {
        paymentCollectedAt: null,
        checkoutStatus: BookingCheckoutStatus.READY,
        totalAmount: '120.00',
      },
      newValue: {
        paymentCollectedAt: TEST_NOW.toISOString(),
        checkoutStatus: BookingCheckoutStatus.PAID,
        totalAmount: '130.00',
      },
    })

    expect(result).toEqual({
      booking: {
        id: 'booking_1',
        checkoutStatus: BookingCheckoutStatus.PAID,
        selectedPaymentMethod: PaymentMethod.ZELLE,
        serviceSubtotalSnapshot: new Prisma.Decimal(100),
        productSubtotalSnapshot: new Prisma.Decimal(20),
        subtotalSnapshot: new Prisma.Decimal(100),
        tipAmount: new Prisma.Decimal(10),
        taxAmount: new Prisma.Decimal(0),
        discountAmount: new Prisma.Decimal(0),
        totalAmount: new Prisma.Decimal(130),
        paymentAuthorizedAt: TEST_NOW,
        paymentCollectedAt: TEST_NOW,
      },
      meta: {
        mutated: true,
        noOp: false,
      },
    })
  })
})