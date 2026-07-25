// tests/integration/reschedule-hold-window.test.ts
//
// B3 — "the hold reserves what the write will take", on the RESCHEDULE path.
//
// B1-A restored that invariant for the CREATE path (offer → hold → finalize)
// and recorded in the plan's §7.2 table that RESERVE == COMMIT "on both
// platforms". That claim did not cover reschedule, and reschedule breaks it by
// arithmetic:
//
//   RESERVE  `POST /api/v1/holds` sizes the hold from the OFFERING
//            (`salonDurationMinutes` / `mobileDurationMinutes` + add-ons)
//   COMMIT   `rescheduleBookingFromHold` takes `booking.totalDurationMinutes`
//
// Nothing keeps those two numbers equal. A booking's committed duration drifts
// from its offering's current base for entirely ordinary reasons — the pro
// edits the service's duration, or edits the booking's. On production today 7
// of the 11 live (PENDING/ACCEPTED/IN_PROGRESS) bookings are exactly 15 minutes
// wider than their offering's current base, with no add-ons involved at all.
//
// Two consequences, both driven below against real Postgres:
//   1. the un-reserved tail is takeable by someone else mid-checkout, and the
//      reschedule is then refused for a slot the client was holding;
//   2. the last starts of every working day are offered and held, then refused
//      at the confirm — the same dead end B1-A removed from the create path.
//
// The fix sizes the reservation from the booking when the hold is placed for a
// reschedule, through the SAME guard the commit runs
// (`resolveRescheduleCommitDurationMinutes`), so the two can no longer drift.
//
// Runs against the docker test database:
//   node scripts/with-test-db.mjs npx vitest run \
//     tests/integration/reschedule-hold-window.test.ts \
//     --config vitest.integration.config.mts --maxWorkers=1 --minWorkers=1
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  BookingStatus,
  BookingSource,
  Prisma,
  PrismaClient,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
} from '@prisma/client'

import {
  createHold,
  rescheduleBookingFromHold,
  updateHoldAddOns,
} from '@/lib/booking/writeBoundary'
import { isBookingError } from '@/lib/booking/errors'
import { minutesSinceMidnightInTimeZone } from '@/lib/time'

// A hold snapshots its location address through the PII envelope, so the real
// boundary needs a real keyring even though these fixtures are salon-only.
vi.hoisted(() => {
  const key32 = Buffer.alloc(32, 7).toString('base64')
  process.env.PII_LOOKUP_HMAC_KEYS_JSON ||= JSON.stringify({ 1: key32 })
  process.env.PII_AEAD_KEYS_JSON ||= JSON.stringify({ 'address-aead-v1': key32 })
})

// `.env.test.local` points the schedule-version counter at the SHARED Upstash
// instance, so this suite must never assert on real Redis state. Nothing here
// tests the bump; stub it so the boundary's calls are inert.
vi.mock('@/lib/booking/cacheVersion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/booking/cacheVersion')>()),
  bumpScheduleVersion: vi.fn(async () => 1),
}))

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with: pnpm test:integration')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const TAG = `resched_hold_${Date.now()}`
const ZONE = 'America/Los_Angeles'

/** What the offering says today — what a hold is sized from. */
const OFFERING_BASE_MINUTES = 60
/** What the booking committed — what the reschedule will take. */
const BOOKED_MINUTES = 90

type Fixtures = {
  tenantId: string
  professionalId: string
  clientId: string
  rivalClientId: string
  serviceId: string
  categoryId: string
  salonLocationId: string
  offeringId: string
  /** A genuinely valid +30 add-on link, so the reschedule refusal below cannot
   *  pass for the resolver's reason instead of its own. */
  addOnId: string
}

let fx: Fixtures

/** A future UTC instant at exactly `hh:mm` LOCAL in the fixture's zone. */
function futureLocal(daysAhead: number, hh: number, mm = 0): Date {
  const anchor = new Date()
  anchor.setUTCDate(anchor.getUTCDate() + daysAhead)
  anchor.setUTCHours(20, 0, 0, 0)

  const anchorLocalMinutes = minutesSinceMidnightInTimeZone(anchor, ZONE)

  return new Date(
    anchor.getTime() + (hh * 60 + mm - anchorLocalMinutes) * 60_000,
  )
}

