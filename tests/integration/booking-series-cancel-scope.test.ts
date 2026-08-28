// tests/integration/booking-series-cancel-scope.test.ts
//
// K19 — the scoped series cancel, and the series read that previews it, driven
// against real Postgres through the real booking write boundary.
//
// The DoD for this step is "each of the three edit/cancel scopes proved against
// the rows they claim to touch AND the rows they claim NOT to". The second half
// is the one a mocked transaction cannot give you: every assertion below that
// matters re-reads the Booking table after the call and checks the statuses of
// the occurrences the scope was supposed to leave alone. A cancel that quietly
// widened its scope passes any test that only counts what it cancelled.
//
// *This one* — the third scope — is deliberately not exercised here: it is the
// ordinary per-booking cancel and has its own coverage. What IS exercised is
// that a scoped cancel never reaches an occurrence the pro did not select.
//
// Run with `pnpm test:integration`.
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
  BookingSeriesExceptionReason,
  BookingSeriesStatus,
  BookingStatus,
  Prisma,
  PrismaClient,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
  StripeAccountStatus,
} from '@prisma/client'

import { loadProBookingSeriesDetail } from '@/lib/booking/series/detail'
import {
  cancelBookingSeriesOccurrences,
  createBookingSeries,
  createProBooking,
} from '@/lib/booking/writeBoundary'
import { isBookingError } from '@/lib/booking/errors'

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

