// tests/integration/deposit-credit-closeout.test.ts
//
// K10-A — the deposit CREDIT and closeout-at-zero, driven against real Postgres.
//
// The bug this suite pins: `Booking.depositCreditedAt`'s schema comment has said
// "when the deposit was applied against the final total" since the deposit rail
// shipped, and `ClientDepositCard` promises the client their deposit "is held
// and will be credited toward your service total". Nothing wrote that column and
// `computeCheckoutTotal` had no deposit term, so the final bill charged the WHOLE
// total a second time. A client who paid a $60 deposit on a $200 service was
// charged $200 again at checkout.
//
// Everything here goes through the real write boundary against a real row —
// mocked-tx unit tests cannot show a double charge, because the amount they
// assert is the amount they were handed. Stripe is not involved at all: the
// assertions are the amount the boundary SAYS to charge and the row it leaves
// behind, which is exactly where the bug lived.
//
// Run with `pnpm test:integration` (or the whole dir in CI via integration.yml).
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  BookingCheckoutStatus,
  BookingDepositStatus,
  BookingStatus,
  Prisma,
  PrismaClient,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
} from '@prisma/client'

import { prepareClientStripeCheckoutSession } from '@/lib/booking/writeBoundary'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with: pnpm test:integration')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const tag = `dep_credit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
const ZONE = 'America/Los_Angeles'

/** $200 service — every case below bills this total. */
const TOTAL = '200.00'
const TOTAL_CENTS = 20_000

type Fixtures = {
  tenantId: string
  professionalId: string
  serviceId: string
  locationId: string
  clientId: string
}

let fx: Fixtures
const seededUserEmails: string[] = []

/**
 * A booking sitting exactly where client checkout begins: aftercare sent,
 * checkout READY, nothing collected — plus whatever deposit state the case is
 * about.
 */
async function checkoutReadyBooking(deposit: {
  status?: BookingDepositStatus
  amount?: string | null
  refundedCents?: number
  disputedAt?: Date | null
}): Promise<string> {
  const booking = await db.booking.create({
    data: {
      clientId: fx.clientId,
      professionalId: fx.professionalId,
      serviceId: fx.serviceId,
      scheduledFor: new Date(Date.now() - 24 * 60 * 60 * 1000),
      status: BookingStatus.IN_PROGRESS,
      locationType: ServiceLocationType.SALON,
      locationId: fx.locationId,
      locationTimeZone: ZONE,
      subtotalSnapshot: new Prisma.Decimal(TOTAL),
      serviceSubtotalSnapshot: new Prisma.Decimal(TOTAL),
      productSubtotalSnapshot: new Prisma.Decimal('0.00'),
      tipAmount: new Prisma.Decimal('0.00'),
      taxAmount: new Prisma.Decimal('0.00'),
      discountAmount: new Prisma.Decimal('0.00'),
      totalAmount: new Prisma.Decimal(TOTAL),
      totalDurationMinutes: 60,
      proTenantId: fx.tenantId,
      clientHomeTenantId: fx.tenantId,
      checkoutStatus: BookingCheckoutStatus.READY,
      depositStatus: deposit.status ?? BookingDepositStatus.NONE,
      depositAmount:
        deposit.amount == null ? null : new Prisma.Decimal(deposit.amount),
      depositRefundedCents: deposit.refundedCents ?? 0,
      depositDisputedAt: deposit.disputedAt ?? null,
      depositPaidAt:
        deposit.status === BookingDepositStatus.PAID ? new Date() : null,
    },
    select: { id: true },
  })

  // Client checkout refuses until aftercare is finalized.
  await db.aftercareSummary.create({
    data: {
      bookingId: booking.id,
      sentToClientAt: new Date(),
    },
  })

  return booking.id
}

function prepare(bookingId: string) {
  return prepareClientStripeCheckoutSession({
    bookingId,
    clientId: fx.clientId,
    requestId: null,
    idempotencyKey: `${tag}-${bookingId}`,
  })
}

function readBooking(bookingId: string) {
  return db.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: {
      checkoutStatus: true,
      paymentCollectedAt: true,
      paymentAuthorizedAt: true,
      depositCreditedAt: true,
      totalAmount: true,
      stripeAmountTotal: true,
      stripePaymentIntentId: true,
      selectedPaymentMethod: true,
    },
  })
}