function workingHours(): Prisma.InputJsonValue {
  const all = { enabled: true, start: '09:00', end: '18:00' }
  return { mon: all, tue: all, wed: all, thu: all, fri: all, sat: all, sun: all }
}

function holdOffering() {
  return {
    id: fx.offeringId,
    professionalId: fx.professionalId,
    offersInSalon: true,
    offersMobile: false,
    salonDurationMinutes: OFFERING_BASE_MINUTES,
    mobileDurationMinutes: null,
    salonPriceStartingAt: new Prisma.Decimal('100.00'),
    mobilePriceStartingAt: null,
    professionalTimeZone: ZONE,
  }
}

async function hold(args: {
  start: Date
  clientId?: string
  rescheduleBookingId?: string | null
  addOnIds?: string[]
}) {
  return createHold({
    clientId: args.clientId ?? fx.clientId,
    bookingEntryPoint: 'DIRECT_PROFILE',
    addOnIds: args.addOnIds ?? [],
    rescheduleBookingId: args.rescheduleBookingId ?? null,
    offering: holdOffering(),
    requestedStart: args.start,
    requestedLocationId: fx.salonLocationId,
    locationType: ServiceLocationType.SALON,
    clientAddressId: null,
  })
}

async function readHold(holdId: string) {
  const row = await db.bookingHold.findUnique({
    where: { id: holdId },
    select: {
      durationMinutesSnapshot: true,
      bufferMinutesSnapshot: true,
      endsAtSnapshot: true,
      scheduledFor: true,
    },
  })

  if (!row) throw new Error('Hold not found')
  return row
}

/** The booking error code a thrown refusal carries, or a rethrow. */
async function refusalCode(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
  } catch (error: unknown) {
    if (isBookingError(error)) return error.code
    throw error
  }

  throw new Error('Expected a refusal, but the call succeeded')
}

/**
 * A live booking whose committed duration is WIDER than the offering's current
 * base — the production shape (the pro shortened the service after the booking
 * was taken). No add-ons: this drift needs none.
 */
async function seedBooking(args: {
  start: Date
  clientId?: string
  status?: BookingStatus
  totalDurationMinutes?: number
}): Promise<string> {
  const booking = await db.booking.create({
    data: {
      client: { connect: { id: args.clientId ?? fx.clientId } },
      professional: { connect: { id: fx.professionalId } },
      proTenant: { connect: { id: fx.tenantId } },
      clientHomeTenant: { connect: { id: fx.tenantId } },
      service: { connect: { id: fx.serviceId } },
      offering: { connect: { id: fx.offeringId } },
      location: { connect: { id: fx.salonLocationId } },
      locationType: ServiceLocationType.SALON,
      locationTimeZone: ZONE,
      scheduledFor: args.start,
      status: args.status ?? BookingStatus.ACCEPTED,
      source: BookingSource.REQUESTED,
      totalDurationMinutes: args.totalDurationMinutes ?? BOOKED_MINUTES,
      bufferMinutes: 0,
      subtotalSnapshot: new Prisma.Decimal('100.00'),
      serviceSubtotalSnapshot: new Prisma.Decimal('100.00'),
      totalAmount: new Prisma.Decimal('100.00'),
    },
    select: { id: true },
  })

  return booking.id
}

