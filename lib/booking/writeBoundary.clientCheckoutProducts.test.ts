// lib/booking/writeBoundary.clientCheckoutProducts.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingCheckoutStatus,
  BookingStatus,
  Prisma,
  SessionStep,
} from '@prisma/client'

const TEST_NOW = new Date('2026-04-12T18:00:00.000Z')
const AFTERCARE_SENT_AT = new Date('2026-04-12T17:30:00.000Z')

const mocks = vi.hoisted(() => ({
  prismaTransaction: vi.fn(),
  prismaBookingFindUnique: vi.fn(),

  withLockedClientOwnedBookingTransaction: vi.fn(),

  txBookingFindUnique: vi.fn(),
  txBookingUpdate: vi.fn(),

  txCheckoutProductItemDeleteMany: vi.fn(),
  txCheckoutProductItemCreateMany: vi.fn(),

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
  withLockedClientOwnedBookingTransaction:
    mocks.withLockedClientOwnedBookingTransaction,
}))

vi.mock('@/lib/booking/closeoutAudit', () => ({
  createBookingCloseoutAuditLog: mocks.createBookingCloseoutAuditLog,
  areAuditValuesEqual: mocks.areAuditValuesEqual,
}))

import { upsertClientBookingCheckoutProducts } from './writeBoundary'

const tx = {
  booking: {
    findUnique: mocks.txBookingFindUnique,
    update: mocks.txBookingUpdate,
  },
  checkoutProductItem: {
    deleteMany: mocks.txCheckoutProductItemDeleteMany,
    createMany: mocks.txCheckoutProductItemCreateMany,
  },
}

function makeBooking(
  overrides?: Partial<{
    clientId: string
    professionalId: string
    status: BookingStatus
    sessionStep: SessionStep
    finishedAt: Date | null
    checkoutStatus: BookingCheckoutStatus
    paymentAuthorizedAt: Date | null
    paymentCollectedAt: Date | null
    aftercareSummary: { id: string; sentToClientAt: Date | null } | null
  }>,
) {
  return {
    id: 'booking_1',
    clientId: overrides?.clientId ?? 'client_1',
    professionalId: overrides?.professionalId ?? 'pro_1',
    status: overrides?.status ?? BookingStatus.ACCEPTED,
    sessionStep: overrides?.sessionStep ?? SessionStep.AFTER_PHOTOS,
    finishedAt: overrides?.finishedAt ?? null,

    checkoutStatus: overrides?.checkoutStatus ?? BookingCheckoutStatus.READY,
    paymentAuthorizedAt: overrides?.paymentAuthorizedAt ?? null,
    paymentCollectedAt: overrides?.paymentCollectedAt ?? null,

    serviceSubtotalSnapshot: new Prisma.Decimal(100),
    productSubtotalSnapshot: new Prisma.Decimal(0),
    subtotalSnapshot: new Prisma.Decimal(100),
    tipAmount: new Prisma.Decimal(0),
    taxAmount: new Prisma.Decimal(0),
    discountAmount: new Prisma.Decimal(0),
    totalAmount: new Prisma.Decimal(100),

    aftercareSummary:
      overrides && 'aftercareSummary' in overrides
        ? overrides.aftercareSummary
        : {
            id: 'aftercare_1',
            sentToClientAt: AFTERCARE_SENT_AT,
          },

    checkoutProductItems: [],
    aftercareProductRecommendations: [],
    productSales: [],
  }
}

function makeArgs() {
  return {
    bookingId: 'booking_1',
    clientId: 'client_1',
    items: [
      {
        recommendationId: 'rec_1',
        productId: 'product_1',
        quantity: 1,
      },
    ],
    requestId: 'req_products_1',
    idempotencyKey: 'idem_products_1',
  }
}