beforeAll(async () => {
  const tenant = await db.tenant.create({
    data: { slug: `${tag}-tenant`, name: 'Deposit Credit', isActive: true },
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
      firstName: 'Credit',
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
      stripePayoutsEnabled: true,
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
      lastName: 'Credit',
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
  await db.aftercareSummary.deleteMany({
    where: { booking: { professionalId: fx.professionalId } },
  })
  await db.bookingCloseoutAuditLog.deleteMany({
    where: { professionalId: fx.professionalId },
  })
  await db.booking.deleteMany({ where: { professionalId: fx.professionalId } })
})

afterAll(async () => {
  await db.aftercareSummary.deleteMany({
    where: { booking: { professionalId: fx.professionalId } },
  })
  await db.bookingCloseoutAuditLog.deleteMany({
    where: { professionalId: fx.professionalId },
  })
  await db.booking.deleteMany({ where: { professionalId: fx.professionalId } })
  await db.professionalPaymentSettings.deleteMany({
    where: { professionalId: fx.professionalId },
  })
  await db.professionalLocation.deleteMany({ where: { name: `${tag} salon` } })
  await db.clientProfile.deleteMany({ where: { lastName: 'Credit' } })
  await db.professionalProfile.deleteMany({
    where: { businessName: `${tag} studio` },
  })
  await db.service.deleteMany({ where: { name: `${tag} service` } })
  await db.serviceCategory.deleteMany({ where: { slug: `${tag}-category` } })
  await db.user.deleteMany({ where: { email: { in: seededUserEmails } } })
  await db.tenant.deleteMany({ where: { slug: `${tag}-tenant` } })
  await db.$disconnect()
}, 60_000)

describe('the deposit comes off the final bill', () => {
  // The control: with no deposit, the charge is the whole total. Without this,
  // every assertion below could pass on a helper that always returns zero.
  it('charges the full total when there is no deposit', async () => {
    const bookingId = await checkoutReadyBooking({})

    const prepared = await prepare(bookingId)

    expect(prepared.outcome).toBe('STRIPE_SESSION')
    if (prepared.outcome !== 'STRIPE_SESSION') return
    expect(prepared.stripe.amountCents).toBe(TOTAL_CENTS)
    expect(prepared.depositCreditCents).toBe(0)
  })

  // 🔴 THE BUG. Pre-K10-A this charged 20000 — the client's $60 deposit was
  // collected a second time. This assertion fails on any implementation that
  // charges `totalAmount`.
  it('charges the total MINUS a paid deposit', async () => {
    const bookingId = await checkoutReadyBooking({
      status: BookingDepositStatus.PAID,
      amount: '60.00',
    })

    const prepared = await prepare(bookingId)

    expect(prepared.outcome).toBe('STRIPE_SESSION')
    if (prepared.outcome !== 'STRIPE_SESSION') return
    expect(prepared.stripe.amountCents).toBe(14_000)
    expect(prepared.depositCreditCents).toBe(6_000)
  })

  it('leaves the bill itself untouched — the credit reduces the CHARGE, not the total', async () => {
    const bookingId = await checkoutReadyBooking({
      status: BookingDepositStatus.PAID,
      amount: '60.00',
    })

    await prepare(bookingId)

    // The service still cost $200; that is what the pro earned and what the
    // money trail must keep saying. Rewriting the total would corrupt the
    // pro's own earnings history to make one charge come out right.
    expect(Number((await readBooking(bookingId)).totalAmount)).toBe(200)
  })
})

describe('closeout at zero', () => {
  it('settles a fully-prepaid booking without opening a Stripe session', async () => {
    const bookingId = await checkoutReadyBooking({
      status: BookingDepositStatus.PAID,
      amount: TOTAL,
    })

    const prepared = await prepare(bookingId)

    expect(prepared.outcome).toBe('SETTLED_BY_DEPOSIT')
    expect(prepared.depositCreditCents).toBe(TOTAL_CENTS)

    const row = await readBooking(bookingId)
    expect(row.checkoutStatus).toBe(BookingCheckoutStatus.PAID)
    expect(row.paymentCollectedAt).not.toBeNull()
    expect(row.paymentAuthorizedAt).not.toBeNull()
    // The column whose schema comment described a write that did not exist.
    expect(row.depositCreditedAt).not.toBeNull()
  })

  // The double charge in its worst form: pre-K10-A a booking the client had
  // ALREADY paid in full opened a Stripe session for the entire total again.
  it('never hands a fully-prepaid client another charge', async () => {
    const bookingId = await checkoutReadyBooking({
      status: BookingDepositStatus.PAID,
      amount: TOTAL,
    })

    const prepared = await prepare(bookingId)

    expect(prepared.outcome).not.toBe('STRIPE_SESSION')
    expect(prepared).not.toHaveProperty('stripe')
  })

  it('touches no Stripe columns — there is no charge to record', async () => {
    const bookingId = await checkoutReadyBooking({
      status: BookingDepositStatus.PAID,
      amount: TOTAL,
    })

    await prepare(bookingId)

    const row = await readBooking(bookingId)
    // Nothing was captured on the FINAL-BILL PaymentIntent, so the refund
    // rail's over-refund guard (captured − reserved) has nothing to give back
    // here. A refund has to go through the DEPOSIT PI's own guard instead —
    // which is what stops this booking being refunded twice.
    expect(row.stripeAmountTotal).toBeNull()
    expect(row.stripePaymentIntentId).toBeNull()
    // The client presented no card for this bill; stamping STRIPE_CARD would
    // make an abandoned-checkout residual out of a settled one (M2).
    expect(row.selectedPaymentMethod).toBeNull()
  })

  it('is idempotent — a replayed prepare keeps the first settlement', async () => {
    const bookingId = await checkoutReadyBooking({
      status: BookingDepositStatus.PAID,
      amount: TOTAL,
    })

    await prepare(bookingId)
    const first = await readBooking(bookingId)

    // A second call finds checkout already PAID and refuses to reopen it,
    // rather than re-settling and moving the collected/credited stamps.
    await expect(prepare(bookingId)).rejects.toThrow()

    const second = await readBooking(bookingId)
    expect(second.paymentCollectedAt).toEqual(first.paymentCollectedAt)
    expect(second.depositCreditedAt).toEqual(first.depositCreditedAt)
  })

  it('caps the credit at the bill when the deposit exceeds it', async () => {
    const bookingId = await checkoutReadyBooking({
      status: BookingDepositStatus.PAID,
      amount: '250.00',
    })

    const prepared = await prepare(bookingId)

    expect(prepared.outcome).toBe('SETTLED_BY_DEPOSIT')
    // Credited $200 against a $200 bill, not $250. The extra $50 is money the
    // pro still holds and the refund rail owns returning it — a checkout path
    // must never quietly hand it back.
    expect(prepared.depositCreditCents).toBe(TOTAL_CENTS)
  })
})

describe('money that is not really held credits nothing', () => {
  it('charges the full total when the deposit is under dispute', async () => {
    const bookingId = await checkoutReadyBooking({
      status: BookingDepositStatus.PAID,
      amount: TOTAL,
      disputedAt: new Date('2026-07-30T00:00:00.000Z'),
    })

    const prepared = await prepare(bookingId)

    // Stripe already pulled the deposit back out of the pro's balance.
    // Crediting it would hand the client the service free and bill the pro.
    expect(prepared.outcome).toBe('STRIPE_SESSION')
    if (prepared.outcome !== 'STRIPE_SESSION') return
    expect(prepared.stripe.amountCents).toBe(TOTAL_CENTS)
    expect(prepared.depositCreditCents).toBe(0)
  })

  it('credits only the net still held after a partial refund', async () => {
    const bookingId = await checkoutReadyBooking({
      status: BookingDepositStatus.PAID,
      amount: TOTAL,
      refundedCents: 5_000,
    })

    const prepared = await prepare(bookingId)

    // A partially-refunded prepay stops being a prepay: $50 went back, so $50
    // is now due and the booking must NOT settle itself.
    expect(prepared.outcome).toBe('STRIPE_SESSION')
    if (prepared.outcome !== 'STRIPE_SESSION') return
    expect(prepared.stripe.amountCents).toBe(5_000)
    expect(prepared.depositCreditCents).toBe(15_000)

    expect((await readBooking(bookingId)).checkoutStatus).toBe(
      BookingCheckoutStatus.READY,
    )
  })

  it('charges the full total for a deposit that was never paid', async () => {
    const bookingId = await checkoutReadyBooking({
      status: BookingDepositStatus.PENDING,
      amount: TOTAL,
    })

    const prepared = await prepare(bookingId)

    expect(prepared.outcome).toBe('STRIPE_SESSION')
    if (prepared.outcome !== 'STRIPE_SESSION') return
    expect(prepared.stripe.amountCents).toBe(TOTAL_CENTS)
  })

  it('charges the full total for a fully refunded deposit', async () => {
    const bookingId = await checkoutReadyBooking({
      status: BookingDepositStatus.REFUNDED,
      amount: TOTAL,
      refundedCents: TOTAL_CENTS,
    })

    const prepared = await prepare(bookingId)

    expect(prepared.outcome).toBe('STRIPE_SESSION')
    if (prepared.outcome !== 'STRIPE_SESSION') return
    expect(prepared.stripe.amountCents).toBe(TOTAL_CENTS)
  })
})
