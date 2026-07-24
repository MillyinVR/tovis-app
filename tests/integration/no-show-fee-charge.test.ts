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
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
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
// the write boundary all run for real against the test database.
const stripe = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('@/lib/stripe/server', () => ({
  getStripe: () => ({ paymentIntents: { create: stripe.create } }),
}))

import { assessAndChargeNoShowFee } from '@/lib/noShowProtection/charge'
import { recordNoShowFeeCharge } from '@/lib/booking/writeBoundary'

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
