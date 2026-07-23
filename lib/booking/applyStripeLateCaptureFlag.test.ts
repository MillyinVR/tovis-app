// M1 (payment-booking-integrity-audit-plan.md) — the two Stripe success
// appliers must FLAG money that lands on an already-CANCELLED booking, so the
// arrival paths (webhook route, requeue cron, orphan recovery) can settle it
// post-commit via applyLateCaptureCancelRefund. The flag must come from the
// UPDATE's returned row, not the pre-update read: the deposit applier takes no
// schedule lock, so a concurrent cancel can commit between the read and the
// write — the update waits on that cancel's row lock and sees its status.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BookingCheckoutStatus,
  BookingDepositStatus,
  BookingStatus,
  PaymentProvider,
  Prisma,
  StripePaymentStatus,
} from '@prisma/client'

import { asTestTransactionClient } from '@/lib/typed/prismaTestClient'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

vi.mock('@/lib/notifications/paymentNotifications', () => ({
  emitPaymentCollectedNotifications: vi.fn(),
  emitPaymentActionRequiredNotifications: vi.fn(),
  emitPaymentRefundedNotifications: vi.fn(),
}))

import {
  applyStripeDepositSucceededInTransaction,
  applyStripePaymentSucceededInTransaction,
} from './writeBoundary'

afterEach(() => vi.restoreAllMocks())

// ─── Deposit applier ─────────────────────────────────────────────────────────

function makeDepositTx(args: {
  depositStatus: BookingDepositStatus
  /** Status the pre-update read sees. */
  readStatus: BookingStatus
  /** Status the UPDATE's returned row carries (post row-lock). */
  updatedStatus?: BookingStatus
}) {
  const update = vi.fn(async () => ({
    status: args.updatedStatus ?? args.readStatus,
  }))

  const tx = asTestTransactionClient({
    booking: {
      findFirst: vi.fn(async () => ({
        id: 'booking_1',
        depositStatus: args.depositStatus,
        status: args.readStatus,
      })),
      findUnique: vi.fn(),
      update,
    },
    // The deposit-paid applier cancels the pending M5 deposit reminder (M5).
    scheduledClientNotification: {
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
  })

  return { tx, update }
}

describe('applyStripeDepositSucceededInTransaction — cancelled-booking flag', () => {
  it('flags a deposit that lands on a CANCELLED booking', async () => {
    const { tx, update } = makeDepositTx({
      depositStatus: BookingDepositStatus.PENDING,
      readStatus: BookingStatus.CANCELLED,
    })

    const result = await applyStripeDepositSucceededInTransaction(tx, {
      stripePaymentIntentId: 'pi_dep_1',
      chargeId: 'ch_1',
    })

    expect(update).toHaveBeenCalledOnce()
    expect(result).toEqual({
      handled: true,
      alreadyPaid: false,
      bookingId: 'booking_1',
      capturedOnCancelledBooking: true,
    })
  })

  it('takes the flag from the UPDATE row when a cancel commits mid-flight', async () => {
    // Pre-update read raced ahead of the cancel; the update's row shows it.
    const { tx } = makeDepositTx({
      depositStatus: BookingDepositStatus.PENDING,
      readStatus: BookingStatus.PENDING,
      updatedStatus: BookingStatus.CANCELLED,
    })

    const result = await applyStripeDepositSucceededInTransaction(tx, {
      stripePaymentIntentId: 'pi_dep_1',
      chargeId: null,
    })

    expect(result.capturedOnCancelledBooking).toBe(true)
  })

  it('does not flag a live booking', async () => {
    const { tx } = makeDepositTx({
      depositStatus: BookingDepositStatus.PENDING,
      readStatus: BookingStatus.PENDING,
    })

    const result = await applyStripeDepositSucceededInTransaction(tx, {
      stripePaymentIntentId: 'pi_dep_1',
      chargeId: null,
    })

    expect(result.capturedOnCancelledBooking).toBe(false)
  })

  it('still flags an already-PAID deposit on a CANCELLED booking (replay self-heal)', async () => {
    const { tx, update } = makeDepositTx({
      depositStatus: BookingDepositStatus.PAID,
      readStatus: BookingStatus.CANCELLED,
    })

    const result = await applyStripeDepositSucceededInTransaction(tx, {
      stripePaymentIntentId: 'pi_dep_1',
      chargeId: null,
    })

    expect(update).not.toHaveBeenCalled()
    expect(result).toEqual({
      handled: true,
      alreadyPaid: true,
      bookingId: 'booking_1',
      capturedOnCancelledBooking: true,
    })
  })
})

// ─── Service-payment applier ─────────────────────────────────────────────────

const UNPAID_BOOKING = {
  id: 'booking_1',
  clientId: 'client_1',
  professionalId: 'pro_1',
  status: BookingStatus.CANCELLED,
  finishedAt: null,
  sessionStep: null,
  subtotalSnapshot: 0,
  serviceSubtotalSnapshot: 0,
  productSubtotalSnapshot: 0,
  tipAmount: 0,
  taxAmount: 0,
  discountAmount: 0,
  totalAmount: new Prisma.Decimal(100),
  checkoutStatus: BookingCheckoutStatus.NOT_READY,
  selectedPaymentMethod: null,
  paymentProvider: PaymentProvider.STRIPE,
  paymentAuthorizedAt: null,
  paymentCollectedAt: null,
  stripeCheckoutSessionId: null,
  stripePaymentIntentId: 'pi_1',
  stripeConnectedAccountId: null,
  stripeCheckoutSessionStatus: null,
  stripePaymentStatus: null,
  stripeAmountSubtotal: 0,
  stripeAmountTotal: 10000,
  stripeCurrency: 'usd',
  stripePaidAt: null,
  stripeLastEventId: null,
  aftercareSummary: null,
}

function makeServiceTx(args: {
  bookingOverrides?: Record<string, unknown>
  updatedStatus: BookingStatus
}) {
  const update = vi.fn(
    async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'booking_1',
      ...data,
      status: args.updatedStatus,
    }),
  )

  const tx = asTestTransactionClient({
    $executeRaw: vi.fn().mockResolvedValue(1),
    booking: {
      findFirst: vi.fn(async () => ({
        id: 'booking_1',
        professionalId: 'pro_1',
      })),
      findUnique: vi.fn(async () => ({
        ...UNPAID_BOOKING,
        ...args.bookingOverrides,
      })),
      update,
    },
    bookingCloseoutAuditLog: { create: vi.fn(), createMany: vi.fn() },
  })

  return { tx, update }
}

