import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingDepositStatus,
  BookingStatus,
  NoShowFeeReason,
  NoShowFeeStatus,
  NoShowFeeType,
  Prisma,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  bookingFindUnique: vi.fn(),
  paymentIntentsCreate: vi.fn(),
  recordNoShowFeeCharge: vi.fn(),
  recordNoShowDepositKept: vi.fn(),
  flagEnabled: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { booking: { findUnique: mocks.bookingFindUnique } },
}))

vi.mock('@/lib/stripe/server', () => ({
  getStripe: () => ({
    paymentIntents: { create: mocks.paymentIntentsCreate },
  }),
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  recordNoShowFeeCharge: mocks.recordNoShowFeeCharge,
  recordNoShowDepositKept: mocks.recordNoShowDepositKept,
  NO_SHOW_FEE_CHARGE_KIND: 'NO_SHOW_FEE',
}))

vi.mock('@/lib/noShowProtection/flag', () => ({
  noShowProtectionEnabled: mocks.flagEnabled,
}))

import { assessAndChargeNoShowFee } from '@/lib/noShowProtection/charge'

const D = (v: string | number) => new Prisma.Decimal(v)

// A confirmed booking whose pro has FLAT $25 protection on, client has a default
// card, and the pro is connected. Override per-test.
function bookingFixture(over: Record<string, unknown> = {}) {
  return {
    id: 'bk_1',
    clientId: 'cl_1',
    professionalId: 'pro_1',
    scheduledFor: new Date('2026-07-10T18:00:00.000Z'),
    subtotalSnapshot: D('120'),
    noShowFeeStatus: null,
    client: {
      stripeCustomerId: 'cus_1',
      paymentMethods: [{ stripePaymentMethodId: 'pm_1' }],
    },
    professional: {
      noShowSettings: {
        enabled: true,
        feeType: NoShowFeeType.FLAT,
        feeFlatAmount: D('25'),
        feePercent: null,
        cancelWindowHours: 24,
        chargeNoShow: true,
        chargeLateCancel: true,
      },
      paymentSettings: {
        stripeAccountId: 'acct_1',
        acceptStripeCard: true,
        stripeChargesEnabled: true,
      },
    },
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.flagEnabled.mockReturnValue(true)
  // Returns a promise so the best-effort `.catch(...)` chain in the suppression
  // branch is valid.
  mocks.recordNoShowDepositKept.mockResolvedValue(undefined)
})

