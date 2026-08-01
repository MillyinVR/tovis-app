// tests/integration/booking-series-materialize.test.ts
//
// K18 — the `BookingSeries` materializer, driven against real Postgres through
// the real booking write boundary.
//
// This suite exists because the three things K18 claims cannot be shown any
// other way:
//
//   1. THE ROWS ARE REAL. The whole reason occurrences are materialized instead
//      of expanded from an RRULE at read time is that a virtual occurrence is
//      invisible to `Booking_no_active_professional_overlap`. So one test tries
//      to insert an overlapping appointment on top of a materialized occurrence
//      and asserts the DATABASE refuses it — not the app, the database. A mocked
//      transaction cannot show that, because it has no constraint.
//   2. A COLLISION SKIPS, IT DOES NOT ABORT. Occurrence 5 landing on an existing
//      appointment must leave 6…11 standing. That only works because each
//      occurrence has its own transaction, and only a real Postgres transaction
//      demonstrates the poisoning that makes it necessary.
//   3. DST IS HONOURED END TO END. The unit tests pin the arithmetic; this pins
//      the `scheduledFor` values that actually reached the table.
//
// Run with `pnpm test:integration` (or the whole dir in CI via integration.yml).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingDepositStatus,
  BookingSeriesExceptionReason,
  BookingSeriesStatus,
  BookingStatus,
  DepositType,
  NotificationEventKey,
  Prisma,
  PrismaClient,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
  StripeAccountStatus,
} from '@prisma/client'

import { cancelBooking, createBookingSeries } from '@/lib/booking/writeBoundary'
import { isBookingError } from '@/lib/booking/errors'

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

