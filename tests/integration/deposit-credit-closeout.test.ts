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
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  BookingCheckoutStatus,
  BookingDepositStatus,
  BookingSource,
  BookingStatus,
  DepositScope,
  DepositType,
  OfferingPrepayScope,
  Prisma,
  PrismaClient,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
  StripeAccountStatus,
} from '@prisma/client'

import {
  createHold,
  finalizeBookingFromHold,
  prepareClientStripeCheckoutSession,
} from '@/lib/booking/writeBoundary'
import { resolveDiscoveryFinalize } from '@/lib/booking/resolveDiscoveryFinalize'
import { derivePaymentBadge } from '@/lib/booking/paymentBadge'
import { minutesSinceMidnightInTimeZone } from '@/lib/time'

// K10's cases book through the REAL hold/finalize path, and a hold snapshots
// its location address through the PII envelope — so the boundary needs a real
// keyring even though these fixtures are salon-only.
vi.hoisted(() => {
  const key32 = Buffer.alloc(32, 9).toString('base64')
  process.env.PII_LOOKUP_HMAC_KEYS_JSON ||= JSON.stringify({ 1: key32 })
  process.env.PII_AEAD_KEYS_JSON ||= JSON.stringify({ 'address-aead-v1': key32 })
})

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
  clientUserId: string
  offeringId: string
  addOnServiceId: string
  offeringAddOnId: string
}

/** K10 fixture money: a $200 base service with a $50 add-on hanging off it. */
const BASE_PRICE = '200.00'
const BASE_PRICE_CENTS = 20_000
const ADD_ON_PRICE = '50.00'
const ADD_ON_PRICE_CENTS = 5_000
const BASE_DURATION_MINUTES = 60

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
      // K10 books through the real hold/finalize path, which refuses a pro who
      // is not booking-ready — so the salon needs an address and coordinates.
      formattedAddress: '123 Credit St, San Diego, CA 92101',
      addressLine1: '123 Credit St',
      city: 'San Diego',
      state: 'CA',
      postalCode: '92101',
      countryCode: 'US',
      lat: new Prisma.Decimal('32.7157000'),
      lng: new Prisma.Decimal('-117.1611000'),
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
      stripeAccountStatus: StripeAccountStatus.ENABLED,
      stripeDetailsSubmitted: true,
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

  // K10: the offering the prepay requirement lives on, plus an add-on so the
  // mixed-booking case (SERVICE_ONLY vs ENTIRE_BOOKING) is real rather than
  // hypothetical.
  const offering = await db.professionalServiceOffering.create({
    data: {
      professionalId: pro.id,
      serviceId: service.id,
      salonPriceStartingAt: new Prisma.Decimal(BASE_PRICE),
      salonDurationMinutes: BASE_DURATION_MINUTES,
      offersInSalon: true,
      offersMobile: false,
      isActive: true,
    },
    select: { id: true },
  })

  const addOnService = await db.service.create({
    data: {
      name: `${tag} add-on`,
      categoryId: category.id,
      defaultDurationMinutes: 15,
      minPrice: new Prisma.Decimal(ADD_ON_PRICE),
      isActive: true,
      isAddOnEligible: true,
    },
    select: { id: true },
  })

  const offeringAddOn = await db.offeringAddOn.create({
    data: {
      offeringId: offering.id,
      addOnServiceId: addOnService.id,
      priceOverride: new Prisma.Decimal(ADD_ON_PRICE),
      durationOverrideMinutes: 15,
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
    clientUserId: clientUser.id,
    offeringId: offering.id,
    addOnServiceId: addOnService.id,
    offeringAddOnId: offeringAddOn.id,
  }
}, 60_000)

