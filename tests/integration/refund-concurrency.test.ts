// tests/integration/refund-concurrency.test.ts
//
// M13 (payment-booking-integrity-audit-plan.md §19) — the refund reservation
// invariant under real concurrency, F11-style, against real Postgres.
//
// The refund reservation math (reserveRefund) and the per-PaymentIntent scoping
// (sumRefundCents) are guarded by a per-booking advisory lock
// (pg_advisory_xact_lock). Every existing suite that touches them —
// refunds.test.ts, cancelRefund.test.ts, refundRetrySweep.test.ts — MOCKS prisma,
// so the lock itself is never exercised: a unit test can't prove two real
// transactions serialize. This one does. It drives genuinely concurrent refunds
// through the REAL applyAutoCancelRefund / applyDiscoveryDepositCancelRefund /
// refundBookingPayment / retryFailedAutoCancelRefunds against a real database and
// asserts the money invariant holds under interleave:
//   • two concurrent cancels of one booking refund it exactly ONCE (no double);
//   • a cancel racing a manual (Dashboard/discretionary) refund never doubles;
//   • a deposit refund and a service refund on one booking each fully refund
//     their OWN PaymentIntent — the deposit row never shrinks the service
//     remainder (M3 per-PI scoping);
//   • the M3 retry sweep racing a manual refund never doubles.
//
// Only Stripe's network boundary (refunds.create) is mocked — the same Connect
// limitation every prior money card hit (dev has no connected account, so a
// reverse_transfer refund can't hit real Stripe). The DB is the assertion surface.
//
// Run with `pnpm test:integration` (or the whole dir in CI via integration.yml).
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  BookingDepositStatus,
  BookingRefundStatus,
  BookingRefundTrigger,
  BookingStatus,
  PaymentProvider,
  Prisma,
  PrismaClient,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
  StripePaymentStatus,
} from '@prisma/client'

// Only Stripe's network boundary is mocked; prisma, the reservation math, the
// advisory lock and the write boundary all run for real against the test DB.
let refundCallCount = 0
const stripe = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('@/lib/stripe/server', () => ({
  getStripe: () => ({ refunds: { create: stripe.create } }),
}))

import { refundBookingPayment } from '@/lib/booking/refunds'
import {
  applyAutoCancelRefund,
  applyDiscoveryDepositCancelRefund,
} from '@/lib/booking/cancelRefund'
import { retryFailedAutoCancelRefunds } from '@/lib/booking/refundRetrySweep'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with: pnpm test:integration')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const tag = `refund_conc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
const ZONE = 'America/Los_Angeles'

type Fixtures = {
  tenantId: string
  professionalId: string
  serviceId: string
  locationId: string
  clientId: string
}

let fx: Fixtures
const seededUserEmails: string[] = []

type SeedArgs = {
  servicePi?: string
  stripeAmountTotalCents?: number
  stripeAmountRefundedCents?: number
  applicationFeeCents?: number
  deposit?: {
    pi: string
    depositDollars: string
    feeCents: number
  }
}

/** Insert one CANCELLED booking with a captured Stripe service payment. */
async function seedCapturedBooking(args: SeedArgs = {}): Promise<string> {
  const booking = await db.booking.create({
    data: {
      clientId: fx.clientId,
      professionalId: fx.professionalId,
      serviceId: fx.serviceId,
      scheduledFor: new Date(Date.now() + 72 * 60 * 60 * 1000),
      status: BookingStatus.CANCELLED,
      cancelledAt: new Date(),
      cancelledByRole: Role.ADMIN,
      locationType: ServiceLocationType.SALON,
      locationId: fx.locationId,
      locationTimeZone: ZONE,
      subtotalSnapshot: new Prisma.Decimal('135.00'),
      totalDurationMinutes: 60,
      proTenantId: fx.tenantId,
      clientHomeTenantId: fx.tenantId,
      // Captured Stripe service payment (the refundable final bill).
      paymentProvider: PaymentProvider.STRIPE,
      stripePaymentStatus: StripePaymentStatus.SUCCEEDED,
      stripePaymentIntentId: args.servicePi ?? `pi_svc_${tag}`,
      stripeAmountTotal: args.stripeAmountTotalCents ?? 13500,
      stripeAmountRefunded: args.stripeAmountRefundedCents ?? 0,
      stripeApplicationFeeAmount: args.applicationFeeCents ?? 675,
      stripeCurrency: 'usd',
      // Optional paid discovery deposit on its OWN PI.
      ...(args.deposit
        ? {
            depositStatus: BookingDepositStatus.PAID,
            depositStripePaymentIntentId: args.deposit.pi,
            depositAmount: new Prisma.Decimal(args.deposit.depositDollars),
            discoveryFeeAmount: args.deposit.feeCents,
          }
        : {}),
    },
    select: { id: true },
  })
  return booking.id
}

