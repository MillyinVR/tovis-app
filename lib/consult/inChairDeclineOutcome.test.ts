// lib/consult/inChairDeclineOutcome.test.ts
//
// Book the Look, B6 — the pro's keep-or-refund answer about a declined client's
// deposit.
//
// This file exists because the branch that moves a client's money had NO tests
// at all, and one of them was wrong: a REFUND that Stripe never performed (the
// deposit already returned, or the charge frozen under a dispute) came back as
// an ordinary success, and the screen printed "you refunded her deposit of $X".
// Every outcome of `recordConsultDeclineDepositChoice` is pinned here, and the
// two money-moved-nothing paths are pinned hardest.

import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  BookingCloseoutAuditAction,
  BookingDepositStatus,
  BookingRefundTrigger,
  ConsultationApprovalStatus,
  Prisma,
  Role,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  bookingFindFirst: vi.fn(),
  auditFindFirst: vi.fn(),
  transaction: vi.fn(),
  createBookingCloseoutAuditLog: vi.fn(),
  refundDiscoveryDeposit: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: { findFirst: mocks.bookingFindFirst },
    bookingCloseoutAuditLog: { findFirst: mocks.auditFindFirst },
    $transaction: mocks.transaction,
  },
}))

vi.mock('@/lib/booking/closeoutAudit', () => ({
  createBookingCloseoutAuditLog: mocks.createBookingCloseoutAuditLog,
}))

vi.mock('@/lib/booking/refunds', () => ({
  refundDiscoveryDeposit: mocks.refundDiscoveryDeposit,
}))

import {
  loadConsultDeclineDepositState,
  recordConsultDeclineDepositChoice,
} from './inChairDeclineOutcome'

const BOOKING_ID = 'bk_1'
const PRO_ID = 'pro_1'
const ACTOR = 'user_1'

/** $180 deposit + $20 client fee = a $200 up-front charge. */
function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: BOOKING_ID,
    professionalId: PRO_ID,
    depositStatus: BookingDepositStatus.PAID,
    depositAmount: new Prisma.Decimal('180.00'),
    discoveryFeeAmount: 2000,
    depositRefundedCents: 0,
    depositStripePaymentIntentId: 'pi_1',
    consultBookingProposal: { id: 'prop_1' },
    consultationApproval: { status: ConsultationApprovalStatus.REJECTED },
    ...overrides,
  }
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset()
  // The audit write runs inside a $transaction; run the callback for real.
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({}),
  )
  mocks.createBookingCloseoutAuditLog.mockResolvedValue(undefined)
  mocks.bookingFindFirst.mockResolvedValue(booking())
})

describe('recordConsultDeclineDepositChoice — refusals', () => {
  it('NOT_FOUND when the booking is not this pro’s', async () => {
    mocks.bookingFindFirst.mockResolvedValue(null)

    const result = await recordConsultDeclineDepositChoice({
      bookingId: BOOKING_ID,
      professionalId: PRO_ID,
      actorUserId: ACTOR,
      choice: 'REFUND',
    })

    expect(result).toEqual({ ok: false, code: 'NOT_FOUND' })
    expect(mocks.refundDiscoveryDeposit).not.toHaveBeenCalled()
  })

  it('NOT_APPLICABLE when the client never declined', async () => {
    mocks.bookingFindFirst.mockResolvedValue(
      booking({
        consultationApproval: { status: ConsultationApprovalStatus.PENDING },
      }),
    )

    const result = await recordConsultDeclineDepositChoice({
      bookingId: BOOKING_ID,
      professionalId: PRO_ID,
      actorUserId: ACTOR,
      choice: 'REFUND',
    })

    expect(result).toEqual({ ok: false, code: 'NOT_APPLICABLE' })
    expect(mocks.createBookingCloseoutAuditLog).not.toHaveBeenCalled()
  })

  it('NOT_APPLICABLE when the deposit is already REFUNDED', async () => {
    mocks.bookingFindFirst.mockResolvedValue(
      booking({ depositStatus: BookingDepositStatus.REFUNDED }),
    )

    const result = await recordConsultDeclineDepositChoice({
      bookingId: BOOKING_ID,
      professionalId: PRO_ID,
      actorUserId: ACTOR,
      choice: 'REFUND',
    })

    expect(result).toEqual({ ok: false, code: 'NOT_APPLICABLE' })
    expect(mocks.refundDiscoveryDeposit).not.toHaveBeenCalled()
  })

  it('ALREADY_DECIDED on the unique-index collision — and issues no second refund', async () => {
    mocks.createBookingCloseoutAuditLog.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    )

    const result = await recordConsultDeclineDepositChoice({
      bookingId: BOOKING_ID,
      professionalId: PRO_ID,
      actorUserId: ACTOR,
      choice: 'REFUND',
    })

    expect(result).toEqual({ ok: false, code: 'ALREADY_DECIDED' })
    expect(mocks.refundDiscoveryDeposit).not.toHaveBeenCalled()
  })
})

