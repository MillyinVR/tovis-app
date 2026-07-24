// tests/integration/no-show-fee-charge.test.ts
//
// M12 (Phase 2 revenue protection) — the no-show / late-cancel fee charge, driven
// end-to-end against real Postgres with only Stripe's network boundary mocked.
//
// The existing lib/noShowProtection/charge.test.ts is a pure unit test: it mocks
// prisma, getStripe AND recordNoShowFeeCharge, so it proves the orchestration
// branches but NEVER exercises the Booking write, the CHARGED-guard inside the
// write boundary, or the client receipt notification. Those are exactly the
// money-integrity surfaces a dark-launch readiness pass has to trust. This suite
// runs the real assessAndChargeNoShowFee → real recordNoShowFeeCharge → real DB,
// asserting on what actually lands on the row and in the client inbox.
//
// Stripe's success leg can't be driven for real: dev has no connected account, so
// a destination charge (transfer_data.destination) would fail at Stripe. We pin
// the Stripe PaymentIntent boundary with a mock and assert the DB truth on both
// sides of it — the same limitation every prior money card hit.
//
// Run with `pnpm test:integration` (or the whole dir in CI via integration.yml).
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  BookingDepositStatus,
  BookingRefundStatus,
  BookingRefundTrigger,
  BookingStatus,
  NotificationEventKey,
  NoShowFeeReason,
  NoShowFeeStatus,
  NoShowFeeType,
  Prisma,
  PrismaClient,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
} from '@prisma/client'

// Only Stripe's network boundary is mocked; prisma, the flag, the fee math and
// the write boundary all run for real against the test database. `refunds.create`
// is the GAP A boundary — dev has no connected account, so a destination-charge
// refund (reverse_transfer) can't be driven for real; the DB is the assertion
// surface, same limitation every prior money card hit.
const stripe = vi.hoisted(() => ({
  create: vi.fn(),
  refundsCreate: vi.fn(),
}))
vi.mock('@/lib/stripe/server', () => ({
  getStripe: () => ({
    paymentIntents: { create: stripe.create },
    refunds: { create: stripe.refundsCreate },
  }),
}))

import { assessAndChargeNoShowFee } from '@/lib/noShowProtection/charge'
import {
  applyStripeNoShowFeeDisputeInTransaction,
  cancelBooking,
  recordNoShowFeeCharge,
  reconcileNoShowFeeChargeRefundInTransaction,
} from '@/lib/booking/writeBoundary'
import {
  applyAutoCancelRefund,
  applyDiscoveryDepositCancelRefund,
  summarizeCancelRefund,
} from '@/lib/booking/cancelRefund'
import { refundNoShowFee } from '@/lib/booking/refunds'
import { retryFailedAutoCancelRefunds } from '@/lib/booking/refundRetrySweep'
import { handleStripeEvent } from '@/lib/stripe/handleWebhookEvent'
import { asTestStripeEvent } from '@/lib/typed/stripeTestEvent'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with: pnpm test:integration')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const tag = `no_show_fee_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
const ZONE = 'America/Los_Angeles'

type Fixtures = {
  tenantId: string
  professionalId: string
  serviceId: string
  locationId: string
  clientWithCardId: string
  clientNoCardId: string
}

let fx: Fixtures
const seededUserEmails: string[] = []

/** A future instant `hoursFromNow` out, so the cancel-window math is exercised. */
function scheduledFor(hoursFromNow: number): Date {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000)
}

/** Insert one ACCEPTED (default) booking for the given client and return its id. */
async function createBooking(args: {
  clientId: string
  status?: BookingStatus
  when?: Date
  subtotal?: string
}): Promise<string> {
  const booking = await db.booking.create({
    data: {
      clientId: args.clientId,
      professionalId: fx.professionalId,
      serviceId: fx.serviceId,
      scheduledFor: args.when ?? scheduledFor(72),
      status: args.status ?? BookingStatus.ACCEPTED,
      locationType: ServiceLocationType.SALON,
      locationId: fx.locationId,
      locationTimeZone: ZONE,
      subtotalSnapshot: new Prisma.Decimal(args.subtotal ?? '120.00'),
      totalDurationMinutes: 60,
      proTenantId: fx.tenantId,
      clientHomeTenantId: fx.tenantId,
    },
    select: { id: true },
  })
  return booking.id
}