/** Sum of BookingRefund cents for a booking + PI at the given statuses. */
async function sumRows(
  bookingId: string,
  paymentIntentId: string,
  statuses: BookingRefundStatus[],
): Promise<number> {
  const agg = await db.bookingRefund.aggregate({
    where: { bookingId, stripePaymentIntentId: paymentIntentId, status: { in: statuses } },
    _sum: { amountCents: true },
  })
  return agg._sum.amountCents ?? 0
}

beforeAll(async () => {
  const tenant = await db.tenant.create({
    data: { slug: `${tag}-tenant`, name: 'Refund Concurrency', isActive: true },
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
      firstName: 'Refund',
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

  const clientEmail = `${tag}_client@example.com`
  const clientUser = await db.user.create({
    data: { email: clientEmail, password: 'test-password', role: Role.CLIENT },
    select: { id: true },
  })
  seededUserEmails.push(clientEmail)
  const client = await db.clientProfile.create({
    data: {
      userId: clientUser.id,
      firstName: 'Refund',
      lastName: 'Client',
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
  refundCallCount = 0
  stripe.create.mockReset()
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
  await db.professionalLocation.deleteMany({ where: { name: `${tag} salon` } })
  await db.clientProfile.deleteMany({ where: { lastName: 'Client', firstName: 'Refund' } })
  await db.professionalProfile.deleteMany({ where: { businessName: `${tag} studio` } })
  await db.service.deleteMany({ where: { name: `${tag} service` } })
  await db.serviceCategory.deleteMany({ where: { slug: `${tag}-category` } })
  await db.user.deleteMany({ where: { email: { in: seededUserEmails } } })
  await db.tenant.deleteMany({ where: { slug: `${tag}-tenant` } })
  await db.$disconnect()
}, 60_000)

/** A Stripe refund stub returning a unique id per call (distinct rows settle). */
function mockRefundSuccess(): void {
  stripe.create.mockImplementation(async () => ({
    id: `re_${tag}_${++refundCallCount}`,
  }))
}

describe('two concurrent auto-cancel refunds of one booking', () => {
  it('refunds exactly once — no double refund under the advisory lock', async () => {
    const servicePi = `pi_svc_double_${tag}`
    const bookingId = await seedCapturedBooking({ servicePi })
    mockRefundSuccess()

    const common = {
      bookingId,
      actorKind: 'admin' as const,
      actorUserId: null,
      cancelMutated: true,
    }
    const [a, b] = await Promise.all([
      applyAutoCancelRefund(common),
      applyAutoCancelRefund(common),
    ])

    const outcomes = [a.outcome, b.outcome].sort()
    // Exactly one reserves + refunds; the other sees the reservation and skips.
    expect(outcomes).toEqual(['REFUNDED', 'SKIPPED'])
    expect(stripe.create).toHaveBeenCalledTimes(1)

    // The money invariant: total returned on the service PI equals the captured
    // total exactly once — never 2× 13500.
    expect(await sumRows(bookingId, servicePi, [BookingRefundStatus.SUCCEEDED])).toBe(
      13500,
    )

    const row = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { stripePaymentStatus: true },
    })
    expect(row.stripePaymentStatus).toBe(StripePaymentStatus.REFUNDED)
  })
})

describe('an auto-cancel refund racing a manual (discretionary) refund', () => {
  it('never double-refunds — exactly one succeeds, one skips', async () => {
    const servicePi = `pi_svc_manual_${tag}`
    const bookingId = await seedCapturedBooking({ servicePi })
    mockRefundSuccess()

    const [cancel, manual] = await Promise.all([
      applyAutoCancelRefund({
        bookingId,
        actorKind: 'admin',
        actorUserId: null,
        cancelMutated: true,
      }),
      refundBookingPayment({
        bookingId,
        trigger: BookingRefundTrigger.DISCRETIONARY,
        actor: { userId: null, role: Role.ADMIN },
        reason: 'Manual full refund racing the cancel.',
      }),
    ])

    const outcomes = [cancel.outcome, manual.outcome].sort()
    expect(outcomes).toEqual(['REFUNDED', 'SKIPPED'])
    expect(stripe.create).toHaveBeenCalledTimes(1)
    expect(await sumRows(bookingId, servicePi, [BookingRefundStatus.SUCCEEDED])).toBe(
      13500,
    )
  })
})

describe('a cancel refund on a booking already fully Dashboard-refunded', () => {
  it('skips — the dashboard total is subtracted, so nothing is double-returned', async () => {
    const servicePi = `pi_svc_dash_${tag}`
    // Stripe already shows the full amount refunded (a Dashboard refund with no
    // local BookingRefund row), synced onto stripeAmountRefunded by the reconcile.
    const bookingId = await seedCapturedBooking({
      servicePi,
      stripeAmountRefundedCents: 13500,
    })
    mockRefundSuccess()

    const result = await applyAutoCancelRefund({
      bookingId,
      actorKind: 'admin',
      actorUserId: null,
      cancelMutated: true,
    })

    expect(result.outcome).toBe('SKIPPED')
    expect(stripe.create).not.toHaveBeenCalled()
    expect(await sumRows(bookingId, servicePi, [BookingRefundStatus.SUCCEEDED])).toBe(0)
  })
})

describe('concurrent deposit + service refund on one booking (M3 per-PI scoping)', () => {
  it('each PI refunds in full — the deposit row never shrinks the service remainder', async () => {
    const servicePi = `pi_svc_perpi_${tag}`
    const depositPi = `pi_dep_perpi_${tag}`
    const bookingId = await seedCapturedBooking({
      servicePi,
      deposit: { pi: depositPi, depositDollars: '40.00', feeCents: 0 },
    })
    mockRefundSuccess()

    const [deposit, service] = await Promise.all([
      applyDiscoveryDepositCancelRefund({
        bookingId,
        actorKind: 'admin',
        actorUserId: null,
        cancelMutated: true,
      }),
      applyAutoCancelRefund({
        bookingId,
        actorKind: 'admin',
        actorUserId: null,
        cancelMutated: true,
      }),
    ])

    // Both succeed: they reserve against DIFFERENT PaymentIntents, so the lock
    // serializes them but neither shrinks the other's remainder.
    expect(deposit.outcome).toBe('REFUNDED')
    expect(service.outcome).toBe('REFUNDED')
    expect(stripe.create).toHaveBeenCalledTimes(2)

    // The invariant M3 fixed: the deposit's SUCCEEDED row (4000 on depositPi) does
    // NOT count against the service PI — the service still returned its full 13500.
    expect(await sumRows(bookingId, servicePi, [BookingRefundStatus.SUCCEEDED])).toBe(
      13500,
    )
    expect(await sumRows(bookingId, depositPi, [BookingRefundStatus.SUCCEEDED])).toBe(
      4000,
    )

    const row = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: {
        stripePaymentStatus: true,
        depositStatus: true,
        depositRefundedCents: true,
      },
    })
    expect(row.stripePaymentStatus).toBe(StripePaymentStatus.REFUNDED)
    expect(row.depositStatus).toBe(BookingDepositStatus.REFUNDED)
    expect(row.depositRefundedCents).toBe(4000)
  })
})

describe('the M3 retry sweep racing a manual refund', () => {
  it('never double-refunds a booking with a stale FAILED auto-cancel row', async () => {
    const servicePi = `pi_svc_sweep_${tag}`
    const bookingId = await seedCapturedBooking({ servicePi })
    // A prior auto-cancel refund FAILED (past the 1h backoff) — the sweep's
    // candidate. A FAILED row is NOT reserving, so it does not itself block a
    // refund; the sweep re-drives the full remainder.
    await db.bookingRefund.create({
      data: {
        bookingId,
        amountCents: 13500,
        currency: 'usd',
        status: BookingRefundStatus.FAILED,
        trigger: BookingRefundTrigger.AUTO_CANCELLATION,
        reverseTransfer: true,
        applicationFeeRefunded: false,
        stripePaymentIntentId: servicePi,
        createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
        failureCode: 'api_error',
        failureMessage: 'earlier transient failure',
      },
    })
    mockRefundSuccess()

    const [, manual] = await Promise.all([
      retryFailedAutoCancelRefunds({ now: new Date() }),
      refundBookingPayment({
        bookingId,
        trigger: BookingRefundTrigger.DISCRETIONARY,
        actor: { userId: null, role: Role.ADMIN },
        reason: 'Manual refund racing the retry sweep.',
      }),
    ])

    // Whichever wins the lock, exactly ONE new SUCCEEDED refund lands — the sweep
    // and the manual refund both reserve against the same PI, so the second sees
    // the first's reservation and no-ops. No double refund.
    expect(stripe.create).toHaveBeenCalledTimes(1)
    expect(await sumRows(bookingId, servicePi, [BookingRefundStatus.SUCCEEDED])).toBe(
      13500,
    )
    // The manual refund either won (REFUNDED) or lost the race (SKIPPED) — never
    // a second charge.
    expect(['REFUNDED', 'SKIPPED']).toContain(manual.outcome)

    const row = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { stripePaymentStatus: true },
    })
    expect(row.stripePaymentStatus).toBe(StripePaymentStatus.REFUNDED)
  })
})
