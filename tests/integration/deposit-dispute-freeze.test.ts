// tests/integration/deposit-dispute-freeze.test.ts
//
// M4 / M13 §19(1) — the DISCOVERY DEPOSIT dispute freeze, driven against real
// Postgres. Fills the coverage gap the §15 D9 refactor surfaced: the deposit
// dispute applier had NO real-DB suite. It was covered only by
// lib/booking/applyStripeDepositDispute.test.ts (a mocked-tx unit test) and by
// routing-level webhook tests whose write boundary is mocked out — so nothing
// proved the freeze against an actual `Booking` row, and nothing proved the two
// money paths the freeze EXISTS to stop (refundDiscoveryDeposit and the M3 retry
// sweep) actually stop when it is set.
//
// This is also the deposit-side twin of the fee dispute e2e already living in
// no-show-fee-charge.test.ts, which matters after D9 (#757): both appliers now
// share ONE freeze rule, and the fee half is the half that was already driven.
//
// Only Stripe's network boundary is mocked. `refunds.create` (reverse_transfer on
// a destination charge) cannot be driven for real — dev has no connected account,
// the standing limitation on every money card — so the assertions are the DB row
// plus WHETHER Stripe was called at all, which is exactly what a freeze is about.
//
// Run with `pnpm test:integration` (or the whole dir in CI via integration.yml).
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  BookingDepositStatus,
  BookingRefundStatus,
  BookingRefundTrigger,
  BookingStatus,
  Prisma,
  PrismaClient,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
} from '@prisma/client'

const stripe = vi.hoisted(() => ({ refundsCreate: vi.fn() }))
vi.mock('@/lib/stripe/server', () => ({
  getStripe: () => ({ refunds: { create: stripe.refundsCreate } }),
}))

import { applyStripeDepositDisputeInTransaction } from '@/lib/booking/writeBoundary'
import { refundDiscoveryDeposit } from '@/lib/booking/refunds'
import {
  retryFailedAutoCancelRefunds,
  DEPOSIT_RETRY_BACKOFF_MS,
} from '@/lib/booking/refundRetrySweep'
import { handleStripeEvent } from '@/lib/stripe/handleWebhookEvent'
import { asTestStripeEvent } from '@/lib/typed/stripeTestEvent'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with: pnpm test:integration')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const tag = `dep_dispute_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
const ZONE = 'America/Los_Angeles'

const DEPOSIT_CENTS = 2000
const FEE_CENTS = 500

type Fixtures = {
  tenantId: string
  professionalId: string
  serviceId: string
  locationId: string
  clientId: string
}

let fx: Fixtures
const seededUserEmails: string[] = []

/** A PAID discovery deposit ($20 + $5 fee) on its own PI, optionally frozen. */
async function depositBooking(args: {
  paymentIntentId: string
  disputedAt?: Date | null
  status?: BookingStatus
  cancelledAt?: Date | null
  cancelledByRole?: Role | null
}): Promise<string> {
  const booking = await db.booking.create({
    data: {
      clientId: fx.clientId,
      professionalId: fx.professionalId,
      serviceId: fx.serviceId,
      scheduledFor: new Date(Date.now() + 72 * 60 * 60 * 1000),
      status: args.status ?? BookingStatus.ACCEPTED,
      locationType: ServiceLocationType.SALON,
      locationId: fx.locationId,
      locationTimeZone: ZONE,
      subtotalSnapshot: new Prisma.Decimal('120.00'),
      totalDurationMinutes: 60,
      proTenantId: fx.tenantId,
      clientHomeTenantId: fx.tenantId,
      depositStatus: BookingDepositStatus.PAID,
      depositAmount: new Prisma.Decimal('20.00'),
      discoveryFeeAmount: FEE_CENTS,
      depositStripePaymentIntentId: args.paymentIntentId,
      depositDisputedAt: args.disputedAt ?? null,
      cancelledAt: args.cancelledAt ?? null,
      cancelledByRole: args.cancelledByRole ?? null,
    },
    select: { id: true },
  })
  return booking.id
}