const tag = `series_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
const ZONE = 'America/Los_Angeles'

const BASE_PRICE = '120.00'
const BASE_DURATION_MINUTES = 60

/**
 * Friday 30 Oct 2026, 9:00am PDT. Chosen so a weekly series crosses the US
 * fall-back boundary (1 Nov 2026) inside its first two occurrences.
 */
const FRIDAY_9AM = new Date('2026-10-30T16:00:00.000Z')

/**
 * Sunday 1 Mar 2026 2:30am PST — a weekly series from here hits 8 Mar 2026
 * 02:30, a wall time that does not exist in Los Angeles.
 *
 * ⚠️ This date is in the PAST relative to any real clock this suite runs on, so
 * the cases that use it move the anchor forward a year: see SPRING_2027.
 */
const SPRING_2027 = new Date('2027-03-07T10:30:00.000Z') // Sun 7 Mar 2027, 2:30am PST

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
    occurrenceCount: 4,
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

/**
 * Run `fn` inside one interactive transaction and always roll it back, so the
 * poisoning probe below leaves nothing behind whichever way it ends.
 */
async function prismaPoisonProbe(
  fn: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<void> {
  const ROLLBACK = Symbol('rollback')
  try {
    await db.$transaction(async (tx) => {
      await fn(tx)
      throw ROLLBACK
    })
  } catch (error: unknown) {
    if (error !== ROLLBACK) throw error
  }
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
      allowsOverlap: true,
      totalDurationMinutes: true,
      bufferMinutes: true,
      depositStatus: true,
      depositAmount: true,
      depositDueAt: true,
    },
  })
}

beforeAll(async () => {
  const tenant = await db.tenant.create({
    data: { slug: `${tag}-tenant`, name: 'Series', isActive: true },
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
      firstName: 'Series',
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
      formattedAddress: '1 Series St, San Diego, CA 92101',
      addressLine1: '1 Series St',
      city: 'San Diego',
      state: 'CA',
      postalCode: '92101',
      countryCode: 'US',
      lat: new Prisma.Decimal('32.7157000'),
      lng: new Prisma.Decimal('-117.1611000'),
      // Round the clock on purpose: the DST cases are anchored at 2:30am, and
      // this suite is about recurrence, not about the working-hours override
      // machinery.
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
      // The deposit path refuses without a deliverable contact for the pay link.
      email: `${tag}_client_contact@example.com`,
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
  // Every case below is about behaviour that only exists with the flag ON. The
  // one case that proves the dark default turns it off itself.
  process.env.ENABLE_RECURRING_APPOINTMENTS = '1'
})

afterEach(async () => {
  delete process.env.ENABLE_RECURRING_APPOINTMENTS

  await db.professionalPaymentSettings.update({
    where: { professionalId: fx.professionalId },
    data: {
      depositEnabled: false,
      depositType: DepositType.FLAT,
      depositFlatAmount: null,
      depositPercent: null,
    },
  })

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

describe('createBookingSeries — materialization', () => {
  it('creates REAL Booking rows, one per occurrence, in the location zone', async () => {
    const result = await series({ occurrenceCount: 4 })

    expect(result.skipped).toEqual([])
    expect(result.occurrences).toHaveLength(4)
    expect(result.nextOccurrenceIndex).toBe(4)
    expect(result.timeZone).toBe(ZONE)

    const rows = await readOccurrences(result.seriesId)
    expect(rows).toHaveLength(4)
    expect(rows.map((r) => r.seriesOccurrenceIndex)).toEqual([0, 1, 2, 3])

    // 🔴 The DST assertion, on the values that reached the TABLE. 30 Oct is PDT
    // (UTC-7) and every later Friday is PST (UTC-8), so 9am local moves from
    // 16:00Z to 17:00Z. A 7×24h materializer would have written 16:00Z for all
    // four — 8am on three of them.
    expect(rows.map((r) => r.scheduledFor.toISOString())).toEqual([
      '2026-10-30T16:00:00.000Z',
      '2026-11-06T17:00:00.000Z',
      '2026-11-13T17:00:00.000Z',
      '2026-11-20T17:00:00.000Z',
    ])

    // Ordinary appointments in every respect that matters downstream.
    for (const row of rows) {
      expect(row.status).toBe(BookingStatus.ACCEPTED)
      expect(row.totalDurationMinutes).toBe(BASE_DURATION_MINUTES)
      // 🔴 NOT exempt from the overlap constraint. A series occurrence that
      // set allowsOverlap would be a virtual occurrence wearing a row's
      // clothes — see the constraint test below.
      expect(row.allowsOverlap).toBe(false)
    }

    // Each occurrence is a real appointment for the client, so each schedules
    // its OWN appointment reminders — the part a virtual occurrence would never
    // have had, and the reason the confirmation notification can be suppressed
    // for the follow-ons without hiding anything.
    const scheduledPerBooking = await db.scheduledClientNotification.groupBy({
      by: ['bookingId'],
      where: { bookingId: { in: rows.map((r) => r.id) } },
      _count: { _all: true },
    })
    expect(scheduledPerBooking).toHaveLength(4)

    // …and exactly ONE "you're booked" announcement, on the first occurrence.
    // Creating a standing appointment is one act of booking.
    const confirmations = await db.clientNotification.findMany({
      where: {
        bookingId: { in: rows.map((r) => r.id) },
        eventKey: NotificationEventKey.BOOKING_CONFIRMED,
      },
      select: { bookingId: true },
    })
    expect(confirmations).toHaveLength(1)
    expect(confirmations[0]?.bookingId).toBe(rows[0]?.id)

    const seriesRow = await db.bookingSeries.findUniqueOrThrow({
      where: { id: result.seriesId },
      select: {
        anchorAt: true,
        timeZone: true,
        intervalWeeks: true,
        occurrenceCount: true,
        nextOccurrenceIndex: true,
        status: true,
        createdByUserId: true,
      },
    })
    expect(seriesRow.anchorAt.toISOString()).toBe(FRIDAY_9AM.toISOString())
    expect(seriesRow.timeZone).toBe(ZONE)
    expect(seriesRow.intervalWeeks).toBe(1)
    expect(seriesRow.nextOccurrenceIndex).toBe(4)
    expect(seriesRow.createdByUserId).toBe(fx.proUserId)
    // Ran to its planned total, so there is nothing for K20 to roll forward.
    expect(seriesRow.status).toBe(BookingSeriesStatus.ENDED)
  }, 60_000)

  it('caps one pass at the materialization horizon for an open-ended series', async () => {
    const result = await series({ occurrenceCount: null })

    expect(result.occurrences).toHaveLength(12)
    expect(result.nextOccurrenceIndex).toBe(12)

    const seriesRow = await db.bookingSeries.findUniqueOrThrow({
      where: { id: result.seriesId },
      select: { occurrenceCount: true, status: true, nextOccurrenceIndex: true },
    })
    expect(seriesRow.occurrenceCount).toBeNull()
    // Still live: K20's cron picks it up from index 12.
    expect(seriesRow.status).toBe(BookingSeriesStatus.ACTIVE)
    expect(seriesRow.nextOccurrenceIndex).toBe(12)
  }, 120_000)

  it('steps fortnightly when intervalWeeks is 2', async () => {
    const result = await series({ intervalWeeks: 2, occurrenceCount: 3 })

    const rows = await readOccurrences(result.seriesId)
    expect(rows.map((r) => r.scheduledFor.toISOString())).toEqual([
      '2026-10-30T16:00:00.000Z',
      '2026-11-13T17:00:00.000Z',
      '2026-11-27T17:00:00.000Z',
    ])
  }, 60_000)
})

describe('createBookingSeries — the rows are real', () => {
  // 🔴 THE test. Materializing real rows is only worth anything if the database
  // then defends them, so this asserts the EXCLUDE constraint itself, with a
  // direct insert that bypasses every application-level check.
  it('the DB overlap constraint rejects an appointment landing on an occurrence', async () => {
    const result = await series({ occurrenceCount: 2 })
    const rows = await readOccurrences(result.seriesId)
    const occurrence = rows[1]
    if (!occurrence) throw new Error('expected occurrence 1')

    // Half an hour into a 60-minute occurrence — overlapping, but not the same
    // instant, so this is the GIST range constraint answering and not the
    // (professionalId, scheduledFor) unique index.
    const collidingStart = new Date(
      occurrence.scheduledFor.getTime() + 30 * 60_000,
    )

    await expect(
      db.booking.create({
        data: {
          clientId: fx.clientId,
          professionalId: fx.professionalId,
          serviceId: fx.serviceId,
          proTenantId: fx.tenantId,
          clientHomeTenantId: fx.tenantId,
          scheduledFor: collidingStart,
          status: BookingStatus.ACCEPTED,
          locationType: ServiceLocationType.SALON,
          locationId: fx.locationId,
          locationTimeZone: ZONE,
          subtotalSnapshot: new Prisma.Decimal(BASE_PRICE),
          totalAmount: new Prisma.Decimal(BASE_PRICE),
          totalDurationMinutes: BASE_DURATION_MINUTES,
          bufferMinutes: 0,
        },
        select: { id: true },
      }),
    ).rejects.toThrow(/Booking_no_active_professional_overlap/)

    // …and the same insert is fine an hour clear of it, so the refusal above is
    // the overlap and not something incidental about the fixture.
    const clear = await db.booking.create({
      data: {
        clientId: fx.clientId,
        professionalId: fx.professionalId,
        serviceId: fx.serviceId,
        proTenantId: fx.tenantId,
        clientHomeTenantId: fx.tenantId,
        scheduledFor: new Date(
          occurrence.scheduledFor.getTime() + 5 * 60 * 60_000,
        ),
        status: BookingStatus.ACCEPTED,
        locationType: ServiceLocationType.SALON,
        locationId: fx.locationId,
        locationTimeZone: ZONE,
        subtotalSnapshot: new Prisma.Decimal(BASE_PRICE),
        totalAmount: new Prisma.Decimal(BASE_PRICE),
        totalDurationMinutes: BASE_DURATION_MINUTES,
        bufferMinutes: 0,
      },
      select: { id: true },
    })
    expect(clear.id).toBeTruthy()
  }, 60_000)
})

describe('the constraint that forces one transaction per occurrence', () => {
  // Not a test of our code — a test of the fact our design rests on, pinned
  // here so nobody "simplifies" createBookingSeries into a single transaction
  // with a try/catch around each occurrence and finds out in production.
  //
  // In Postgres, a statement error puts the whole transaction into an aborted
  // state: catching it in application code does NOT let you carry on, every
  // later statement fails with 25P02. So "a collision on occurrence 5 must not
  // abort 6…11" is only achievable if occurrence 5 had a transaction of its own
  // to roll back.
  it('a caught constraint violation poisons the rest of its transaction', async () => {
    const base = {
      clientId: fx.clientId,
      professionalId: fx.professionalId,
      serviceId: fx.serviceId,
      proTenantId: fx.tenantId,
      clientHomeTenantId: fx.tenantId,
      status: BookingStatus.ACCEPTED,
      locationType: ServiceLocationType.SALON,
      locationId: fx.locationId,
      locationTimeZone: ZONE,
      subtotalSnapshot: new Prisma.Decimal(BASE_PRICE),
      totalAmount: new Prisma.Decimal(BASE_PRICE),
      totalDurationMinutes: BASE_DURATION_MINUTES,
      bufferMinutes: 0,
    }

    let caughtFirst = false
    let secondInsertError: unknown = null

    await prismaPoisonProbe(async (tx) => {
      // 1. A clean insert.
      await tx.booking.create({
        data: { ...base, scheduledFor: new Date('2028-01-07T17:00:00.000Z') },
        select: { id: true },
      })

      // 2. One that violates the overlap constraint — caught, deliberately.
      try {
        await tx.booking.create({
          data: { ...base, scheduledFor: new Date('2028-01-07T17:30:00.000Z') },
          select: { id: true },
        })
      } catch {
        caughtFirst = true
      }

      // 3. A perfectly valid insert, days away from anything. It STILL fails:
      //    the transaction is already aborted.
      try {
        await tx.booking.create({
          data: { ...base, scheduledFor: new Date('2028-02-01T17:00:00.000Z') },
          select: { id: true },
        })
      } catch (error: unknown) {
        secondInsertError = error
      }
    })

    expect(caughtFirst).toBe(true)
    expect(secondInsertError).not.toBeNull()
    expect(String(secondInsertError)).toMatch(
      /current transaction is aborted|25P02/i,
    )

    // The whole probe rolled back, so nothing above survives.
    expect(
      await db.booking.count({
        where: {
          professionalId: fx.professionalId,
          scheduledFor: { gte: new Date('2028-01-01T00:00:00.000Z') },
        },
      }),
    ).toBe(0)
  }, 60_000)
})

describe('createBookingSeries — conflict policy', () => {
  it('SKIPS a colliding occurrence, records it, and keeps materializing the rest', async () => {
    // 🔴 The blocker starts THIRTY MINUTES BEFORE occurrence 2 (13 Nov 2026,
    // 9am PST), not on it. That matters: a blocker at the identical instant is
    // refused by the (professionalId, scheduledFor) unique index no matter what
    // the overlap policy says, so it would pass this test even with the
    // SERIES_MATERIALIZATION branch deleted — and the deleted branch is exactly
    // the thing that would silently double-book. An offset blocker can only be
    // refused by the policy, because a PRO_AUTHORIZED_OVERLAP row sets
    // allowsOverlap and the DB constraint's predicate exempts it
    // ([[ab-proof-needs-an-unchanged-seam]]).
    const blocker = await db.booking.create({
      data: {
        clientId: fx.clientId,
        professionalId: fx.professionalId,
        serviceId: fx.serviceId,
        proTenantId: fx.tenantId,
        clientHomeTenantId: fx.tenantId,
        scheduledFor: new Date('2026-11-13T16:30:00.000Z'),
        status: BookingStatus.ACCEPTED,
        locationType: ServiceLocationType.SALON,
        locationId: fx.locationId,
        locationTimeZone: ZONE,
        subtotalSnapshot: new Prisma.Decimal(BASE_PRICE),
        totalAmount: new Prisma.Decimal(BASE_PRICE),
        totalDurationMinutes: BASE_DURATION_MINUTES,
        bufferMinutes: 0,
      },
      select: { id: true },
    })

    const result = await series({ occurrenceCount: 5 })

    // 🔴 The collision did not abort the series: 0, 1, 3 and 4 all booked.
    expect(result.occurrences.map((o) => o.index)).toEqual([0, 1, 3, 4])
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]).toMatchObject({
      index: 2,
      reason: BookingSeriesExceptionReason.SLOT_UNAVAILABLE,
      detail: 'TIME_BOOKED',
    })
    expect(result.skipped[0]?.intendedStart?.toISOString()).toBe(
      '2026-11-13T17:00:00.000Z',
    )
    expect(result.nextOccurrenceIndex).toBe(5)

    const rows = await readOccurrences(result.seriesId)
    expect(rows.map((r) => r.seriesOccurrenceIndex)).toEqual([0, 1, 3, 4])

    // 🔴 And it did NOT double-book. Nothing at all was written into the
    // blocker's window, and no row anywhere in this series claims the overlap
    // exemption that would have let one in.
    const inBlockedWindow = await db.booking.findMany({
      where: {
        professionalId: fx.professionalId,
        scheduledFor: {
          gte: new Date('2026-11-13T16:00:00.000Z'),
          lt: new Date('2026-11-13T19:00:00.000Z'),
        },
      },
      select: { id: true },
    })
    expect(inBlockedWindow).toHaveLength(1)
    expect(inBlockedWindow[0]?.id).toBe(blocker.id)

    expect(
      await db.booking.count({
        where: { seriesId: result.seriesId, allowsOverlap: true },
      }),
    ).toBe(0)

    // The skip is durable — this is what makes K20's roll-forward idempotent.
    const exceptions = await db.bookingSeriesException.findMany({
      where: { seriesId: result.seriesId },
      select: {
        occurrenceIndex: true,
        reason: true,
        detail: true,
        intendedStart: true,
      },
    })
    expect(exceptions).toHaveLength(1)
    expect(exceptions[0]).toMatchObject({
      occurrenceIndex: 2,
      reason: BookingSeriesExceptionReason.SLOT_UNAVAILABLE,
      detail: 'TIME_BOOKED',
    })
    expect(exceptions[0]?.intendedStart?.toISOString()).toBe(
      '2026-11-13T17:00:00.000Z',
    )
  }, 90_000)

  it('REFUSES the whole series when the FIRST occurrence collides', async () => {
    // Offset for the same reason as the case above: an identical instant would
    // be refused by the unique index rather than by the series overlap rule.
    await db.booking.create({
      data: {
        clientId: fx.clientId,
        professionalId: fx.professionalId,
        serviceId: fx.serviceId,
        proTenantId: fx.tenantId,
        clientHomeTenantId: fx.tenantId,
        scheduledFor: new Date(FRIDAY_9AM.getTime() - 30 * 60_000),
        status: BookingStatus.ACCEPTED,
        locationType: ServiceLocationType.SALON,
        locationId: fx.locationId,
        locationTimeZone: ZONE,
        subtotalSnapshot: new Prisma.Decimal(BASE_PRICE),
        totalAmount: new Prisma.Decimal(BASE_PRICE),
        totalDurationMinutes: BASE_DURATION_MINUTES,
        bufferMinutes: 0,
      },
      select: { id: true },
    })

    await expect(series({ occurrenceCount: 4 })).rejects.toSatisfy(
      (error: unknown) => isBookingError(error) && error.code === 'TIME_BOOKED',
    )

    // 🔴 Nothing left behind: the pro asked for a standing appointment starting
    // at a time that does not work, and half of that is not an answer.
    const orphans = await db.bookingSeries.count({
      where: { professionalId: fx.professionalId },
    })
    expect(orphans).toBe(0)
  }, 60_000)

  it('SKIPS an occurrence whose local wall time does not exist, never shifting it', async () => {
    // 2:30am weekly from 7 Mar 2027. 14 Mar 2027 is the US spring-forward day,
    // and 02:30 does not happen at all.
    const result = await series({
      firstOccurrenceAt: SPRING_2027,
      occurrenceCount: 3,
    })

    expect(result.occurrences.map((o) => o.index)).toEqual([0, 2])
    expect(result.skipped).toEqual([
      {
        index: 1,
        intendedStart: null,
        reason: BookingSeriesExceptionReason.NONEXISTENT_LOCAL_TIME,
        detail: '2027-03-14T02:30',
      },
    ])

    const rows = await readOccurrences(result.seriesId)
    expect(rows.map((r) => r.scheduledFor.toISOString())).toEqual([
      '2027-03-07T10:30:00.000Z',
      // 21 Mar 2027 is PDT, so 2:30am local is 09:30Z.
      '2027-03-21T09:30:00.000Z',
    ])

    // 🔴 The "helpful" answer — 3:30am on the transition day — must not exist.
    // A client agreed to 2:30, and an hour later is a different appointment.
    const shifted = await db.booking.count({
      where: {
        professionalId: fx.professionalId,
        scheduledFor: new Date('2027-03-14T10:30:00.000Z'),
      },
    })
    expect(shifted).toBe(0)
  }, 60_000)
})

describe('createBookingSeries — D7 deposits', () => {
  async function enableFlatDeposit() {
    await db.professionalPaymentSettings.update({
      where: { professionalId: fx.professionalId },
      data: {
        depositEnabled: true,
        depositType: DepositType.FLAT,
        depositFlatAmount: new Prisma.Decimal('40.00'),
      },
    })
  }

  it('first-occurrence-only: index 0 owes a deposit, the rest do not', async () => {
    await enableFlatDeposit()

    const result = await series({
      occurrenceCount: 3,
      depositRequested: true,
      depositPerOccurrence: false,
    })

    const rows = await readOccurrences(result.seriesId)
    expect(rows).toHaveLength(3)

    expect(rows[0]?.depositStatus).toBe(BookingDepositStatus.PENDING)
    expect(rows[0]?.depositAmount?.toString()).toBe('40')
    expect(rows[0]?.depositDueAt).not.toBeNull()

    for (const row of rows.slice(1)) {
      expect(row.depositStatus).toBe(BookingDepositStatus.NONE)
      expect(row.depositAmount).toBeNull()
      expect(row.depositDueAt).toBeNull()
    }

    const stored = await db.bookingSeries.findUniqueOrThrow({
      where: { id: result.seriesId },
      select: { depositRequested: true, depositPerOccurrence: true },
    })
    expect(stored).toEqual({ depositRequested: true, depositPerOccurrence: false })
  }, 90_000)

  it('every-occurrence: each appointment carries its OWN deposit and deadline', async () => {
    await enableFlatDeposit()

    const result = await series({
      occurrenceCount: 3,
      depositRequested: true,
      depositPerOccurrence: true,
    })

    const rows = await readOccurrences(result.seriesId)
    expect(rows).toHaveLength(3)

    for (const row of rows) {
      expect(row.depositStatus).toBe(BookingDepositStatus.PENDING)
      expect(row.depositAmount?.toString()).toBe('40')
      expect(row.depositDueAt).not.toBeNull()
    }

    // 🔴 Deadlines are per-occurrence, not one shared date: the release sweep
    // keys on depositDueAt, and a single deadline would auto-release an
    // appointment three months out the moment the first one lapsed.
    const dueAts = rows.map((r) => r.depositDueAt?.toISOString())
    expect(new Set(dueAts).size).toBe(3)
    for (const row of rows) {
      const dueAt = row.depositDueAt
      if (!dueAt) throw new Error('expected a deposit deadline')
      expect(dueAt.getTime()).toBeLessThan(row.scheduledFor.getTime())
    }
  }, 90_000)

  it('normalizes depositPerOccurrence away when no deposit is collected at all', async () => {
    await enableFlatDeposit()

    const result = await series({
      occurrenceCount: 2,
      depositRequested: false,
      depositPerOccurrence: true,
    })

    // The stored row must not read "charge every occurrence" beside "collect
    // nothing" — K19's edit form and K20's cron both read it back.
    const stored = await db.bookingSeries.findUniqueOrThrow({
      where: { id: result.seriesId },
      select: { depositRequested: true, depositPerOccurrence: true },
    })
    expect(stored).toEqual({
      depositRequested: false,
      depositPerOccurrence: false,
    })

    const rows = await readOccurrences(result.seriesId)
    for (const row of rows) {
      expect(row.depositStatus).toBe(BookingDepositStatus.NONE)
    }
  }, 60_000)

  it('a SKIPPED occurrence carries no deposit, so there is nothing to refund', async () => {
    await enableFlatDeposit()

    await db.booking.create({
      data: {
        clientId: fx.clientId,
        professionalId: fx.professionalId,
        serviceId: fx.serviceId,
        proTenantId: fx.tenantId,
        clientHomeTenantId: fx.tenantId,
        // Offset, so the refusal is the series overlap rule and not the
        // (professionalId, scheduledFor) unique index.
        scheduledFor: new Date('2026-11-06T16:30:00.000Z'),
        status: BookingStatus.ACCEPTED,
        locationType: ServiceLocationType.SALON,
        locationId: fx.locationId,
        locationTimeZone: ZONE,
        subtotalSnapshot: new Prisma.Decimal(BASE_PRICE),
        totalAmount: new Prisma.Decimal(BASE_PRICE),
        totalDurationMinutes: BASE_DURATION_MINUTES,
        bufferMinutes: 0,
      },
      select: { id: true },
    })

    const result = await series({
      occurrenceCount: 3,
      depositRequested: true,
      depositPerOccurrence: true,
    })

    expect(result.skipped.map((s) => s.index)).toEqual([1])

    // No booking, no deposit, no pay link, no scheduled release for index 1.
    const rows = await readOccurrences(result.seriesId)
    expect(rows.map((r) => r.seriesOccurrenceIndex)).toEqual([0, 2])
    for (const row of rows) {
      expect(row.depositStatus).toBe(BookingDepositStatus.PENDING)
    }
  }, 90_000)

  it('CANCELLING the deposit-bearing first occurrence leaves the rest standing', async () => {
    await enableFlatDeposit()

    const result = await series({
      occurrenceCount: 3,
      depositRequested: true,
      depositPerOccurrence: false,
    })

    const first = result.occurrences[0]
    if (!first) throw new Error('expected occurrence 0')

    await cancelBooking({
      bookingId: first.bookingId,
      actor: { kind: 'pro', professionalId: fx.professionalId },
    })

    const rows = await readOccurrences(result.seriesId)
    expect(rows).toHaveLength(3)

    // Cancelling one appointment is not cancelling the standing arrangement —
    // K19 owns "this one / this and future / all". The other two are untouched
    // and still ACCEPTED.
    expect(rows[0]?.status).toBe(BookingStatus.CANCELLED)
    expect(rows[1]?.status).toBe(BookingStatus.ACCEPTED)
    expect(rows[2]?.status).toBe(BookingStatus.ACCEPTED)

    // And the deposit did not migrate to another occurrence behind the pro's
    // back: the remaining two still owe nothing.
    expect(rows[1]?.depositStatus).toBe(BookingDepositStatus.NONE)
    expect(rows[2]?.depositStatus).toBe(BookingDepositStatus.NONE)
  }, 90_000)
})

describe('createBookingSeries — the kill switch', () => {
  it('REFUSES at the write boundary when the flag is off, not just at the route', async () => {
    delete process.env.ENABLE_RECURRING_APPOINTMENTS

    await expect(series({ occurrenceCount: 2 })).rejects.toSatisfy(
      (error: unknown) => isBookingError(error) && error.code === 'FORBIDDEN',
    )

    expect(
      await db.bookingSeries.count({
        where: { professionalId: fx.professionalId },
      }),
    ).toBe(0)
  })

  it('refuses a recurrence the pattern rules do not allow', async () => {
    await expect(
      series({ intervalWeeks: 0, occurrenceCount: 3 }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isBookingError(error) && error.code === 'INVALID_SERIES_RECURRENCE',
    )

    await expect(
      series({ intervalWeeks: 1, occurrenceCount: 500 }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isBookingError(error) && error.code === 'INVALID_SERIES_RECURRENCE',
    )

    expect(
      await db.bookingSeries.count({
        where: { professionalId: fx.professionalId },
      }),
    ).toBe(0)
  })
})