describe('recordConsultDeclineDepositChoice — KEEP', () => {
  it('records the decision, settles as KEPT, and moves no money', async () => {
    const result = await recordConsultDeclineDepositChoice({
      bookingId: BOOKING_ID,
      professionalId: PRO_ID,
      actorUserId: ACTOR,
      choice: 'KEEP',
    })

    expect(result).toEqual({
      ok: true,
      choice: 'KEEP',
      settlement: 'KEPT',
      refundedCents: 0,
    })
    expect(mocks.refundDiscoveryDeposit).not.toHaveBeenCalled()
    expect(mocks.createBookingCloseoutAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action:
          BookingCloseoutAuditAction.CONSULTATION_DECLINE_DEPOSIT_DECIDED,
        metadata: expect.objectContaining({ choice: 'KEEP' }),
      }),
    )
  })
})

describe('recordConsultDeclineDepositChoice — REFUND', () => {
  it('returns the cents Stripe actually returned, not the cents asked for', async () => {
    mocks.refundDiscoveryDeposit.mockResolvedValue({
      outcome: 'REFUNDED',
      refundAmountCents: 20000,
      feeRefunded: true,
    })

    const result = await recordConsultDeclineDepositChoice({
      bookingId: BOOKING_ID,
      professionalId: PRO_ID,
      actorUserId: ACTOR,
      choice: 'REFUND',
    })

    expect(result).toEqual({
      ok: true,
      choice: 'REFUND',
      settlement: 'REFUNDED',
      refundedCents: 20000,
    })
    // Deposit + fee, and kept OUT of the auto-cancel retry sweep on purpose.
    expect(mocks.refundDiscoveryDeposit).toHaveBeenCalledWith(
      expect.objectContaining({
        refundAmountCents: 20000,
        refundFee: true,
        trigger: BookingRefundTrigger.DISCRETIONARY,
        actor: { userId: ACTOR, role: Role.PRO },
      }),
    )
  })

  it('asks only for what is left when part of the charge already went back', async () => {
    mocks.bookingFindFirst.mockResolvedValue(
      booking({ depositRefundedCents: 5000 }),
    )
    mocks.refundDiscoveryDeposit.mockResolvedValue({
      outcome: 'REFUNDED',
      refundAmountCents: 15000,
      feeRefunded: true,
    })

    const result = await recordConsultDeclineDepositChoice({
      bookingId: BOOKING_ID,
      professionalId: PRO_ID,
      actorUserId: ACTOR,
      choice: 'REFUND',
    })

    expect(result).toMatchObject({ settlement: 'REFUNDED', refundedCents: 15000 })
    expect(mocks.refundDiscoveryDeposit).toHaveBeenCalledWith(
      expect.objectContaining({ refundAmountCents: 15000 }),
    )
  })

  // 🔴 The defect this file was written for. A disputed deposit still shows the
  // pro a live Refund button (the dispute webhook leaves depositStatus PAID),
  // and the refund is frozen — so the request succeeds having moved nothing.
  it('a dispute-frozen refund settles NOT_MOVED, never as a refund', async () => {
    mocks.refundDiscoveryDeposit.mockResolvedValue({
      outcome: 'NOT_ATTEMPTED',
      reason: 'DISPUTED',
    })

    const result = await recordConsultDeclineDepositChoice({
      bookingId: BOOKING_ID,
      professionalId: PRO_ID,
      actorUserId: ACTOR,
      choice: 'REFUND',
    })

    expect(result).toEqual({
      ok: true,
      choice: 'REFUND',
      settlement: 'NOT_MOVED',
      refundedCents: 0,
    })
  })

  it('an already-returned deposit settles NOT_MOVED', async () => {
    mocks.refundDiscoveryDeposit.mockResolvedValue({
      outcome: 'NOT_ATTEMPTED',
      reason: 'ALREADY_RETURNED',
    })

    const result = await recordConsultDeclineDepositChoice({
      bookingId: BOOKING_ID,
      professionalId: PRO_ID,
      actorUserId: ACTOR,
      choice: 'REFUND',
    })

    expect(result).toMatchObject({ ok: true, settlement: 'NOT_MOVED', refundedCents: 0 })
  })

  it('REFUND_FAILED when Stripe refuses — the decision stands, the money did not move', async () => {
    mocks.refundDiscoveryDeposit.mockResolvedValue({
      outcome: 'FAILED',
      message: 'card_declined',
    })

    const result = await recordConsultDeclineDepositChoice({
      bookingId: BOOKING_ID,
      professionalId: PRO_ID,
      actorUserId: ACTOR,
      choice: 'REFUND',
    })

    expect(result).toEqual({
      ok: false,
      code: 'REFUND_FAILED',
      message: 'card_declined',
    })
    // The audit row was already committed: the answer is recorded even though
    // the refund is not. That is the honest state, and it is deliberate.
    expect(mocks.createBookingCloseoutAuditLog).toHaveBeenCalledOnce()
  })

  it('a throw from the refund machinery becomes REFUND_FAILED, not a 500', async () => {
    mocks.refundDiscoveryDeposit.mockRejectedValue(new Error('stripe down'))

    const result = await recordConsultDeclineDepositChoice({
      bookingId: BOOKING_ID,
      professionalId: PRO_ID,
      actorUserId: ACTOR,
      choice: 'REFUND',
    })

    expect(result).toMatchObject({ ok: false, code: 'REFUND_FAILED' })
  })
})

