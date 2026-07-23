// M8 / M1 tie-in — a late-arriving payment can NEVER complete a terminal booking.
//
// `maybeCompleteBookingCloseout` gates auto-completion on
// `isPaymentAndAftercareCloseoutCandidate`, which refuses CANCELLED and COMPLETED
// bookings BEFORE any payment/aftercare check. So even when a cancelled booking's
// payment succeeds late (M1's black-hole scenario) with aftercare + after-media
// already in place, the applier records the money but leaves the booking
// CANCELLED — it never drags it to COMPLETED. The A/B control below flips ONLY the
// status to IN_PROGRESS with the identical closeout inputs and shows it DOES
// complete, proving the terminal-status guard is the load-bearing blocker (not a
// missing precondition).
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BookingCheckoutStatus,
  BookingStatus,
  PaymentProvider,
  Prisma,
  SessionStep,
  StripePaymentStatus,
} from '@prisma/client'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

vi.mock('@/lib/notifications/paymentNotifications', () => ({
  emitPaymentCollectedNotifications: vi.fn(),
  emitPaymentActionRequiredNotifications: vi.fn(),
  emitPaymentRefundedNotifications: vi.fn(),
}))

import { asTestTransactionClient } from '@/lib/typed/prismaTestClient'

import { applyStripePaymentSucceededInTransaction } from './writeBoundary'

// A booking whose payment has NOT yet been recorded (so the applier proceeds
// rather than no-opping), but whose aftercare is sent — i.e. one payment capture
// away from being closeout-ready IF its status allowed completion.
const CLOSEOUT_READY_EXCEPT_STATUS = {
  id: 'booking_1',
  clientId: 'client_1',
  professionalId: 'pro_1',
  status: BookingStatus.CANCELLED,
  finishedAt: null,
  sessionStep: SessionStep.AFTER_PHOTOS,
  subtotalSnapshot: new Prisma.Decimal(100),
  serviceSubtotalSnapshot: new Prisma.Decimal(100),
  productSubtotalSnapshot: new Prisma.Decimal(0),
  tipAmount: new Prisma.Decimal(0),
  taxAmount: new Prisma.Decimal(0),
  discountAmount: new Prisma.Decimal(0),
  // $100.00 = 10000 cents, matching amountReceivedCents (no captured-amount drift).
  totalAmount: new Prisma.Decimal(100),
  checkoutStatus: BookingCheckoutStatus.READY,
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
  // Aftercare already sent — the only remaining closeout gate is payment, which
  // this event supplies.
  aftercareSummary: { sentToClientAt: new Date('2026-06-01T00:00:00Z') },
}

function makeTx(bookingOverrides: Record<string, unknown> = {}) {
  const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    ...CLOSEOUT_READY_EXCEPT_STATUS,
    ...bookingOverrides,
    ...data,
  }))

  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    booking: {
      findFirst: vi.fn(async () => ({ id: 'booking_1', professionalId: 'pro_1' })),
      findUnique: vi.fn(async () => ({
        ...CLOSEOUT_READY_EXCEPT_STATUS,
        ...bookingOverrides,
      })),
      update,
    },
    // After-media present, so the only thing standing between this booking and
    // auto-completion is the terminal-status guard.
    mediaAsset: { count: vi.fn(async () => 1) },
    bookingCloseoutAuditLog: { create: vi.fn(async () => ({ id: 'audit_1' })) },
    scheduledClientNotification: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: 'scn_1' })),
    },
  }

  return { tx: asTestTransactionClient(tx), update }
}

function completionUpdateCalls(update: ReturnType<typeof makeTx>['update']) {
  return update.mock.calls.filter(
    ([arg]) =>
      (arg as { data?: Record<string, unknown> } | undefined)?.data?.status ===
      BookingStatus.COMPLETED,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('applyStripePaymentSucceededInTransaction — closeout guard (M8/M1)', () => {
  it('records the payment on a CANCELLED booking but never completes it', async () => {
    const { tx, update } = makeTx({ status: BookingStatus.CANCELLED })

    const result = await applyStripePaymentSucceededInTransaction(tx, {
      bookingIdHint: null,
      stripePaymentIntentId: 'pi_1',
      stripeEventId: 'stripe:pi_succeeded:pi_1',
      amountReceivedCents: 10000,
      currency: 'usd',
    })

    // The payment WAS recorded (a booking-field update ran)…
    expect(update).toHaveBeenCalled()
    // …but no update flipped the booking to COMPLETED.
    expect(completionUpdateCalls(update)).toHaveLength(0)
    expect(result?.bookingCompleted).toBe(false)
    // M1: the late capture on a cancelled booking is flagged for the refund path.
    expect(result?.capturedOnCancelledBooking).toBe(true)
  })

  it('A/B control: the SAME closeout inputs on an IN_PROGRESS booking DO complete it', async () => {
    const { tx, update } = makeTx({
      status: BookingStatus.IN_PROGRESS,
      sessionStep: SessionStep.AFTER_PHOTOS,
    })

    const result = await applyStripePaymentSucceededInTransaction(tx, {
      bookingIdHint: null,
      stripePaymentIntentId: 'pi_1',
      stripeEventId: 'stripe:pi_succeeded:pi_1',
      amountReceivedCents: 10000,
      currency: 'usd',
    })

    // Delta from the CANCELLED case is ONLY the status → completion now fires.
    expect(completionUpdateCalls(update)).toHaveLength(1)
    expect(result?.bookingCompleted).toBe(true)
    expect(result?.capturedOnCancelledBooking).toBe(false)
  })
})