beforeAll(async () => {
  const tenant = await db.tenant.upsert({
    where: { slug: 'tovis-root' },
    update: {},
    create: { slug: 'tovis-root', name: 'TOVIS', isActive: true },
    select: { id: true },
  })

  const proUser = await db.user.create({
    data: { email: `${TAG}_pro@example.com`, password: 'x', role: Role.PRO },
    select: { id: true },
  })
  const professional = await db.professionalProfile.create({
    data: {
      userId: proUser.id,
      homeTenantId: tenant.id,
      firstName: 'Rhea',
      lastName: 'Schedule',
      businessName: 'Reschedule Studio',
      timeZone: ZONE,
    },
    select: { id: true },
  })

  async function seedClient(label: string): Promise<string> {
    const user = await db.user.create({
      data: {
        email: `${TAG}_${label}@example.com`,
        password: 'x',
        role: Role.CLIENT,
      },
      select: { id: true },
    })
    const client = await db.clientProfile.create({
      data: {
        userId: user.id,
        homeTenantId: tenant.id,
        firstName: label,
        lastName: 'Client',
      },
      select: { id: true },
    })
    return client.id
  }

  const clientId = await seedClient('client')
  const rivalClientId = await seedClient('rival')

  const category = await db.serviceCategory.create({
    data: { name: `${TAG} Cat`, slug: `${TAG}-cat`, isActive: true },
    select: { id: true },
  })
  const service = await db.service.create({
    data: {
      name: `${TAG} Cut`,
      categoryId: category.id,
      defaultDurationMinutes: OFFERING_BASE_MINUTES,
      minPrice: new Prisma.Decimal('100.00'),
      isActive: true,
    },
    select: { id: true },
  })

  const salon = await db.professionalLocation.create({
    data: {
      professionalId: professional.id,
      type: ProfessionalLocationType.SALON,
      name: 'Main Salon',
      isPrimary: true,
      isBookable: true,
      formattedAddress: '123 Salon St, San Diego, CA 92101',
      addressLine1: '123 Salon St',
      city: 'San Diego',
      state: 'CA',
      postalCode: '92101',
      countryCode: 'US',
      lat: new Prisma.Decimal('32.7157000'),
      lng: new Prisma.Decimal('-117.1611000'),
      timeZone: ZONE,
      workingHours: workingHours(),
      bufferMinutes: 0,
      stepMinutes: 15,
      advanceNoticeMinutes: 0,
      maxDaysAhead: 365,
    },
    select: { id: true },
  })

  const offering = await db.professionalServiceOffering.create({
    data: {
      professionalId: professional.id,
      serviceId: service.id,
      isActive: true,
      offersInSalon: true,
      offersMobile: false,
      salonPriceStartingAt: new Prisma.Decimal('100.00'),
      salonDurationMinutes: OFFERING_BASE_MINUTES,
    },
    select: { id: true },
  })

  fx = {
    tenantId: tenant.id,
    professionalId: professional.id,
    clientId,
    rivalClientId,
    serviceId: service.id,
    categoryId: category.id,
    salonLocationId: salon.id,
    offeringId: offering.id,
    addOnId: '',
  }

  const addOnService = await db.service.create({
    data: {
      name: `${TAG} Gloss`,
      categoryId: category.id,
      defaultDurationMinutes: 30,
      minPrice: new Prisma.Decimal('25.00'),
      isActive: true,
      isAddOnEligible: true,
    },
    select: { id: true },
  })
  const addOnLink = await db.offeringAddOn.create({
    data: {
      offeringId: offering.id,
      addOnServiceId: addOnService.id,
      isActive: true,
      sortOrder: 1,
      priceOverride: new Prisma.Decimal('25.00'),
      durationOverrideMinutes: 30,
    },
    select: { id: true },
  })
  fx.addOnId = addOnLink.id
})

afterEach(async () => {
  const pro = { professionalId: fx.professionalId }
  await db.reminder.deleteMany({ where: pro })
  await db.notification.deleteMany({ where: pro })
  await db.bookingServiceItem.deleteMany({ where: { booking: pro } })
  await db.bookingHold.deleteMany({ where: pro })
  await db.booking.deleteMany({ where: pro })
})

