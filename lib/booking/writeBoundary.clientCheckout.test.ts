// lib/booking/writeBoundary.clientCheckout.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingCheckoutStatus,
  BookingStatus,
  PaymentMethod,
  Prisma,
  SessionStep,
} from '@prisma/client'

const TEST_NOW = new Date('2026-03-25T16:00:00.000Z')
const FINISHED_AT = new Date('2026-03-25T15:30:00.000Z')
const AFTERCARE_SENT_AT = new Date('2026-03-25T15:45:00.000Z')

const mocks = vi.hoisted(() => ({
  prismaTransaction: vi.fn(),
  prismaBookingFindUnique: vi.fn(),

  withLockedProfessionalTransaction: vi.fn(),
  withLockedClientOwnedBookingTransaction: vi.fn(),

  txBookingFindUnique: vi.fn(),
  txBookingUpdate: vi.fn(),
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

import { updateClientBookingCheckout } from './writeBoundary'

const tx = {
  booking: {
    findUnique: mocks.txBookingFindUnique,
    update: mocks.txBookingUpdate,
  },
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
    tipAmount: overrides?.tipAmount ?? new Prisma.Decimal(0),
    taxAmount: overrides?.taxAmount ?? new Prisma.Decimal(0),
    discountAmount: overrides?.discountAmount ?? new Prisma.Decimal(0),
    totalAmount: overrides?.totalAmount ?? new Prisma.Decimal(120),
    checkoutStatus: overrides?.checkoutStatus ?? BookingCheckoutStatus.READY,
    selectedPaymentMethod: overrides?.selectedPaymentMethod ?? null,
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

describe('lib/booking/writeBoundary updateClientBookingCheckout', () => {
  beforeEach(() => {
    vi.resetAllMocks()
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
  })

  it('updates tip and payment method through the locked client-owned booking transaction', async () => {
    const booking = makeClientCheckoutBooking()

    mocks.txBookingFindUnique
      .mockResolvedValueOnce(booking)
      .mockResolvedValueOnce(booking)

    mocks.txBookingUpdate.mockResolvedValueOnce({
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
    })

    const result = await updateClientBookingCheckout({
      bookingId: 'booking_1',
      clientId: 'client_1',
      tipAmount: '15.00',
      selectedPaymentMethod: PaymentMethod.CASH,
    })

    expect(
      mocks.withLockedClientOwnedBookingTransaction,
    ).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      clientId: 'client_1',
      run: expect.any(Function),
    })

    expect(mocks.txBookingFindUnique).toHaveBeenCalledTimes(2)

    const updateArgs = mocks.txBookingUpdate.mock.calls[0]?.[0]
    expect(updateArgs.where).toEqual({ id: 'booking_1' })
    expect(updateArgs.data.selectedPaymentMethod).toBe(PaymentMethod.CASH)

    expect(updateArgs.data.serviceSubtotalSnapshot.toString()).toBe('100')
    expect(updateArgs.data.productSubtotalSnapshot.toString()).toBe('20')
    expect(updateArgs.data.subtotalSnapshot.toString()).toBe('100')
    expect(updateArgs.data.tipAmount.toString()).toBe('15')
    expect(updateArgs.data.taxAmount.toString()).toBe('0')
    expect(updateArgs.data.discountAmount.toString()).toBe('0')
    expect(updateArgs.data.totalAmount.toString()).toBe('135')

    expect(updateArgs.data.paymentAuthorizedAt).toBeUndefined()
    expect(updateArgs.data.paymentCollectedAt).toBeUndefined()

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
        mutated: true,
        noOp: false,
      },
    })
  })

  it('confirms payment, marks timestamps, and completes booking closeout when eligible', async () => {
    const booking = makeClientCheckoutBooking({
      status: BookingStatus.ACCEPTED,
      sessionStep: SessionStep.AFTER_PHOTOS,
      finishedAt: FINISHED_AT,
      selectedPaymentMethod: null,
    })

    mocks.txBookingFindUnique
      .mockResolvedValueOnce(booking)
      .mockResolvedValueOnce(booking)

    mocks.txBookingUpdate
      .mockResolvedValueOnce({
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
      .mockResolvedValueOnce({
        id: 'booking_1',
      })

    const result = await updateClientBookingCheckout({
      bookingId: 'booking_1',
      clientId: 'client_1',
      tipAmount: '10.00',
      selectedPaymentMethod: PaymentMethod.ZELLE,
      checkoutStatus: BookingCheckoutStatus.PAID,
      markPaymentAuthorized: true,
      markPaymentCollected: true,
    })

    expect(mocks.txBookingUpdate).toHaveBeenCalledTimes(2)

    const checkoutUpdateArgs = mocks.txBookingUpdate.mock.calls[0]?.[0]
    expect(checkoutUpdateArgs.where).toEqual({ id: 'booking_1' })
    expect(checkoutUpdateArgs.data.selectedPaymentMethod).toBe(
      PaymentMethod.ZELLE,
    )
    expect(checkoutUpdateArgs.data.checkoutStatus).toBe(
      BookingCheckoutStatus.PAID,
    )
    expect(checkoutUpdateArgs.data.paymentAuthorizedAt).toEqual(TEST_NOW)
    expect(checkoutUpdateArgs.data.paymentCollectedAt).toEqual(TEST_NOW)

    const completionUpdateArgs = mocks.txBookingUpdate.mock.calls[1]?.[0]
    expect(completionUpdateArgs).toEqual({
      where: { id: 'booking_1' },
      data: {
        status: BookingStatus.COMPLETED,
        sessionStep: SessionStep.DONE,
        finishedAt: FINISHED_AT,
      },
      select: { id: true },
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

  it('rejects checkout updates before aftercare is finalized', async () => {
  const booking = makeClientCheckoutBooking({
    aftercareSummary: {
      id: 'aftercare_1',
      sentToClientAt: null,
    },
  })

  mocks.txBookingFindUnique.mockResolvedValue(booking)

  await expect(
    updateClientBookingCheckout({
      bookingId: 'booking_1',
      clientId: 'client_1',
      tipAmount: '5.00',
      selectedPaymentMethod: PaymentMethod.CASH,
    }),
  ).rejects.toMatchObject({
    code: 'FORBIDDEN',
  })

  expect(mocks.txBookingUpdate).not.toHaveBeenCalled()
})

  it('rejects confirming payment without a payment method', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeClientCheckoutBooking({
        selectedPaymentMethod: null,
      }),
    )

    await expect(
      updateClientBookingCheckout({
        bookingId: 'booking_1',
        clientId: 'client_1',
        markPaymentCollected: true,
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })

    expect(mocks.txBookingUpdate).not.toHaveBeenCalled()
  })

  it('rejects checkout edits after payment was already collected', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeClientCheckoutBooking({
        paymentCollectedAt: TEST_NOW,
        checkoutStatus: BookingCheckoutStatus.PAID,
      }),
    )

    await expect(
      updateClientBookingCheckout({
        bookingId: 'booking_1',
        clientId: 'client_1',
        tipAmount: '7.00',
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })

    expect(mocks.txBookingUpdate).not.toHaveBeenCalled()
  })
})