async function readFreeze(bookingId: string): Promise<{
  depositDisputedAt: Date | null
  noShowFeeDisputedAt: Date | null
  depositStatus: BookingDepositStatus
  depositRefundedCents: number
}> {
  return db.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: {
      depositDisputedAt: true,
      noShowFeeDisputedAt: true,
      depositStatus: true,
      depositRefundedCents: true,
    },
  })
}

beforeAll(async () => {
  const tenant = await db.tenant.create({
    data: { slug: `${tag}-tenant`, name: 'Deposit Dispute', isActive: true },
    select: { id: true },
  })

  const proEmail = `${tag}_pro@example.com`
  const proUser = await db.user.create({
    data: { email: proEmail, password: 'test-password', role: Role.PRO },
    select: { id: true },
  })
  seededUserEmails.push(proEmail)

  const pro = await db.professionalProfile.create({
    data: {
      userId: proUser.id,
      firstName: 'Deposit',
      lastName: 'Pro',
      businessName: `${tag} studio`,
      homeTenantId: tenant.id,
      timeZone: ZONE,
    },
    select: { id: true },
  })

  const location = await db.professionalLocation.create({
    data: {
      professionalId: pro.id,
      type: ProfessionalLocationType.SALON,
      name: `${tag} salon`,
      isPrimary: true,
      isBookable: true,
      timeZone: ZONE,
      workingHours: {
        mon: { enabled: true, start: '09:00', end: '18:00' },
        tue: { enabled: true, start: '09:00', end: '18:00' },
        wed: { enabled: true, start: '09:00', end: '18:00' },
        thu: { enabled: true, start: '09:00', end: '18:00' },
        fri: { enabled: true, start: '09:00', end: '18:00' },
        sat: { enabled: true, start: '09:00', end: '18:00' },
        sun: { enabled: true, start: '09:00', end: '18:00' },
      },
    },
    select: { id: true },
  })

  await db.professionalPaymentSettings.create({
    data: {
      professionalId: pro.id,
      acceptStripeCard: true,
      stripeAccountId: `acct_${tag}`,
      stripeChargesEnabled: true,
    },
  })

  const clientEmail = `${tag}_client@example.com`
  const clientUser = await db.user.create({
    data: { email: clientEmail, password: 'test-password', role: Role.CLIENT },
    select: { id: true },
  })
  seededUserEmails.push(clientEmail)
  const client = await db.clientProfile.create({
    data: {
      userId: clientUser.id,
      firstName: 'Dep',
      lastName: 'Dispute',
      homeTenantId: tenant.id,
    },
    select: { id: true },
  })

  const category = await db.serviceCategory.create({
    data: { name: `${tag} category`, slug: `${tag}-category`, isActive: true },
    select: { id: true },
  })
  const service = await db.service.create({
    data: {
      name: `${tag} service`,
      categoryId: category.id,
      defaultDurationMinutes: 60,
      minPrice: new Prisma.Decimal('50.00'),
      isActive: true,
    },
    select: { id: true },
  })

  fx = {
    tenantId: tenant.id,
    professionalId: pro.id,
    serviceId: service.id,
    locationId: location.id,
    clientId: client.id,
  }
}, 60_000)

afterEach(async () => {
  stripe.refundsCreate.mockReset()
  await db.bookingRefund.deleteMany({
    where: { booking: { professionalId: fx.professionalId } },
  })
  await db.clientNotification.deleteMany({ where: { clientId: fx.clientId } })
  await db.booking.deleteMany({ where: { professionalId: fx.professionalId } })
})

afterAll(async () => {
  await db.bookingRefund.deleteMany({
    where: { booking: { professionalId: fx.professionalId } },
  })
  await db.clientNotification.deleteMany({ where: { clientId: fx.clientId } })
  await db.booking.deleteMany({ where: { professionalId: fx.professionalId } })
  await db.professionalPaymentSettings.deleteMany({
    where: { professionalId: fx.professionalId },
  })
  await db.professionalLocation.deleteMany({ where: { name: `${tag} salon` } })
  await db.clientProfile.deleteMany({ where: { lastName: 'Dispute' } })
  await db.professionalProfile.deleteMany({ where: { businessName: `${tag} studio` } })
  await db.service.deleteMany({ where: { name: `${tag} service` } })
  await db.serviceCategory.deleteMany({ where: { slug: `${tag}-category` } })
  await db.user.deleteMany({ where: { email: { in: seededUserEmails } } })
  await db.tenant.deleteMany({ where: { slug: `${tag}-tenant` } })
  await db.$disconnect()
}, 60_000)