describe('assessAndChargeNoShowFee gating', () => {
  it('does nothing when the flag is off', async () => {
    mocks.flagEnabled.mockReturnValue(false)
    const out = await assessAndChargeNoShowFee({
      bookingId: 'bk_1',
      reason: NoShowFeeReason.NO_SHOW,
    })
    expect(out).toEqual({ kind: 'NOT_CHARGEABLE', reason: 'flag_off' })
    expect(mocks.bookingFindUnique).not.toHaveBeenCalled()
    expect(mocks.paymentIntentsCreate).not.toHaveBeenCalled()
  })

  it('does nothing when the pro has protection off', async () => {
    mocks.bookingFindUnique.mockResolvedValue(
      bookingFixture({ professional: { noShowSettings: null, paymentSettings: null } }),
    )
    const out = await assessAndChargeNoShowFee({
      bookingId: 'bk_1',
      reason: NoShowFeeReason.NO_SHOW,
    })
    expect(out).toEqual({ kind: 'NOT_CHARGEABLE', reason: 'protection_off' })
    expect(mocks.paymentIntentsCreate).not.toHaveBeenCalled()
  })

  it('short-circuits when the fee was already charged', async () => {
    mocks.bookingFindUnique.mockResolvedValue(
      bookingFixture({ noShowFeeStatus: NoShowFeeStatus.CHARGED }),
    )
    const out = await assessAndChargeNoShowFee({
      bookingId: 'bk_1',
      reason: NoShowFeeReason.NO_SHOW,
    })
    expect(out).toMatchObject({ kind: 'ATTEMPTED', status: 'CHARGED', alreadyCharged: true })
    expect(mocks.paymentIntentsCreate).not.toHaveBeenCalled()
    expect(mocks.recordNoShowFeeCharge).not.toHaveBeenCalled()
  })

  it('does not charge a no-show when chargeNoShow is off', async () => {
    const fix = bookingFixture()
    fix.professional.noShowSettings.chargeNoShow = false
    mocks.bookingFindUnique.mockResolvedValue(fix)
    const out = await assessAndChargeNoShowFee({
      bookingId: 'bk_1',
      reason: NoShowFeeReason.NO_SHOW,
    })
    expect(out).toEqual({ kind: 'NOT_CHARGEABLE', reason: 'no_show_charging_off' })
  })

  it('suppresses a no-show fee when a discovery deposit was kept (PAID) — M15 POLICY analog', async () => {
    // A kept deposit IS the no-show penalty; charging a fee too would double-hit.
    mocks.bookingFindUnique.mockResolvedValue(
      bookingFixture({ depositStatus: BookingDepositStatus.PAID }),
    )
    const out = await assessAndChargeNoShowFee({
      bookingId: 'bk_1',
      reason: NoShowFeeReason.NO_SHOW,
    })
    expect(out).toEqual({
      kind: 'NOT_CHARGEABLE',
      reason: 'deposit_kept_suppresses_fee',
    })
    expect(mocks.paymentIntentsCreate).not.toHaveBeenCalled()
    expect(mocks.recordNoShowFeeCharge).not.toHaveBeenCalled()
    // The client is told their deposit was kept (their only no-show money notice).
    expect(mocks.recordNoShowDepositKept).toHaveBeenCalledWith({
      bookingId: 'bk_1',
      professionalId: 'pro_1',
    })
  })

  it('still charges a no-show fee when no deposit was kept (PENDING/NONE)', async () => {
    mocks.bookingFindUnique.mockResolvedValue(
      bookingFixture({ depositStatus: BookingDepositStatus.PENDING }),
    )
    mocks.paymentIntentsCreate.mockResolvedValue({ id: 'pi_ns', status: 'succeeded' })
    const out = await assessAndChargeNoShowFee({
      bookingId: 'bk_1',
      reason: NoShowFeeReason.NO_SHOW,
    })
    expect(out).toMatchObject({ kind: 'ATTEMPTED', status: NoShowFeeStatus.CHARGED })
    expect(mocks.paymentIntentsCreate).toHaveBeenCalledTimes(1)
  })

  it('does NOT let a PAID deposit suppress a LATE_CANCEL fee (that gate lives in the cancel route)', async () => {
    // The cancel route suppresses only a FORFEITED deposit and still charges when
    // a wide-window deposit was REFUNDED (or its refund FAILED) — so charge.ts must
    // not second-guess it by keying on depositStatus for LATE_CANCEL. The
    // deposit-kept gate is NO_SHOW-only.
    mocks.bookingFindUnique.mockResolvedValue(
      bookingFixture({ depositStatus: BookingDepositStatus.PAID }),
    )
    mocks.paymentIntentsCreate.mockResolvedValue({ id: 'pi_lc', status: 'succeeded' })
    const out = await assessAndChargeNoShowFee({
      bookingId: 'bk_1',
      reason: NoShowFeeReason.LATE_CANCEL,
      priorStatus: BookingStatus.ACCEPTED,
      now: new Date('2026-07-10T06:00:00.000Z'), // 12h before, inside 24h window
    })
    expect(out).toMatchObject({ kind: 'ATTEMPTED', status: NoShowFeeStatus.CHARGED })
    expect(mocks.paymentIntentsCreate).toHaveBeenCalledTimes(1)
  })

  it('charges from the agreed snapshot, not the pro\'s live settings (M15)', async () => {
    // Pro's LIVE flat fee is $99, but the client agreed to a $25 snapshot at
    // booking — charge the agreed $25.
    const fix = bookingFixture({
      cancellationPolicySnapshot: {
        feeType: NoShowFeeType.FLAT,
        feeFlatAmount: '25.00',
        feePercent: null,
        cancelWindowHours: 24,
        chargeNoShow: true,
        chargeLateCancel: true,
      },
    })
    fix.professional.noShowSettings.feeFlatAmount = D('99')
    mocks.bookingFindUnique.mockResolvedValue(fix)
    mocks.paymentIntentsCreate.mockResolvedValue({ id: 'pi_snap', status: 'succeeded' })

    const out = await assessAndChargeNoShowFee({
      bookingId: 'bk_1',
      reason: NoShowFeeReason.NO_SHOW,
    })

    expect(out).toMatchObject({ status: NoShowFeeStatus.CHARGED, amount: '25.00' })
    expect(mocks.paymentIntentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2500 }), // $25 agreed, NOT $99 live
      expect.anything(),
    )
  })

  it('a snapshot governs the window too — a wider live window can\'t re-open a late cancel', async () => {
    // Agreed window 24h; pro later widened live to 72h. A cancel 48h out is inside
    // the live 72h but outside the agreed 24h → not chargeable.
    const fix = bookingFixture({
      scheduledFor: new Date('2026-07-10T18:00:00.000Z'),
      cancellationPolicySnapshot: {
        feeType: NoShowFeeType.FLAT,
        feeFlatAmount: '25.00',
        feePercent: null,
        cancelWindowHours: 24,
        chargeNoShow: true,
        chargeLateCancel: true,
      },
    })
    fix.professional.noShowSettings.cancelWindowHours = 72
    mocks.bookingFindUnique.mockResolvedValue(fix)

    const out = await assessAndChargeNoShowFee({
      bookingId: 'bk_1',
      reason: NoShowFeeReason.LATE_CANCEL,
      priorStatus: BookingStatus.ACCEPTED,
      now: new Date('2026-07-08T18:00:00.000Z'), // 48h before
    })
    expect(out).toEqual({ kind: 'NOT_CHARGEABLE', reason: 'outside_cancel_window' })
    expect(mocks.paymentIntentsCreate).not.toHaveBeenCalled()
  })

  it('does not charge a late cancel outside the window', async () => {
    mocks.bookingFindUnique.mockResolvedValue(bookingFixture())
    const out = await assessAndChargeNoShowFee({
      bookingId: 'bk_1',
      reason: NoShowFeeReason.LATE_CANCEL,
      now: new Date('2026-07-08T18:00:00.000Z'), // 48h before, window 24h
    })
    expect(out).toEqual({ kind: 'NOT_CHARGEABLE', reason: 'outside_cancel_window' })
    expect(mocks.paymentIntentsCreate).not.toHaveBeenCalled()
  })

  it('does not charge a late cancel of an unconfirmed (PENDING) booking', async () => {
    mocks.bookingFindUnique.mockResolvedValue(bookingFixture())
    const out = await assessAndChargeNoShowFee({
      bookingId: 'bk_1',
      reason: NoShowFeeReason.LATE_CANCEL,
      priorStatus: BookingStatus.PENDING,
      now: new Date('2026-07-10T12:00:00.000Z'), // inside window
    })
    expect(out).toEqual({ kind: 'NOT_CHARGEABLE', reason: 'not_confirmed' })
    expect(mocks.paymentIntentsCreate).not.toHaveBeenCalled()
  })

  it('records SKIPPED when the client has no saved card', async () => {
    mocks.bookingFindUnique.mockResolvedValue(
      bookingFixture({
        client: { stripeCustomerId: null, paymentMethods: [] },
      }),
    )
    const out = await assessAndChargeNoShowFee({
      bookingId: 'bk_1',
      reason: NoShowFeeReason.NO_SHOW,
    })
    expect(out).toMatchObject({ kind: 'SKIPPED', reason: 'no_card_on_file' })
    expect(mocks.recordNoShowFeeCharge).toHaveBeenCalledWith(
      expect.objectContaining({ status: NoShowFeeStatus.SKIPPED }),
    )
    expect(mocks.paymentIntentsCreate).not.toHaveBeenCalled()
  })

  it('records SKIPPED when the pro is not connected for charges', async () => {
    const fix = bookingFixture()
    fix.professional.paymentSettings.stripeChargesEnabled = false
    mocks.bookingFindUnique.mockResolvedValue(fix)
    const out = await assessAndChargeNoShowFee({
      bookingId: 'bk_1',
      reason: NoShowFeeReason.NO_SHOW,
    })
    expect(out).toMatchObject({ kind: 'SKIPPED', reason: 'pro_not_connected' })
    expect(mocks.recordNoShowFeeCharge).toHaveBeenCalledWith(
      expect.objectContaining({ status: NoShowFeeStatus.SKIPPED }),
    )
  })
})

