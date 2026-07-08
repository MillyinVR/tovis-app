// lib/booking/writeBoundary.confirmPayment.test.ts
//
// PF2 — confirmProBookingPaymentReceived: the pro confirms receipt of an
// off-platform payment left AWAITING_CONFIRMATION at client checkout. This both
// closes out the booking's payment (PAID + collected) and auto-approves any
// aftercare-sourced next appointment coupled to it (PENDING → ACCEPTED).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingCheckoutStatus,
  BookingSource,
  BookingStatus,
  NotificationEventKey,
  PaymentMethod,
  Prisma,
  SessionStep,
} from '@prisma/client'

const TEST_NOW = new Date('2026-05-02T16:00:00.000Z')
const PAYMENT_AUTHORIZED_AT = new Date('2026-05-01T18:00:00.000Z')
const AFTERCARE_SENT_AT = new Date('2026-05-01T18:05:00.000Z')

const mocks = vi.hoisted(() => ({
  prismaTransaction: vi.fn(),
  prismaBookingFindUnique: vi.fn(),

  withLockedProfessionalTransaction: vi.fn(),

  recordStatusTransition: vi.fn(),
  recordStepTransition: vi.fn(),
  registerLifecycleDriftSink: vi.fn(),

  createBookingCloseoutAuditLog: vi.fn(),
  areAuditValuesEqual: vi.fn(),

  emitPaymentCollectedNotifications: vi.fn(),
  emitPaymentActionRequiredNotifications: vi.fn(),
  emitPaymentRefundedNotifications: vi.fn(),

  upsertClientNotification: vi.fn(),
  createProNotification: vi.fn(),
  syncBookingAppointmentReminders: vi.fn(),
  cancelBookingAppointmentReminders: vi.fn(),
  scheduleReviewRequestOnCompletion: vi.fn(),

  txBookingFindUnique: vi.fn(),
  txBookingFindMany: vi.fn(),
  txBookingUpdate: vi.fn(),
  txMediaAssetCount: vi.fn(),
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
  withLockedClientOwnedBookingTransaction: vi.fn(),
}))

vi.mock('@/lib/booking/lifecycleContract', () => ({
  recordStatusTransition: mocks.recordStatusTransition,
  recordStepTransition: mocks.recordStepTransition,
  registerLifecycleDriftSink: mocks.registerLifecycleDriftSink,
}))

vi.mock('@/lib/booking/closeoutAudit', () => ({
  createBookingCloseoutAuditLog: mocks.createBookingCloseoutAuditLog,
  areAuditValuesEqual: mocks.areAuditValuesEqual,
}))

vi.mock('@/lib/notifications/paymentNotifications', () => ({
  emitPaymentCollectedNotifications: mocks.emitPaymentCollectedNotifications,
  emitPaymentActionRequiredNotifications:
    mocks.emitPaymentActionRequiredNotifications,
  emitPaymentRefundedNotifications: mocks.emitPaymentRefundedNotifications,
}))

vi.mock('@/lib/notifications/clientNotifications', () => ({
  upsertClientNotification: mocks.upsertClientNotification,
}))

vi.mock('@/lib/notifications/proNotifications', () => ({
  createProNotification: mocks.createProNotification,
}))

vi.mock('@/lib/notifications/appointmentReminders', () => ({
  syncBookingAppointmentReminders: mocks.syncBookingAppointmentReminders,
  cancelBookingAppointmentReminders: mocks.cancelBookingAppointmentReminders,
}))

vi.mock('@/lib/notifications/reviewRequests', () => ({
  scheduleReviewRequestOnCompletion: mocks.scheduleReviewRequestOnCompletion,
}))

import { confirmProBookingPaymentReceived } from './writeBoundary'

const tx = {
  booking: {
    findUnique: mocks.txBookingFindUnique,
    findMany: mocks.txBookingFindMany,
    update: mocks.txBookingUpdate,
  },
  mediaAsset: {
    count: mocks.txMediaAssetCount,
  },
}