beforeAll(async () => {
  const tenant = await db.tenant.create({
    data: { slug: `${tag}-tenant`, name: 'No-Show Fee', isActive: true },
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
      firstName: 'Fee',
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

  // Pro can receive a destination charge, and has FLAT $25 protection on.
  await db.professionalPaymentSettings.create({
    data: {
      professionalId: pro.id,
      acceptStripeCard: true,
      stripeAccountId: `acct_${tag}`,
      stripeChargesEnabled: true,
    },
  })
  await db.proNoShowSettings.create({
    data: {
      professionalId: pro.id,
      enabled: true,
      feeType: NoShowFeeType.FLAT,
      feeFlatAmount: new Prisma.Decimal('25.00'),
      cancelWindowHours: 24,
      chargeNoShow: true,
      chargeLateCancel: true,
    },
  })

  async function seedClient(
    label: string,
    withCard: boolean,
  ): Promise<string> {
    const email = `${tag}_${label}@example.com`
    const user = await db.user.create({
      data: { email, password: 'test-password', role: Role.CLIENT },
      select: { id: true },
    })
    seededUserEmails.push(email)
    const client = await db.clientProfile.create({
      data: {
        userId: user.id,
        firstName: label,
        lastName: 'Fee',
        homeTenantId: tenant.id,
        stripeCustomerId: withCard ? `cus_${tag}_${label}` : null,
      },
      select: { id: true },
    })
    if (withCard) {
      await db.clientPaymentMethod.create({
        data: {
          clientId: client.id,
          stripePaymentMethodId: `pm_${tag}_${label}`,
          isDefault: true,
          brand: 'visa',
          last4: '4242',
        },
      })
    }
    return client.id
  }

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
    clientWithCardId: await seedClient('carded', true),
    clientNoCardId: await seedClient('nocard', false),
  }

  // The whole feature is behind this flag; light it up locally to drive the path.
  process.env.ENABLE_NO_SHOW_PROTECTION = 'true'
}, 60_000)

afterEach(async () => {
  // Bookings + their fee-receipt notifications are recreated per test; wipe both
  // so CHARGED stickiness on one booking can't leak into the next assertion.
  await db.clientNotification.deleteMany({
    where: { clientId: { in: [fx.clientWithCardId, fx.clientNoCardId] } },
  })
  await db.booking.deleteMany({ where: { professionalId: fx.professionalId } })
})

afterAll(async () => {
  delete process.env.ENABLE_NO_SHOW_PROTECTION
  await db.clientNotification.deleteMany({
    where: { clientId: { in: [fx.clientWithCardId, fx.clientNoCardId] } },
  })
  await db.booking.deleteMany({ where: { professionalId: fx.professionalId } })
  await db.clientPaymentMethod.deleteMany({
    where: { clientId: { in: [fx.clientWithCardId, fx.clientNoCardId] } },
  })
  await db.proNoShowSettings.deleteMany({
    where: { professionalId: fx.professionalId },
  })
  await db.professionalPaymentSettings.deleteMany({
    where: { professionalId: fx.professionalId },
  })
  await db.professionalLocation.deleteMany({ where: { name: `${tag} salon` } })
  await db.clientProfile.deleteMany({ where: { lastName: 'Fee' } })
  await db.professionalProfile.deleteMany({ where: { businessName: `${tag} studio` } })
  await db.service.deleteMany({ where: { name: `${tag} service` } })
  await db.serviceCategory.deleteMany({ where: { slug: `${tag}-category` } })
  await db.user.deleteMany({ where: { email: { in: seededUserEmails } } })
  await db.tenant.deleteMany({ where: { slug: `${tag}-tenant` } })
  await db.$disconnect()
}, 60_000)

describe('assessAndChargeNoShowFee — persists a CHARGED no-show fee', () => {
  it('charges off-session, routes to the pro, and writes the outcome + receipt', async () => {
    const bookingId = await createBooking({ clientId: fx.clientWithCardId })
    stripe.create.mockResolvedValue({ id: 'pi_charged', status: 'succeeded' })

    const out = await assessAndChargeNoShowFee({
      bookingId,
      reason: NoShowFeeReason.NO_SHOW,
    })

    expect(out).toMatchObject({
      kind: 'ATTEMPTED',
      status: NoShowFeeStatus.CHARGED,
      amount: '25.00',
      stripePaymentIntentId: 'pi_charged',
      alreadyCharged: false,
    })

    // Stripe boundary: one off-session destination charge, stable idempotency key.
    expect(stripe.create).toHaveBeenCalledTimes(1)
    expect(stripe.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 2500,
        currency: 'usd',
        customer: `cus_${tag}_carded`,
        payment_method: `pm_${tag}_carded`,
        off_session: true,
        confirm: true,
        transfer_data: { destination: `acct_${tag}` },
      }),
      { idempotencyKey: `tovis:no-show-fee:${bookingId}` },
    )

    // DB truth — the whole point of the integration pass.
    const row = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: {
        noShowFeeStatus: true,
        noShowFeeReason: true,
        noShowFeeAmount: true,
        noShowFeeStripePaymentIntentId: true,
        noShowFeeChargedAt: true,
      },
    })
    expect(row.noShowFeeStatus).toBe(NoShowFeeStatus.CHARGED)
    expect(row.noShowFeeReason).toBe(NoShowFeeReason.NO_SHOW)
    expect(row.noShowFeeAmount?.toFixed(2)).toBe('25.00')
    expect(row.noShowFeeStripePaymentIntentId).toBe('pi_charged')
    expect(row.noShowFeeChargedAt).toBeInstanceOf(Date)

    // Client receipt notification enqueued exactly once.
    const notes = await db.clientNotification.findMany({
      where: {
        clientId: fx.clientWithCardId,
        eventKey: NotificationEventKey.NO_SHOW_FEE_CHARGED,
      },
    })
    expect(notes).toHaveLength(1)
    expect(notes[0]?.dedupeKey).toBe(`NO_SHOW_FEE:${bookingId}`)
  })
})

describe('assessAndChargeNoShowFee — idempotent, never double-charges', () => {
  it('a second assessment on a CHARGED booking touches no card and re-enqueues nothing', async () => {
    const bookingId = await createBooking({ clientId: fx.clientWithCardId })
    stripe.create.mockResolvedValue({ id: 'pi_once', status: 'succeeded' })

    const first = await assessAndChargeNoShowFee({
      bookingId,
      reason: NoShowFeeReason.NO_SHOW,
    })
    expect(first).toMatchObject({ status: NoShowFeeStatus.CHARGED })
    expect(stripe.create).toHaveBeenCalledTimes(1)

    // Retry (lost webhook / route re-hit / concurrent request) — must NOT re-charge.
    const second = await assessAndChargeNoShowFee({
      bookingId,
      reason: NoShowFeeReason.NO_SHOW,
    })
    expect(second).toMatchObject({
      kind: 'ATTEMPTED',
      status: NoShowFeeStatus.CHARGED,
      alreadyCharged: true,
    })
    expect(stripe.create).toHaveBeenCalledTimes(1) // still one — no second charge

    const row = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { noShowFeeStripePaymentIntentId: true },
    })
    expect(row.noShowFeeStripePaymentIntentId).toBe('pi_once')

    const notes = await db.clientNotification.count({
      where: {
        clientId: fx.clientWithCardId,
        eventKey: NotificationEventKey.NO_SHOW_FEE_CHARGED,
      },
    })
    expect(notes).toBe(1)
  })

  it('the write boundary itself refuses to clobber a CHARGED fee', async () => {
    // Guards the recorder independently of charge.ts: even a direct FAILED write
    // against an already-CHARGED booking is a no-op (never downgrades the truth).
    const bookingId = await createBooking({ clientId: fx.clientWithCardId })
    stripe.create.mockResolvedValue({ id: 'pi_guard', status: 'succeeded' })
    await assessAndChargeNoShowFee({ bookingId, reason: NoShowFeeReason.NO_SHOW })

    await recordNoShowFeeCharge({
      bookingId,
      professionalId: fx.professionalId,
      status: NoShowFeeStatus.FAILED,
      reason: NoShowFeeReason.NO_SHOW,
      amount: new Prisma.Decimal('25.00'),
      stripePaymentIntentId: 'pi_should_be_ignored',
    })

    const row = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: {
        noShowFeeStatus: true,
        noShowFeeStripePaymentIntentId: true,
      },
    })
    expect(row.noShowFeeStatus).toBe(NoShowFeeStatus.CHARGED)
    expect(row.noShowFeeStripePaymentIntentId).toBe('pi_guard')
  })
})

