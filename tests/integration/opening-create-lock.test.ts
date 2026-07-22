// tests/integration/opening-create-lock.test.ts
//
// F6, driven against real Postgres: publishing a last-minute opening is a
// schedule write, so it must take the professional's advisory lock before it
// reads the schedule it is about to promise away — and it must run the same
// occupancy reader every other write path runs.
//
// Both halves need the real database. The lock half is meaningless against a
// mocked client: a bare `$transaction` under READ COMMITTED looks identical in
// unit tests and is no protection at all in Postgres, which is exactly how this
// path shipped without one. The reader half needs a hold row whose snapshot
// columns disagree with its offering's current duration — the case the replaced
// inline math got wrong.
//
// Two of the five cases below are ALLOW cases on purpose. A suite of "it
// refused" assertions passes just as happily against a create that refuses
// everything, and a lock that never releases would look like a pass too.
//
// Run with `pnpm test:integration`.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  BookingStatus,
  LastMinuteOfferType,
  LastMinuteTier,
  LastMinuteVisibilityMode,
  Prisma,
  PrismaClient,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
} from '@prisma/client'

import { createLastMinuteOpening } from '@/lib/lastMinute/commands/createLastMinuteOpening'
import { lockProfessionalSchedule } from '@/lib/booking/scheduleLock'
import { minutesSinceMidnightInTimeZone } from '@/lib/time'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with: pnpm test:integration')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const TAG = `opening_create_lock_${Date.now()}`
const ZONE = 'America/Los_Angeles'

/**
 * How long the rival transaction keeps the pro's advisory lock while the
 * opening create is in flight. It only has to outlast an UNLOCKED create — the
 * dozen local queries `createInsideTransaction` runs, tens of milliseconds — so
 * the margin here is large enough that a slow CI runner cannot fake a pass.
 */
const RIVAL_LOCK_HOLD_MS = 400

type Fixtures = {
  tenantId: string
  professionalId: string
  settingsId: string
  clientId: string
  rivalClientId: string
  serviceId: string
  salonLocationId: string
  offeringId: string
}

let fx: Fixtures

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function futureUtc(daysAhead: number, hourUtc: number): Date {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + daysAhead)
  d.setUTCHours(hourUtc, 0, 0, 0)
  return d
}

/** A future UTC instant at exactly `hh:mm` LOCAL in the fixture's zone. */
function futureLocal(daysAhead: number, hh: number, mm = 0): Date {
  const anchor = futureUtc(daysAhead, 20)
  const anchorLocalMinutes = minutesSinceMidnightInTimeZone(anchor, ZONE)
  return new Date(anchor.getTime() + (hh * 60 + mm - anchorLocalMinutes) * 60_000)
}

function workingHours(start = '09:00', end = '18:00'): Prisma.InputJsonValue {
  const all = { enabled: true, start, end }
  return { mon: all, tue: all, wed: all, thu: all, fri: all, sat: all, sun: all }
}

async function createOpeningAt(startAt: Date): Promise<string> {
  const created = await createLastMinuteOpening({
    professionalId: fx.professionalId,
    offeringIds: [fx.offeringId],
    startAt,
    locationType: ServiceLocationType.SALON,
    requestedLocationId: fx.salonLocationId,
    visibilityMode: LastMinuteVisibilityMode.PUBLIC_AT_DISCOVERY,
    // All three tiers are mandatory; the incentive itself is irrelevant here.
    tierPlans: [
      { tier: LastMinuteTier.WAITLIST, offerType: LastMinuteOfferType.PERCENT_OFF, percentOff: 10 },
      { tier: LastMinuteTier.REACTIVATION, offerType: LastMinuteOfferType.PERCENT_OFF, percentOff: 15 },
      { tier: LastMinuteTier.DISCOVERY, offerType: LastMinuteOfferType.PERCENT_OFF, percentOff: 20 },
    ],
  })

  return created.id
}