/** A source booking sitting in AWAITING_CONFIRMATION, mid-closeout. */
function makeAwaitingSourceBooking(
  overrides?: Partial<{
    professionalId: string
    checkoutStatus: BookingCheckoutStatus
    finishedAt: Date | null
  }>,
) {
  return {
    id: 'source_1',
    professionalId: overrides?.professionalId ?? 'pro_1',
    status: BookingStatus.ACCEPTED,
    sessionStep: SessionStep.AFTER_PHOTOS,
    finishedAt:
      overrides && 'finishedAt' in overrides ? overrides.finishedAt : null,
    checkoutStatus:
      overrides?.checkoutStatus ?? BookingCheckoutStatus.AWAITING_CONFIRMATION,
    selectedPaymentMethod: PaymentMethod.VENMO,
    serviceSubtotalSnapshot: new Prisma.Decimal(100),
    productSubtotalSnapshot: new Prisma.Decimal(0),
    subtotalSnapshot: new Prisma.Decimal(100),
    tipAmount: new Prisma.Decimal(0),
    taxAmount: new Prisma.Decimal(0),
    discountAmount: new Prisma.Decimal(0),
    totalAmount: new Prisma.Decimal(100),
    paymentAuthorizedAt: PAYMENT_AUTHORIZED_AT,
    paymentCollectedAt: null,
    aftercareSummary: {
      id: 'aftercare_1',
      sentToClientAt: AFTERCARE_SENT_AT,
    },
  }
}

/** The updated source row the checkout write returns (now PAID + collected). */
function makeCollectedSourceBooking() {
  return {
    ...makeAwaitingSourceBooking(),
    checkoutStatus: BookingCheckoutStatus.PAID,
    paymentCollectedAt: TEST_NOW,
  }
}

function makeCoupledRebook(id: string) {
  return {
    id,
    status: BookingStatus.PENDING,
    clientId: 'client_1',
    professionalId: 'pro_1',
  }
}

