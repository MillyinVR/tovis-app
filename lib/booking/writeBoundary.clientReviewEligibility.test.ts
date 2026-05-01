// lib/booking/writeBoundary.clientReviewEligibility.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingCheckoutStatus,
  BookingStatus,
} from '@prisma/client'

const FINISHED_AT = new Date('2026-04-12T18:00:00.000Z')
const AFTERCARE_SENT_AT = new Date('2026-04-12T18:05:00.000Z')
const PAYMENT_COLLECTED_AT = new Date('2026-04-12T18:10:00.000Z')

const mocks = vi.hoisted(() => ({
  prismaTransaction: vi.fn(),
  prismaBookingFindUnique: vi.fn(),

  withLockedClientOwnedBookingTransaction: vi.fn(),

  txBookingFindUnique: vi.fn(),
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

import { assertClientBookingReviewEligibility } from './writeBoundary'

const tx = {
  booking: {
    findUnique: mocks.txBookingFindUnique,
  },
}

function makeBooking(
  overrides?: Partial<{
    clientId: string
    professionalId: string
    status: BookingStatus
    finishedAt: Date | null
    checkoutStatus: BookingCheckoutStatus
    paymentCollectedAt: Date | null
    aftercareSummary: { id: string; sentToClientAt: Date | null } | null
    reviews: Array<{ id: string; clientId: string }>
  }>,
) {
  return {
    id: 'booking_1',
    clientId: overrides?.clientId ?? 'client_1',
    professionalId: overrides?.professionalId ?? 'pro_1',
    status: overrides?.status ?? BookingStatus.COMPLETED,
    finishedAt:
      overrides && 'finishedAt' in overrides
        ? (overrides.finishedAt ?? null)
        : FINISHED_AT,
    checkoutStatus: overrides?.checkoutStatus ?? BookingCheckoutStatus.PAID,
    paymentCollectedAt:
      overrides && 'paymentCollectedAt' in overrides
        ? (overrides.paymentCollectedAt ?? null)
        : PAYMENT_COLLECTED_AT,
    aftercareSummary:
      overrides && 'aftercareSummary' in overrides
        ? overrides.aftercareSummary
        : {
            id: 'aftercare_1',
            sentToClientAt: AFTERCARE_SENT_AT,
          },
    reviews: overrides?.reviews ?? [],
  }
}

function makeArgs() {
  return {
    bookingId: 'booking_1',
    clientId: 'client_1',
  }
}

describe('lib/booking/writeBoundary assertClientBookingReviewEligibility', () => {
  beforeEach(() => {
    vi.resetAllMocks()

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
      }) => run({ tx, now: new Date(), professionalId: 'pro_1' }),
    )

    mocks.prismaTransaction.mockImplementation(
      async (run: (db: typeof tx) => Promise<unknown>) => run(tx),
    )
  })

  it('returns eligibility when booking closeout is complete and client has not reviewed', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(makeBooking())

    const result = await assertClientBookingReviewEligibility(makeArgs())

    expect(mocks.withLockedClientOwnedBookingTransaction).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      clientId: 'client_1',
      run: expect.any(Function),
    })

    expect(result).toEqual({
      booking: {
        id: 'booking_1',
        professionalId: 'pro_1',
        status: BookingStatus.COMPLETED,
        finishedAt: FINISHED_AT,
        checkoutStatus: BookingCheckoutStatus.PAID,
        paymentCollectedAt: PAYMENT_COLLECTED_AT,
        aftercareSentAt: AFTERCARE_SENT_AT,
      },
      meta: {
        mutated: false,
        noOp: true,
      },
    })
  })

  it('rejects when booking is missing', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(null)

    await expect(
      assertClientBookingReviewEligibility(makeArgs()),
    ).rejects.toMatchObject({
      code: 'BOOKING_NOT_FOUND',
    })
  })

  it('rejects when booking belongs to another client', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeBooking({
        clientId: 'client_other',
      }),
    )

    await expect(
      assertClientBookingReviewEligibility(makeArgs()),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('rejects cancelled bookings', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeBooking({
        status: BookingStatus.CANCELLED,
      }),
    )

    await expect(
      assertClientBookingReviewEligibility(makeArgs()),
    ).rejects.toMatchObject({
      code: 'BOOKING_CANNOT_EDIT_CANCELLED',
    })
  })

  it('rejects when client already reviewed the booking', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeBooking({
        reviews: [
          {
            id: 'review_1',
            clientId: 'client_1',
          },
        ],
      }),
    )

    await expect(
      assertClientBookingReviewEligibility(makeArgs()),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('rejects when status is not COMPLETED even if other closeout fields exist', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeBooking({
        status: BookingStatus.ACCEPTED,
      }),
    )

    await expect(
      assertClientBookingReviewEligibility(makeArgs()),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('rejects when finishedAt is missing', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeBooking({
        finishedAt: null,
      }),
    )

    await expect(
      assertClientBookingReviewEligibility(makeArgs()),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('rejects when aftercare is missing', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeBooking({
        aftercareSummary: null,
      }),
    )

    await expect(
      assertClientBookingReviewEligibility(makeArgs()),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('rejects when aftercare is only a draft', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeBooking({
        aftercareSummary: {
          id: 'aftercare_1',
          sentToClientAt: null,
        },
      }),
    )

    await expect(
      assertClientBookingReviewEligibility(makeArgs()),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('rejects when checkout is not complete', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeBooking({
        checkoutStatus: BookingCheckoutStatus.READY,
      }),
    )

    await expect(
      assertClientBookingReviewEligibility(makeArgs()),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('rejects when payment is not collected', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeBooking({
        paymentCollectedAt: null,
      }),
    )

    await expect(
      assertClientBookingReviewEligibility(makeArgs()),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })
})