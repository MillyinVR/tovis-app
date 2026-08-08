// lib/booking/lateChangeFeeOrchestration.test.ts
//
// The post-commit half of a late client reschedule. Both reschedule routes (the
// authed one and the SMS token one) call through here, so these tests are what
// keep the two from drifting.
//
// The load-bearing case is `windowAnchor`. A reschedule MOVES `scheduledFor` on
// the same Booking row and this runs after the commit, so the naive version —
// letting the fee assessor read the row — asks "is the NEW time within the
// cancel window", which is the comfortably-distant time the client just picked.
// The answer is always no, and the fee silently never charges. Nothing else in
// the suite would notice: no error, no failing write, just money never billed.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingStatus, NoShowFeeReason, NoShowFeeStatus } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  assessAndChargeNoShowFee: vi.fn(),
  noShowProtectionEnabled: vi.fn(),
}))

vi.mock('@/lib/noShowProtection/charge', () => ({
  assessAndChargeNoShowFee: mocks.assessAndChargeNoShowFee,
}))

vi.mock('@/lib/noShowProtection/flag', () => ({
  noShowProtectionEnabled: mocks.noShowProtectionEnabled,
}))

import { runLateChangeFeeOrchestration } from './lateChangeFeeOrchestration'

const PREVIOUS = new Date('2026-08-07T14:00:00.000Z')

function run(over: Partial<Parameters<typeof runLateChangeFeeOrchestration>[0]> = {}) {
  return runLateChangeFeeOrchestration({
    bookingId: 'bk_1',
    lateChangeApplied: true,
    previousScheduledFor: PREVIOUS,
    priorStatus: BookingStatus.ACCEPTED,
    operation: 'TEST',
    ...over,
  })
}

function charged(amount: string, alreadyCharged = false) {
  return {
    kind: 'ATTEMPTED' as const,
    status: NoShowFeeStatus.CHARGED,
    amount,
    stripePaymentIntentId: 'pi_1',
    alreadyCharged,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.noShowProtectionEnabled.mockReturnValue(true)
  mocks.assessAndChargeNoShowFee.mockResolvedValue(charged('40.00'))
})

describe('runLateChangeFeeOrchestration', () => {
  // THE regression guard. Assessing against the row would read the new time.
  it('assesses the window against the PRE-move instant, not the booking row', async () => {
    await run()

    expect(mocks.assessAndChargeNoShowFee).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'bk_1',
        reason: NoShowFeeReason.LATE_RESCHEDULE,
        windowAnchor: PREVIOUS,
      }),
    )
  })

  it('reports the charged amount in cents', async () => {
    await expect(run()).resolves.toEqual({ chargedCents: 4000 })
  })

  it('charges nothing when the move was not a late change', async () => {
    await expect(run({ lateChangeApplied: false })).resolves.toEqual({
      chargedCents: 0,
    })
    expect(mocks.assessAndChargeNoShowFee).not.toHaveBeenCalled()
  })

  // The stamp closes the refund hole on its own; the fee is the flag-gated
  // deterrent on top. With the flag off we must not even reach the assessor.
  it('charges nothing, and does not call the assessor, when the flag is off', async () => {
    mocks.noShowProtectionEnabled.mockReturnValue(false)

    await expect(run()).resolves.toEqual({ chargedCents: 0 })
    expect(mocks.assessAndChargeNoShowFee).not.toHaveBeenCalled()
  })

  // M6: only money that actually left the card is reported as charged.
  it.each([
    ['a replayed charge', charged('40.00', true)],
    [
      'a FAILED charge',
      {
        kind: 'ATTEMPTED' as const,
        status: NoShowFeeStatus.FAILED,
        amount: '40.00',
        stripePaymentIntentId: null,
        alreadyCharged: false,
      },
    ],
    ['a SKIPPED fee', { kind: 'SKIPPED' as const, reason: 'no_card_on_file', amount: '40.00' }],
    [
      'a NOT_CHARGEABLE outcome',
      { kind: 'NOT_CHARGEABLE' as const, reason: 'outside_cancel_window' },
    ],
  ])('reports 0 cents for %s', async (_label, outcome) => {
    mocks.assessAndChargeNoShowFee.mockResolvedValue(outcome)

    await expect(run()).resolves.toEqual({ chargedCents: 0 })
  })

  // The reschedule is already committed. A charge failure must never propagate
  // and turn a successful move into a 500 the client reads as "it didn't work".
  it('swallows a thrown charge error and reports nothing charged', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.assessAndChargeNoShowFee.mockRejectedValue(new Error('stripe boom'))

    await expect(run()).resolves.toEqual({ chargedCents: 0 })
    expect(spy).toHaveBeenCalled()

    spy.mockRestore()
  })

  // Only a confirmed booking is billable; the assessor enforces it, but the
  // status has to actually reach it rather than being dropped on the floor.
  it('passes the prior status through to the assessor', async () => {
    await run({ priorStatus: BookingStatus.PENDING })

    expect(mocks.assessAndChargeNoShowFee).toHaveBeenCalledWith(
      expect.objectContaining({ priorStatus: BookingStatus.PENDING }),
    )
  })
})
