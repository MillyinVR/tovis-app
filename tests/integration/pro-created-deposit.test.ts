// tests/integration/pro-created-deposit.test.ts
//
// K10-B — the pro-created deposit step, driven against real Postgres.
//
// What this suite pins, end to end through the real write boundary:
//
//   1. `depositRequested` on the pro-create path stamps the deposit rail
//      (PENDING + amount from the pro's own config + the STAMPED release
//      deadline `depositDueAt`) and mints the DEPOSIT_PAYMENT pay-link token —
//      pre-K10-B the path hardcoded no deposit at all.
//   2. The dueAt formula's both branches: far-future bookings anchor on the
//      appointment (scheduledFor − 72h); near-term bookings hit the floor
//      (createdAt + 24h) instead of being born past their own deadline.
//   3. The release sweep keys on the STAMP: a stamped-future row with an old
//      createdAt is left alone (the old ageing would have cancelled it), a
//      stamped-past row releases, and a legacy null-stamp row still ages on
//      createdAt.
//   4. An impossible request is REFUSED, not silently dropped: no Stripe, or
//      nothing chargeable, means NO booking row.
//   5. skip and importMode stamp nothing.
//   6. The unauthenticated token resolves to the same prepare-checkout core
//      the authed deposit route uses.
//   7. K10-B-1 — an UNCLAIMED client gets a SECOND, scheduled dispatch of the
//      same pay link at the instant the login-gated DEPOSIT_REMINDER computes
//      (they can't use that reminder: no in-app inbox, email suppressed on the
//      unverified destination, no SMS channel), and every state change that
//      makes the nudge a lie cancels it — the generic dispatch drain does NOT
//      revalidate deposit state at send time.
//
// Run with `pnpm test:integration`.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  BookingDepositStatus,
  BookingStatus,
  ClientActionTokenKind,
  DepositType,
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationEventKey,
  OfferingPrepayScope,
  Prisma,
  PrismaClient,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
  StripeAccountStatus,
} from '@prisma/client'

import {
  applyStripeDepositSucceededInTransaction,
  cancelBooking,
  createProBooking,
  prepareClientDepositCheckout,
} from '@/lib/booking/writeBoundary'
import { releaseAbandonedDepositBookings } from '@/lib/booking/depositReleaseSweep'
import {
  DEPOSIT_PRO_CREATED_LEAD_HOURS_DEFAULT,
  DEPOSIT_UNPAID_DEADLINE_HOURS_DEFAULT,
} from '@/lib/booking/depositDeadline'
import { createDepositPaymentDelivery } from '@/lib/clientActions/createDepositPaymentDelivery'
import {
  resolveDepositPaymentTokenForRead,
} from '@/lib/booking/depositPaymentTokens'

// The pro-create boundary snapshots the salon address through the PII
// envelope, so the keyring must exist even for salon-only fixtures.
vi.hoisted(() => {
  const key32 = Buffer.alloc(32, 9).toString('base64')
  process.env.PII_LOOKUP_HMAC_KEYS_JSON ||= JSON.stringify({ 1: key32 })
  process.env.PII_AEAD_KEYS_JSON ||= JSON.stringify({ 'address-aead-v1': key32 })
  // The K10-B-1 nudge asserts an SMS delivery ROW is enqueued for the
  // phone-only-reachable population; without Twilio config the enqueue-time
  // launch gate drops the SMS capability entirely. Nothing here ever SENDS —
  // the delivery drain never runs in this suite.
  process.env.TWILIO_ACCOUNT_SID ||= `AC${'0'.repeat(32)}`
  process.env.TWILIO_AUTH_TOKEN ||= 'test-auth-token'
  process.env.TWILIO_FROM_NUMBER ||= '+15005550006'
})

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with: pnpm test:integration')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const tag = `procr_dep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
const ZONE = 'America/Los_Angeles'

const BASE_PRICE = '200.00'
const HOUR_MS = 60 * 60 * 1000
const LEAD_MS = DEPOSIT_PRO_CREATED_LEAD_HOURS_DEFAULT * HOUR_MS
const FLOOR_MS = DEPOSIT_UNPAID_DEADLINE_HOURS_DEFAULT * HOUR_MS

type Fixtures = {
  tenantId: string
  professionalId: string
  proUserId: string
  serviceId: string
  locationId: string
  clientId: string
  offeringId: string
}

let fx: Fixtures
const seededUserEmails: string[] = []