describe('lib/booking/writeBoundary upsertClientBookingCheckoutProducts lifecycle guards', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(TEST_NOW)

    mocks.areAuditValuesEqual.mockImplementation(
      (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b),
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

  it('rejects product edits when aftercare is missing', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeBooking({
        aftercareSummary: null,
      }),
    )

    await expect(
      upsertClientBookingCheckoutProducts(makeArgs()),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })

    expect(mocks.txBookingUpdate).not.toHaveBeenCalled()
    expect(mocks.txCheckoutProductItemDeleteMany).not.toHaveBeenCalled()
    expect(mocks.txCheckoutProductItemCreateMany).not.toHaveBeenCalled()
  })

  it('rejects product edits when aftercare is only a draft', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeBooking({
        aftercareSummary: {
          id: 'aftercare_1',
          sentToClientAt: null,
        },
      }),
    )

    await expect(
      upsertClientBookingCheckoutProducts(makeArgs()),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })

    expect(mocks.txBookingUpdate).not.toHaveBeenCalled()
    expect(mocks.txCheckoutProductItemDeleteMany).not.toHaveBeenCalled()
    expect(mocks.txCheckoutProductItemCreateMany).not.toHaveBeenCalled()
  })

  it('rejects product edits after payment authorization starts', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeBooking({
        paymentAuthorizedAt: TEST_NOW,
        checkoutStatus: BookingCheckoutStatus.READY,
      }),
    )

    await expect(
      upsertClientBookingCheckoutProducts(makeArgs()),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })

    expect(mocks.txBookingUpdate).not.toHaveBeenCalled()
    expect(mocks.txCheckoutProductItemDeleteMany).not.toHaveBeenCalled()
    expect(mocks.txCheckoutProductItemCreateMany).not.toHaveBeenCalled()
  })

  it('rejects product edits after payment is collected', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeBooking({
        paymentAuthorizedAt: TEST_NOW,
        paymentCollectedAt: TEST_NOW,
        checkoutStatus: BookingCheckoutStatus.PAID,
      }),
    )

    await expect(
      upsertClientBookingCheckoutProducts(makeArgs()),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })

    expect(mocks.txBookingUpdate).not.toHaveBeenCalled()
    expect(mocks.txCheckoutProductItemDeleteMany).not.toHaveBeenCalled()
    expect(mocks.txCheckoutProductItemCreateMany).not.toHaveBeenCalled()
  })

  it('rejects product edits when checkout is partially paid', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeBooking({
        checkoutStatus: BookingCheckoutStatus.PARTIALLY_PAID,
      }),
    )

    await expect(
      upsertClientBookingCheckoutProducts(makeArgs()),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })

    expect(mocks.txBookingUpdate).not.toHaveBeenCalled()
    expect(mocks.txCheckoutProductItemDeleteMany).not.toHaveBeenCalled()
    expect(mocks.txCheckoutProductItemCreateMany).not.toHaveBeenCalled()
  })

  it('rejects product edits when checkout is paid', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeBooking({
        checkoutStatus: BookingCheckoutStatus.PAID,
      }),
    )

    await expect(
      upsertClientBookingCheckoutProducts(makeArgs()),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })

    expect(mocks.txBookingUpdate).not.toHaveBeenCalled()
    expect(mocks.txCheckoutProductItemDeleteMany).not.toHaveBeenCalled()
    expect(mocks.txCheckoutProductItemCreateMany).not.toHaveBeenCalled()
  })

  it('rejects product edits when checkout is waived', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeBooking({
        checkoutStatus: BookingCheckoutStatus.WAIVED,
      }),
    )

    await expect(
      upsertClientBookingCheckoutProducts(makeArgs()),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })

    expect(mocks.txBookingUpdate).not.toHaveBeenCalled()
    expect(mocks.txCheckoutProductItemDeleteMany).not.toHaveBeenCalled()
    expect(mocks.txCheckoutProductItemCreateMany).not.toHaveBeenCalled()
  })

  it('rejects product edits when booking is completed', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeBooking({
        status: BookingStatus.COMPLETED,
        sessionStep: SessionStep.DONE,
        finishedAt: TEST_NOW,
      }),
    )

    await expect(
      upsertClientBookingCheckoutProducts(makeArgs()),
    ).rejects.toMatchObject({
      code: 'BOOKING_CANNOT_EDIT_COMPLETED',
    })

    expect(mocks.txBookingUpdate).not.toHaveBeenCalled()
    expect(mocks.txCheckoutProductItemDeleteMany).not.toHaveBeenCalled()
    expect(mocks.txCheckoutProductItemCreateMany).not.toHaveBeenCalled()
  })
})