// M9 (payment-booking-integrity-audit-plan.md) — the manual close-out predicate
// (performLockedUpdateProCheckoutCloseout, reached via mark-paid / waive) must
// REFUSE with a distinct code when the client already paid the final bill by
// Stripe card. Without it, mark-paid silently no-ops and waive returns a generic
// FORBIDDEN, and — worse — a manual close-out racing a live card session
// double-collects. The mirror direction (card charge lands AFTER the manual
// close-out) can't be refused here (money already captured) and is covered by
// the applier's capturedAfterManualCloseout flag (applyStripeLateCaptureFlag).
//
// The schedule transaction wrapper is mocked to run the callback against a
// controlled tx, so the REAL predicate runs; the tx only needs booking.findUnique
// because the SUCCEEDED refusal throws before any read/update beyond it.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BookingCheckoutStatus,
  BookingStatus,
  PaymentMethod,
  Prisma,
  SessionStep,
  StripePaymentStatus,
} from '@prisma/client'

import { asTestTransactionClient } from '@/lib/typed/prismaTestClient'
import { isBookingError } from '@/lib/booking/errors'

const mocks = vi.hoisted(() => ({
  bookingFindUnique: vi.fn(),
  bookingUpdate: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

vi.mock('@/lib/booking/scheduleTransaction', () => ({
  withLockedProfessionalTransaction: (
    _professionalId: string,
    run: (ctx: { tx: unknown; now: Date }) => Promise<unknown>,
  ) =>
    run({
      tx: asTestTransactionClient({
        booking: {
          findUnique: mocks.bookingFindUnique,
          update: mocks.bookingUpdate,
        },
        bookingCloseoutAuditLog: { create: vi.fn(), createMany: vi.fn() },
      }),
      now: new Date('2026-07-23T00:00:00Z'),
    }),
  withLockedClientOwnedBookingTransaction: vi.fn(),
}))

import {
  markProBookingCheckoutPaid,
  updateBookingCheckout,
  waiveProBookingCheckout,
} from './writeBoundary'

const PRO_ID = 'pro_1'

function bookingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'booking_1',
    professionalId: PRO_ID,
    status: BookingStatus.IN_PROGRESS,
    sessionStep: SessionStep.AFTER_PHOTOS,
    finishedAt: null,
    checkoutStatus: BookingCheckoutStatus.PAID,
    selectedPaymentMethod: PaymentMethod.STRIPE_CARD,
    stripePaymentStatus: StripePaymentStatus.SUCCEEDED,
    serviceSubtotalSnapshot: new Prisma.Decimal(100),
    productSubtotalSnapshot: new Prisma.Decimal(0),
    subtotalSnapshot: new Prisma.Decimal(100),
    tipAmount: new Prisma.Decimal(0),
    taxAmount: new Prisma.Decimal(0),
    discountAmount: new Prisma.Decimal(0),
    totalAmount: new Prisma.Decimal(100),
    paymentAuthorizedAt: new Date('2026-07-22T00:00:00Z'),
    paymentCollectedAt: new Date('2026-07-22T00:00:00Z'),
    aftercareSummary: { id: 'ac_1', sentToClientAt: new Date('2026-07-22T00:00:00Z') },
    ...overrides,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  mocks.bookingFindUnique.mockReset()
  mocks.bookingUpdate.mockReset()
})

describe('manual close-out vs a Stripe-paid booking (M9)', () => {
  it('mark-paid refuses with CHECKOUT_ALREADY_PAID_BY_STRIPE once the card paid', async () => {
    mocks.bookingFindUnique.mockResolvedValue(bookingRow())

    const err = await markProBookingCheckoutPaid({
      bookingId: 'booking_1',
      professionalId: PRO_ID,
      actorUserId: 'user_1',
      selectedPaymentMethod: PaymentMethod.CASH,
      requestId: null,
      idempotencyKey: 'k1',
    }).catch((e: unknown) => e)

    expect(isBookingError(err)).toBe(true)
    expect((err as { code: string }).code).toBe('CHECKOUT_ALREADY_PAID_BY_STRIPE')
    // Refused before any write.
    expect(mocks.bookingUpdate).not.toHaveBeenCalled()
  })

  it('waive refuses with CHECKOUT_ALREADY_PAID_BY_STRIPE once the card paid', async () => {
    mocks.bookingFindUnique.mockResolvedValue(bookingRow())

    const err = await waiveProBookingCheckout({
      bookingId: 'booking_1',
      professionalId: PRO_ID,
      actorUserId: 'user_1',
      requestId: null,
      idempotencyKey: 'k2',
      reason: 'comped',
    }).catch((e: unknown) => e)

    expect(isBookingError(err)).toBe(true)
    expect((err as { code: string }).code).toBe('CHECKOUT_ALREADY_PAID_BY_STRIPE')
    expect(mocks.bookingUpdate).not.toHaveBeenCalled()
  })

  it('does NOT over-fire on a genuine manual replay (no Stripe capture)', async () => {
    // A manually-marked PAID leaves stripePaymentStatus NOT_STARTED. A repeat
    // mark-paid must reach the ordinary idempotent no-op, not the new refusal.
    mocks.bookingFindUnique.mockResolvedValue(
      bookingRow({ stripePaymentStatus: StripePaymentStatus.NOT_STARTED }),
    )

    const result = await markProBookingCheckoutPaid({
      bookingId: 'booking_1',
      professionalId: PRO_ID,
      actorUserId: 'user_1',
      selectedPaymentMethod: PaymentMethod.CASH,
      requestId: null,
      idempotencyKey: 'k3',
    })

    expect(result.meta.noOp).toBe(true)
    expect(mocks.bookingUpdate).not.toHaveBeenCalled()
  })
})

// §21.4 R2 — the general checkout-update path forwards markPaymentCollected but
// had NO Stripe-capture guard. No route passes it today; this pins the guard so
// a future caller can't stamp a manual collection over a live Stripe capture.
describe('updateBookingCheckout markPaymentCollected vs a Stripe-paid booking (R2)', () => {
  it('refuses markPaymentCollected with CHECKOUT_ALREADY_PAID_BY_STRIPE once the card paid', async () => {
    mocks.bookingFindUnique.mockResolvedValue(bookingRow())

    const err = await updateBookingCheckout({
      bookingId: 'booking_1',
      professionalId: PRO_ID,
      markPaymentCollected: true,
      requestId: null,
      idempotencyKey: 'k4',
    }).catch((e: unknown) => e)

    expect(isBookingError(err)).toBe(true)
    expect((err as { code: string }).code).toBe('CHECKOUT_ALREADY_PAID_BY_STRIPE')
    // Refused before any write.
    expect(mocks.bookingUpdate).not.toHaveBeenCalled()
  })

  it('does NOT fire without markPaymentCollected (a tip-only edit of a Stripe-paid booking)', async () => {
    // The guard must key on markPaymentCollected, not on SUCCEEDED alone. The
    // harness mocks only booking.findUnique, so the call fails later on the
    // unmocked rollup read — the assertion is that whatever happens, it is NOT
    // the new refusal.
    mocks.bookingFindUnique.mockResolvedValue(bookingRow())

    const err = await updateBookingCheckout({
      bookingId: 'booking_1',
      professionalId: PRO_ID,
      tipAmount: '10.00',
      requestId: null,
      idempotencyKey: 'k5',
    }).catch((e: unknown) => e)

    expect(
      isBookingError(err) && (err as { code: string }).code === 'CHECKOUT_ALREADY_PAID_BY_STRIPE',
    ).toBe(false)
  })

  it('does NOT fire on markPaymentCollected when no Stripe capture exists', async () => {
    // A cash collect on a booking with no card payment must pass the guard
    // (and then fail here only on the unmocked rollup read).
    mocks.bookingFindUnique.mockResolvedValue(
      bookingRow({ stripePaymentStatus: StripePaymentStatus.NOT_STARTED }),
    )

    const err = await updateBookingCheckout({
      bookingId: 'booking_1',
      professionalId: PRO_ID,
      markPaymentCollected: true,
      requestId: null,
      idempotencyKey: 'k6',
    }).catch((e: unknown) => e)

    expect(
      isBookingError(err) && (err as { code: string }).code === 'CHECKOUT_ALREADY_PAID_BY_STRIPE',
    ).toBe(false)
  })
})