/** A working-hours-safe start `days` out at 10:00 in the fixture zone-ish. */
function futureStart(days: number, extraHours = 0): Date {
  const at = new Date(Date.now() + days * 24 * HOUR_MS + extraHours * HOUR_MS)
  at.setUTCMinutes(0, 0, 0)
  // 18:00 UTC = 10:00/11:00 in America/Los_Angeles year-round — inside the
  // fixture's 09:00–18:00 window either way.
  at.setUTCHours(18)
  return at
}

function proCreate(args: {
  scheduledFor: Date
  depositRequested?: boolean
  importMode?: boolean
  allowShortNotice?: boolean
  clientId?: string
}) {
  return createProBooking({
    professionalId: fx.professionalId,
    actorUserId: fx.proUserId,
    clientId: args.clientId ?? fx.clientId,
    offeringId: fx.offeringId,
    locationId: fx.locationId,
    locationType: ServiceLocationType.SALON,
    scheduledFor: args.scheduledFor,
    clientAddressId: null,
    internalNotes: null,
    overrideReason: null,
    requestedBufferMinutes: null,
    requestedTotalDurationMinutes: null,
    allowOutsideWorkingHours: false,
    allowShortNotice: args.allowShortNotice ?? false,
    allowFarFuture: false,
    depositRequested: args.depositRequested ?? false,
    importMode: args.importMode ?? false,
  })
}

function readDeposit(bookingId: string) {
  return db.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: {
      depositStatus: true,
      depositAmount: true,
      depositDueAt: true,
      scheduledFor: true,
      createdAt: true,
      status: true,
    },
  })
}

/** Seed a bare PENDING-deposit row for the sweep cases (no boundary needed). */
async function seedSweepRow(args: {
  createdAt: Date
  depositDueAt: Date | null
  scheduledFor: Date
}): Promise<string> {
  const row = await db.booking.create({
    data: {
      clientId: fx.clientId,
      professionalId: fx.professionalId,
      serviceId: fx.serviceId,
      scheduledFor: args.scheduledFor,
      status: BookingStatus.ACCEPTED,
      locationType: ServiceLocationType.SALON,
      locationId: fx.locationId,
      locationTimeZone: ZONE,
      subtotalSnapshot: new Prisma.Decimal(BASE_PRICE),
      serviceSubtotalSnapshot: new Prisma.Decimal(BASE_PRICE),
      totalAmount: new Prisma.Decimal(BASE_PRICE),
      totalDurationMinutes: 60,
      proTenantId: fx.tenantId,
      clientHomeTenantId: fx.tenantId,
      depositStatus: BookingDepositStatus.PENDING,
      depositAmount: new Prisma.Decimal('40.00'),
      depositDueAt: args.depositDueAt,
      createdAt: args.createdAt,
    },
    select: { id: true },
  })
  return row.id
}