// ---------------------------------------------------------------------------
// The applier itself, on a real row. Post-D9 (#757) this and the no-show-fee
// applier share one internal freeze rule, so these cases guard the DEPOSIT half
// of that shared rule — the half that had no real-DB coverage.
// ---------------------------------------------------------------------------
describe('applyStripeDepositDisputeInTransaction — real Postgres', () => {
  it('OPEN freezes, a later replay keeps the EARLIEST, WON clears, WON again no-ops', async () => {
    const pi = `pi_dep_${tag}_lifecycle`
    const bookingId = await depositBooking({ paymentIntentId: pi })
    const first = new Date('2026-07-24T10:00:00.000Z')
    const later = new Date('2026-07-24T12:00:00.000Z')

    const open = await db.$transaction((tx) =>
      applyStripeDepositDisputeInTransaction(tx, {
        depositPaymentIntentId: pi,
        outcome: 'OPEN',
        now: first,
      }),
    )
    expect(open).toEqual({ bookingId })
    expect((await readFreeze(bookingId)).depositDisputedAt).toEqual(first)

    // Stripe re-delivers; a LOST arriving later must not move the stamp forward.
    // The freeze is "when the money first came under threat", not "last event".
    const replay = await db.$transaction((tx) =>
      applyStripeDepositDisputeInTransaction(tx, {
        depositPaymentIntentId: pi,
        outcome: 'LOST',
        now: later,
      }),
    )
    expect(replay).toEqual({ bookingId })
    expect((await readFreeze(bookingId)).depositDisputedAt).toEqual(first)

    const won = await db.$transaction((tx) =>
      applyStripeDepositDisputeInTransaction(tx, {
        depositPaymentIntentId: pi,
        outcome: 'WON',
        now: later,
      }),
    )
    expect(won).toEqual({ bookingId })
    expect((await readFreeze(bookingId)).depositDisputedAt).toBeNull()

    // WON on an unfrozen row still MATCHES (so the webhook reports handled) but
    // must never invent a clear-write.
    const wonAgain = await db.$transaction((tx) =>
      applyStripeDepositDisputeInTransaction(tx, {
        depositPaymentIntentId: pi,
        outcome: 'WON',
        now: later,
      }),
    )
    expect(wonAgain).toEqual({ bookingId })
    expect((await readFreeze(bookingId)).depositDisputedAt).toBeNull()
  })

  it('leaves depositStatus PAID — the freeze is a separate marker (M4)', async () => {
    const pi = `pi_dep_${tag}_status`
    const bookingId = await depositBooking({ paymentIntentId: pi })

    await db.$transaction((tx) =>
      applyStripeDepositDisputeInTransaction(tx, {
        depositPaymentIntentId: pi,
        outcome: 'OPEN',
      }),
    )

    const row = await readFreeze(bookingId)
    expect(row.depositDisputedAt).toBeInstanceOf(Date)
    // A new BookingDepositStatus value would have changed every depositStatus
    // read in the app; the marker deliberately preserves the prior PAID state.
    expect(row.depositStatus).toBe(BookingDepositStatus.PAID)
  })

  it('returns null for a PI no booking carries, and never touches the fee freeze', async () => {
    const bookingId = await depositBooking({ paymentIntentId: `pi_dep_${tag}_mine` })

    const miss = await db.$transaction((tx) =>
      applyStripeDepositDisputeInTransaction(tx, {
        depositPaymentIntentId: `pi_dep_${tag}_nobody`,
        outcome: 'OPEN',
      }),
    )
    expect(miss).toBeNull()

    const row = await readFreeze(bookingId)
    expect(row.depositDisputedAt).toBeNull()
    expect(row.noShowFeeDisputedAt).toBeNull()
  })

  it('rejects a blank deposit PI with the deposit-specific message', async () => {
    await expect(
      db.$transaction((tx) =>
        applyStripeDepositDisputeInTransaction(tx, {
          depositPaymentIntentId: '   ',
          outcome: 'OPEN',
        }),
      ),
    ).rejects.toThrow(/deposit payment intent id is required/i)
  })
})