const tag = `k19_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
const ZONE = 'America/Los_Angeles'

const BASE_PRICE = '120.00'
const BASE_PRICE_CENTS = 12_000
const BASE_DURATION_MINUTES = 60

/** Friday 30 Oct 2026, 9:00am PDT — comfortably in the future, like K18's. */
const FRIDAY_9AM = new Date('2026-10-30T16:00:00.000Z')

type Fixtures = {
  tenantId: string
  professionalId: string
  proUserId: string
  otherProfessionalId: string
  otherProUserId: string
  serviceId: string
  locationId: string
  clientId: string
  offeringId: string
}

let fx: Fixtures
const seededUserEmails: string[] = []

function series(
  overrides: Partial<Parameters<typeof createBookingSeries>[0]> = {},
) {
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

function readOccurrences(seriesId: string) {
  return db.booking.findMany({
    where: { seriesId },
    orderBy: { seriesOccurrenceIndex: 'asc' },
    select: {
      id: true,
      seriesOccurrenceIndex: true,
      scheduledFor: true,
      status: true,
      cancelledAt: true,
      subtotalSnapshot: true,
    },
  })
}

beforeAll(async () => {
  const tenant = await db.tenant.create({
    data: { slug: `${tag}-tenant`, name: 'K19', isActive: true },
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
      firstName: 'Scope',
      lastName: 'Pro',
      businessName: `${tag} studio`,
      homeTenantId: tenant.id,
      timeZone: ZONE,
    },
    select: { id: true },
  })

  // A second pro, so "someone else's series is a 404" is proved against a real
  // professional rather than a made-up id.
  const otherEmail = `${tag}_other@example.com`
  const otherUser = await db.user.create({
    data: { email: otherEmail, password: 'test-password', role: Role.PRO },
    select: { id: true },
  })
  seededUserEmails.push(otherEmail)

  const otherPro = await db.professionalProfile.create({
    data: {
      userId: otherUser.id,
      firstName: 'Other',
      lastName: 'Pro',
      businessName: `${tag} other studio`,
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
      formattedAddress: '1 Scope St, San Diego, CA 92101',
      addressLine1: '1 Scope St',
      city: 'San Diego',
      state: 'CA',
      postalCode: '92101',
      countryCode: 'US',
      lat: new Prisma.Decimal('32.7157000'),
      lng: new Prisma.Decimal('-117.1611000'),
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
    otherProfessionalId: otherPro.id,
    otherProUserId: otherUser.id,
    serviceId: service.id,
    locationId: location.id,
    clientId: client.id,
    offeringId: offering.id,
  }
}, 60_000)

beforeEach(() => {
  process.env.ENABLE_RECURRING_APPOINTMENTS = '1'
})

afterEach(async () => {
  delete process.env.ENABLE_RECURRING_APPOINTMENTS

  await db.professionalServiceOffering.update({
    where: { id: fx.offeringId },
    data: { salonPriceStartingAt: new Prisma.Decimal(BASE_PRICE) },
  })

  await db.booking.deleteMany({
    where: { professionalId: { in: [fx.professionalId, fx.otherProfessionalId] } },
  })
  await db.bookingSeries.deleteMany({
    where: { professionalId: { in: [fx.professionalId, fx.otherProfessionalId] } },
  })
})

afterAll(async () => {
  await db.booking.deleteMany({
    where: { professionalId: { in: [fx.professionalId, fx.otherProfessionalId] } },
  })
  await db.bookingSeries.deleteMany({
    where: { professionalId: { in: [fx.professionalId, fx.otherProfessionalId] } },
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
  await db.professionalProfile.deleteMany({
    where: { id: { in: [fx.professionalId, fx.otherProfessionalId] } },
  })
  await db.clientProfile.deleteMany({ where: { id: fx.clientId } })
  await db.service.deleteMany({ where: { name: { startsWith: tag } } })
  await db.serviceCategory.deleteMany({ where: { name: { startsWith: tag } } })
  await db.user.deleteMany({ where: { email: { in: seededUserEmails } } })
  await db.tenant.deleteMany({ where: { slug: `${tag}-tenant` } })
  await db.$disconnect()
}, 60_000)

describe('cancelBookingSeriesOccurrences — scope ALL', () => {
  it('cancels every remaining occurrence and stops the series', async () => {
    const created = await series({ occurrenceCount: 4 })

    const result = await cancelBookingSeriesOccurrences({
      professionalId: fx.professionalId,
      actorUserId: fx.proUserId,
      seriesId: created.seriesId,
      scope: 'ALL',
      fromOccurrenceIndex: null,
      reason: 'Closing the salon',
    })

    expect(result.cancelled.map((row) => row.index)).toEqual([0, 1, 2, 3])
    expect(result.untouched).toEqual([])
    expect(result.seriesStatus).toBe(BookingSeriesStatus.CANCELLED)

    // Re-read the TABLE, not the return value.
    const rows = await readOccurrences(created.seriesId)
    expect(rows).toHaveLength(4)
    for (const row of rows) {
      expect(row.status).toBe(BookingStatus.CANCELLED)
      expect(row.cancelledAt).not.toBeNull()
    }

    const seriesRow = await db.bookingSeries.findUniqueOrThrow({
      where: { id: created.seriesId },
      select: { status: true },
    })
    // K20's roll-forward sweeps on status: a stopped series left ACTIVE would
    // be dutifully materialized forward again.
    expect(seriesRow.status).toBe(BookingSeriesStatus.CANCELLED)
  }, 60_000)

  // 🔴 The decision under test: "all" is not "all rows". An occurrence that
  // already happened is history, and rewriting it to CANCELLED would corrupt
  // the pro's own record of work they did.
  it('leaves a COMPLETED occurrence alone and says so', async () => {
    const created = await series({ occurrenceCount: 4 })
    const rowsBefore = await readOccurrences(created.seriesId)
    const completed = rowsBefore[1]
    if (!completed) throw new Error('fixture: expected occurrence 1')

    await db.booking.update({
      where: { id: completed.id },
      data: {
        status: BookingStatus.COMPLETED,
        startedAt: new Date('2026-11-06T17:00:00.000Z'),
        finishedAt: new Date('2026-11-06T18:00:00.000Z'),
      },
    })

    const result = await cancelBookingSeriesOccurrences({
      professionalId: fx.professionalId,
      actorUserId: fx.proUserId,
      seriesId: created.seriesId,
      scope: 'ALL',
      fromOccurrenceIndex: null,
      reason: null,
    })

    expect(result.cancelled.map((row) => row.index)).toEqual([0, 2, 3])
    expect(result.untouched).toEqual([
      expect.objectContaining({
        index: 1,
        bookingId: completed.id,
        status: BookingStatus.COMPLETED,
        reason: 'ALREADY_HAPPENED',
      }),
    ])

    // The row it claimed not to touch, in the database.
    const after = await db.booking.findUniqueOrThrow({
      where: { id: completed.id },
      select: { status: true, cancelledAt: true },
    })
    expect(after.status).toBe(BookingStatus.COMPLETED)
    expect(after.cancelledAt).toBeNull()
  }, 60_000)

  // The largest scope the materializer can produce. One transaction has to
  // carry all twelve cancels plus twelve notifications inside the 20s schedule
  // budget (SCHEDULE_TX_TIMEOUT_MS) — measured rather than assumed, because
  // "twelve is probably fine" is exactly the claim that turns out to be false.
  it('cancels a full-horizon 12-occurrence series in one transaction', async () => {
    const created = await series({ occurrenceCount: 12 })
    expect(created.occurrences).toHaveLength(12)

    const startedAt = Date.now()
    const result = await cancelBookingSeriesOccurrences({
      professionalId: fx.professionalId,
      actorUserId: fx.proUserId,
      seriesId: created.seriesId,
      scope: 'ALL',
      fromOccurrenceIndex: null,
      reason: null,
    })
    const elapsedMs = Date.now() - startedAt

    expect(result.cancelled).toHaveLength(12)
    expect(result.untouched).toEqual([])

    const rows = await readOccurrences(created.seriesId)
    expect(rows).toHaveLength(12)
    for (const row of rows) {
      expect(row.status).toBe(BookingStatus.CANCELLED)
    }

    // Deliberately generous: this is a budget guard, not a benchmark. It fails
    // only if the whole scope stops fitting in the transaction it runs in.
    expect(elapsedMs).toBeLessThan(15_000)
    console.info(`[K19] 12-occurrence ALL cancel took ${elapsedMs}ms`)
  }, 120_000)

  // Stamping CANCELLED is what stops K20's roll-forward. A call that changed
  // nothing against a series that already ran its course must not rewrite "ran
  // to its planned total" as "the pro stopped it".
  it('leaves an already-ENDED series ENDED when it cancels nothing', async () => {
    const created = await series({ occurrenceCount: 2 })

    await db.booking.updateMany({
      where: { seriesId: created.seriesId },
      data: { status: BookingStatus.COMPLETED, finishedAt: new Date() },
    })

    const result = await cancelBookingSeriesOccurrences({
      professionalId: fx.professionalId,
      actorUserId: fx.proUserId,
      seriesId: created.seriesId,
      scope: 'ALL',
      fromOccurrenceIndex: null,
      reason: null,
    })

    expect(result.cancelled).toEqual([])
    expect(result.seriesStatus).toBe(BookingSeriesStatus.ENDED)

    const seriesRow = await db.bookingSeries.findUniqueOrThrow({
      where: { id: created.seriesId },
      select: { status: true },
    })
    expect(seriesRow.status).toBe(BookingSeriesStatus.ENDED)
  }, 60_000)

  it('leaves a past occurrence alone', async () => {
    const created = await series({ occurrenceCount: 3 })
    const rowsBefore = await readOccurrences(created.seriesId)
    const target = rowsBefore[0]
    if (!target) throw new Error('fixture: expected occurrence 0')

    // Move it behind the clock without touching its status: a date that has
    // been and gone is not something a bulk cancel gets to rewrite.
    await db.booking.update({
      where: { id: target.id },
      data: { scheduledFor: new Date('2026-01-09T17:00:00.000Z') },
    })

    const result = await cancelBookingSeriesOccurrences({
      professionalId: fx.professionalId,
      actorUserId: fx.proUserId,
      seriesId: created.seriesId,
      scope: 'ALL',
      fromOccurrenceIndex: null,
      reason: null,
    })

    expect(result.cancelled.map((row) => row.index)).toEqual([1, 2])
    expect(result.untouched).toEqual([
      expect.objectContaining({ index: 0, reason: 'IN_PAST' }),
    ])

    const after = await db.booking.findUniqueOrThrow({
      where: { id: target.id },
      select: { status: true },
    })
    expect(after.status).toBe(BookingStatus.ACCEPTED)
  }, 60_000)
})

describe('cancelBookingSeriesOccurrences — scope THIS_AND_FUTURE', () => {
  it('cancels from the chosen occurrence forward and leaves the earlier ones BOOKED', async () => {
    const created = await series({ occurrenceCount: 4 })

    const result = await cancelBookingSeriesOccurrences({
      professionalId: fx.professionalId,
      actorUserId: fx.proUserId,
      seriesId: created.seriesId,
      scope: 'THIS_AND_FUTURE',
      fromOccurrenceIndex: 2,
      reason: null,
    })

    expect(result.cancelled.map((row) => row.index)).toEqual([2, 3])
    expect(result.untouched.map((row) => row.index)).toEqual([0, 1])
    for (const row of result.untouched) {
      expect(row.reason).toBe('OUT_OF_SCOPE')
    }

    // 🔴 The half a count-only test would miss: occurrences 0 and 1 are still
    // real, confirmed appointments on the pro's calendar.
    const rows = await readOccurrences(created.seriesId)
    expect(
      rows.map((row) => [row.seriesOccurrenceIndex, row.status]),
    ).toEqual([
      [0, BookingStatus.ACCEPTED],
      [1, BookingStatus.ACCEPTED],
      [2, BookingStatus.CANCELLED],
      [3, BookingStatus.CANCELLED],
    ])
  }, 60_000)

  // Index 0 is a perfectly ordinary choice — "stop the whole thing, starting
  // with the first one" — and it is exactly where a falsy-zero bug hides: a
  // `!fromOccurrenceIndex` guard anywhere in the chain (route parse, boundary
  // validation, classifier comparison) would read it as "absent" and refuse.
  it('accepts occurrence 0 as the starting point, not as a missing one', async () => {
    const created = await series({ occurrenceCount: 3 })

    const result = await cancelBookingSeriesOccurrences({
      professionalId: fx.professionalId,
      actorUserId: fx.proUserId,
      seriesId: created.seriesId,
      scope: 'THIS_AND_FUTURE',
      fromOccurrenceIndex: 0,
      reason: null,
    })

    expect(result.cancelled.map((row) => row.index)).toEqual([0, 1, 2])
    expect(result.untouched).toEqual([])

    const rows = await readOccurrences(created.seriesId)
    for (const row of rows) {
      expect(row.status).toBe(BookingStatus.CANCELLED)
    }
  }, 60_000)

  it('refuses without an occurrence index rather than widening to ALL', async () => {
    const created = await series({ occurrenceCount: 3 })

    await expect(
      cancelBookingSeriesOccurrences({
        professionalId: fx.professionalId,
        actorUserId: fx.proUserId,
        seriesId: created.seriesId,
        scope: 'THIS_AND_FUTURE',
        fromOccurrenceIndex: null,
        reason: null,
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isBookingError(error) && error.code === 'INVALID_SERIES_RECURRENCE',
    )

    const rows = await readOccurrences(created.seriesId)
    for (const row of rows) {
      expect(row.status).toBe(BookingStatus.ACCEPTED)
    }
  }, 60_000)
})

describe('cancelBookingSeriesOccurrences — ownership', () => {
  it("answers 404 for another pro's series and cancels nothing", async () => {
    const created = await series({ occurrenceCount: 3 })

    await expect(
      cancelBookingSeriesOccurrences({
        professionalId: fx.otherProfessionalId,
        actorUserId: fx.otherProUserId,
        seriesId: created.seriesId,
        scope: 'ALL',
        fromOccurrenceIndex: null,
        reason: null,
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isBookingError(error) && error.code === 'BOOKING_NOT_FOUND',
    )

    const rows = await readOccurrences(created.seriesId)
    for (const row of rows) {
      expect(row.status).toBe(BookingStatus.ACCEPTED)
    }

    const seriesRow = await db.bookingSeries.findUniqueOrThrow({
      where: { id: created.seriesId },
      select: { status: true },
    })
    // Still exactly what creation left it: a 3-of-3 series is stamped ENDED by
    // the materializer (nothing left to roll forward). What matters is that the
    // foreign call did NOT stamp it CANCELLED.
    expect(seriesRow.status).toBe(BookingSeriesStatus.ENDED)
  }, 60_000)
})

describe('loadProBookingSeriesDetail', () => {
  // 🔴 The whole reason K19 exists. K18's create response carries `skipped[]`
  // once and then it is gone; the exception rows are the durable form, and this
  // is the read that surfaces them.
  it('reports the skipped occurrences a collision produced', async () => {
    // Occupy occurrence 1's slot, offset by 30 minutes so it is the OVERLAP
    // rule that refuses and not the (professionalId, scheduledFor) unique index
    // ([[ab-proof-needs-an-unchanged-seam]], learned the hard way in K18).
    await createProBooking({
      professionalId: fx.professionalId,
      actorUserId: fx.proUserId,
      clientId: fx.clientId,
      offeringId: fx.offeringId,
      locationId: fx.locationId,
      locationType: ServiceLocationType.SALON,
      scheduledFor: new Date('2026-11-06T17:30:00.000Z'),
      clientAddressId: null,
      internalNotes: null,
      requestedBufferMinutes: null,
      requestedTotalDurationMinutes: null,
      allowOutsideWorkingHours: true,
      allowShortNotice: true,
      allowFarFuture: true,
      overrideReason: 'blocker for the K19 skip test',
      requestId: null,
      idempotencyKey: null,
    })

    const created = await series({ occurrenceCount: 4 })
    expect(created.skipped.map((row) => row.index)).toEqual([1])

    const detail = await loadProBookingSeriesDetail({
      professionalId: fx.professionalId,
      seriesId: created.seriesId,
    })

    if (!detail) throw new Error('expected the series to load')

    expect(detail.occurrences.map((row) => row.index)).toEqual([0, 2, 3])
    expect(detail.skipped).toEqual([
      expect.objectContaining({
        index: 1,
        reason: BookingSeriesExceptionReason.SLOT_UNAVAILABLE,
      }),
    ])
    expect(detail.timeZone).toBe(ZONE)
  }, 60_000)

  it('pins the price to occurrence 0 and surfaces a list price that has moved', async () => {
    const created = await series({ occurrenceCount: 3 })

    const before = await loadProBookingSeriesDetail({
      professionalId: fx.professionalId,
      seriesId: created.seriesId,
    })
    if (!before) throw new Error('expected the series to load')

    expect(before.pricing.pinnedTotalCents).toBe(BASE_PRICE_CENTS)
    expect(before.pricing.currentListTotalCents).toBe(BASE_PRICE_CENTS)
    expect(before.pricing.listPriceMoved).toBe(false)
    expect(before.pricing.occurrencesDisagree).toBe(false)

    // The pro raises their catalog price. The standing client keeps theirs.
    await db.professionalServiceOffering.update({
      where: { id: fx.offeringId },
      data: { salonPriceStartingAt: new Prisma.Decimal('150.00') },
    })

    const after = await loadProBookingSeriesDetail({
      professionalId: fx.professionalId,
      seriesId: created.seriesId,
    })
    if (!after) throw new Error('expected the series to load')

    expect(after.pricing.pinnedTotalCents).toBe(BASE_PRICE_CENTS)
    expect(after.pricing.currentListTotalCents).toBe(15_000)
    expect(after.pricing.listPriceMoved).toBe(true)

    // 🔴 Surfaced, never applied: the booked rows still carry the agreed price.
    const rows = await readOccurrences(created.seriesId)
    for (const row of rows) {
      expect(row.subtotalSnapshot.toFixed(2)).toBe(BASE_PRICE)
    }
  }, 60_000)

  it("returns null for another pro's series", async () => {
    const created = await series({ occurrenceCount: 2 })

    await expect(
      loadProBookingSeriesDetail({
        professionalId: fx.otherProfessionalId,
        seriesId: created.seriesId,
      }),
    ).resolves.toBeNull()
  }, 60_000)

  it('marks which occurrences a cancel could touch', async () => {
    const created = await series({ occurrenceCount: 3 })
    const rows = await readOccurrences(created.seriesId)
    const cancelledRow = rows[0]
    if (!cancelledRow) throw new Error('fixture: expected occurrence 0')

    await db.booking.update({
      where: { id: cancelledRow.id },
      data: { status: BookingStatus.CANCELLED, cancelledAt: new Date() },
    })

    const detail = await loadProBookingSeriesDetail({
      professionalId: fx.professionalId,
      seriesId: created.seriesId,
    })
    if (!detail) throw new Error('expected the series to load')

    expect(
      detail.occurrences.map((row) => [row.index, row.cancellable]),
    ).toEqual([
      [0, false],
      [1, true],
      [2, true],
    ])
    expect(detail.occurrences[0]?.untouchedReason).toBe('ALREADY_CANCELLED')
  }, 60_000)
})