/**
 * The `code` a create refused with, or `NO_REFUSAL` if it succeeded. Returning
 * the outcome rather than asserting inside a matcher is what makes a failure
 * legible: "expected 'NO_REFUSAL' to be 'HOLD_CONFLICT'" names the bug.
 */
async function refusalOf(attempt: Promise<unknown>): Promise<string> {
  try {
    await attempt
    return 'NO_REFUSAL'
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      return String((error as Error & { code: unknown }).code)
    }
    return String(error)
  }
}

function bookingData(startAt: Date, durationMinutes = 60): Prisma.BookingUncheckedCreateInput {
  return {
    professionalId: fx.professionalId,
    clientId: fx.rivalClientId,
    serviceId: fx.serviceId,
    offeringId: fx.offeringId,
    locationId: fx.salonLocationId,
    locationType: ServiceLocationType.SALON,
    scheduledFor: startAt,
    totalDurationMinutes: durationMinutes,
    bufferMinutes: 0,
    status: BookingStatus.ACCEPTED,
    locationTimeZone: ZONE,
    subtotalSnapshot: new Prisma.Decimal('100.00'),
    proTenantId: fx.tenantId,
    clientHomeTenantId: fx.tenantId,
  }
}

/**
 * A rival schedule write, shaped exactly like every real one: take the pro's
 * advisory lock, write, and only then commit. It parks on `release` so the test
 * decides when the commit lands, which is what makes the race deterministic
 * rather than a sleep-and-hope.
 */
function bookUnderLock(startAt: Date): {
  committed: Promise<void>
  locked: Promise<void>
  release: () => void
} {
  let signalLocked!: () => void
  let failLocked!: (error: unknown) => void
  let release!: () => void
  const locked = new Promise<void>((resolve, reject) => {
    signalLocked = resolve
    failLocked = reject
  })
  const held = new Promise<void>((resolve) => {
    release = resolve
  })

  const committed = db.$transaction(
    async (tx) => {
      await lockProfessionalSchedule(tx, fx.professionalId)
      await tx.booking.create({ data: bookingData(startAt), select: { id: true } })
      signalLocked()
      await held
    },
    { maxWait: 10_000, timeout: 20_000 },
  )

  // If the rival dies before it signals — a bad fixture, a constraint it tripped
  // — `locked` would otherwise never settle and every test here would hang until
  // the suite timeout with nothing naming the cause. Attaching this also marks
  // `committed` handled, so the real error surfaces at `await committed` rather
  // than as a bare unhandled rejection.
  committed.catch((error) => failLocked(error))

  return { committed, locked, release }
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
      firstName: 'Lockie',
      lastName: 'Pro',
      businessName: 'Advisory Studio',
      timeZone: ZONE,
    },
    select: { id: true },
  })

  const clientUser = await db.user.create({
    data: { email: `${TAG}_client@example.com`, password: 'x', role: Role.CLIENT },
    select: { id: true },
  })
  const client = await db.clientProfile.create({
    data: {
      userId: clientUser.id,
      homeTenantId: tenant.id,
      firstName: 'Cleo',
      lastName: 'Client',
    },
    select: { id: true },
  })

  const rivalUser = await db.user.create({
    data: { email: `${TAG}_rival@example.com`, password: 'x', role: Role.CLIENT },
    select: { id: true },
  })
  const rivalClient = await db.clientProfile.create({
    data: {
      userId: rivalUser.id,
      homeTenantId: tenant.id,
      firstName: 'Riva',
      lastName: 'Racer',
    },
    select: { id: true },
  })

  const category = await db.serviceCategory.create({
    data: { name: `${TAG} Cat`, slug: `${TAG}-cat`, isActive: true },
    select: { id: true },
  })
  const service = await db.service.create({
    data: {
      name: `${TAG} Cut`,
      categoryId: category.id,
      defaultDurationMinutes: 60,
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
      // The pro-readiness gate needs coordinates.
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
      salonDurationMinutes: 60,
    },
    select: { id: true },
  })

  const settings = await db.lastMinuteSettings.create({
    data: { professionalId: professional.id, enabled: true },
    select: { id: true },
  })

  fx = {
    tenantId: tenant.id,
    professionalId: professional.id,
    settingsId: settings.id,
    clientId: client.id,
    rivalClientId: rivalClient.id,
    serviceId: service.id,
    salonLocationId: salon.id,
    offeringId: offering.id,
  }
})