// ---------------------------------------------------------------------------
// The real webhook path, end to end: routing + applier + DB, no mocked boundary.
// The deposit twin of the fee's charge.dispute.created e2e.
// ---------------------------------------------------------------------------
describe('charge.dispute.* on a deposit PI — end to end', () => {
  function disputeEvent(args: {
    id: string
    type: 'charge.dispute.created' | 'charge.dispute.closed'
    paymentIntentId: string
    status: string
  }) {
    return asTestStripeEvent({
      id: args.id,
      type: args.type,
      data: {
        object: {
          id: `dp_${tag}`,
          object: 'dispute',
          payment_intent: args.paymentIntentId,
          status: args.status,
        },
      },
    })
  }

  it('created → freezes the deposit and reports it as the DEPOSIT flavor', async () => {
    const pi = `pi_dep_${tag}_e2e`
    const bookingId = await depositBooking({ paymentIntentId: pi })

    const result = await db.$transaction((tx) =>
      handleStripeEvent(
        tx,
        disputeEvent({
          id: `evt_${tag}_created`,
          type: 'charge.dispute.created',
          paymentIntentId: pi,
          status: 'warning_needs_response',
        }),
      ),
    )

    expect(result.handled).toBe(true)
    // Routing matters as much as the write: the deposit PI must not fall through
    // to the final-bill applier or onward to the fee applier.
    expect(result.message).toContain('deposit')

    const row = await readFreeze(bookingId)
    expect(row.depositDisputedAt).toBeInstanceOf(Date)
    expect(row.noShowFeeDisputedAt).toBeNull()
  })

  it('closed as won → clears the freeze so deposit refunds may resume', async () => {
    const pi = `pi_dep_${tag}_e2e_won`
    const bookingId = await depositBooking({
      paymentIntentId: pi,
      disputedAt: new Date('2026-07-20T00:00:00.000Z'),
    })

    const result = await db.$transaction((tx) =>
      handleStripeEvent(
        tx,
        disputeEvent({
          id: `evt_${tag}_won`,
          type: 'charge.dispute.closed',
          paymentIntentId: pi,
          status: 'won',
        }),
      ),
    )

    expect(result.handled).toBe(true)
    expect((await readFreeze(bookingId)).depositDisputedAt).toBeNull()
  })

  it('closed as lost → keeps the freeze forever (the funds are gone)', async () => {
    const pi = `pi_dep_${tag}_e2e_lost`
    const frozenAt = new Date('2026-07-20T00:00:00.000Z')
    const bookingId = await depositBooking({
      paymentIntentId: pi,
      disputedAt: frozenAt,
    })

    await db.$transaction((tx) =>
      handleStripeEvent(
        tx,
        disputeEvent({
          id: `evt_${tag}_lost`,
          type: 'charge.dispute.closed',
          paymentIntentId: pi,
          status: 'lost',
        }),
      ),
    )

    expect((await readFreeze(bookingId)).depositDisputedAt).toEqual(frozenAt)
  })
})