describe('assessAndChargeNoShowFee — records a declined charge as FAILED', () => {
  it('persists FAILED with the failed PI id and enqueues no receipt', async () => {
    const bookingId = await createBooking({ clientId: fx.clientWithCardId })
    stripe.create.mockRejectedValue(
      Object.assign(new Error('card_declined'), {
        raw: { payment_intent: { id: 'pi_declined' } },
      }),
    )

    const out = await assessAndChargeNoShowFee({
      bookingId,
      reason: NoShowFeeReason.NO_SHOW,
    })
    expect(out).toMatchObject({
      kind: 'ATTEMPTED',
      status: NoShowFeeStatus.FAILED,
      stripePaymentIntentId: 'pi_declined',
    })

    const row = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: {
        noShowFeeStatus: true,
        noShowFeeStripePaymentIntentId: true,
        noShowFeeChargedAt: true,
      },
    })
    expect(row.noShowFeeStatus).toBe(NoShowFeeStatus.FAILED)
    expect(row.noShowFeeStripePaymentIntentId).toBe('pi_declined')
    expect(row.noShowFeeChargedAt).toBeNull()

    const notes = await db.clientNotification.count({
      where: {
        clientId: fx.clientWithCardId,
        eventKey: NotificationEventKey.NO_SHOW_FEE_CHARGED,
      },
    })
    expect(notes).toBe(0) // no "your card was charged" receipt for a failed charge
  })
})

describe('assessAndChargeNoShowFee — records SKIPPED when no card on file', () => {
  it('never calls Stripe and writes SKIPPED', async () => {
    const bookingId = await createBooking({ clientId: fx.clientNoCardId })

    const out = await assessAndChargeNoShowFee({
      bookingId,
      reason: NoShowFeeReason.NO_SHOW,
    })
    expect(out).toMatchObject({ kind: 'SKIPPED', reason: 'no_card_on_file' })
    expect(stripe.create).not.toHaveBeenCalled()

    const row = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { noShowFeeStatus: true },
    })
    expect(row.noShowFeeStatus).toBe(NoShowFeeStatus.SKIPPED)
  })
})

describe('assessAndChargeNoShowFee — late-cancel window + prior-status gate', () => {
  it('charges a late cancel inside the window and records the reason', async () => {
    const bookingId = await createBooking({
      clientId: fx.clientWithCardId,
      when: scheduledFor(6), // 6h out, inside the 24h window
    })
    stripe.create.mockResolvedValue({ id: 'pi_late', status: 'succeeded' })

    const out = await assessAndChargeNoShowFee({
      bookingId,
      reason: NoShowFeeReason.LATE_CANCEL,
      priorStatus: BookingStatus.ACCEPTED,
    })
    expect(out).toMatchObject({ kind: 'ATTEMPTED', status: NoShowFeeStatus.CHARGED })

    const row = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { noShowFeeStatus: true, noShowFeeReason: true },
    })
    expect(row.noShowFeeStatus).toBe(NoShowFeeStatus.CHARGED)
    expect(row.noShowFeeReason).toBe(NoShowFeeReason.LATE_CANCEL)
  })

  it('does not charge a late cancel of an unconfirmed (PENDING) booking — no write', async () => {
    const bookingId = await createBooking({
      clientId: fx.clientWithCardId,
      when: scheduledFor(6),
    })

    const out = await assessAndChargeNoShowFee({
      bookingId,
      reason: NoShowFeeReason.LATE_CANCEL,
      priorStatus: BookingStatus.PENDING,
    })
    expect(out).toEqual({ kind: 'NOT_CHARGEABLE', reason: 'not_confirmed' })
    expect(stripe.create).not.toHaveBeenCalled()

    const row = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { noShowFeeStatus: true },
    })
    expect(row.noShowFeeStatus).toBeNull() // gate short-circuits before any write
  })
})