describe('applyStripePaymentSucceededInTransaction — cancelled-booking flag', () => {
  it('flags a payment that applies onto a CANCELLED booking', async () => {
    const { tx, update } = makeServiceTx({
      updatedStatus: BookingStatus.CANCELLED,
    })

    const result = await applyStripePaymentSucceededInTransaction(tx, {
      bookingIdHint: null,
      stripePaymentIntentId: 'pi_1',
      stripeEventId: 'evt_1',
      amountReceivedCents: 10000,
      currency: 'usd',
    })

    expect(update).toHaveBeenCalledOnce()
    expect(result?.meta.mutated).toBe(true)
    expect(result?.capturedOnCancelledBooking).toBe(true)
  })

  it('does not flag a live booking', async () => {
    const { tx } = makeServiceTx({
      bookingOverrides: { status: BookingStatus.ACCEPTED },
      updatedStatus: BookingStatus.ACCEPTED,
    })

    const result = await applyStripePaymentSucceededInTransaction(tx, {
      bookingIdHint: null,
      stripePaymentIntentId: 'pi_1',
      stripeEventId: 'evt_1',
      amountReceivedCents: 10000,
      currency: 'usd',
    })

    expect(result?.capturedOnCancelledBooking).toBe(false)
  })

  it('still flags an already-applied payment on a CANCELLED booking (replay self-heal)', async () => {
    const { tx, update } = makeServiceTx({
      bookingOverrides: {
        checkoutStatus: BookingCheckoutStatus.PAID,
        paymentCollectedAt: new Date('2026-06-01T00:00:00Z'),
        stripePaymentStatus: StripePaymentStatus.SUCCEEDED,
      },
      updatedStatus: BookingStatus.CANCELLED,
    })

    const result = await applyStripePaymentSucceededInTransaction(tx, {
      bookingIdHint: null,
      stripePaymentIntentId: 'pi_1',
      stripeEventId: 'evt_2',
      amountReceivedCents: 10000,
      currency: 'usd',
    })

    expect(update).not.toHaveBeenCalled()
    expect(result?.meta.mutated).toBe(false)
    expect(result?.capturedOnCancelledBooking).toBe(true)
  })

  it('never flags from the DISPUTED freeze branch', async () => {
    const { tx, update } = makeServiceTx({
      bookingOverrides: {
        stripePaymentStatus: StripePaymentStatus.DISPUTED,
      },
      updatedStatus: BookingStatus.CANCELLED,
    })

    const result = await applyStripePaymentSucceededInTransaction(tx, {
      bookingIdHint: null,
      stripePaymentIntentId: 'pi_1',
      stripeEventId: 'evt_3',
      amountReceivedCents: 10000,
      currency: 'usd',
    })

    expect(update).not.toHaveBeenCalled()
    expect(result?.capturedOnCancelledBooking).toBeUndefined()
  })
})