afterAll(async () => {
  if (fx) {
    const pro = { professionalId: fx.professionalId }
    await db.scheduledClientNotification.deleteMany({
      where: { clientId: { in: [fx.clientId, fx.rivalClientId] } },
    })
    await db.clientNotification.deleteMany({
      where: { clientId: { in: [fx.clientId, fx.rivalClientId] } },
    })
    await db.reminder.deleteMany({ where: pro })
    await db.notification.deleteMany({ where: pro })
    await db.bookingServiceItem.deleteMany({ where: { booking: pro } })
    await db.bookingHold.deleteMany({ where: pro })
    await db.booking.deleteMany({ where: pro })
    await db.offeringAddOn.deleteMany({ where: { offeringId: fx.offeringId } })
    await db.professionalServiceOffering.deleteMany({ where: pro })
    await db.professionalLocation.deleteMany({ where: pro })
    await db.service.deleteMany({ where: { categoryId: fx.categoryId } })
    await db.serviceCategory.deleteMany({ where: { id: fx.categoryId } })
    await db.clientProfile.deleteMany({
      where: { id: { in: [fx.clientId, fx.rivalClientId] } },
    })
    await db.professionalProfile.deleteMany({ where: { id: fx.professionalId } })
    await db.user.deleteMany({
      where: {
        email: {
          in: [
            `${TAG}_pro@example.com`,
            `${TAG}_client@example.com`,
            `${TAG}_rival@example.com`,
          ],
        },
      },
    })
  }
  await db.$disconnect()
})

describe('a reschedule hold reserves what the reschedule will commit (real DB)', () => {
  it('sizes the reservation from the BOOKING, not the offering', async () => {
    const original = futureLocal(30, 10)
    const target = futureLocal(31, 12)
    const bookingId = await seedBooking({ start: original })

    const created = await hold({ start: target, rescheduleBookingId: bookingId })

    // Sized from the offering this would be 60 — the width the commit will
    // demand is 90.
    expect(created.hold.durationMinutes).toBe(BOOKED_MINUTES)

    const row = await readHold(created.hold.id)
    expect(row.durationMinutesSnapshot).toBe(BOOKED_MINUTES)
    expect(row.endsAtSnapshot?.getTime()).toBe(
      target.getTime() + BOOKED_MINUTES * 60_000,
    )
  })

  it('holds the tail the reschedule will take, so a rival cannot claim it', async () => {
    const original = futureLocal(32, 10)
    const target = futureLocal(33, 12)
    // 13:00 falls inside the booking's 12:00–13:30 window but OUTSIDE the
    // 12:00–13:00 an offering-sized hold would have reserved.
    const tail = new Date(target.getTime() + OFFERING_BASE_MINUTES * 60_000)

    const bookingId = await seedBooking({ start: original })
    const created = await hold({ start: target, rescheduleBookingId: bookingId })

    expect(
      await refusalCode(() => hold({ start: tail, clientId: fx.rivalClientId })),
    ).toBe('TIME_HELD')

    // …and because the tail was never lost, the client still gets their slot.
    // Before the fix the rival's hold succeeded here and this commit failed.
    const result = await rescheduleBookingFromHold({
      bookingId,
      clientId: fx.clientId,
      holdId: created.hold.id,
      requestedLocationType: ServiceLocationType.SALON,
    })
    expect(result.booking.scheduledFor.getTime()).toBe(target.getTime())
  })

  it('refuses the last start of the day AT THE HOLD, not at the confirm', async () => {
    const original = futureLocal(34, 10)
    // 17:00 + 60 base fits a 09:00–18:00 day; + the booking's real 90 does not.
    const lastStart = futureLocal(35, 17)
    const bookingId = await seedBooking({ start: original })

    expect(
      await refusalCode(() =>
        hold({ start: lastStart, rescheduleBookingId: bookingId }),
      ),
    ).toBe('OUTSIDE_WORKING_HOURS')
  })

  it('still reschedules onto a slot that genuinely fits, keeping the booked duration', async () => {
    const original = futureLocal(36, 10)
    const target = futureLocal(37, 12)
    const bookingId = await seedBooking({ start: original })

    const created = await hold({ start: target, rescheduleBookingId: bookingId })

    const result = await rescheduleBookingFromHold({
      bookingId,
      clientId: fx.clientId,
      holdId: created.hold.id,
      requestedLocationType: ServiceLocationType.SALON,
    })

    expect(result.booking.scheduledFor.getTime()).toBe(target.getTime())
    expect(result.booking.totalDurationMinutes).toBe(BOOKED_MINUTES)

    // The hold is consumed by the commit.
    expect(
      await db.bookingHold.findUnique({ where: { id: created.hold.id } }),
    ).toBeNull()
  })
})