// M15 GAP B — reconcile a Stripe-side refund / dispute of the fee's OWN
// PaymentIntent against real Postgres. Drives the write-boundary reconcilers the
// charge.refunded / charge.dispute webhook branches call. Stripe never has to be
// hit: these functions take the amounts a webhook already carries.
describe('reconcile no-show fee PI refund / dispute', () => {
  /** Seed a CHARGED fee (its own PI) on a fresh booking; returns id + PI. */
  async function chargedFeeBooking(feePi: string): Promise<string> {
    const bookingId = await createBooking({ clientId: fx.clientWithCardId })
    await db.booking.update({
      where: { id: bookingId },
      data: {
        noShowFeeStatus: NoShowFeeStatus.CHARGED,
        noShowFeeReason: NoShowFeeReason.NO_SHOW,
        noShowFeeAmount: new Prisma.Decimal('25.00'),
        noShowFeeStripePaymentIntentId: feePi,
        noShowFeeChargedAt: new Date(),
      },
    })
    return bookingId
  }

  function refundReceiptCount(): Promise<number> {
    return db.clientNotification.count({
      where: {
        clientId: fx.clientWithCardId,
        eventKey: NotificationEventKey.PAYMENT_REFUNDED,
      },
    })
  }

  it('a FULL refund flips CHARGED → REFUNDED, records cents, and notifies once', async () => {
    const feePi = `pi_fee_full_${tag}`
    const bookingId = await chargedFeeBooking(feePi)

    const result = await db.$transaction((tx) =>
      reconcileNoShowFeeChargeRefundInTransaction(tx, {
        paymentIntentId: feePi,
        amountRefundedCents: 2500,
        chargeAmountCents: 2500,
      }),
    )
    expect(result).toEqual({ handled: true })

    const row = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { noShowFeeStatus: true, noShowFeeRefundedCents: true },
    })
    expect(row.noShowFeeStatus).toBe(NoShowFeeStatus.REFUNDED)
    expect(row.noShowFeeRefundedCents).toBe(2500)
    expect(await refundReceiptCount()).toBe(1)
  })

  it('a PARTIAL refund stays CHARGED and only accumulates cents', async () => {
    const feePi = `pi_fee_partial_${tag}`
    const bookingId = await chargedFeeBooking(feePi)

    await db.$transaction((tx) =>
      reconcileNoShowFeeChargeRefundInTransaction(tx, {
        paymentIntentId: feePi,
        amountRefundedCents: 1000,
        chargeAmountCents: 2500,
      }),
    )

    const row = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { noShowFeeStatus: true, noShowFeeRefundedCents: true },
    })
    expect(row.noShowFeeStatus).toBe(NoShowFeeStatus.CHARGED)
    expect(row.noShowFeeRefundedCents).toBe(1000)
    expect(await refundReceiptCount()).toBe(1)
  })

  it('a stale (smaller) replay never rolls the counter back or re-notifies', async () => {
    const feePi = `pi_fee_replay_${tag}`
    const bookingId = await chargedFeeBooking(feePi)

    // Full refund first (cumulative 2500), then a stale replay reporting 1000.
    for (const amt of [2500, 1000, 2500]) {
      await db.$transaction((tx) =>
        reconcileNoShowFeeChargeRefundInTransaction(tx, {
          paymentIntentId: feePi,
          amountRefundedCents: amt,
          chargeAmountCents: 2500,
        }),
      )
    }

    const row = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { noShowFeeStatus: true, noShowFeeRefundedCents: true },
    })
    expect(row.noShowFeeStatus).toBe(NoShowFeeStatus.REFUNDED)
    expect(row.noShowFeeRefundedCents).toBe(2500) // monotonic max, never rolled back
    expect(await refundReceiptCount()).toBe(1) // only the first rise notified
  })

  it('an unknown fee PI is a clean no-op (handled:false)', async () => {
    const result = await db.$transaction((tx) =>
      reconcileNoShowFeeChargeRefundInTransaction(tx, {
        paymentIntentId: `pi_fee_absent_${tag}`,
        amountRefundedCents: 2500,
        chargeAmountCents: 2500,
      }),
    )
    expect(result).toEqual({ handled: false })
  })

  it('a dispute freezes the fee (OPEN), keeps the earliest time, and clears on WON', async () => {
    const feePi = `pi_fee_dispute_${tag}`
    const bookingId = await chargedFeeBooking(feePi)

    const open = await db.$transaction((tx) =>
      applyStripeNoShowFeeDisputeInTransaction(tx, {
        feePaymentIntentId: feePi,
        outcome: 'OPEN',
      }),
    )
    expect(open).toEqual({ bookingId })

    const frozen = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { noShowFeeDisputedAt: true },
    })
    expect(frozen.noShowFeeDisputedAt).toBeInstanceOf(Date)
    const firstDisputedAt = frozen.noShowFeeDisputedAt

    // A second OPEN keeps the earliest timestamp (set-if-unset idempotency).
    await db.$transaction((tx) =>
      applyStripeNoShowFeeDisputeInTransaction(tx, {
        feePaymentIntentId: feePi,
        outcome: 'OPEN',
      }),
    )
    const stillFrozen = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { noShowFeeDisputedAt: true },
    })
    expect(stillFrozen.noShowFeeDisputedAt).toEqual(firstDisputedAt)

    // WON restores: the freeze clears.
    await db.$transaction((tx) =>
      applyStripeNoShowFeeDisputeInTransaction(tx, {
        feePaymentIntentId: feePi,
        outcome: 'WON',
      }),
    )
    const restored = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { noShowFeeDisputedAt: true },
    })
    expect(restored.noShowFeeDisputedAt).toBeNull()
  })

  it('an unknown fee PI dispute is a clean no-op (null)', async () => {
    const result = await db.$transaction((tx) =>
      applyStripeNoShowFeeDisputeInTransaction(tx, {
        feePaymentIntentId: `pi_fee_dispute_absent_${tag}`,
        outcome: 'OPEN',
      }),
    )
    expect(result).toBeNull()
  })

  // The full dispatch → reconcile → DB chain, driven through the real
  // handleStripeEvent with NO mocks (only the Stripe HTTP signature, which the
  // route owns, is out of scope). Proves the fee PI is resolved from a real event
  // shape and never falls through to the final-bill applier.
  it('drives a real charge.refunded webhook end-to-end onto the fee row', async () => {
    const feePi = `pi_fee_e2e_refund_${tag}`
    const bookingId = await chargedFeeBooking(feePi)

    const event = asTestStripeEvent({
      id: `evt_${tag}_refund`,
      type: 'charge.refunded',
      data: {
        object: {
          id: `ch_${tag}`,
          object: 'charge',
          payment_intent: feePi,
          amount: 2500,
          amount_refunded: 2500,
          refunds: { data: [] },
        },
      },
    })

    const result = await db.$transaction((tx) => handleStripeEvent(tx, event))
    expect(result.handled).toBe(true)
    expect(result.message).toContain('no-show fee')

    const row = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { noShowFeeStatus: true, noShowFeeRefundedCents: true },
    })
    expect(row.noShowFeeStatus).toBe(NoShowFeeStatus.REFUNDED)
    expect(row.noShowFeeRefundedCents).toBe(2500)
  })

  it('drives a real charge.dispute.created webhook end-to-end onto the fee row', async () => {
    const feePi = `pi_fee_e2e_dispute_${tag}`
    const bookingId = await chargedFeeBooking(feePi)

    const event = asTestStripeEvent({
      id: `evt_${tag}_dispute`,
      type: 'charge.dispute.created',
      data: {
        object: {
          id: `dp_${tag}`,
          object: 'dispute',
          payment_intent: feePi,
          status: 'warning_needs_response',
        },
      },
    })

    const result = await db.$transaction((tx) => handleStripeEvent(tx, event))
    expect(result.handled).toBe(true)
    expect(result.message).toContain('no-show fee')

    const row = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { noShowFeeDisputedAt: true },
    })
    expect(row.noShowFeeDisputedAt).toBeInstanceOf(Date)
  })
})