// ---------------------------------------------------------------------------
// What the freeze is FOR. Both money paths that could double-return a deposit
// Stripe already clawed back, each with the A/B that proves the freeze is the
// sole blocker (clear it, re-run the IDENTICAL call, watch it proceed).
// ---------------------------------------------------------------------------
describe('the freeze stops both refund paths (and only the freeze does)', () => {
  it('refundDiscoveryDeposit refuses a disputed deposit without touching the card', async () => {
    const pi = `pi_dep_${tag}_refund`
    const bookingId = await depositBooking({
      paymentIntentId: pi,
      disputedAt: new Date('2026-07-20T00:00:00.000Z'),
    })

    const refused = await refundDiscoveryDeposit({
      bookingId,
      paymentIntentId: pi,
      refundAmountCents: DEPOSIT_CENTS + FEE_CENTS,
      refundFee: true,
      trigger: BookingRefundTrigger.AUTO_CANCELLATION,
    })

    expect(refused).toEqual({ outcome: 'NOT_ATTEMPTED' })
    expect(stripe.refundsCreate).not.toHaveBeenCalled()

    const frozen = await readFreeze(bookingId)
    expect(frozen.depositStatus).toBe(BookingDepositStatus.PAID)
    expect(frozen.depositRefundedCents).toBe(0)
    // No row either: a refusal is not an attempt, so it must not look like one
    // in the money trail or become sweep fodder.
    expect(await db.bookingRefund.count({ where: { bookingId } })).toBe(0)

    // A/B — clear the freeze (as a WON dispute does) and re-run the SAME call.
    stripe.refundsCreate.mockResolvedValue({ id: `re_${tag}` })
    await db.booking.update({
      where: { id: bookingId },
      data: { depositDisputedAt: null },
    })

    const allowed = await refundDiscoveryDeposit({
      bookingId,
      paymentIntentId: pi,
      refundAmountCents: DEPOSIT_CENTS + FEE_CENTS,
      refundFee: true,
      trigger: BookingRefundTrigger.AUTO_CANCELLATION,
    })

    expect(allowed.outcome).toBe('REFUNDED')
    expect(stripe.refundsCreate).toHaveBeenCalledTimes(1)
    const settled = await readFreeze(bookingId)
    expect(settled.depositStatus).toBe(BookingDepositStatus.REFUNDED)
    expect(settled.depositRefundedCents).toBe(DEPOSIT_CENTS + FEE_CENTS)
  })

  it('the M3 retry sweep skips a disputed deposit rather than burning an attempt', async () => {
    const pi = `pi_dep_${tag}_sweep`
    const cancelledAt = new Date(Date.now() - 60 * 60 * 1000)
    const bookingId = await depositBooking({
      paymentIntentId: pi,
      disputedAt: new Date('2026-07-20T00:00:00.000Z'),
      status: BookingStatus.CANCELLED,
      cancelledAt,
      // A PRO cancel refunds deposit AND fee, so the plan the sweep re-resolves
      // genuinely wants to move money — otherwise the control below would prove
      // nothing about the freeze.
      cancelledByRole: Role.PRO,
    })

    // The FAILED row IS the attempt counter (M3): one failed auto-cancel refund
    // on the deposit PI makes this pair a sweep candidate.
    await db.bookingRefund.create({
      data: {
        bookingId,
        amountCents: DEPOSIT_CENTS + FEE_CENTS,
        currency: 'usd',
        status: BookingRefundStatus.FAILED,
        trigger: BookingRefundTrigger.AUTO_CANCELLATION,
        reverseTransfer: true,
        applicationFeeRefunded: false,
        stripePaymentIntentId: pi,
        failureCode: 'card_declined',
        failureMessage: 'seeded failure',
      },
    })

    // Past the deposit backoff (deliberately > Stripe's 24h idempotency TTL) so
    // the ONLY thing that can hold the sweep back is the dispute freeze.
    const now = new Date(Date.now() + DEPOSIT_RETRY_BACKOFF_MS + 60_000)

    const frozenRun = await retryFailedAutoCancelRefunds({ now })
    const frozenResult = frozenRun.results.find((r) => r.bookingId === bookingId)
    expect(frozenResult?.flavor).toBe('DEPOSIT')
    expect(frozenResult?.outcome).toBe('not_retryable')
    expect(stripe.refundsCreate).not.toHaveBeenCalled()
    expect((await readFreeze(bookingId)).depositRefundedCents).toBe(0)

    // A/B — same sweep, same rows, freeze cleared.
    stripe.refundsCreate.mockResolvedValue({ id: `re_${tag}_sweep` })
    await db.booking.update({
      where: { id: bookingId },
      data: { depositDisputedAt: null },
    })

    const clearedRun = await retryFailedAutoCancelRefunds({ now })
    const clearedResult = clearedRun.results.find((r) => r.bookingId === bookingId)
    expect(clearedResult?.outcome).not.toBe('not_retryable')
    expect(stripe.refundsCreate).toHaveBeenCalled()
  })
})
