// M13 (payment-booking-integrity-audit-plan.md §19) — direct write-boundary
// coverage for the SERVICE (final-bill) dispute applier's state machine.
//
// The deposit dispute applier (applyStripeDepositDispute.test.ts) and the fee
// dispute applier (tests/integration/no-show-fee-charge.test.ts) each got a
// direct state-machine test; the SERVICE applier only had routing-level coverage
// (handleWebhookEvent.dispute.test.ts, which MOCKS applyStripeDisputeInTransaction).
// Its comment claims the state machine is "covered separately" — it was not. This
// file pins performLockedApplyStripeDispute directly:
//   OPEN / LOST      -> stripePaymentStatus = DISPUTED  (freeze the refund path)
//   WON              -> stripePaymentStatus = SUCCEEDED  (restore) — but ONLY from
//                       a currently-DISPUTED booking (never clobber one that moved on)
//   replay / at-target -> no-op (event-id dedupe + idempotent target state)
//   no booking on this PI -> null; blank PI / event id -> FORBIDDEN
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BookingStatus, StripePaymentStatus } from '@prisma/client'

import { asTestTransactionClient } from '@/lib/typed/prismaTestClient'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { applyStripeDisputeInTransaction } from './writeBoundary'

afterEach(() => vi.restoreAllMocks())

const PI = 'pi_service_1'
const EVENT = 'evt_dispute_1'

/**
 * A fake transaction client for the service dispute applier. The applier resolves
 * the booking via findBookingForStripeWebhook (findFirst by PI → { id,
 * professionalId }), takes the pro-schedule advisory lock ($executeRaw), then
 * performLockedApplyStripeDispute reads the full record (findUnique) and updates.
 */
function makeTx(args: {
  /** null => no booking carries this PI (lookup miss → applier returns null). */
  exists?: boolean
  stripePaymentStatus?: StripePaymentStatus
  stripeLastEventId?: string | null
  status?: BookingStatus
}) {
  const exists = args.exists ?? true
  const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'booking_1',
    status: args.status ?? BookingStatus.ACCEPTED,
    ...data,
  }))
  const findFirst = vi.fn(async () =>
    exists ? { id: 'booking_1', professionalId: 'pro_1' } : null,
  )
  const findUnique = vi.fn(async () => ({
    id: 'booking_1',
    status: args.status ?? BookingStatus.ACCEPTED,
    stripePaymentStatus:
      args.stripePaymentStatus ?? StripePaymentStatus.SUCCEEDED,
    stripeLastEventId:
      args.stripeLastEventId === undefined ? 'evt_prior' : args.stripeLastEventId,
  }))

  const tx = asTestTransactionClient({
    $executeRaw: vi.fn(async () => 1),
    booking: { findFirst, findUnique, update },
  })

  return { tx, update, findFirst, findUnique }
}