// M15 GAP A — the in-app WRITE side: a pro/admin refund of a CHARGED fee on its
// OWN PaymentIntent. reverse_transfer can't be driven for real (no dev connected
// account), so `refunds.create` is mocked; the DB (fee status, cents, the
// BookingRefund ledger row, the client receipt) is the assertion surface.
describe('refund a CHARGED no-show fee (M15 GAP A)', () => {
  /** Seed a CHARGED $25 fee (its own PI) with an optional prior refunded balance. */
  async function chargedFeeBooking(
    feePi: string,
    refundedCents = 0,
  ): Promise<string> {
    const bookingId = await createBooking({ clientId: fx.clientWithCardId })
    await db.booking.update({
      where: { id: bookingId },
      data: {
        noShowFeeStatus: NoShowFeeStatus.CHARGED,
        noShowFeeReason: NoShowFeeReason.NO_SHOW,
        noShowFeeAmount: new Prisma.Decimal('25.00'),
        noShowFeeStripePaymentIntentId: feePi,
        noShowFeeChargedAt: new Date(),
        noShowFeeRefundedCents: refundedCents,
      },
    })
    return bookingId
  }

  function refundReceiptCount(): Promise<number> {
    return db.clientNotification.count({
      where: {
        clientId: fx.clientWithCardId,
        eventKey: NotificationEventKey.PAYMENT_REFUNDED,
      },
    })
  }

  beforeEach(() => {
    stripe.refundsCreate.mockReset()
    stripe.refundsCreate.mockResolvedValue({ id: `rf_${tag}` })
  })

  it('a full refund flips CHARGED → REFUNDED, reverses the transfer, and notifies once', async () => {
    const feePi = `pi_fee_ref_full_${tag}`
    const bookingId = await chargedFeeBooking(feePi)

    const result = await refundNoShowFee({ bookingId })
    expect(result).toEqual({ outcome: 'REFUNDED', refundAmountCents: 2500 })

    // Stripe was called on the fee PI, full remaining, with reverse_transfer.
    expect(stripe.refundsCreate).toHaveBeenCalledTimes(1)
    expect(stripe.refundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_intent: feePi,
        amount: 2500,
        reverse_transfer: true,
      }),
      expect.objectContaining({
        idempotencyKey: `tovis:no-show-fee-refund:${bookingId}:0`,
      }),
    )

    const row = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { noShowFeeStatus: true, noShowFeeRefundedCents: true },
    })
    expect(row.noShowFeeStatus).toBe(NoShowFeeStatus.REFUNDED)
    expect(row.noShowFeeRefundedCents).toBe(2500)

    // A durable SUCCEEDED ledger row on the FEE PI, and one refund receipt.
    const refundRow = await db.bookingRefund.findFirstOrThrow({
      where: { bookingId },
      select: {
        status: true,
        amountCents: true,
        stripePaymentIntentId: true,
        trigger: true,
        reverseTransfer: true,
      },
    })
    expect(refundRow).toMatchObject({
      status: BookingRefundStatus.SUCCEEDED,
      amountCents: 2500,
      stripePaymentIntentId: feePi,
      reverseTransfer: true,
    })
    expect(await refundReceiptCount()).toBe(1)
  })

  it('refunds only the remaining balance after a Dashboard partial (GAP B reconciled)', async () => {
    // A prior Dashboard partial ($10) left the fee CHARGED + noShowFeeRefundedCents=1000.
    const feePi = `pi_fee_ref_partial_${tag}`
    const bookingId = await chargedFeeBooking(feePi, 1000)

    const result = await refundNoShowFee({ bookingId })
    expect(result).toEqual({ outcome: 'REFUNDED', refundAmountCents: 1500 })

    // Only the remaining 1500 is refunded; the key carries the pre-refund
    // cumulative (1000) so it never collides with the partial's own refund.
    expect(stripe.refundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1500 }),
      expect.objectContaining({
        idempotencyKey: `tovis:no-show-fee-refund:${bookingId}:1000`,
      }),
    )

    const row = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { noShowFeeStatus: true, noShowFeeRefundedCents: true },
    })
    expect(row.noShowFeeStatus).toBe(NoShowFeeStatus.REFUNDED)
    expect(row.noShowFeeRefundedCents).toBe(2500)
  })

  it('a late charge.refunded replay after an in-app refund changes nothing (no double-notify)', async () => {
    const feePi = `pi_fee_ref_replay_${tag}`
    const bookingId = await chargedFeeBooking(feePi)

    await refundNoShowFee({ bookingId })
    expect(await refundReceiptCount()).toBe(1)

    // The fee's charge.refunded webhook lands later at the same cumulative (2500).
    // GAP B's reconcile sees no rise → status stays REFUNDED, no second receipt.
    const reconciled = await db.$transaction((tx) =>
      reconcileNoShowFeeChargeRefundInTransaction(tx, {
        paymentIntentId: feePi,
        amountRefundedCents: 2500,
        chargeAmountCents: 2500,
      }),
    )
    expect(reconciled).toEqual({ handled: true })

    const row = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { noShowFeeStatus: true, noShowFeeRefundedCents: true },
    })
    expect(row.noShowFeeStatus).toBe(NoShowFeeStatus.REFUNDED)
    expect(row.noShowFeeRefundedCents).toBe(2500)
    expect(await refundReceiptCount()).toBe(1) // still exactly one
  })

  it('records the ledger row on the FEE PI only — never the service PI (M3 per-PI)', async () => {
    const feePi = `pi_fee_ref_peri_${tag}`
    const servicePi = `pi_service_ref_peri_${tag}`
    const bookingId = await chargedFeeBooking(feePi)
    await db.booking.update({
      where: { id: bookingId },
      data: { stripePaymentIntentId: servicePi },
    })

    await refundNoShowFee({ bookingId })

    const feeSum = await db.bookingRefund.aggregate({
      where: {
        bookingId,
        stripePaymentIntentId: feePi,
        status: BookingRefundStatus.SUCCEEDED,
      },
      _sum: { amountCents: true },
    })
    const serviceSum = await db.bookingRefund.aggregate({
      where: {
        bookingId,
        stripePaymentIntentId: servicePi,
        status: BookingRefundStatus.SUCCEEDED,
      },
      _sum: { amountCents: true },
    })
    expect(feeSum._sum.amountCents).toBe(2500)
    expect(serviceSum._sum.amountCents).toBeNull() // fee refund never counts here
  })

  it('refuses a disputed fee (frozen), touching no card and no state', async () => {
    const feePi = `pi_fee_ref_disputed_${tag}`
    const bookingId = await chargedFeeBooking(feePi)
    await db.booking.update({
      where: { id: bookingId },
      data: { noShowFeeDisputedAt: new Date() },
    })

    const result = await refundNoShowFee({ bookingId })
    expect(result).toEqual({
      outcome: 'NOT_ATTEMPTED',
      code: 'NO_SHOW_FEE_REFUND_FROZEN_DISPUTED',
    })
    expect(stripe.refundsCreate).not.toHaveBeenCalled()

    const row = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { noShowFeeStatus: true, noShowFeeRefundedCents: true },
    })
    expect(row.noShowFeeStatus).toBe(NoShowFeeStatus.CHARGED)
    expect(row.noShowFeeRefundedCents).toBe(0)
    expect(await db.bookingRefund.count({ where: { bookingId } })).toBe(0)
  })

  it('refuses a FAILED fee — a fee that never charged is waived, not refunded', async () => {
    const bookingId = await createBooking({ clientId: fx.clientWithCardId })
    await db.booking.update({
      where: { id: bookingId },
      data: {
        noShowFeeStatus: NoShowFeeStatus.FAILED,
        noShowFeeReason: NoShowFeeReason.NO_SHOW,
        noShowFeeAmount: new Prisma.Decimal('25.00'),
      },
    })

    const result = await refundNoShowFee({ bookingId })
    expect(result).toEqual({
      outcome: 'NOT_ATTEMPTED',
      code: 'NO_SHOW_FEE_NOT_REFUNDABLE',
    })
    expect(stripe.refundsCreate).not.toHaveBeenCalled()
  })

  it('refuses an already-REFUNDED fee (idempotent — no double refund)', async () => {
    const feePi = `pi_fee_ref_twice_${tag}`
    const bookingId = await chargedFeeBooking(feePi)

    const first = await refundNoShowFee({ bookingId })
    expect(first.outcome).toBe('REFUNDED')

    // A second refund on the now-REFUNDED fee is refused before any Stripe call.
    const second = await refundNoShowFee({ bookingId })
    expect(second).toEqual({
      outcome: 'NOT_ATTEMPTED',
      code: 'NO_SHOW_FEE_ALREADY_REFUNDED',
    })
    expect(stripe.refundsCreate).toHaveBeenCalledTimes(1) // never twice
    expect(await refundReceiptCount()).toBe(1)
  })

  it('rolls the claim back when Stripe fails: CHARGED restored + a durable FAILED row, no receipt', async () => {
    const feePi = `pi_fee_ref_fail_${tag}`
    const bookingId = await chargedFeeBooking(feePi)

    stripe.refundsCreate.mockRejectedValue(new Error('card_declined'))

    const result = await refundNoShowFee({ bookingId })
    expect(result.outcome).toBe('FAILED')

    // The reservation is released — status back to CHARGED, cents back to 0.
    const row = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { noShowFeeStatus: true, noShowFeeRefundedCents: true },
    })
    expect(row.noShowFeeStatus).toBe(NoShowFeeStatus.CHARGED)
    expect(row.noShowFeeRefundedCents).toBe(0)

    // A durable FAILED ledger row on the fee PI (visible to the money trail),
    // and NO refund receipt (money never moved).
    const failedRow = await db.bookingRefund.findFirstOrThrow({
      where: { bookingId },
      select: { status: true, stripePaymentIntentId: true, failureMessage: true },
    })
    expect(failedRow.status).toBe(BookingRefundStatus.FAILED)
    expect(failedRow.stripePaymentIntentId).toBe(feePi)
    expect(await refundReceiptCount()).toBe(0)
  })

  it('the auto-cancel retry sweep never re-drives a DISCRETIONARY fee refund (M3)', async () => {
    // A FAILED in-app fee refund is a DISCRETIONARY row on the fee PI. Seed the
    // exact shape the auto-cancel retry sweep scans — a CANCELLED booking with a
    // FAILED refund row on it — but with the DISCRETIONARY trigger. The sweep
    // filters trigger=AUTO_CANCELLATION at the DB, so it never picks this up (and
    // classifyFlavor would return null for a fee PI even if it did).
    const feePi = `pi_fee_sweep_${tag}`
    const bookingId = await chargedFeeBooking(feePi)
    await db.booking.update({
      where: { id: bookingId },
      data: { status: BookingStatus.CANCELLED },
    })
    await db.bookingRefund.create({
      data: {
        bookingId,
        amountCents: 2500,
        currency: 'usd',
        status: BookingRefundStatus.FAILED,
        trigger: BookingRefundTrigger.DISCRETIONARY,
        reverseTransfer: true,
        stripePaymentIntentId: feePi,
      },
    })

    const result = await retryFailedAutoCancelRefunds()

    // This booking's DISCRETIONARY fee row is invisible to the sweep, and its
    // ledger row is left untouched (still FAILED — no retry attempt was made).
    expect(result.results.some((r) => r.bookingId === bookingId)).toBe(false)
    const rows = await db.bookingRefund.findMany({
      where: { bookingId },
      select: { status: true },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe(BookingRefundStatus.FAILED)
  })
})