beforeAll(async () => {
  const tenant = await db.tenant.create({
    data: { slug: `${tag}-tenant`, name: 'Pro Deposit', isActive: true },
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
      lastName: 'Step',
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
      formattedAddress: '123 Step St, San Diego, CA 92101',
      addressLine1: '123 Step St',
      city: 'San Diego',
      state: 'CA',
      postalCode: '92101',
      countryCode: 'US',
      lat: new Prisma.Decimal('32.7157000'),
      lng: new Prisma.Decimal('-117.1611000'),
      // No maxDaysAhead cap: the far-future case books a month out.
      maxDaysAhead: 3650,
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
      depositEnabled: true,
      depositType: DepositType.FLAT,
      depositFlatAmount: new Prisma.Decimal('40.00'),
    },
  })

  // Deliberately UNCLAIMED (no user) with a direct email AND phone — the
  // population the token pay link (and the K10-B-1 nudge) exists for.
  const client = await db.clientProfile.create({
    data: {
      firstName: 'Walkin',
      lastName: 'Regular',
      email: `${tag}_client@example.com`,
      phone: '+15550123001',
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

  const offering = await db.professionalServiceOffering.create({
    data: {
      professionalId: pro.id,
      serviceId: service.id,
      salonPriceStartingAt: new Prisma.Decimal(BASE_PRICE),
      salonDurationMinutes: 60,
      offersInSalon: true,
      offersMobile: false,
      isActive: true,
    },
    select: { id: true },
  })

  fx = {
    tenantId: tenant.id,
    professionalId: pro.id,
    proUserId: proUser.id,
    serviceId: service.id,
    locationId: location.id,
    clientId: client.id,
    offeringId: offering.id,
  }
}, 60_000)

afterEach(async () => {
  // Each case states its own deposit config; reset to the fixture default.
  await db.professionalPaymentSettings.update({
    where: { professionalId: fx.professionalId },
    data: {
      depositEnabled: true,
      depositType: DepositType.FLAT,
      depositFlatAmount: new Prisma.Decimal('40.00'),
      depositPercent: null,
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
      stripeAccountId: `acct_${tag}`,
    },
  })
  await db.professionalServiceOffering.update({
    where: { id: fx.offeringId },
    data: { prepayScope: null },
  })
  await db.scheduledClientNotification.deleteMany({
    where: { booking: { professionalId: fx.professionalId } },
  })
  await db.clientActionToken.deleteMany({
    where: { professionalId: fx.professionalId },
  })
  await db.notificationDelivery.deleteMany({
    where: { dispatch: { client: { homeTenantId: fx.tenantId } } },
  })
  await db.notificationDispatch.deleteMany({
    where: { client: { homeTenantId: fx.tenantId } },
  })
  await db.booking.deleteMany({ where: { professionalId: fx.professionalId } })
})

afterAll(async () => {
  await db.scheduledClientNotification.deleteMany({
    where: { booking: { professionalId: fx.professionalId } },
  })
  await db.clientActionToken.deleteMany({
    where: { professionalId: fx.professionalId },
  })
  await db.notificationDelivery.deleteMany({
    where: { dispatch: { client: { homeTenantId: fx.tenantId } } },
  })
  await db.notificationDispatch.deleteMany({
    where: { client: { homeTenantId: fx.tenantId } },
  })
  await db.booking.deleteMany({ where: { professionalId: fx.professionalId } })
  await db.professionalServiceOffering.deleteMany({
    where: { professionalId: fx.professionalId },
  })
  await db.professionalPaymentSettings.deleteMany({
    where: { professionalId: fx.professionalId },
  })
  await db.professionalLocation.deleteMany({ where: { name: `${tag} salon` } })
  await db.clientProfile.deleteMany({
    where: { email: `${tag}_client@example.com` },
  })
  await db.professionalProfile.deleteMany({
    where: { businessName: `${tag} studio` },
  })
  await db.service.deleteMany({ where: { name: `${tag} service` } })
  await db.serviceCategory.deleteMany({ where: { slug: `${tag}-category` } })
  await db.user.deleteMany({ where: { email: { in: seededUserEmails } } })
  await db.tenant.deleteMany({ where: { slug: `${tag}-tenant` } })
  await db.$disconnect()
}, 60_000)

describe('depositRequested stamps the deposit rail', () => {
  it('stamps PENDING + the configured amount + an appointment-anchored dueAt (far branch), and mints the pay-link token', async () => {
    const scheduledFor = futureStart(30)
    const result = await proCreate({ scheduledFor, depositRequested: true })

    expect(result.deposit).not.toBeNull()
    expect(result.deposit?.amount.toString()).toBe('40')

    const row = await readDeposit(result.booking.id)
    expect(row.depositStatus).toBe(BookingDepositStatus.PENDING)
    expect(row.depositAmount?.toString()).toBe('40')
    expect(row.depositDueAt).not.toBeNull()

    // Far branch: dueAt = scheduledFor − 72h (the floor is a month away).
    const expected = scheduledFor.getTime() - LEAD_MS
    expect(Math.abs((row.depositDueAt?.getTime() ?? 0) - expected)).toBeLessThan(
      2 * 60 * 1000,
    )

    // The pay link exists: one DEPOSIT_PAYMENT token bound to this booking,
    // expiring no earlier than the release deadline.
    const token = await db.clientActionToken.findFirst({
      where: {
        bookingId: result.booking.id,
        kind: ClientActionTokenKind.DEPOSIT_PAYMENT,
      },
      select: { id: true, singleUse: true, expiresAt: true, clientId: true },
    })
    expect(token).not.toBeNull()
    expect(token?.singleUse).toBe(false)
    expect(token?.clientId).toBe(fx.clientId)
    expect(token && token.expiresAt.getTime()).toBeGreaterThanOrEqual(expected - 60_000)

    // And the pre-release nudge is scheduled before the deadline.
    const reminder = await db.scheduledClientNotification.findFirst({
      where: { bookingId: result.booking.id, eventKey: 'DEPOSIT_REMINDER' },
      select: { runAt: true },
    })
    expect(reminder).not.toBeNull()
    expect(reminder && reminder.runAt.getTime()).toBeLessThan(expected)
  })

  it('floors the deadline at createdAt + 24h when the appointment is inside the lead window', async () => {
    // 48h out: scheduledFor − 72h is in the PAST — without the floor the
    // booking would be born already past its own deadline.
    const scheduledFor = futureStart(2)
    const result = await proCreate({ scheduledFor, depositRequested: true })

    const row = await readDeposit(result.booking.id)
    expect(row.depositDueAt).not.toBeNull()

    const expected = row.createdAt.getTime() + FLOOR_MS
    expect(Math.abs((row.depositDueAt?.getTime() ?? 0) - expected)).toBeLessThan(
      2 * 60 * 1000,
    )
    // And it is genuinely in the future.
    expect(row.depositDueAt!.getTime()).toBeGreaterThan(Date.now())
  })

  it('sizes from the prepay term when the account-wide deposit is OFF (decision 2)', async () => {
    await db.professionalPaymentSettings.update({
      where: { professionalId: fx.professionalId },
      data: { depositEnabled: false, depositFlatAmount: null },
    })
    await db.professionalServiceOffering.update({
      where: { id: fx.offeringId },
      data: { prepayScope: OfferingPrepayScope.SERVICE_ONLY },
    })

    const result = await proCreate({
      scheduledFor: futureStart(30),
      depositRequested: true,
    })

    // 100% of the $200 base service.
    const row = await readDeposit(result.booking.id)
    expect(row.depositAmount?.toString()).toBe('200')
    expect(row.depositStatus).toBe(BookingDepositStatus.PENDING)
  })

  it('stamps nothing when the pro skips the step', async () => {
    const result = await proCreate({
      scheduledFor: futureStart(30),
      depositRequested: false,
    })

    expect(result.deposit).toBeNull()
    const row = await readDeposit(result.booking.id)
    expect(row.depositStatus).toBe(BookingDepositStatus.NONE)
    expect(row.depositAmount).toBeNull()
    expect(row.depositDueAt).toBeNull()

    await expect(
      db.clientActionToken.count({
        where: { bookingId: result.booking.id },
      }),
    ).resolves.toBe(0)
  })

  it('ignores depositRequested on importMode (imported history must not text clients)', async () => {
    const result = await proCreate({
      scheduledFor: futureStart(30),
      depositRequested: true,
      importMode: true,
    })

    const row = await readDeposit(result.booking.id)
    expect(row.depositStatus).toBe(BookingDepositStatus.NONE)
    expect(row.depositDueAt).toBeNull()
    await expect(
      db.clientActionToken.count({ where: { bookingId: result.booking.id } }),
    ).resolves.toBe(0)
  })
})

describe('an impossible deposit request is REFUSED, never dropped', () => {
  it('refuses when the pro cannot receive a charge — and creates NO booking', async () => {
    await db.professionalPaymentSettings.update({
      where: { professionalId: fx.professionalId },
      data: { stripePayoutsEnabled: false },
    })

    // Payouts-off already fails the booking-readiness gate (PRO_NOT_READY)
    // before the deposit gate is reached — see the K10 handoff note. Either
    // layer refusing is correct; the invariant is refusal + no row.
    await expect(
      proCreate({ scheduledFor: futureStart(30), depositRequested: true }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        (error.code === 'FORBIDDEN' || error.code === 'PRO_NOT_READY'),
    )

    await expect(
      db.booking.count({ where: { professionalId: fx.professionalId } }),
    ).resolves.toBe(0)
  })

  it('refuses when nothing is chargeable (no deposit config, no prepay)', async () => {
    await db.professionalPaymentSettings.update({
      where: { professionalId: fx.professionalId },
      data: { depositEnabled: false, depositFlatAmount: null },
    })

    await expect(
      proCreate({ scheduledFor: futureStart(30), depositRequested: true }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    await expect(
      db.booking.count({ where: { professionalId: fx.professionalId } }),
    ).resolves.toBe(0)
  })
})

describe('the release sweep keys on the STAMP', () => {
  it('releases a stamped row at dueAt, leaves a stamped-future row alone even with an old createdAt, and still ages legacy null-stamp rows', async () => {
    const now = Date.now()
    // Distinct starts: Booking carries a (professionalId, scheduledFor) unique.
    const future = (hours: number) =>
      new Date(now + 10 * 24 * HOUR_MS + hours * HOUR_MS)

    // Stamped, deadline passed → release.
    const duePast = await seedSweepRow({
      createdAt: new Date(now - 2 * HOUR_MS),
      depositDueAt: new Date(now - 5 * 60 * 1000),
      scheduledFor: future(0),
    })

    // Stamped, deadline in the future, createdAt 3 days old. The OLD
    // createdAt-ageing would have cancelled this booking (a pro-created prepay
    // with a long window); the stamp must protect it.
    const dueFuture = await seedSweepRow({
      createdAt: new Date(now - 3 * 24 * HOUR_MS),
      depositDueAt: new Date(now + 5 * 24 * HOUR_MS),
      scheduledFor: future(2),
    })

    // Legacy: no stamp, created 2 days ago → the createdAt fallback releases.
    const legacy = await seedSweepRow({
      createdAt: new Date(now - 2 * 24 * HOUR_MS),
      depositDueAt: null,
      scheduledFor: future(4),
    })

    const run = await releaseAbandonedDepositBookings()
    expect(run.enabled).toBe(true)

    const outcomes = new Map(run.results.map((r) => [r.bookingId, r.outcome]))
    expect(outcomes.get(duePast)).toBe('released')
    expect(outcomes.get(legacy)).toBe('released')
    expect(outcomes.has(dueFuture)).toBe(false)

    const [pastRow, futureRow, legacyRow] = await Promise.all([
      readDeposit(duePast),
      readDeposit(dueFuture),
      readDeposit(legacy),
    ])
    expect(pastRow.status).toBe(BookingStatus.CANCELLED)
    expect(futureRow.status).toBe(BookingStatus.ACCEPTED)
    expect(legacyRow.status).toBe(BookingStatus.CANCELLED)
  })
})

describe('the pay-link token reaches the same deposit checkout core', () => {
  it('resolves the token and prepares the SAME charge the authed route would', async () => {
    const scheduledFor = futureStart(30)
    const created = await proCreate({ scheduledFor, depositRequested: true })

    // Mint a fresh delivery for the raw token (the boundary's own token is
    // hash-only by design). Same helper the boundary runs.
    const delivery = await createDepositPaymentDelivery({
      tx: db,
      professionalId: fx.professionalId,
      clientId: fx.clientId,
      bookingId: created.booking.id,
      depositAmountLabel: '$40.00',
      depositDueAt: new Date(scheduledFor.getTime() - LEAD_MS),
      locationTimeZone: ZONE,
      expiresAt: new Date(scheduledFor.getTime()),
      recipientEmail: `${tag}_client@example.com`,
      recipientPhone: null,
      issuedByUserId: fx.proUserId,
      recipientUserId: null,
      recipientTimeZone: ZONE,
      professionalName: 'Deposit Step',
    })

    const resolved = await resolveDepositPaymentTokenForRead({
      rawToken: delivery.token.rawToken,
    })

    expect(resolved.booking.id).toBe(created.booking.id)
    expect(resolved.booking.clientId).toBe(fx.clientId)
    expect(resolved.booking.depositStatus).toBe(BookingDepositStatus.PENDING)
    expect(resolved.idempotencyActorKey).toBe(
      `public-deposit-token:${delivery.token.id}`,
    )

    // The exact prepare the public route runs with the token's identity.
    const prepared = await prepareClientDepositCheckout({
      bookingId: resolved.booking.id,
      clientId: resolved.booking.clientId,
      requestId: null,
      idempotencyKey: `${tag}-token-checkout`,
    })

    expect(prepared.stripe.depositCents).toBe(4_000)
    expect(prepared.stripe.feeCents).toBe(0)
    expect(prepared.stripe.totalCents).toBe(4_000)
    expect(prepared.stripe.connectedAccountId).toBe(`acct_${tag}`)
  })

  it('refuses an expired token', async () => {
    const created = await proCreate({
      scheduledFor: futureStart(30),
      depositRequested: true,
    })

    const delivery = await createDepositPaymentDelivery({
      tx: db,
      professionalId: fx.professionalId,
      clientId: fx.clientId,
      bookingId: created.booking.id,
      depositAmountLabel: '$40.00',
      depositDueAt: new Date(Date.now() + 60_000),
      locationTimeZone: ZONE,
      expiresAt: new Date(Date.now() + 60_000),
      recipientEmail: `${tag}_client@example.com`,
      recipientPhone: null,
      issuedByUserId: fx.proUserId,
      recipientUserId: null,
      recipientTimeZone: ZONE,
      professionalName: 'Deposit Step',
    })

    await db.clientActionToken.update({
      where: { id: delivery.token.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    })

    await expect(
      resolveDepositPaymentTokenForRead({ rawToken: delivery.token.rawToken }),
    ).rejects.toMatchObject({ code: 'DEPOSIT_TOKEN_INVALID' })
  })
})

describe('the unclaimed pre-release nudge (K10-B-1)', () => {
  // The cancellation contract keys on this literal — payment/cancel paths find
  // the nudge by sourceKey alone (the webhook applier only has a bookingId).
  const nudgeSourceKey = (bookingId: string) =>
    `deposit-payment-nudge:${bookingId}`

  function readNudgeDispatch(bookingId: string) {
    return db.notificationDispatch.findUnique({
      where: { sourceKey: nudgeSourceKey(bookingId) },
      select: {
        id: true,
        eventKey: true,
        scheduledFor: true,
        cancelledAt: true,
        href: true,
        recipientEmail: true,
        recipientPhone: true,
        deliveries: {
          select: {
            channel: true,
            status: true,
            nextAttemptAt: true,
            cancelledAt: true,
          },
        },
      },
    })
  }

  async function requireNudgeDispatch(bookingId: string) {
    const nudge = await readNudgeDispatch(bookingId)
    if (!nudge) {
      throw new Error(`expected a nudge dispatch for booking ${bookingId}`)
    }
    return nudge
  }

  it('schedules a SECOND dispatch of the same pay link at the DEPOSIT_REMINDER instant, on both channels', async () => {
    const created = await proCreate({
      scheduledFor: futureStart(30),
      depositRequested: true,
    })

    const nudge = await requireNudgeDispatch(created.booking.id)
    expect(nudge.eventKey).toBe(NotificationEventKey.DEPOSIT_PAYMENT_LINK)
    expect(nudge.cancelledAt).toBeNull()

    // Fires at the SAME instant the login-gated DEPOSIT_REMINDER computes —
    // one formula, two rails.
    const reminder = await db.scheduledClientNotification.findFirstOrThrow({
      where: {
        bookingId: created.booking.id,
        eventKey: NotificationEventKey.DEPOSIT_REMINDER,
      },
      select: { runAt: true },
    })
    expect(nudge.scheduledFor.getTime()).toBe(reminder.runAt.getTime())

    // …and that instant is dueAt − the pro-created reminder lead (24h).
    const row = await readDeposit(created.booking.id)
    if (!row.depositDueAt) throw new Error('expected a stamped depositDueAt')
    expect(nudge.scheduledFor.getTime()).toBe(
      row.depositDueAt.getTime() - 24 * HOUR_MS,
    )

    // The SAME public token URL the initial send carries — never a login path.
    const initial = await db.notificationDispatch.findFirstOrThrow({
      where: {
        eventKey: NotificationEventKey.DEPOSIT_PAYMENT_LINK,
        clientId: fx.clientId,
        sourceKey: { not: nudgeSourceKey(created.booking.id) },
        payload: { path: ['bookingId'], equals: created.booking.id },
      },
      select: { href: true },
    })
    expect(nudge.href).toBe(initial.href)
    expect(nudge.href).toMatch(/^\/client\/deposit\/[0-9a-f]{64}$/)

    // Both channels for the unclaimed recipient (email + phone on file), armed
    // to attempt exactly at the scheduled instant.
    const channels = nudge.deliveries.map((d) => d.channel)
    expect(channels).toContain(NotificationChannel.EMAIL)
    expect(channels).toContain(NotificationChannel.SMS)
    for (const delivery of nudge.deliveries) {
      expect(delivery.status).toBe(NotificationDeliveryStatus.PENDING)
      expect(delivery.cancelledAt).toBeNull()
      expect(delivery.nextAttemptAt.getTime()).toBe(
        nudge.scheduledFor.getTime(),
      )
    }
  })

  it('does NOT schedule the nudge for a CLAIMED client (the login-gated DEPOSIT_REMINDER serves them)', async () => {
    const email = `${tag}_claimed@example.com`
    const user = await db.user.create({
      data: { email, password: 'test-password', role: Role.CLIENT },
      select: { id: true },
    })
    seededUserEmails.push(email)
    const claimed = await db.clientProfile.create({
      data: {
        userId: user.id,
        firstName: 'Claimed',
        lastName: 'Client',
        email,
        phone: '+15550123002',
        homeTenantId: fx.tenantId,
      },
      select: { id: true },
    })

    try {
      const created = await proCreate({
        scheduledFor: futureStart(31),
        depositRequested: true,
        clientId: claimed.id,
      })

      // The initial pay link still goes out (paying by token is fine for a
      // claimed client too)…
      const initial = await db.notificationDispatch.findFirst({
        where: {
          eventKey: NotificationEventKey.DEPOSIT_PAYMENT_LINK,
          clientId: claimed.id,
          payload: { path: ['bookingId'], equals: created.booking.id },
        },
        select: { id: true },
      })
      expect(initial).not.toBeNull()

      // …the login-gated reminder is scheduled for them…
      const reminder = await db.scheduledClientNotification.findFirst({
        where: {
          bookingId: created.booking.id,
          eventKey: NotificationEventKey.DEPOSIT_REMINDER,
        },
        select: { id: true },
      })
      expect(reminder).not.toBeNull()

      // …and the token nudge is NOT (they can read the reminder; two nudges at
      // the same instant would double-text the same ask).
      expect(await readNudgeDispatch(created.booking.id)).toBeNull()
    } finally {
      await db.notificationDelivery.deleteMany({
        where: { dispatch: { clientId: claimed.id } },
      })
      await db.notificationDispatch.deleteMany({
        where: { clientId: claimed.id },
      })
      await db.scheduledClientNotification.deleteMany({
        where: { clientId: claimed.id },
      })
      await db.clientActionToken.deleteMany({ where: { clientId: claimed.id } })
      await db.booking.deleteMany({ where: { clientId: claimed.id } })
      await db.clientProfile.delete({ where: { id: claimed.id } })
    }
  })

  it('cancel-on-pay: the deposit-paid applier stamps the nudge cancelled (the drain never revalidates)', async () => {
    const created = await proCreate({
      scheduledFor: futureStart(32),
      depositRequested: true,
    })

    const before = await requireNudgeDispatch(created.booking.id)
    expect(before.cancelledAt).toBeNull()

    await db.$transaction(async (tx) => {
      const applied = await applyStripeDepositSucceededInTransaction(tx, {
        stripePaymentIntentId: `pi_${tag}_nudge_paid`,
        chargeId: null,
        bookingIdHint: created.booking.id,
      })
      expect(applied.handled).toBe(true)
      expect(applied.alreadyPaid).toBe(false)
    })

    const row = await readDeposit(created.booking.id)
    expect(row.depositStatus).toBe(BookingDepositStatus.PAID)

    const after = await requireNudgeDispatch(created.booking.id)
    expect(after.cancelledAt).not.toBeNull()
    for (const delivery of after.deliveries) {
      expect(delivery.cancelledAt).not.toBeNull()
    }
  })

  it('cancel-on-release: the sweep cancelling the booking cancels the nudge with it', async () => {
    const created = await proCreate({
      scheduledFor: futureStart(33),
      depositRequested: true,
    })

    // Force the stamped deadline into the past so the sweep picks the row up.
    await db.booking.update({
      where: { id: created.booking.id },
      data: { depositDueAt: new Date(Date.now() - 60_000) },
    })

    const run = await releaseAbandonedDepositBookings()
    expect(run.enabled).toBe(true)
    const outcome = run.results.find(
      (r) => r.bookingId === created.booking.id,
    )?.outcome
    expect(outcome).toBe('released')

    const row = await readDeposit(created.booking.id)
    expect(row.status).toBe(BookingStatus.CANCELLED)

    const after = await requireNudgeDispatch(created.booking.id)
    expect(after.cancelledAt).not.toBeNull()
  })

  it('cancel-on-cancel: a pro cancel stamps the nudge cancelled', async () => {
    const created = await proCreate({
      scheduledFor: futureStart(34),
      depositRequested: true,
    })

    await cancelBooking({
      bookingId: created.booking.id,
      actor: { kind: 'pro', professionalId: fx.professionalId },
      notifyClient: false,
      reason: 'test cancel',
    })

    const after = await requireNudgeDispatch(created.booking.id)
    expect(after.cancelledAt).not.toBeNull()
  })
})
