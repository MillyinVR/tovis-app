// tests/integration/booking-series-roll-forward.test.ts
//
// K20 — the roll-forward sweep, driven against real Postgres through the real
// booking write boundary.
//
// Four claims that cannot be shown any other way, and one that could have been
// unit-tested but would have proved nothing:
//
//   1. A SERIES ADVANCES PAST ITS CREATION HORIZON. K18 materializes 12 and
//      stops; the rows that appear here are the ones the pro would otherwise
//      never get, and they are read back out of the table.
//   2. A SECOND PASS IS A NO-OP. The idempotency is `@@unique([seriesId,
//      seriesOccurrenceIndex])` and `@@unique([seriesId, occurrenceIndex])` —
//      DATABASE constraints, so only a database can show they hold.
//   3. A STOPPED SERIES IS NOT SWEPT. K19 stamps CANCELLED precisely so the
//      cron skips it; a sweep that widened would resurrect appointments a pro
//      deliberately ended.
//   4. 🔴 A "TOO FAR AHEAD" REFUSAL DEFERS, IT DOES NOT BURN AN EXCEPTION ROW.
//      Exception rows are permanent (unique per index ⇒ never retried), so
//      recording one for a temporary condition makes a missing appointment
//      forever. This drives the whole cycle: refuse → no row → widen the
//      window → the SAME indices materialize.
//   5. 🔴 THE PRICE PIN. A rolled-forward occurrence charges what occurrence 0
//      charged, not today's catalog. Proved against an UNCHANGED seam: an
//      ordinary pro booking created in the same moment DOES take the new price,
//      so the assertion cannot pass because the price change failed to land
//      ([[ab-proof-needs-an-unchanged-seam]]).
//
// Run with `pnpm test:integration`.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingSeriesStatus,
  BookingServiceItemType,
  Prisma,
  PrismaClient,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
  StripeAccountStatus,
} from '@prisma/client'

import { createBookingSeries, createProBooking } from '@/lib/booking/writeBoundary'
import { rollForwardBookingSeries } from '@/lib/booking/series/rollForwardSweep'

// The boundary snapshots the location address through the PII envelope, so it
// needs a real keyring even for salon-only fixtures.
vi.hoisted(() => {
  const key32 = Buffer.alloc(32, 7).toString('base64')
  process.env.PII_LOOKUP_HMAC_KEYS_JSON ||= JSON.stringify({ 1: key32 })
  process.env.PII_AEAD_KEYS_JSON ||= JSON.stringify({ 'address-aead-v1': key32 })
})

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with: pnpm test:integration')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const tag = `roll_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
const ZONE = 'America/Los_Angeles'

const BASE_PRICE = '120.00'
const RAISED_PRICE = '200.00'
const BASE_DURATION_MINUTES = 60

/**
 * Friday 30 Oct 2026, 9:00am PDT — the same anchor K18's suite uses, so the
 * two read the same way. 30 Oct is PDT (UTC-7); every later Friday in this
 * suite's range is PST (UTC-8), which is what makes 17:00Z the DST-correct
 * answer for a rolled-forward occurrence and 16:00Z the naive-arithmetic one.
 */
const FRIDAY_9AM = new Date('2026-10-30T16:00:00.000Z')

/**
 * The sweep's `now`. It moves the WINDOW (which occurrences are due), not the
 * clock the booking rules read — those still run against the real time inside
 * each transaction, which is why the fixture location's booking horizon is wide.
 * Nothing here pretends to time-travel Postgres.
 */
const SWEEP_NOW = new Date('2027-01-01T18:00:00.000Z')

/** Wide enough that "too far ahead" is only ever true when a test asks for it. */
const WIDE_MAX_DAYS_AHEAD = 2000

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

function series(overrides: Partial<Parameters<typeof createBookingSeries>[0]> = {}) {
  return createBookingSeries({
    professionalId: fx.professionalId,
    actorUserId: fx.proUserId,
    clientId: fx.clientId,
    offeringId: fx.offeringId,
    locationId: fx.locationId,
    locationType: ServiceLocationType.SALON,
    clientAddressId: null,
    firstOccurrenceAt: FRIDAY_9AM,
    intervalWeeks: 1,
    occurrenceCount: 20,
    internalNotes: null,
    overrideReason: null,
    requestedBufferMinutes: null,
    requestedTotalDurationMinutes: null,
    allowOutsideWorkingHours: false,
    allowShortNotice: false,
    allowFarFuture: false,
    requestId: null,
    idempotencyKey: null,
    ...overrides,
  })
}

