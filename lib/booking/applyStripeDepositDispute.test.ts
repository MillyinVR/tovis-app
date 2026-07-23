// M4 (payment-booking-integrity-audit-plan.md) — a dispute on the DISCOVERY
// DEPOSIT PaymentIntent rides its own charge, distinct from the final bill, so
// it never matches applyStripeDisputeInTransaction (which resolves by the
// final-bill stripePaymentIntentId). applyStripeDepositDisputeInTransaction
// resolves the booking by depositStripePaymentIntentId and records the freeze on
// depositDisputedAt: set on OPEN/LOST, cleared on WON, field-level idempotent.
import { afterEach, describe, expect, it, vi } from 'vitest'

import { asTestTransactionClient } from '@/lib/typed/prismaTestClient'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { applyStripeDepositDisputeInTransaction } from './writeBoundary'

afterEach(() => vi.restoreAllMocks())

function makeTx(args: {
  /** null => no booking carries this deposit PI. */
  depositDisputedAt: Date | null | undefined
  exists?: boolean
}) {
  const exists = args.exists ?? true
  const update = vi.fn(async () => ({ id: 'booking_1' }))
  const findFirst = vi.fn(async () =>
    exists
      ? {
          id: 'booking_1',
          professionalId: 'pro_1',
          depositDisputedAt: args.depositDisputedAt ?? null,
        }
      : null,
  )

  const tx = asTestTransactionClient({
    $executeRaw: vi.fn(async () => 1),
    booking: { findFirst, update },
  })

  return { tx, update, findFirst }
}

const FROZEN_AT = new Date('2026-07-22T00:00:00.000Z')
const NOW = new Date('2026-07-23T00:00:00.000Z')

describe('applyStripeDepositDisputeInTransaction', () => {
  it('OPEN on an unfrozen deposit sets depositDisputedAt', async () => {
    const { tx, update } = makeTx({ depositDisputedAt: null })

    const result = await applyStripeDepositDisputeInTransaction(tx, {
      depositPaymentIntentId: 'pi_deposit',
      outcome: 'OPEN',
      now: NOW,
    })

    expect(result).toEqual({ bookingId: 'booking_1' })
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'booking_1' },
        data: { depositDisputedAt: NOW },
      }),
    )
  })

  it('OPEN on an already-frozen deposit is a no-op (keeps the earliest freeze)', async () => {
    const { tx, update } = makeTx({ depositDisputedAt: FROZEN_AT })

    const result = await applyStripeDepositDisputeInTransaction(tx, {
      depositPaymentIntentId: 'pi_deposit',
      outcome: 'OPEN',
      now: NOW,
    })

    expect(result).toEqual({ bookingId: 'booking_1' })
    expect(update).not.toHaveBeenCalled()
  })

  it('LOST on an unfrozen deposit sets the freeze (funds gone via chargeback)', async () => {
    const { tx, update } = makeTx({ depositDisputedAt: null })

    await applyStripeDepositDisputeInTransaction(tx, {
      depositPaymentIntentId: 'pi_deposit',
      outcome: 'LOST',
      now: NOW,
    })

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { depositDisputedAt: NOW } }),
    )
  })

  it('WON clears the freeze so deposit refunds may resume', async () => {
    const { tx, update } = makeTx({ depositDisputedAt: FROZEN_AT })

    const result = await applyStripeDepositDisputeInTransaction(tx, {
      depositPaymentIntentId: 'pi_deposit',
      outcome: 'WON',
      now: NOW,
    })

    expect(result).toEqual({ bookingId: 'booking_1' })
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { depositDisputedAt: null } }),
    )
  })

  it('WON on a deposit that was never frozen is a no-op (never invents a clear)', async () => {
    const { tx, update } = makeTx({ depositDisputedAt: null })

    await applyStripeDepositDisputeInTransaction(tx, {
      depositPaymentIntentId: 'pi_deposit',
      outcome: 'WON',
      now: NOW,
    })

    expect(update).not.toHaveBeenCalled()
  })

  it('returns null when no booking carries the deposit PI', async () => {
    const { tx, update } = makeTx({ depositDisputedAt: null, exists: false })

    const result = await applyStripeDepositDisputeInTransaction(tx, {
      depositPaymentIntentId: 'pi_unknown',
      outcome: 'OPEN',
      now: NOW,
    })

    expect(result).toBeNull()
    expect(update).not.toHaveBeenCalled()
  })

  it('throws on a blank deposit PI (never a silent no-match)', async () => {
    const { tx } = makeTx({ depositDisputedAt: null })

    await expect(
      applyStripeDepositDisputeInTransaction(tx, {
        depositPaymentIntentId: '   ',
        outcome: 'OPEN',
        now: NOW,
      }),
    ).rejects.toThrow()
  })
})