describe('assessAndChargeNoShowFee charging', () => {
  it('charges the default card off-session and routes to the pro (destination charge)', async () => {
    mocks.bookingFindUnique.mockResolvedValue(bookingFixture())
    mocks.paymentIntentsCreate.mockResolvedValue({ id: 'pi_1', status: 'succeeded' })

    const out = await assessAndChargeNoShowFee({
      bookingId: 'bk_1',
      reason: NoShowFeeReason.NO_SHOW,
    })

    expect(mocks.paymentIntentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 2500,
        currency: 'usd',
        customer: 'cus_1',
        payment_method: 'pm_1',
        off_session: true,
        confirm: true,
        transfer_data: { destination: 'acct_1' },
        // The webhook guard branches on this kind — pin that the producer stamps
        // it, so the fee PI is never misrouted into the final-bill applier.
        metadata: expect.objectContaining({ kind: 'NO_SHOW_FEE', bookingId: 'bk_1' }),
      }),
      { idempotencyKey: 'tovis:no-show-fee:bk_1' },
    )
    expect(out).toMatchObject({
      kind: 'ATTEMPTED',
      status: NoShowFeeStatus.CHARGED,
      amount: '25.00',
      stripePaymentIntentId: 'pi_1',
    })
    expect(mocks.recordNoShowFeeCharge).toHaveBeenCalledWith(
      expect.objectContaining({
        status: NoShowFeeStatus.CHARGED,
        reason: NoShowFeeReason.NO_SHOW,
        stripePaymentIntentId: 'pi_1',
      }),
    )
  })

  it('records FAILED when the off-session charge is declined', async () => {
    mocks.bookingFindUnique.mockResolvedValue(bookingFixture())
    mocks.paymentIntentsCreate.mockRejectedValue(
      Object.assign(new Error('card_declined'), {
        raw: { payment_intent: { id: 'pi_fail' } },
      }),
    )

    const out = await assessAndChargeNoShowFee({
      bookingId: 'bk_1',
      reason: NoShowFeeReason.NO_SHOW,
    })

    expect(out).toMatchObject({
      kind: 'ATTEMPTED',
      status: NoShowFeeStatus.FAILED,
      stripePaymentIntentId: 'pi_fail',
    })
    expect(mocks.recordNoShowFeeCharge).toHaveBeenCalledWith(
      expect.objectContaining({ status: NoShowFeeStatus.FAILED }),
    )
  })

  it('charges a late cancel inside the window', async () => {
    mocks.bookingFindUnique.mockResolvedValue(bookingFixture())
    mocks.paymentIntentsCreate.mockResolvedValue({ id: 'pi_2', status: 'succeeded' })

    const out = await assessAndChargeNoShowFee({
      bookingId: 'bk_1',
      reason: NoShowFeeReason.LATE_CANCEL,
      now: new Date('2026-07-10T12:00:00.000Z'), // 6h before start
    })

    expect(out).toMatchObject({ kind: 'ATTEMPTED', status: NoShowFeeStatus.CHARGED })
    expect(mocks.recordNoShowFeeCharge).toHaveBeenCalledWith(
      expect.objectContaining({ reason: NoShowFeeReason.LATE_CANCEL }),
    )
  })
})