// ─── M15 POLICY — deposit-forfeit suppresses the late-cancel fee, driven ──────
//
// Tori's call (2026-07-24): a forfeited discovery deposit IS the <24h cancellation
// penalty, so it suppresses the separate late-cancel fee — a client is never
// double-penalised for one cancel. The suppression + honest summary live in the
// client cancel ROUTE; those are exhaustively unit-tested. Here we drive the two
// REAL inputs the route consumes against real Postgres — the pre-transition status
// (§18.4, read inside cancelBooking's tx) and the FORFEITED signal from
// applyDiscoveryDepositCancelRefund — plus the not-suppressed fee charge itself,
// so both sides of the route's `!depositForfeited` gate are proven on real data.
// The real-Stripe charge leg still can't be driven (no dev connected account);
// the PaymentIntent boundary is mocked and the DB is the assertion surface.

/** A client cancel actor for the given seeded client id. */
function clientActor(clientId: string) {
  return { kind: 'client' as const, clientId }
}

describe('M15 §18.4 — cancelBooking returns the pre-transition status from its tx', () => {
  it('an ACCEPTED booking reports priorStatus ACCEPTED (the fee gate reads this)', async () => {
    const bookingId = await createBooking({
      clientId: fx.clientWithCardId,
      status: BookingStatus.ACCEPTED,
      when: scheduledFor(12),
    })

    const res = await cancelBooking({
      bookingId,
      actor: clientActor(fx.clientWithCardId),
    })

    expect(res.priorStatus).toBe(BookingStatus.ACCEPTED)
    expect(res.meta.mutated).toBe(true)
    expect(res.booking.status).toBe(BookingStatus.CANCELLED)
  })

  it('a PENDING booking reports priorStatus PENDING → the fee is never assessed (under-charge safe)', async () => {
    const bookingId = await createBooking({
      clientId: fx.clientWithCardId,
      status: BookingStatus.PENDING,
      when: scheduledFor(12),
    })

    const res = await cancelBooking({
      bookingId,
      actor: clientActor(fx.clientWithCardId),
    })
    expect(res.priorStatus).toBe(BookingStatus.PENDING)

    // The route would call assess with this priorStatus; a non-confirmed booking
    // is never billed — proven end-to-end (no Stripe call, no fee row).
    const out = await assessAndChargeNoShowFee({
      bookingId,
      reason: NoShowFeeReason.LATE_CANCEL,
      priorStatus: res.priorStatus,
    })
    expect(out).toMatchObject({ kind: 'NOT_CHARGEABLE', reason: 'not_confirmed' })
    expect(stripe.create).not.toHaveBeenCalled()

    const row = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { noShowFeeStatus: true },
    })
    expect(row.noShowFeeStatus).toBeNull()
  })
})