describe('loadConsultDeclineDepositState — the read-back', () => {
  it('returns null when the question was never asked', async () => {
    mocks.bookingFindFirst.mockResolvedValue(
      booking({ consultBookingProposal: null }),
    )

    await expect(
      loadConsultDeclineDepositState({
        bookingId: BOOKING_ID,
        professionalId: PRO_ID,
      }),
    ).resolves.toBeNull()
    expect(mocks.auditFindFirst).not.toHaveBeenCalled()
  })

  it('reports the charge and an open question when nothing is decided', async () => {
    mocks.auditFindFirst.mockResolvedValue(null)

    const state = await loadConsultDeclineDepositState({
      bookingId: BOOKING_ID,
      professionalId: PRO_ID,
    })

    expect(state).toEqual({
      depositChargeCents: 20000,
      decidedChoice: null,
      decidedAt: null,
      refundedCents: 0,
    })
  })

  // 🔴 The reload half of the same defect: the decision row is written before
  // Stripe and never revised, so it says REFUND forever. Only the money can say
  // whether the refund happened, and the state must carry it.
  it('carries the cents actually returned, so a failed refund cannot read as a refund', async () => {
    mocks.auditFindFirst.mockResolvedValue({
      createdAt: new Date('2026-09-02T10:00:00.000Z'),
      metadata: { choice: 'REFUND' },
    })

    const state = await loadConsultDeclineDepositState({
      bookingId: BOOKING_ID,
      professionalId: PRO_ID,
    })

    expect(state).toEqual({
      depositChargeCents: 20000,
      decidedChoice: 'REFUND',
      decidedAt: '2026-09-02T10:00:00.000Z',
      refundedCents: 0,
    })
  })

  it('reports the returned cents when the refund did work', async () => {
    mocks.bookingFindFirst.mockResolvedValue(
      booking({
        depositStatus: BookingDepositStatus.REFUNDED,
        depositRefundedCents: 20000,
      }),
    )
    mocks.auditFindFirst.mockResolvedValue({
      createdAt: new Date('2026-09-02T10:00:00.000Z'),
      metadata: { choice: 'REFUND' },
    })

    const state = await loadConsultDeclineDepositState({
      bookingId: BOOKING_ID,
      professionalId: PRO_ID,
    })

    expect(state).toMatchObject({ decidedChoice: 'REFUND', refundedCents: 20000 })
  })
})