// ─── M9: manual close-out over-collection flag ───────────────────────────────
//
// A card charge that lands AFTER the pro closed the booking out by hand
// (mark-paid cash / waive) over-collects the client. The manual close-out stamps
// paymentCollectedAt while stripePaymentStatus is still not SUCCEEDED; the normal
// card flow has paymentCollectedAt == null at apply time. So a non-null
// paymentCollectedAt on a not-yet-SUCCEEDED booking is the flag. The money is
// already captured, so the applier records it and flags for a post-commit page.

describe('applyStripePaymentSucceededInTransaction — manual close-out flag (M9)', () => {
  const COLLECTED = new Date('2026-06-01T00:00:00Z')

  it('flags a card charge that lands on a mark-paid (cash) booking', async () => {
    const { tx, update } = makeServiceTx({
      bookingOverrides: {
        status: BookingStatus.IN_PROGRESS,
        checkoutStatus: BookingCheckoutStatus.PAID,
        selectedPaymentMethod: 'CASH',
        paymentCollectedAt: COLLECTED,
        stripePaymentStatus: StripePaymentStatus.NOT_STARTED,
      },
      updatedStatus: BookingStatus.IN_PROGRESS,
    })

    const result = await applyStripePaymentSucceededInTransaction(tx, {
      bookingIdHint: null,
      stripePaymentIntentId: 'pi_1',
      stripeEventId: 'evt_m9_1',
      amountReceivedCents: 10000,
      currency: 'usd',
    })

    // The money IS recorded (the card captured — that's real), and flagged.
    expect(update).toHaveBeenCalledOnce()
    expect(result?.capturedAfterManualCloseout).toBe(true)
    expect(result?.capturedOnCancelledBooking).toBe(false)
  })

  it('flags a card charge that lands on a WAIVED booking', async () => {
    const { tx } = makeServiceTx({
      bookingOverrides: {
        status: BookingStatus.IN_PROGRESS,
        checkoutStatus: BookingCheckoutStatus.WAIVED,
        paymentCollectedAt: COLLECTED,
        stripePaymentStatus: StripePaymentStatus.NOT_STARTED,
      },
      updatedStatus: BookingStatus.IN_PROGRESS,
    })

    const result = await applyStripePaymentSucceededInTransaction(tx, {
      bookingIdHint: null,
      stripePaymentIntentId: 'pi_1',
      stripeEventId: 'evt_m9_2',
      amountReceivedCents: 10000,
      currency: 'usd',
    })

    expect(result?.capturedAfterManualCloseout).toBe(true)
  })

  it('does not flag the normal card flow (no manual collection)', async () => {
    const { tx } = makeServiceTx({
      bookingOverrides: {
        status: BookingStatus.ACCEPTED,
        checkoutStatus: BookingCheckoutStatus.READY,
        paymentCollectedAt: null,
        stripePaymentStatus: StripePaymentStatus.NOT_STARTED,
      },
      updatedStatus: BookingStatus.ACCEPTED,
    })

    const result = await applyStripePaymentSucceededInTransaction(tx, {
      bookingIdHint: null,
      stripePaymentIntentId: 'pi_1',
      stripeEventId: 'evt_m9_3',
      amountReceivedCents: 10000,
      currency: 'usd',
    })

    expect(result?.capturedAfterManualCloseout).toBe(false)
  })

  it('does not re-flag on redelivery once the card charge is recorded', async () => {
    // First application already recorded SUCCEEDED + PAID + collected → the
    // alreadyApplied replay guard short-circuits; the manual signal is consumed.
    const { tx, update } = makeServiceTx({
      bookingOverrides: {
        status: BookingStatus.IN_PROGRESS,
        checkoutStatus: BookingCheckoutStatus.PAID,
        paymentCollectedAt: COLLECTED,
        stripePaymentStatus: StripePaymentStatus.SUCCEEDED,
      },
      updatedStatus: BookingStatus.IN_PROGRESS,
    })

    const result = await applyStripePaymentSucceededInTransaction(tx, {
      bookingIdHint: null,
      stripePaymentIntentId: 'pi_1',
      stripeEventId: 'evt_m9_4',
      amountReceivedCents: 10000,
      currency: 'usd',
    })

    expect(update).not.toHaveBeenCalled()
    expect(result?.capturedAfterManualCloseout).toBeUndefined()
  })
})