describe('M15 POLICY — a forfeited deposit suppresses the late-cancel fee', () => {
  it('client <24h cancel of a PAID-deposit booking → FORFEITED, and no fee is charged', async () => {
    const booking = await db.booking.create({
      data: {
        clientId: fx.clientWithCardId,
        professionalId: fx.professionalId,
        serviceId: fx.serviceId,
        scheduledFor: scheduledFor(12), // <24h → forfeit window
        status: BookingStatus.ACCEPTED,
        locationType: ServiceLocationType.SALON,
        locationId: fx.locationId,
        locationTimeZone: ZONE,
        subtotalSnapshot: new Prisma.Decimal('120.00'),
        totalDurationMinutes: 60,
        proTenantId: fx.tenantId,
        clientHomeTenantId: fx.tenantId,
        // A paid discovery deposit riding its own PI.
        depositStatus: BookingDepositStatus.PAID,
        depositStripePaymentIntentId: `pi_dep_${tag}_forfeit`,
        depositAmount: new Prisma.Decimal('20.00'),
        discoveryFeeAmount: 500,
      },
      select: { id: true },
    })

    const res = await cancelBooking({
      bookingId: booking.id,
      actor: clientActor(fx.clientWithCardId),
    })
    expect(res.priorStatus).toBe(BookingStatus.ACCEPTED)

    // The deposit is FORFEITED (client <24h) — the exact signal the route's
    // suppression gate reads. The forfeit path returns before any Stripe refund.
    const deposit = await applyDiscoveryDepositCancelRefund({
      bookingId: booking.id,
      actorKind: 'client',
      actorUserId: null,
      cancelMutated: res.meta.mutated,
    })
    expect(deposit.outcome).toBe('FORFEITED')
    expect(stripe.refundsCreate).not.toHaveBeenCalled()

    // Route logic: `!depositForfeited` is false → assess is never called → no fee.
    const depositForfeited = deposit.outcome === 'FORFEITED'
    expect(depositForfeited).toBe(true)
    expect(stripe.create).not.toHaveBeenCalled()

    const row = await db.booking.findUniqueOrThrow({
      where: { id: booking.id },
      select: { noShowFeeStatus: true },
    })
    expect(row.noShowFeeStatus).toBeNull()

    // And the honest summary names the forfeit, no fee (M6/M15).
    const summary = summarizeCancelRefund({
      service: { outcome: 'NOT_ATTEMPTED' },
      deposit,
      lateCancelFeeChargedCents: 0,
    })
    expect(summary.status).toBe('FORFEITED')
    expect(summary.lateCancelFeeChargedCents).toBeUndefined()
  })

  it('client <24h cancel with NO deposit → the fee IS charged and folds into the summary', async () => {
    const bookingId = await createBooking({
      clientId: fx.clientWithCardId,
      status: BookingStatus.ACCEPTED,
      when: scheduledFor(12),
    })
    stripe.create.mockResolvedValue({ id: 'pi_late_fee', status: 'succeeded' })

    const res = await cancelBooking({
      bookingId,
      actor: clientActor(fx.clientWithCardId),
    })

    // No deposit → nothing forfeited → the route does NOT suppress the fee.
    const deposit = await applyDiscoveryDepositCancelRefund({
      bookingId,
      actorKind: 'client',
      actorUserId: null,
      cancelMutated: res.meta.mutated,
    })
    expect(deposit.outcome).toBe('NOT_ATTEMPTED')

    const service = await applyAutoCancelRefund({
      bookingId,
      actorKind: 'client',
      actorUserId: null,
      cancelMutated: res.meta.mutated,
    })

    const fee = await assessAndChargeNoShowFee({
      bookingId,
      reason: NoShowFeeReason.LATE_CANCEL,
      priorStatus: res.priorStatus,
    })
    expect(fee).toMatchObject({
      kind: 'ATTEMPTED',
      status: NoShowFeeStatus.CHARGED,
      amount: '25.00',
    })

    const row = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { noShowFeeStatus: true, noShowFeeAmount: true },
    })
    expect(row.noShowFeeStatus).toBe(NoShowFeeStatus.CHARGED)
    expect(row.noShowFeeAmount?.toFixed(2)).toBe('25.00')

    // The route's summary construction, with the freshly-charged fee folded in.
    const feeCents =
      fee.kind === 'ATTEMPTED' && fee.status === NoShowFeeStatus.CHARGED
        ? Math.round(Number(fee.amount) * 100)
        : 0
    const summary = summarizeCancelRefund({
      service,
      deposit,
      lateCancelFeeChargedCents: feeCents,
    })
    expect(summary.status).toBe('FEE_CHARGED')
    expect(summary.lateCancelFeeChargedCents).toBe(2500)
    expect(summary.message).toContain('$25.00')
    expect(summary.message).toContain('late-cancellation fee')
  })
})