afterEach(async () => {
  // K10 cases mutate the pro's payment settings and the offering's prepay
  // requirement; every test states its own, so reset to the shipped default
  // rather than letting one case's setup leak into the next.
  await db.professionalPaymentSettings.update({
    where: { professionalId: fx.professionalId },
    data: {
      depositEnabled: false,
      depositType: DepositType.FLAT,
      depositFlatAmount: null,
      depositPercent: null,
      depositScope: DepositScope.NEW_DISCOVERY_ONLY,
      acceptStripeCard: true,
      stripeAccountStatus: StripeAccountStatus.ENABLED,
      stripeDetailsSubmitted: true,
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
    },
  })
  await db.professionalServiceOffering.update({
    where: { id: fx.offeringId },
    data: { prepayScope: null },
  })
  await db.bookingHold.deleteMany({
    where: { professionalId: fx.professionalId },
  })
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
  await db.bookingHold.deleteMany({
    where: { professionalId: fx.professionalId },
  })
  await db.offeringAddOn.deleteMany({ where: { offeringId: fx.offeringId } })
  await db.professionalServiceOffering.deleteMany({
    where: { professionalId: fx.professionalId },
  })
  await db.professionalPaymentSettings.deleteMany({
    where: { professionalId: fx.professionalId },
  })
  await db.professionalLocation.deleteMany({ where: { name: `${tag} salon` } })
  await db.clientProfile.deleteMany({ where: { lastName: 'Credit' } })
  await db.professionalProfile.deleteMany({
    where: { businessName: `${tag} studio` },
  })
  await db.service.deleteMany({
    where: { name: { in: [`${tag} service`, `${tag} add-on`] } },
  })
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

    expect(prepared.outcome).toBe('SETTLED_NOTHING_DUE')
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

    expect(prepared.outcome).toBe('SETTLED_NOTHING_DUE')
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

// ── K10: the per-service PREPAY requirement (D4) ─────────────────────────────
//
// K10-A built the credit and the zero-due closeout; K10 builds the thing that
// produces a deposit big enough to need them. Everything below goes through the
// REAL write boundary — `createHold` → `resolveDiscoveryFinalize` →
// `finalizeBookingFromHold` — because the bug class here is "the row the
// boundary wrote", and a mocked transaction asserts only the number it was
// handed.
//
// 🔴 Proven RED first: with `prepayScope` ignored, the four charge assertions in
// this block fail (`depositAmount` comes back null and the closeout opens a
// $250 session).

/** A future instant at `hh:00` local, inside the fixture's 09:00–18:00 hours. */
function futureLocal(daysAhead: number, hh: number): Date {
  const anchor = new Date()
  anchor.setUTCDate(anchor.getUTCDate() + daysAhead)
  anchor.setUTCHours(20, 0, 0, 0)

  const anchorLocalMinutes = minutesSinceMidnightInTimeZone(anchor, ZONE)

  return new Date(anchor.getTime() + (hh * 60 - anchorLocalMinutes) * 60_000)
}

function finalizeOffering() {
  return {
    id: fx.offeringId,
    professionalId: fx.professionalId,
    serviceId: fx.serviceId,
    offersInSalon: true,
    offersMobile: false,
    salonPriceStartingAt: new Prisma.Decimal(BASE_PRICE),
    salonDurationMinutes: BASE_DURATION_MINUTES,
    mobilePriceStartingAt: null,
    mobileDurationMinutes: null,
    professionalTimeZone: ZONE,
  }
}

/**
 * Book the fixture offering the way a client does: hold the slot, resolve the
 * discovery/deposit directive from real DB state, finalize. Returns the row the
 * boundary wrote.
 */
async function bookThroughTheRealPath(args: {
  hour: number
  addOnIds?: string[]
  source?: BookingSource
}) {
  const addOnIds = args.addOnIds ?? []
  const start = futureLocal(3, args.hour)

  const held = await createHold({
    clientId: fx.clientId,
    bookingEntryPoint: 'DIRECT_PROFILE',
    addOnIds,
    offering: {
      id: fx.offeringId,
      professionalId: fx.professionalId,
      offersInSalon: true,
      offersMobile: false,
      salonDurationMinutes: BASE_DURATION_MINUTES,
      mobileDurationMinutes: null,
      salonPriceStartingAt: new Prisma.Decimal(BASE_PRICE),
      mobilePriceStartingAt: null,
      professionalTimeZone: ZONE,
    },
    requestedStart: start,
    requestedLocationId: fx.locationId,
    locationType: ServiceLocationType.SALON,
    clientAddressId: null,
  })

  const source = args.source ?? BookingSource.REQUESTED

  // The trust boundary, against the real DB — this is what reads the offering's
  // `prepayScope`, so the test cannot accidentally hand it the answer.
  const discovery = await resolveDiscoveryFinalize({
    clientId: fx.clientId,
    clientUserId: fx.clientUserId,
    professionalId: fx.professionalId,
    offeringId: fx.offeringId,
    lookPostId: null,
    mediaId: null,
    source,
    aftercare: false,
  })

  const finalized = await finalizeBookingFromHold({
    clientId: fx.clientId,
    bookingEntryPoint: 'DIRECT_PROFILE',
    holdId: held.hold.id,
    openingId: null,
    addOnIds,
    locationType: ServiceLocationType.SALON,
    source,
    initialStatus: BookingStatus.PENDING,
    rebookOfBookingId: null,
    offering: finalizeOffering(),
    discovery,
  })

  const row = await db.booking.findUniqueOrThrow({
    where: { id: finalized.booking.id },
    select: {
      id: true,
      depositStatus: true,
      depositAmount: true,
      depositRefundedCents: true,
      depositDisputedAt: true,
      discoveryFeeAmount: true,
      totalAmount: true,
      subtotalSnapshot: true,
      checkoutStatus: true,
      paymentCollectedAt: true,
      stripePaymentStatus: true,
      stripeAmountTotal: true,
      stripeAmountRefunded: true,
      paymentAuthorizedAt: true,
      depositCreditedAt: true,
    },
  })

  return { discovery, row }
}

function centsOf(value: Prisma.Decimal | null): number | null {
  return value == null ? null : Math.round(Number(value) * 100)
}

/** Mark a booking's deposit captured and open its client checkout. */
async function depositPaidAndCheckoutReady(bookingId: string) {
  await db.booking.update({
    where: { id: bookingId },
    data: {
      status: BookingStatus.IN_PROGRESS,
      depositStatus: BookingDepositStatus.PAID,
      depositPaidAt: new Date(),
      checkoutStatus: BookingCheckoutStatus.READY,
    },
  })
  await db.aftercareSummary.create({
    data: { bookingId, sentToClientAt: new Date() },
  })
}

describe('K10 — a prepay-required service is paid in full up front', () => {
  // The control. Same path, same offering, no requirement: nothing is collected,
  // so every assertion below is about `prepayScope` and not about the harness.
  it('collects nothing when the service demands no prepay', async () => {
    const { discovery, row } = await bookThroughTheRealPath({ hour: 10 })

    expect(discovery.depositRequirement).toEqual({
      required: false,
      scopeRequired: false,
      prepayScope: null,
    })
    expect(row.depositStatus).toBe(BookingDepositStatus.NONE)
    expect(row.depositAmount).toBeNull()
  })

  // 🔴 Tori, 2026-07-30: per-service prepay OVERRIDES the account-wide switch.
  // `depositEnabled` is false for this pro throughout.
  it('charges the WHOLE bill with deposits switched off account-wide', async () => {
    await db.professionalServiceOffering.update({
      where: { id: fx.offeringId },
      data: { prepayScope: OfferingPrepayScope.ENTIRE_BOOKING },
    })

    const { discovery, row } = await bookThroughTheRealPath({
      hour: 11,
      addOnIds: [fx.offeringAddOnId],
    })

    expect(discovery.depositRequirement.required).toBe(true)
    expect(discovery.depositRequirement.scopeRequired).toBe(false)
    expect(discovery.depositSettings.depositEnabled).toBe(false)

    expect(row.depositStatus).toBe(BookingDepositStatus.PENDING)
    expect(centsOf(row.totalAmount)).toBe(BASE_PRICE_CENTS + ADD_ON_PRICE_CENTS)
    expect(centsOf(row.depositAmount)).toBe(
      BASE_PRICE_CENTS + ADD_ON_PRICE_CENTS,
    )
    // The pro is not a cold platform match here, so no platform fee rides
    // along. It records 0 rather than null because the booking DOES carry an
    // up-front charge — and the refund-reset query that reads this column keys
    // on `> 0`, so 0 and null mean the same thing to every reader.
    expect(row.discoveryFeeAmount).toBe(0)
  })

  // The mixed booking Tori settled: the pro chose "this service only", so the
  // add-on stays on the final bill instead of being swept into the prepay.
  it('SERVICE_ONLY charges the base service and leaves the add-on to settle later', async () => {
    await db.professionalServiceOffering.update({
      where: { id: fx.offeringId },
      data: { prepayScope: OfferingPrepayScope.SERVICE_ONLY },
    })

    const { row } = await bookThroughTheRealPath({
      hour: 12,
      addOnIds: [fx.offeringAddOnId],
    })

    expect(centsOf(row.totalAmount)).toBe(BASE_PRICE_CENTS + ADD_ON_PRICE_CENTS)
    expect(centsOf(row.depositAmount)).toBe(BASE_PRICE_CENTS)
  })

  // Adding the two rules would charge 125% of the bill.
  it('does not stack the pro’s own percentage deposit on top of the prepay', async () => {
    await db.professionalPaymentSettings.update({
      where: { professionalId: fx.professionalId },
      data: {
        depositEnabled: true,
        depositType: DepositType.PERCENT,
        depositPercent: 25,
        depositScope: DepositScope.ALL_CLIENTS,
      },
    })
    await db.professionalServiceOffering.update({
      where: { id: fx.offeringId },
      data: { prepayScope: OfferingPrepayScope.ENTIRE_BOOKING },
    })

    const { discovery, row } = await bookThroughTheRealPath({ hour: 13 })

    // Both rules fired...
    expect(discovery.depositRequirement.scopeRequired).toBe(true)
    expect(discovery.depositRequirement.prepayScope).toBe(
      OfferingPrepayScope.ENTIRE_BOOKING,
    )
    // ...and the charge is the bill, not the bill plus a quarter of it.
    expect(centsOf(row.depositAmount)).toBe(BASE_PRICE_CENTS)
  })

  // 🔴 The gate prepay does NOT override. A pro who cannot receive a
  // destination charge would only get a booking nobody can pay for — and the
  // 24h release sweep would then cancel it.
  it('collects nothing from a pro who cannot take a card charge', async () => {
    // A cash-only pro: booking-ready (readiness only demands Connect from pros
    // who accept cards) but with no way to receive a destination charge.
    await db.professionalPaymentSettings.update({
      where: { professionalId: fx.professionalId },
      data: {
        acceptStripeCard: false,
        stripeChargesEnabled: false,
        stripePayoutsEnabled: false,
      },
    })
    await db.professionalServiceOffering.update({
      where: { id: fx.offeringId },
      data: { prepayScope: OfferingPrepayScope.ENTIRE_BOOKING },
    })

    const { discovery, row } = await bookThroughTheRealPath({ hour: 14 })

    expect(discovery.depositRequirement.required).toBe(false)
    expect(row.depositStatus).toBe(BookingDepositStatus.NONE)
    expect(row.depositAmount).toBeNull()
  })

  // The end-to-end DoD: booked prepay-required, paid, closed out at $0 with no
  // second charge. This is the assertion that would have caught K10-A's bug on
  // a prepaid booking — pre-K10-A it opened a Stripe session for the full $200.
  it('settles closeout at $0 with no second charge once the prepay is paid', async () => {
    await db.professionalServiceOffering.update({
      where: { id: fx.offeringId },
      data: { prepayScope: OfferingPrepayScope.ENTIRE_BOOKING },
    })

    const { row } = await bookThroughTheRealPath({ hour: 15 })
    expect(centsOf(row.depositAmount)).toBe(BASE_PRICE_CENTS)

    await depositPaidAndCheckoutReady(row.id)

    const prepared = await prepare(row.id)

    expect(prepared.outcome).toBe('SETTLED_NOTHING_DUE')
    if (prepared.outcome !== 'SETTLED_NOTHING_DUE') return
    expect(prepared.depositCreditCents).toBe(BASE_PRICE_CENTS)

    const settled = await readBooking(row.id)
    expect(settled.checkoutStatus).toBe(BookingCheckoutStatus.PAID)
    expect(settled.depositCreditedAt).not.toBeNull()
    expect(settled.paymentCollectedAt).not.toBeNull()
    // No session was opened, so no Stripe amount was ever quoted.
    expect(settled.stripePaymentIntentId).toBeNull()
    // The bill itself is untouched — the credit reduces the CHARGE, not the total.
    expect(centsOf(settled.totalAmount)).toBe(BASE_PRICE_CENTS)
  })

  // A prepay that has been partly refunded is no longer "paid in full": the
  // badge must stop claiming it and the client must be billed the balance.
  it('stops claiming PREPAID_IN_FULL once the prepay is partly refunded', async () => {
    await db.professionalServiceOffering.update({
      where: { id: fx.offeringId },
      data: { prepayScope: OfferingPrepayScope.ENTIRE_BOOKING },
    })

    const { row } = await bookThroughTheRealPath({ hour: 16 })
    await depositPaidAndCheckoutReady(row.id)

    const fullyPaid = await db.booking.findUniqueOrThrow({
      where: { id: row.id },
      select: {
        depositStatus: true,
        depositAmount: true,
        depositRefundedCents: true,
        depositDisputedAt: true,
        totalAmount: true,
        checkoutStatus: true,
        paymentCollectedAt: true,
        stripePaymentStatus: true,
        stripeAmountTotal: true,
        stripeAmountRefunded: true,
      },
    })

    expect(derivePaymentBadge(fullyPaid).kind).toBe('PREPAID_IN_FULL')

    await db.booking.update({
      where: { id: row.id },
      data: { depositRefundedCents: 5_000 },
    })

    const partlyRefunded = await db.booking.findUniqueOrThrow({
      where: { id: row.id },
      select: {
        depositStatus: true,
        depositAmount: true,
        depositRefundedCents: true,
        depositDisputedAt: true,
        totalAmount: true,
        checkoutStatus: true,
        paymentCollectedAt: true,
        stripePaymentStatus: true,
        stripeAmountTotal: true,
        stripeAmountRefunded: true,
      },
    })

    expect(derivePaymentBadge(partlyRefunded).kind).not.toBe('PREPAID_IN_FULL')

    // ...and the balance is what the client is asked for, not the whole bill
    // and not nothing.
    await db.booking.update({
      where: { id: row.id },
      data: {
        checkoutStatus: BookingCheckoutStatus.READY,
        paymentCollectedAt: null,
      },
    })

    const prepared = await prepare(row.id)

    expect(prepared.outcome).toBe('STRIPE_SESSION')
    if (prepared.outcome !== 'STRIPE_SESSION') return
    expect(prepared.stripe.amountCents).toBe(5_000)
    expect(prepared.depositCreditCents).toBe(BASE_PRICE_CENTS - 5_000)
  })
})