function readOccurrences(seriesId: string) {
  return db.booking.findMany({
    where: { seriesId },
    orderBy: { seriesOccurrenceIndex: 'asc' },
    select: {
      id: true,
      seriesOccurrenceIndex: true,
      scheduledFor: true,
      status: true,
      subtotalSnapshot: true,
    },
  })
}

function setMaxDaysAhead(days: number) {
  return db.professionalLocation.update({
    where: { id: fx.locationId },
    data: { maxDaysAhead: days },
  })
}

function setOfferingPrice(price: string) {
  return db.professionalServiceOffering.update({
    where: { id: fx.offeringId },
    data: { salonPriceStartingAt: new Prisma.Decimal(price) },
  })
}

beforeAll(async () => {
  const tenant = await db.tenant.create({
    data: { slug: `${tag}-tenant`, name: 'Roll', isActive: true },
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
      firstName: 'Roll',
      lastName: 'Forward',
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
      formattedAddress: '1 Roll St, San Diego, CA 92101',
      addressLine1: '1 Roll St',
      city: 'San Diego',
      state: 'CA',
      postalCode: '92101',
      countryCode: 'US',
      lat: new Prisma.Decimal('32.7157000'),
      lng: new Prisma.Decimal('-117.1611000'),
      maxDaysAhead: WIDE_MAX_DAYS_AHEAD,
      // Round the clock: this suite is about the window advancing, not about
      // the working-hours override machinery.
      workingHours: {
        mon: { enabled: true, start: '00:00', end: '23:59' },
        tue: { enabled: true, start: '00:00', end: '23:59' },
        wed: { enabled: true, start: '00:00', end: '23:59' },
        thu: { enabled: true, start: '00:00', end: '23:59' },
        fri: { enabled: true, start: '00:00', end: '23:59' },
        sat: { enabled: true, start: '00:00', end: '23:59' },
        sun: { enabled: true, start: '00:00', end: '23:59' },
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
      firstName: 'Standing',
      lastName: 'Client',
      email: `${tag}_client_contact@example.com`,
      homeTenantId: tenant.id,
      // The pro created this client's record, which is what carries them
      // through the pro↔client relationship gate `createBookingSeries` applies
      // (lib/clients/proClientRelationship.ts). A standing appointment is only
      // ever booked for a client the pro already has.
      createdByProfessionalId: pro.id,
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
      defaultDurationMinutes: BASE_DURATION_MINUTES,
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
      salonDurationMinutes: BASE_DURATION_MINUTES,
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

beforeEach(() => {
  process.env.ENABLE_RECURRING_APPOINTMENTS = '1'
  delete process.env.SERIES_ROLL_FORWARD_ENABLED
})

afterEach(async () => {
  delete process.env.ENABLE_RECURRING_APPOINTMENTS
  delete process.env.SERIES_ROLL_FORWARD_ENABLED

  await setMaxDaysAhead(WIDE_MAX_DAYS_AHEAD)
  await setOfferingPrice(BASE_PRICE)

  await db.booking.deleteMany({ where: { professionalId: fx.professionalId } })
  await db.bookingSeries.deleteMany({
    where: { professionalId: fx.professionalId },
  })
})

afterAll(async () => {
  await db.booking.deleteMany({ where: { professionalId: fx.professionalId } })
  await db.bookingSeries.deleteMany({
    where: { professionalId: fx.professionalId },
  })
  await db.professionalServiceOffering.deleteMany({
    where: { professionalId: fx.professionalId },
  })
  await db.professionalPaymentSettings.deleteMany({
    where: { professionalId: fx.professionalId },
  })
  await db.professionalLocation.deleteMany({
    where: { professionalId: fx.professionalId },
  })
  await db.professionalProfile.deleteMany({ where: { id: fx.professionalId } })
  await db.clientProfile.deleteMany({ where: { id: fx.clientId } })
  await db.service.deleteMany({ where: { name: { startsWith: tag } } })
  await db.serviceCategory.deleteMany({ where: { name: { startsWith: tag } } })
  await db.user.deleteMany({ where: { email: { in: seededUserEmails } } })
  await db.tenant.deleteMany({ where: { slug: `${tag}-tenant` } })
  await db.$disconnect()
}, 60_000)

describe('rollForwardBookingSeries — advancing the window', () => {
  it('materializes the occurrences creation stopped short of, and ENDS the series', async () => {
    const created = await series({ occurrenceCount: 20 })

    // K18's horizon: twelve now, eight the pro would never otherwise get.
    expect(created.occurrences).toHaveLength(12)
    expect(created.nextOccurrenceIndex).toBe(12)

    const run = await rollForwardBookingSeries({ now: SWEEP_NOW })

    expect(run.enabled).toBe(true)
    expect(run.createdCount).toBe(8)
    expect(run.skippedCount).toBe(0)
    expect(run.tally.advanced).toBe(1)

    const rows = await readOccurrences(created.seriesId)
    expect(rows).toHaveLength(20)
    expect(rows.map((r) => r.seriesOccurrenceIndex)).toEqual(
      Array.from({ length: 20 }, (_, i) => i),
    )

    // 🔴 DST, on the values that reached the TABLE. The anchor is PDT (16:00Z);
    // every rolled-forward Friday here is PST, so 9am local is 17:00Z. A
    // materializer stepping 7×24h from the anchor would have written 16:00Z —
    // 8am — for all eight.
    const rolled = rows.filter((r) => (r.seriesOccurrenceIndex ?? -1) >= 12)
    expect(rolled).toHaveLength(8)
    for (const row of rolled) {
      expect(row.scheduledFor.toISOString().slice(11)).toBe('17:00:00.000Z')
    }
    expect(rolled[0]?.scheduledFor.toISOString()).toBe('2027-01-22T17:00:00.000Z')
    expect(rolled[7]?.scheduledFor.toISOString()).toBe('2027-03-12T17:00:00.000Z')

    const seriesRow = await db.bookingSeries.findUniqueOrThrow({
      where: { id: created.seriesId },
      select: { status: true, nextOccurrenceIndex: true },
    })
    expect(seriesRow.nextOccurrenceIndex).toBe(20)
    // Ran its course. The next pass must not reconsider it.
    expect(seriesRow.status).toBe(BookingSeriesStatus.ENDED)
  }, 120_000)

  it('is idempotent — a second pass writes nothing', async () => {
    const created = await series({ occurrenceCount: 16 })

    await rollForwardBookingSeries({ now: SWEEP_NOW })

    const afterFirst = await readOccurrences(created.seriesId)
    const exceptionsAfterFirst = await db.bookingSeriesException.count({
      where: { seriesId: created.seriesId },
    })

    const second = await rollForwardBookingSeries({ now: SWEEP_NOW })

    expect(second.createdCount).toBe(0)
    expect(second.skippedCount).toBe(0)

    const afterSecond = await readOccurrences(created.seriesId)
    expect(afterSecond).toHaveLength(afterFirst.length)
    expect(afterSecond.map((r) => r.id)).toEqual(afterFirst.map((r) => r.id))
    expect(
      await db.bookingSeriesException.count({
        where: { seriesId: created.seriesId },
      }),
    ).toBe(exceptionsAfterFirst)
  }, 120_000)

  it('leaves a CANCELLED series alone — the sweep keys on status', async () => {
    const created = await series({ occurrenceCount: null })
    expect(created.occurrences).toHaveLength(12)

    // What K19's cancel stamps once it has stopped a series.
    await db.bookingSeries.update({
      where: { id: created.seriesId },
      data: { status: BookingSeriesStatus.CANCELLED },
    })

    const run = await rollForwardBookingSeries({ now: SWEEP_NOW })

    expect(run.createdCount).toBe(0)
    expect(run.candidatesScanned).toBe(0)

    const rows = await readOccurrences(created.seriesId)
    expect(rows).toHaveLength(12)

    const seriesRow = await db.bookingSeries.findUniqueOrThrow({
      where: { id: created.seriesId },
      select: { status: true, nextOccurrenceIndex: true },
    })
    expect(seriesRow.status).toBe(BookingSeriesStatus.CANCELLED)
    expect(seriesRow.nextOccurrenceIndex).toBe(12)
  }, 120_000)

  it('writes nothing while the recurring-appointments flag is off', async () => {
    const created = await series({ occurrenceCount: 16 })

    delete process.env.ENABLE_RECURRING_APPOINTMENTS

    const run = await rollForwardBookingSeries({ now: SWEEP_NOW })

    expect(run.enabled).toBe(false)
    expect(run.createdCount).toBe(0)

    expect(await readOccurrences(created.seriesId)).toHaveLength(12)
  }, 120_000)

  it('observes only while SERIES_ROLL_FORWARD_ENABLED is off', async () => {
    const created = await series({ occurrenceCount: 16 })

    process.env.SERIES_ROLL_FORWARD_ENABLED = '0'

    const run = await rollForwardBookingSeries({ now: SWEEP_NOW })

    expect(run.enabled).toBe(false)
    // Still SCANNED — the observe-only mode reports what it would have done.
    expect(run.candidatesScanned).toBe(1)
    expect(await readOccurrences(created.seriesId)).toHaveLength(12)
  }, 120_000)
})

describe('rollForwardBookingSeries — a refusal that means "not yet"', () => {
  it('DEFERS past the booking horizon without burning an exception row, and retries once the window widens', async () => {
    // 90 days from the real clock is roughly the anchor itself, so a horizon of
    // 120 days lets the first few occurrences book and puts the rest out of
    // reach — the shape a pro with a modest booking window actually has.
    const anchorDaysAhead = Math.ceil(
      (FRIDAY_9AM.getTime() - Date.now()) / (24 * 60 * 60_000),
    )
    const narrow = anchorDaysAhead + 22 // ⇒ indices 0…3 fit, 4 onwards do not
    await setMaxDaysAhead(narrow)

    const created = await series({ occurrenceCount: 8 })

    // 🔴 The whole point: it stopped, and it stopped WITHOUT recording anything.
    // An exception row here would be permanent and the roll-forward would never
    // revisit these dates.
    expect(created.deferred).not.toBeNull()
    expect(created.deferred?.code).toBe('MAX_DAYS_AHEAD_EXCEEDED')
    expect(created.skipped).toEqual([])
    expect(
      await db.bookingSeriesException.count({
        where: { seriesId: created.seriesId },
      }),
    ).toBe(0)

    const bookedFirst = created.occurrences.length
    expect(bookedFirst).toBeGreaterThan(0)
    expect(bookedFirst).toBeLessThan(8)

    const seriesAfterCreate = await db.bookingSeries.findUniqueOrThrow({
      where: { id: created.seriesId },
      select: { status: true, nextOccurrenceIndex: true },
    })
    // Parked exactly at the deferred index, and still ACTIVE — a deferral is not
    // an ending.
    expect(seriesAfterCreate.nextOccurrenceIndex).toBe(bookedFirst)
    expect(seriesAfterCreate.status).toBe(BookingSeriesStatus.ACTIVE)

    // The pro widens their booking window (or simply, time passes).
    await setMaxDaysAhead(WIDE_MAX_DAYS_AHEAD)

    const run = await rollForwardBookingSeries({ now: SWEEP_NOW })

    expect(run.createdCount).toBe(8 - bookedFirst)

    const rows = await readOccurrences(created.seriesId)
    expect(rows).toHaveLength(8)
    expect(rows.map((r) => r.seriesOccurrenceIndex)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ])
    // Still nothing recorded as a skip: these dates were never refused, only
    // postponed.
    expect(
      await db.bookingSeriesException.count({
        where: { seriesId: created.seriesId },
      }),
    ).toBe(0)
  }, 120_000)

  it('bounds an OPEN-ENDED series by the lead window instead of booking it out to infinity', async () => {
    const created = await series({ occurrenceCount: null })
    expect(created.occurrences).toHaveLength(12)

    // Nothing due yet: a sweep three months before the anchor sees index 12
    // (2027-01-22) sitting well past `now + 90d`, so the series is not even a
    // candidate. This is the state an open-ended series spends most of its life
    // in, and it must cost nothing.
    const early = await rollForwardBookingSeries({
      now: new Date('2026-08-05T16:00:00.000Z'),
    })
    expect(early.candidatesScanned).toBe(0)
    expect(early.createdCount).toBe(0)
    expect(await readOccurrences(created.seriesId)).toHaveLength(12)

    // 🔴 The window is what bounds the pass, NOT the per-series cap. One day
    // before the anchor, exactly one unmaterialized index (12, at +83 days) is
    // inside `now + 90d`; index 13 is at +90 days and is not. An unbounded pass
    // would have taken all twelve its cap allows — booking a standing
    // appointment three months further out every single tick, forever.
    const run = await rollForwardBookingSeries({
      now: new Date(FRIDAY_9AM.getTime() - 24 * 60 * 60_000),
    })

    expect(run.createdCount).toBe(1)

    const rows = await readOccurrences(created.seriesId)
    expect(rows).toHaveLength(13)
    expect(rows[12]?.scheduledFor.toISOString()).toBe('2027-01-22T17:00:00.000Z')

    const seriesRow = await db.bookingSeries.findUniqueOrThrow({
      where: { id: created.seriesId },
      select: { status: true, nextOccurrenceIndex: true },
    })
    // Parked at the first index outside the window, still live: an open-ended
    // series never ENDS on its own.
    expect(seriesRow.nextOccurrenceIndex).toBe(13)
    expect(seriesRow.status).toBe(BookingSeriesStatus.ACTIVE)
  }, 120_000)
})

describe('rollForwardBookingSeries — the price pin', () => {
  it('books a rolled-forward occurrence at occurrence 0 price, not today catalog', async () => {
    const created = await series({ occurrenceCount: 14 })
    expect(created.occurrences).toHaveLength(12)

    const before = await readOccurrences(created.seriesId)
    expect(before[0]?.subtotalSnapshot.toFixed(2)).toBe(BASE_PRICE)

    // The pro raises their price.
    await setOfferingPrice(RAISED_PRICE)

    const run = await rollForwardBookingSeries({ now: SWEEP_NOW })
    expect(run.createdCount).toBe(2)

    const rows = await readOccurrences(created.seriesId)
    expect(rows).toHaveLength(14)

    // 🔴 The decision K19 left to K20: the standing client keeps the price they
    // agreed to. Every occurrence, including the two the cron just made.
    for (const row of rows) {
      expect(row.subtotalSnapshot.toFixed(2)).toBe(BASE_PRICE)
    }

    // …and the BASE line item, which is what the money actually reads from.
    const rolledIds = rows
      .filter((r) => (r.seriesOccurrenceIndex ?? -1) >= 12)
      .map((r) => r.id)
    const baseItems = await db.bookingServiceItem.findMany({
      where: { bookingId: { in: rolledIds }, itemType: BookingServiceItemType.BASE },
      select: { priceSnapshot: true },
    })
    expect(baseItems).toHaveLength(2)
    for (const item of baseItems) {
      expect(item.priceSnapshot.toFixed(2)).toBe(BASE_PRICE)
    }

    // 🔴 The unchanged seam. Without this the test passes whenever the price
    // change silently failed to land, which is the commonest way a pinning test
    // lies ([[ab-proof-needs-an-unchanged-seam]]). An ORDINARY pro booking made
    // right now takes the NEW price — so the series really is being treated
    // differently, rather than nothing having changed at all.
    const control = await createProBooking({
      professionalId: fx.professionalId,
      actorUserId: fx.proUserId,
      clientId: fx.clientId,
      offeringId: fx.offeringId,
      locationId: fx.locationId,
      locationType: ServiceLocationType.SALON,
      // A Tuesday, so it cannot collide with the Friday series.
      scheduledFor: new Date('2026-11-03T17:00:00.000Z'),
      clientAddressId: null,
      internalNotes: null,
      requestedBufferMinutes: null,
      requestedTotalDurationMinutes: null,
      allowOutsideWorkingHours: false,
      allowShortNotice: false,
      allowFarFuture: false,
      overrideReason: null,
    })
    const controlRow = await db.booking.findUniqueOrThrow({
      where: { id: control.booking.id },
      select: { subtotalSnapshot: true },
    })
    expect(controlRow.subtotalSnapshot.toFixed(2)).toBe(RAISED_PRICE)
  }, 120_000)
})