// ─── M15 POLICY analog — a kept deposit suppresses the NO_SHOW fee, driven ────
//
// The no-show follow-up (plan §24.7). Unlike the late-cancel path, marking a
// no-show runs NO deposit-refund logic — a paid deposit just stays captured (PAID)
// with the pro. So a no-show'd new-discovery client would be double-hit (deposit
// kept + no-show fee). Tori's late-cancel call extended: a kept deposit IS the
// no-show penalty, so it suppresses the fee. The gate lives in
// assessAndChargeNoShowFee (NO_SHOW-scoped), driven here against real Postgres.

describe('M15 POLICY — a kept deposit suppresses the NO_SHOW fee', () => {
  it('a PAID discovery deposit suppresses the no-show fee → no charge, no row', async () => {
    const booking = await db.booking.create({
      data: {
        clientId: fx.clientWithCardId,
        professionalId: fx.professionalId,
        serviceId: fx.serviceId,
        scheduledFor: scheduledFor(-2), // a past appointment the client missed
        status: BookingStatus.NO_SHOW,
        locationType: ServiceLocationType.SALON,
        locationId: fx.locationId,
        locationTimeZone: ZONE,
        subtotalSnapshot: new Prisma.Decimal('120.00'),
        totalDurationMinutes: 60,
        proTenantId: fx.tenantId,
        clientHomeTenantId: fx.tenantId,
        // A captured discovery deposit the pro keeps on the no-show.
        depositStatus: BookingDepositStatus.PAID,
        depositStripePaymentIntentId: `pi_dep_${tag}_noshow`,
        depositAmount: new Prisma.Decimal('20.00'),
      },
      select: { id: true },
    })

    const out = await assessAndChargeNoShowFee({
      bookingId: booking.id,
      reason: NoShowFeeReason.NO_SHOW,
    })
    expect(out).toEqual({
      kind: 'NOT_CHARGEABLE',
      reason: 'deposit_kept_suppresses_fee',
    })
    expect(stripe.create).not.toHaveBeenCalled()

    const row = await db.booking.findUniqueOrThrow({
      where: { id: booking.id },
      select: { noShowFeeStatus: true },
    })
    expect(row.noShowFeeStatus).toBeNull()
  })

  it('with no kept deposit (PENDING), the no-show fee IS charged', async () => {
    const booking = await db.booking.create({
      data: {
        clientId: fx.clientWithCardId,
        professionalId: fx.professionalId,
        serviceId: fx.serviceId,
        scheduledFor: scheduledFor(-2),
        status: BookingStatus.NO_SHOW,
        locationType: ServiceLocationType.SALON,
        locationId: fx.locationId,
        locationTimeZone: ZONE,
        subtotalSnapshot: new Prisma.Decimal('120.00'),
        totalDurationMinutes: 60,
        proTenantId: fx.tenantId,
        clientHomeTenantId: fx.tenantId,
        depositStatus: BookingDepositStatus.PENDING, // never paid → nothing kept
        depositStripePaymentIntentId: `pi_dep_${tag}_noshow_pending`,
        depositAmount: new Prisma.Decimal('20.00'),
      },
      select: { id: true },
    })
    stripe.create.mockResolvedValue({ id: 'pi_ns_pending', status: 'succeeded' })

    const out = await assessAndChargeNoShowFee({
      bookingId: booking.id,
      reason: NoShowFeeReason.NO_SHOW,
    })
    expect(out).toMatchObject({
      kind: 'ATTEMPTED',
      status: NoShowFeeStatus.CHARGED,
      amount: '25.00',
    })

    const row = await db.booking.findUniqueOrThrow({
      where: { id: booking.id },
      select: { noShowFeeStatus: true },
    })
    expect(row.noShowFeeStatus).toBe(NoShowFeeStatus.CHARGED)
  })
})