describe('applyStripeDisputeInTransaction — SERVICE dispute state machine', () => {
  it('OPEN on a SUCCEEDED booking freezes it to DISPUTED', async () => {
    const { tx, update } = makeTx({
      stripePaymentStatus: StripePaymentStatus.SUCCEEDED,
    })

    const result = await applyStripeDisputeInTransaction(tx, {
      bookingIdHint: null,
      stripePaymentIntentId: PI,
      stripeEventId: EVENT,
      outcome: 'OPEN',
    })

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'booking_1' },
        data: {
          stripePaymentStatus: StripePaymentStatus.DISPUTED,
          stripePaymentIntentId: PI,
          stripeLastEventId: EVENT,
        },
      }),
    )
    expect(result?.meta.mutated).toBe(true)
    expect(result?.bookingId).toBe('booking_1')
  })

  it('LOST on a SUCCEEDED booking also freezes it to DISPUTED (funds gone via chargeback)', async () => {
    const { tx, update } = makeTx({
      stripePaymentStatus: StripePaymentStatus.SUCCEEDED,
    })

    const result = await applyStripeDisputeInTransaction(tx, {
      bookingIdHint: null,
      stripePaymentIntentId: PI,
      stripeEventId: EVENT,
      outcome: 'LOST',
    })

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stripePaymentStatus: StripePaymentStatus.DISPUTED,
        }),
      }),
    )
    expect(result?.meta.mutated).toBe(true)
  })

  it('WON on a DISPUTED booking restores it to SUCCEEDED (refunds resume)', async () => {
    const { tx, update } = makeTx({
      stripePaymentStatus: StripePaymentStatus.DISPUTED,
    })

    const result = await applyStripeDisputeInTransaction(tx, {
      bookingIdHint: null,
      stripePaymentIntentId: PI,
      stripeEventId: EVENT,
      outcome: 'WON',
    })

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stripePaymentStatus: StripePaymentStatus.SUCCEEDED,
        }),
      }),
    )
    expect(result?.meta.mutated).toBe(true)
  })

  it('WON on a booking that is NOT DISPUTED is a no-op (never clobbers a booking that moved on)', async () => {
    // A won dispute only RESTORES a booking we previously froze. If a refund
    // landed (or anything moved the status off DISPUTED) in the meantime, WON
    // must not overwrite it.
    const { tx, update } = makeTx({
      stripePaymentStatus: StripePaymentStatus.REFUNDED,
    })

    const result = await applyStripeDisputeInTransaction(tx, {
      bookingIdHint: null,
      stripePaymentIntentId: PI,
      stripeEventId: EVENT,
      outcome: 'WON',
    })

    expect(update).not.toHaveBeenCalled()
    expect(result?.meta.mutated).toBe(false)
    expect(result?.bookingId).toBe('booking_1')
  })

  it('a replay of the SAME event id is a no-op', async () => {
    const { tx, update } = makeTx({
      stripePaymentStatus: StripePaymentStatus.SUCCEEDED,
      stripeLastEventId: EVENT, // this event already touched the booking
    })

    const result = await applyStripeDisputeInTransaction(tx, {
      bookingIdHint: null,
      stripePaymentIntentId: PI,
      stripeEventId: EVENT,
      outcome: 'OPEN',
    })

    expect(update).not.toHaveBeenCalled()
    expect(result?.meta.mutated).toBe(false)
  })

  it('a non-restoring event whose target state is already recorded is a no-op (created → funds_withdrawn → closed-lost all map to DISPUTED)', async () => {
    const { tx, update } = makeTx({
      stripePaymentStatus: StripePaymentStatus.DISPUTED, // already frozen
      stripeLastEventId: 'evt_earlier_open',
    })

    const result = await applyStripeDisputeInTransaction(tx, {
      bookingIdHint: null,
      stripePaymentIntentId: PI,
      stripeEventId: 'evt_funds_withdrawn', // a different, later OPEN-mapped event
      outcome: 'OPEN',
    })

    expect(update).not.toHaveBeenCalled()
    expect(result?.meta.mutated).toBe(false)
  })

  it('returns null when no booking carries this payment intent', async () => {
    const { tx, update } = makeTx({ exists: false })

    const result = await applyStripeDisputeInTransaction(tx, {
      bookingIdHint: null,
      stripePaymentIntentId: 'pi_unknown',
      stripeEventId: EVENT,
      outcome: 'OPEN',
    })

    expect(result).toBeNull()
    expect(update).not.toHaveBeenCalled()
  })

  it('throws on a blank payment intent id (never a silent no-match)', async () => {
    const { tx } = makeTx({})

    await expect(
      applyStripeDisputeInTransaction(tx, {
        bookingIdHint: null,
        stripePaymentIntentId: '   ',
        stripeEventId: EVENT,
        outcome: 'OPEN',
      }),
    ).rejects.toThrow()
  })

  it('throws on a blank event id', async () => {
    const { tx } = makeTx({})

    await expect(
      applyStripeDisputeInTransaction(tx, {
        bookingIdHint: null,
        stripePaymentIntentId: PI,
        stripeEventId: '',
        outcome: 'OPEN',
      }),
    ).rejects.toThrow()
  })
})