beforeEach(async () => {
  if (!fx) return
  const pro = { professionalId: fx.professionalId }
  await db.bookingHold.deleteMany({ where: pro })
  await db.calendarBlock.deleteMany({ where: pro })
  await db.lastMinuteBlock.deleteMany({ where: { settingsId: fx.settingsId } })
  await db.bookingServiceItem.deleteMany({ where: { booking: pro } })
  await db.booking.deleteMany({ where: pro })
  await db.lastMinuteTierPlan.deleteMany({ where: { opening: pro } })
  await db.lastMinuteOpeningService.deleteMany({ where: { opening: pro } })
  await db.lastMinuteOpening.deleteMany({ where: pro })
})

afterAll(async () => {
  if (fx) {
    const pro = { professionalId: fx.professionalId }
    // BookingHold RESTRICTs ProfessionalLocation, so holds go first.
    await db.bookingHold.deleteMany({ where: pro })
    await db.calendarBlock.deleteMany({ where: pro })
    await db.bookingServiceItem.deleteMany({ where: { booking: pro } })
    await db.booking.deleteMany({ where: pro })
    await db.lastMinuteRecipient.deleteMany({ where: { opening: pro } })
    await db.lastMinuteTierPlan.deleteMany({ where: { opening: pro } })
    await db.lastMinuteOpeningService.deleteMany({ where: { opening: pro } })
    await db.lastMinuteOpening.deleteMany({ where: pro })
    await db.lastMinuteBlock.deleteMany({ where: { settingsId: fx.settingsId } })
    await db.lastMinuteSettings.deleteMany({ where: pro })
    await db.professionalServiceOffering.deleteMany({ where: pro })
    await db.professionalLocation.deleteMany({ where: pro })
    await db.professionalPaymentSettings.deleteMany({ where: pro })
    await db.service.deleteMany({ where: { id: fx.serviceId } })
    await db.serviceCategory.deleteMany({ where: { name: `${TAG} Cat` } })
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

/**
 * Did `attempt` settle while the rival still held the pro's advisory lock?
 *
 * The rival is released in a `finally`, so an assertion failing afterwards
 * cannot strand a parked interactive transaction on its connection for the full
 * 20s Prisma timeout — which is how the first red run of this suite behaved.
 */
async function settledWhileLockHeld(
  rival: ReturnType<typeof bookUnderLock>,
  attempt: Promise<unknown>,
): Promise<boolean> {
  try {
    return await Promise.race([
      attempt.then(
        () => true,
        () => true,
      ),
      sleep(RIVAL_LOCK_HOLD_MS).then(() => false),
    ])
  } finally {
    rival.release()
    await rival.committed
  }
}

describe('last-minute opening creation takes the professional lock (real DB)', () => {
  it('waits for a booking committing concurrently, then refuses the slot', async () => {
    const start = futureLocal(3, 13)

    const rival = bookUnderLock(start)
    await rival.locked

    // The booking now exists but is UNCOMMITTED. Without the advisory lock this
    // create reads straight past it under READ COMMITTED and publishes an
    // opening over a slot that is already gone.
    const opening = createOpeningAt(start)

    // THE LOCK. False only because the create is parked on
    // pg_advisory_xact_lock; delete the lock and it finishes here instead.
    expect(await settledWhileLockHeld(rival, opening)).toBe(false)

    expect(await refusalOf(opening)).toBe('BOOKING_CONFLICT')

    await expect(
      db.lastMinuteOpening.count({ where: { professionalId: fx.professionalId } }),
    ).resolves.toBe(0)
  }, 20_000)

  // ALLOW CASE. The lock serializes; it must not refuse. Without this, a create
  // that always threw — or a lock that never released — would pass the test above.
  it('publishes a clean slot once the concurrent write releases the lock', async () => {
    const bookedStart = futureLocal(3, 13)
    const freeStart = futureLocal(3, 15)

    const rival = bookUnderLock(bookedStart)
    await rival.locked

    const opening = createOpeningAt(freeStart)

    expect(await settledWhileLockHeld(rival, opening)).toBe(false)

    await expect(opening).resolves.toEqual(expect.any(String))

    const row = await db.lastMinuteOpening.findFirstOrThrow({
      where: { professionalId: fx.professionalId },
      select: { startAt: true },
    })
    expect(row.startAt.toISOString()).toBe(freeStart.toISOString())
  }, 20_000)

  it('sees a hold that reserves more time than its offering currently lasts', async () => {
    const holdStart = futureLocal(4, 10)

    // The offering is 60 minutes, but this hold reserves 120 — add-ons, or an
    // offering shortened after the hold was taken. The replaced inline math
    // sized the hold from the OFFERING and stopped at 11:00, so an opening at
    // 11:00 sailed past it while the database EXCLUDE range said 10:00-12:00.
    await db.bookingHold.create({
      data: {
        professionalId: fx.professionalId,
        clientId: fx.rivalClientId,
        offeringId: fx.offeringId,
        locationId: fx.salonLocationId,
        locationType: ServiceLocationType.SALON,
        scheduledFor: holdStart,
        endsAtSnapshot: new Date(holdStart.getTime() + 120 * 60_000),
        durationMinutesSnapshot: 120,
        bufferMinutesSnapshot: 0,
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
    })

    expect(await refusalOf(createOpeningAt(futureLocal(4, 11)))).toBe('HOLD_CONFLICT')
  })

  // ALLOW CASE for the same swap: the reader must still let go at the end of
  // the hold's real window, not treat every hold in the day as occupancy.
  it('publishes a slot starting after the reserved window of a hold ends', async () => {
    const holdStart = futureLocal(4, 10)

    await db.bookingHold.create({
      data: {
        professionalId: fx.professionalId,
        clientId: fx.rivalClientId,
        offeringId: fx.offeringId,
        locationId: fx.salonLocationId,
        locationType: ServiceLocationType.SALON,
        scheduledFor: holdStart,
        endsAtSnapshot: new Date(holdStart.getTime() + 60 * 60_000),
        durationMinutesSnapshot: 60,
        bufferMinutesSnapshot: 0,
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
    })

    await expect(createOpeningAt(futureLocal(4, 11))).resolves.toEqual(
      expect.any(String),
    )
  })

  // The three conflict queries now arrive as ONE verdict with its own priority
  // (BLOCKED > BOOKING > HOLD), so the refusal a pro reads is only unchanged
  // because the asserts are split around the last-minute block. These pin that.
  it('keeps the refusal a pro sees when several conflicts overlap at once', async () => {
    const start = futureLocal(5, 13)
    const end = new Date(start.getTime() + 60 * 60_000)

    await db.booking.create({ data: bookingData(start), select: { id: true } })
    await db.lastMinuteBlock.create({
      data: { settingsId: fx.settingsId, startAt: start, endAt: end },
      select: { id: true },
    })

    // Last-minute block outranks the booking, as it did before.
    expect(await refusalOf(createOpeningAt(start))).toBe('LAST_MINUTE_BLOCK_CONFLICT')

    // ...and a calendar block outranks the last-minute block.
    await db.calendarBlock.create({
      data: {
        professionalId: fx.professionalId,
        locationId: fx.salonLocationId,
        startsAt: start,
        endsAt: end,
        note: 'Dentist',
      },
      select: { id: true },
    })

    expect(await refusalOf(createOpeningAt(start))).toBe('CALENDAR_BLOCK_CONFLICT')
  })
})