describe('the reschedule-sized hold runs the commit gate’s own guards', () => {
  it('refuses another client’s booking with the uniform BOOKING_NOT_FOUND', async () => {
    const original = futureLocal(38, 10)
    const target = futureLocal(39, 12)
    const bookingId = await seedBooking({
      start: original,
      clientId: fx.rivalClientId,
    })

    // Never FORBIDDEN: a client must not be able to probe for the existence of
    // someone else's booking by the shape of the refusal.
    expect(
      await refusalCode(() =>
        hold({ start: target, rescheduleBookingId: bookingId }),
      ),
    ).toBe('BOOKING_NOT_FOUND')
  })

  it('refuses a cancelled booking the same way the commit would', async () => {
    const original = futureLocal(40, 10)
    const target = futureLocal(41, 12)
    const bookingId = await seedBooking({
      start: original,
      status: BookingStatus.CANCELLED,
    })

    expect(
      await refusalCode(() =>
        hold({ start: target, rescheduleBookingId: bookingId }),
      ),
    ).toBe('BOOKING_NOT_RESCHEDULABLE')
  })

  it('refuses add-ons on a reschedule hold — the booking already fixes the width', async () => {
    const original = futureLocal(42, 10)
    const target = futureLocal(43, 12)
    const bookingId = await seedBooking({ start: original })

    // A VALID add-on link, so the refusal can only come from the reschedule
    // rule. An invalid id would be refused by the add-on resolver regardless,
    // and the test would pass without the rule existing at all.
    const created = await hold({ start: target, addOnIds: [fx.addOnId] })
    expect(created.hold.durationMinutes).toBe(OFFERING_BASE_MINUTES + 30)
    await db.bookingHold.deleteMany({ where: { id: created.hold.id } })

    expect(
      await refusalCode(() =>
        hold({
          start: target,
          rescheduleBookingId: bookingId,
          addOnIds: [fx.addOnId],
        }),
      ),
    ).toBe('ADDONS_INVALID')
  })

  it('leaves an ordinary (non-reschedule) hold sized from the offering', async () => {
    const target = futureLocal(44, 12)

    const created = await hold({ start: target })

    expect(created.hold.durationMinutes).toBe(OFFERING_BASE_MINUTES)
  })
})

describe('a reschedule hold cannot be re-sized back down by the add-on path', () => {
  // PATCH /api/v1/holds/[id] recomputes a hold's width from the OFFERING plus
  // the posted add-ons. A reschedule hold is deliberately wider than that, so
  // without a guard the very endpoint B1-A added would narrow it straight back
  // to the defect this card fixed — and `addOnIds: []` is a request the client
  // already sends on every add-ons page load. The waitlist reservation is
  // refused here for the same shape of reason (it belongs to the pro), via a
  // persisted discriminator; a reschedule hold needs its own.
  it('refuses the add-on re-size instead of shrinking the reservation', async () => {
    const original = futureLocal(45, 10)
    const target = futureLocal(46, 12)
    const bookingId = await seedBooking({ start: original })

    const created = await hold({ start: target, rescheduleBookingId: bookingId })
    expect(created.hold.durationMinutes).toBe(BOOKED_MINUTES)

    expect(
      await refusalCode(() =>
        updateHoldAddOns({
          holdId: created.hold.id,
          clientId: fx.clientId,
          addOnIds: [],
        }),
      ),
    ).toBe('HOLD_FORBIDDEN')

    // Untouched: still reserving what the reschedule will take.
    const after = await readHold(created.hold.id)
    expect(after.durationMinutesSnapshot).toBe(BOOKED_MINUTES)
    expect(after.endsAtSnapshot?.getTime()).toBe(
      target.getTime() + BOOKED_MINUTES * 60_000,
    )
  })
})