describe('lib/booking/writeBoundary confirmProBookingPaymentReceived', () => {
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
  })

  it('marks the pending off-platform payment PAID and approves the coupled aftercare rebook', async () => {
    mocks.txBookingFindUnique
      // guard: current status must be AWAITING_CONFIRMATION
      .mockResolvedValueOnce({
        id: 'source_1',
        professionalId: 'pro_1',
        checkoutStatus: BookingCheckoutStatus.AWAITING_CONFIRMATION,
      })
      // closeout: full source booking
      .mockResolvedValueOnce(makeAwaitingSourceBooking())

    // No after-media → source does not auto-complete; keeps the update sequence
    // to (1) checkout write, (2) coupled-rebook accept.
    mocks.txMediaAssetCount.mockResolvedValue(0)

    mocks.txBookingUpdate
      // checkout write → PAID + collected
      .mockResolvedValueOnce(makeCollectedSourceBooking())
      // coupled rebook → ACCEPTED
      .mockResolvedValueOnce({ id: 'rebook_1' })

    mocks.txBookingFindMany.mockResolvedValueOnce([makeCoupledRebook('rebook_1')])

    const result = await confirmProBookingPaymentReceived({
      bookingId: 'source_1',
      professionalId: 'pro_1',
      actorUserId: 'user_pro_1',
    })

    // Source payment closed out.
    const checkoutUpdate = mocks.txBookingUpdate.mock.calls[0]?.[0]
    expect(checkoutUpdate.where).toEqual({ id: 'source_1' })
    expect(checkoutUpdate.data.checkoutStatus).toBe(BookingCheckoutStatus.PAID)
    expect(checkoutUpdate.data.paymentCollectedAt).toEqual(TEST_NOW)
    expect(result.booking.checkoutStatus).toBe(BookingCheckoutStatus.PAID)
    expect(result.booking.paymentCollectedAt).toEqual(TEST_NOW)

    // Coupled query is scoped to AFTERCARE-sourced PENDING rebooks of this source.
    const findManyArgs = mocks.txBookingFindMany.mock.calls[0]?.[0]
    expect(findManyArgs.where).toMatchObject({
      rebookOfBookingId: 'source_1',
      source: BookingSource.AFTERCARE,
      status: BookingStatus.PENDING,
      professionalId: 'pro_1',
    })

    // Coupled rebook approved PENDING → ACCEPTED.
    const rebookUpdate = mocks.txBookingUpdate.mock.calls[1]?.[0]
    expect(rebookUpdate).toMatchObject({
      where: { id: 'rebook_1' },
      data: { status: BookingStatus.ACCEPTED },
    })
    expect(mocks.recordStatusTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        from: BookingStatus.PENDING,
        to: BookingStatus.ACCEPTED,
        actor: 'PRO',
        bookingId: 'rebook_1',
      }),
    )
    expect(mocks.syncBookingAppointmentReminders).toHaveBeenCalledWith({
      tx,
      bookingId: 'rebook_1',
    })
    expect(mocks.upsertClientNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'client_1',
        bookingId: 'rebook_1',
        eventKey: NotificationEventKey.BOOKING_CONFIRMED,
        dedupeKey: 'BOOKING_CONFIRMED:rebook_1',
      }),
    )

    // Client payment receipt emitted through the shared closeout path.
    expect(mocks.emitPaymentCollectedNotifications).toHaveBeenCalledWith({
      tx,
      bookingId: 'source_1',
    })

    expect(result.approvedNextAppointmentBookingIds).toEqual(['rebook_1'])
    expect(result.meta.mutated).toBe(true)
  })

  it('approves every coupled aftercare rebook when several are pending', async () => {
    mocks.txBookingFindUnique
      .mockResolvedValueOnce({
        id: 'source_1',
        professionalId: 'pro_1',
        checkoutStatus: BookingCheckoutStatus.AWAITING_CONFIRMATION,
      })
      .mockResolvedValueOnce(makeAwaitingSourceBooking())

    mocks.txMediaAssetCount.mockResolvedValue(0)

    mocks.txBookingUpdate
      .mockResolvedValueOnce(makeCollectedSourceBooking())
      .mockResolvedValueOnce({ id: 'rebook_a' })
      .mockResolvedValueOnce({ id: 'rebook_b' })

    mocks.txBookingFindMany.mockResolvedValueOnce([
      makeCoupledRebook('rebook_a'),
      makeCoupledRebook('rebook_b'),
    ])

    const result = await confirmProBookingPaymentReceived({
      bookingId: 'source_1',
      professionalId: 'pro_1',
      actorUserId: 'user_pro_1',
    })

    expect(result.approvedNextAppointmentBookingIds).toEqual([
      'rebook_a',
      'rebook_b',
    ])
    // One checkout write + two rebook approvals.
    expect(mocks.txBookingUpdate).toHaveBeenCalledTimes(3)
    expect(mocks.txBookingUpdate.mock.calls[1]?.[0]).toMatchObject({
      where: { id: 'rebook_a' },
      data: { status: BookingStatus.ACCEPTED },
    })
    expect(mocks.txBookingUpdate.mock.calls[2]?.[0]).toMatchObject({
      where: { id: 'rebook_b' },
      data: { status: BookingStatus.ACCEPTED },
    })
    expect(mocks.upsertClientNotification).toHaveBeenCalledTimes(2)
  })

  it('leaves non-aftercare / non-pending bookings untouched (no coupled approvals)', async () => {
    mocks.txBookingFindUnique
      .mockResolvedValueOnce({
        id: 'source_1',
        professionalId: 'pro_1',
        checkoutStatus: BookingCheckoutStatus.AWAITING_CONFIRMATION,
      })
      .mockResolvedValueOnce(makeAwaitingSourceBooking())

    mocks.txMediaAssetCount.mockResolvedValue(0)

    mocks.txBookingUpdate.mockResolvedValueOnce(makeCollectedSourceBooking())

    // The coupled query filters to AFTERCARE + PENDING, so a REQUESTED rebook or
    // an already-accepted one never comes back here.
    mocks.txBookingFindMany.mockResolvedValueOnce([])

    const result = await confirmProBookingPaymentReceived({
      bookingId: 'source_1',
      professionalId: 'pro_1',
      actorUserId: 'user_pro_1',
    })

    expect(result.approvedNextAppointmentBookingIds).toEqual([])
    // Only the checkout write happened — no coupled-booking accept.
    expect(mocks.txBookingUpdate).toHaveBeenCalledTimes(1)
    expect(mocks.upsertClientNotification).not.toHaveBeenCalled()
    expect(mocks.recordStatusTransition).not.toHaveBeenCalledWith(
      expect.objectContaining({ to: BookingStatus.ACCEPTED }),
    )
  })

  it('rejects a booking that is not awaiting payment confirmation', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce({
      id: 'source_1',
      professionalId: 'pro_1',
      checkoutStatus: BookingCheckoutStatus.PAID,
    })

    await expect(
      confirmProBookingPaymentReceived({
        bookingId: 'source_1',
        professionalId: 'pro_1',
        actorUserId: 'user_pro_1',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    expect(mocks.txBookingUpdate).not.toHaveBeenCalled()
    expect(mocks.txBookingFindMany).not.toHaveBeenCalled()
  })

  it('returns a uniform 404 for a booking owned by another professional', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce({
      id: 'source_1',
      professionalId: 'pro_other',
      checkoutStatus: BookingCheckoutStatus.AWAITING_CONFIRMATION,
    })

    await expect(
      confirmProBookingPaymentReceived({
        bookingId: 'source_1',
        professionalId: 'pro_1',
        actorUserId: 'user_pro_1',
      }),
    ).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' })

    expect(mocks.txBookingUpdate).not.toHaveBeenCalled()
  })
})
