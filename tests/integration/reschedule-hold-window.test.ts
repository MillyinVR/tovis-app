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
// B3-A (the second describe block below) closes the THIRD window. B3 left the
// OFFER base-sized on purpose: `/availability/day` is unauthenticated and its
// answer is cached, so making it booking-aware was a design call rather than a
// mechanical change. It now takes an optional `rescheduleBookingId`, and when
// present it authenticates, checks ownership, and sizes the grid through that
// same guard — so OFFER, RESERVE and COMMIT are one number
// ([[offer-reserve-commit-are-three-windows]]).
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
import { minutesSinceMidnightInTimeZone, utcDateToLocalParts } from '@/lib/time'
import { GET as availabilityDayGET } from '@/app/api/v1/availability/day/route'
import { GET as availabilityBootstrapGET } from '@/app/api/v1/availability/bootstrap/route'
import { buildDayCacheKey } from '@/lib/availability/data/cache'
import { isRecord } from '@/lib/guards'

// A hold snapshots its location address through the PII envelope, so the real
// boundary needs a real keyring even though these fixtures are salon-only.
vi.hoisted(() => {
  const key32 = Buffer.alloc(32, 7).toString('base64')
  process.env.PII_LOOKUP_HMAC_KEYS_JSON ||= JSON.stringify({ 1: key32 })
  process.env.PII_AEAD_KEYS_JSON ||= JSON.stringify({ 'address-aead-v1': key32 })
  // B3-A imports the availability ROUTE, whose `@/app/api/_utils` barrel pulls
  // in the session reader at module load. No JWT is ever minted here — the
  // viewer comes from the `requireClient` mock below — but the module refuses
  // to load without this set.
  process.env.JWT_SECRET ||= 'b3a-integration-secret-not-used-for-signing'
})

// `.env.test.local` points the schedule-version counter at the SHARED Upstash
// instance, so this suite must never assert on real Redis state. Nothing here
// tests the bump; stub it so the boundary's calls are inert.
vi.mock('@/lib/booking/cacheVersion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/booking/cacheVersion')>()),
  bumpScheduleVersion: vi.fn(async () => 1),
  // B3-A drives the availability ROUTES, which read both counters. Stubbing the
  // getters keeps this suite off the shared Redis entirely rather than trusting
  // that a read never initialises a key.
  getScheduleVersion: vi.fn(async () => 1),
  getScheduleConfigVersion: vi.fn(async () => 1),
}))

/**
 * Who `requireClient` reports for the next availability request. B3's own tests
 * call the write boundary directly and never touch this barrel, so the mock is
 * inert for them; `...actual` keeps `jsonOk`/`jsonFail` real, which matters
 * because `bookingJsonFail` resolves `jsonFail` through this same barrel.
 */
const authState = vi.hoisted(() => ({ current: null as string | null }))

vi.mock('@/app/api/_utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/api/_utils')>()

  return {
    ...actual,
    requireClient: async () =>
      authState.current
        ? { ok: true, clientId: authState.current, user: null }
        : { ok: false, res: actual.jsonFail(401, 'Sign in to continue.') },
  }
})

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

// ─── B3-A ────────────────────────────────────────────────────────────────────
// The OFFER window. Everything above proves the RESERVE matches the COMMIT;
// these prove the grid the client picks from matches both.

/** The LOCAL calendar date of an instant, as the routes' `date` param wants. */
function ymdOf(instant: Date): string {
  const parts = utcDateToLocalParts(instant, ZONE)
  const mm = String(parts.month).padStart(2, '0')
  const dd = String(parts.day).padStart(2, '0')
  return `${parts.year}-${mm}-${dd}`
}

/** Minutes since LOCAL midnight for an offered slot — 17:00 reads as 1020. */
function localMinutes(iso: string): number {
  return minutesSinceMidnightInTimeZone(new Date(iso), ZONE)
}

type DayAnswer = {
  status: number
  ok: boolean
  code: string | null
  slots: string[]
  durationMinutes: number | null
  raw: string
}

function readAnswer(status: number, body: unknown, raw: string): DayAnswer {
  const record = isRecord(body) ? body : {}
  const slots = Array.isArray(record.slots)
    ? record.slots.filter((slot): slot is string => typeof slot === 'string')
    : []

  return {
    status,
    ok: record.ok === true,
    code: typeof record.code === 'string' ? record.code : null,
    slots,
    durationMinutes:
      typeof record.durationMinutes === 'number' ? record.durationMinutes : null,
    raw,
  }
}

/** Drive the real `/availability/day` handler. `debug` keeps it off the cache. */
async function askDay(params: Record<string, string>): Promise<DayAnswer> {
  const qs = new URLSearchParams({
    professionalId: fx.professionalId,
    serviceId: fx.serviceId,
    locationType: 'SALON',
    locationId: fx.salonLocationId,
    debug: '1',
    ...params,
  })

  const res = await availabilityDayGET(
    new Request(`http://localhost/api/v1/availability/day?${qs.toString()}`),
  )
  const raw = await res.text()
  return readAnswer(res.status, JSON.parse(raw) as unknown, raw)
}

async function askBootstrap(params: Record<string, string>): Promise<DayAnswer> {
  const qs = new URLSearchParams({
    professionalId: fx.professionalId,
    serviceId: fx.serviceId,
    locationType: 'SALON',
    locationId: fx.salonLocationId,
    includeOtherPros: '0',
    debug: '1',
    ...params,
  })

  const res = await availabilityBootstrapGET(
    new Request(
      `http://localhost/api/v1/availability/bootstrap?${qs.toString()}`,
    ),
  )
  const raw = await res.text()
  return readAnswer(res.status, JSON.parse(raw) as unknown, raw)
}

describe('the reschedule OFFER is sized from the booking too (real DB)', () => {
  // The booking sits on its own day so the queried day is a clean 09:00–18:00
  // grid: what differs between the two answers is the WIDTH, nothing else.
  const bookingDay = () => futureLocal(3, 10)
  const queryDay = () => futureLocal(4, 12)

  afterEach(() => {
    authState.current = null
  })

  it('offers starts the reschedule refuses — and stops once it knows the booking', async () => {
    const bookingId = await seedBooking({ start: bookingDay() })
    const date = ymdOf(queryDay())

    // The public grid: sized 60, so it runs to 17:00 (17:00 + 60 = 18:00).
    const publicAnswer = await askDay({ date })
    expect(publicAnswer.ok).toBe(true)
    expect(publicAnswer.durationMinutes).toBe(OFFERING_BASE_MINUTES)

    // The reschedule grid: sized 90, so it stops at 16:30.
    authState.current = fx.clientId
    const rescheduleAnswer = await askDay({
      date,
      rescheduleBookingId: bookingId,
    })
    expect(rescheduleAnswer.ok).toBe(true)
    expect(rescheduleAnswer.durationMinutes).toBe(BOOKED_MINUTES)

    const publicMinutes = publicAnswer.slots.map(localMinutes)
    const rescheduleMinutes = rescheduleAnswer.slots.map(localMinutes)

    expect(Math.max(...publicMinutes)).toBe(17 * 60)
    expect(Math.max(...rescheduleMinutes)).toBe(16 * 60 + 30)

    // The dead ends, named exactly: offered at base width, refused at booking
    // width. Two starts per working day on this fixture.
    const deadEnds = publicMinutes.filter(
      (minute) => !rescheduleMinutes.includes(minute),
    )
    expect(deadEnds).toEqual([16 * 60 + 45, 17 * 60])

    // Nothing was LOST the other way — the narrower grid is a strict subset.
    expect(rescheduleMinutes.every((m) => publicMinutes.includes(m))).toBe(true)
  })

  it('a start the public grid offers is genuinely refused by the reschedule hold', async () => {
    const bookingId = await seedBooking({ start: bookingDay() })
    const date = ymdOf(queryDay())

    const publicAnswer = await askDay({ date })
    const deadEndIso = publicAnswer.slots.find(
      (slot) => localMinutes(slot) === 17 * 60,
    )
    expect(deadEndIso).toBeDefined()

    // This is what made it a dead end rather than a mere mislabel: the client
    // could pick it, and only then be told no.
    const code = await refusalCode(() =>
      hold({ start: new Date(deadEndIso as string), rescheduleBookingId: bookingId }),
    )
    expect(code).toBe('OUTSIDE_WORKING_HOURS')
  })

  it('every start the reschedule grid offers is one the reschedule hold accepts', async () => {
    const bookingId = await seedBooking({ start: bookingDay() })
    const date = ymdOf(queryDay())

    authState.current = fx.clientId
    const answer = await askDay({ date, rescheduleBookingId: bookingId })
    expect(answer.slots.length).toBeGreaterThan(20)

    // Whole-grid parity, B1's method: not a sampled start, every one of them.
    // Each createHold supersedes this client's previous hold, so the loop needs
    // no cleanup between iterations.
    for (const slot of answer.slots) {
      const created = await hold({
        start: new Date(slot),
        rescheduleBookingId: bookingId,
      })

      const row = await readHold(created.hold.id)
      expect(row.durationMinutesSnapshot).toBe(BOOKED_MINUTES)
    }
  }, 120_000)

  it('sizes the day scroller too, so no day is offered that has nothing in it', async () => {
    const bookingId = await seedBooking({ start: bookingDay() })

    const publicBoot = await askBootstrap({})
    expect(publicBoot.ok).toBe(true)
    expect(publicBoot.durationMinutes).toBe(OFFERING_BASE_MINUTES)

    authState.current = fx.clientId
    const rescheduleBoot = await askBootstrap({
      rescheduleBookingId: bookingId,
    })
    expect(rescheduleBoot.ok).toBe(true)
    expect(rescheduleBoot.durationMinutes).toBe(BOOKED_MINUTES)
  })

  it('answers a stranger’s booking exactly as it answers a missing one', async () => {
    const rivalBookingId = await seedBooking({
      start: bookingDay(),
      clientId: fx.rivalClientId,
    })
    const date = ymdOf(queryDay())

    authState.current = fx.clientId

    const stranger = await askDay({ date, rescheduleBookingId: rivalBookingId })
    const missing = await askDay({
      date,
      rescheduleBookingId: 'booking_does_not_exist',
    })

    expect(stranger.code).toBe('BOOKING_NOT_FOUND')
    expect(stranger.status).toBe(missing.status)
    expect(stranger.code).toBe(missing.code)
    // No enumeration oracle: the two refusals are byte-identical.
    expect(stranger.raw).toBe(missing.raw)
  })

  it('refuses the booking-sized grid to a signed-out caller', async () => {
    const bookingId = await seedBooking({ start: bookingDay() })
    const date = ymdOf(queryDay())

    authState.current = null
    const answer = await askDay({ date, rescheduleBookingId: bookingId })

    expect(answer.status).toBe(401)
    expect(answer.ok).toBe(false)
  })

  it('leaves the public grid unauthenticated', async () => {
    const date = ymdOf(queryDay())

    authState.current = null
    const answer = await askDay({ date })

    expect(answer.ok).toBe(true)
    expect(answer.durationMinutes).toBe(OFFERING_BASE_MINUTES)
  })

  it('refuses add-ons alongside a reschedule, as the hold already does', async () => {
    const bookingId = await seedBooking({ start: bookingDay() })
    const date = ymdOf(queryDay())

    authState.current = fx.clientId
    const answer = await askDay({
      date,
      rescheduleBookingId: bookingId,
      addOnIds: fx.addOnId,
    })

    expect(answer.code).toBe('ADDONS_INVALID')

    // The same request shape is refused at the reservation, so the two ends
    // agree rather than one silently ignoring a field the other honours.
    const holdCode = await refusalCode(() =>
      hold({
        start: queryDay(),
        rescheduleBookingId: bookingId,
        addOnIds: [fx.addOnId],
      }),
    )
    expect(holdCode).toBe('ADDONS_INVALID')
  })

  it('surfaces the commit’s own refusal at the grid instead of after the pick', async () => {
    const cancelledId = await seedBooking({
      start: bookingDay(),
      status: BookingStatus.CANCELLED,
    })
    const date = ymdOf(queryDay())

    authState.current = fx.clientId
    const answer = await askDay({ date, rescheduleBookingId: cancelledId })

    expect(answer.code).toBe('BOOKING_NOT_RESCHEDULABLE')
  })

  it('names a mismatched offering distinctly from a missing booking', async () => {
    const bookingId = await seedBooking({ start: bookingDay() })
    const date = ymdOf(queryDay())

    // A second service the client could plausibly be looking at, whose offering
    // is not the one the booking committed to.
    const otherService = await db.service.create({
      data: {
        name: `${TAG} Other`,
        categoryId: fx.categoryId,
        defaultDurationMinutes: OFFERING_BASE_MINUTES,
        minPrice: new Prisma.Decimal('100.00'),
        isActive: true,
      },
      select: { id: true },
    })
    await db.professionalServiceOffering.create({
      data: {
        professionalId: fx.professionalId,
        serviceId: otherService.id,
        isActive: true,
        offersInSalon: true,
        offersMobile: false,
        salonPriceStartingAt: new Prisma.Decimal('100.00'),
        salonDurationMinutes: OFFERING_BASE_MINUTES,
      },
      select: { id: true },
    })

    authState.current = fx.clientId
    const answer = await askDay({
      date,
      serviceId: otherService.id,
      rescheduleBookingId: bookingId,
    })

    // NOT BOOKING_NOT_FOUND (the booking is theirs and it exists) and NOT
    // HOLD_MISMATCH (there is no hold) — [[one-code-two-meanings-add-a-code]].
    expect(answer.code).toBe('RESCHEDULE_BOOKING_MISMATCH')
  })

  it('keeps the booking out of the answer, which is what lets the cache stay shared', async () => {
    const bookingId = await seedBooking({ start: bookingDay() })
    const date = ymdOf(queryDay())

    authState.current = fx.clientId
    const answer = await askDay({ date, rescheduleBookingId: bookingId })

    expect(answer.ok).toBe(true)
    // The booking is an INPUT to the width, never part of the payload — so two
    // callers who resolve to the same width are owed the identical answer and
    // the public cache entry is safe to share ([[cache-is-a-third-query]]).
    expect(answer.raw).not.toContain(bookingId)
    expect(answer.raw).not.toContain(fx.clientId)
  })

  it('separates the two answers in the cache key by the width itself', () => {
    const common = {
      professionalId: fx.professionalId,
      serviceId: fx.serviceId,
      locationId: fx.salonLocationId,
      locationType: ServiceLocationType.SALON,
      dateStr: '2026-09-01',
      timeZone: ZONE,
      stepMinutes: 15,
      leadTimeMinutes: 0,
      locationBufferMinutes: 0,
      scheduleVersion: 1,
      scheduleConfigVersion: 1,
      addOnIds: [],
      clientAddressId: null,
    }

    // Why no per-client key was needed: the width is already in the key, and
    // the width is the only thing the reschedule variant changes.
    expect(
      buildDayCacheKey({ ...common, durationMinutes: OFFERING_BASE_MINUTES }),
    ).not.toBe(buildDayCacheKey({ ...common, durationMinutes: BOOKED_MINUTES }))
  })
})

// ─── B3-B ────────────────────────────────────────────────────────────────────
// "3pm–5pm, move it to start at 4pm." Tori's call, 2026-07-25: allow it.
//
// The reschedule COMMIT always allowed it — `evaluateRescheduleDecision` passes
// `excludeBookingId`, because a booking is not an obstacle to itself. The two
// promise sites did not: `/availability/day` counted the booking in its busy set
// and `evaluateHoldCreationDecision` ran its conflict query with no exclusion.
// So the overlapping start was hidden from the grid and refused at the hold, and
// the only reschedule a client could make was into a completely free window.
//
// Nothing was ever offered-then-refused by this — the two promise sites agreed
// with each other, just not with the commit — which is why B3-A left it. What it
// cost was reach: on the booking's own day a wide booking could leave NO
// offerable start at all.

describe('a reschedule may overlap the slot it is vacating (real DB)', () => {
  // 15:00 local, 90 minutes committed → the booking occupies 15:00–16:30.
  const bookingStart = () => futureLocal(5, 15)
  /** 16:00 — inside the booking's own window, and the case Tori named. */
  const overlappingStart = () => futureLocal(5, 16)

  afterEach(() => {
    authState.current = null
  })

  it('offers a start inside the booking’s own window', async () => {
    const bookingId = await seedBooking({ start: bookingStart() })
    const date = ymdOf(bookingStart())

    // The public grid cannot offer it: for everyone else that time IS busy.
    const publicAnswer = await askDay({ date })
    expect(publicAnswer.slots.map(localMinutes)).not.toContain(16 * 60)

    // The client moving THIS booking is offered it.
    authState.current = fx.clientId
    const answer = await askDay({ date, rescheduleBookingId: bookingId })

    expect(answer.ok).toBe(true)
    expect(answer.slots.map(localMinutes)).toContain(16 * 60)
  })

  it('holds it, and the reschedule commits it', async () => {
    const bookingId = await seedBooking({ start: bookingStart() })

    const created = await hold({
      start: overlappingStart(),
      rescheduleBookingId: bookingId,
    })

    const row = await readHold(created.hold.id)
    expect(row.durationMinutesSnapshot).toBe(BOOKED_MINUTES)
    expect(row.scheduledFor.getTime()).toBe(overlappingStart().getTime())

    await rescheduleBookingFromHold({
      bookingId,
      clientId: fx.clientId,
      holdId: created.hold.id,
      requestedLocationType: ServiceLocationType.SALON,
    })

    const moved = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { scheduledFor: true, totalDurationMinutes: true },
    })

    expect(moved.scheduledFor.getTime()).toBe(overlappingStart().getTime())
    expect(moved.totalDurationMinutes).toBe(BOOKED_MINUTES)
  })

  it('still refuses a time taken by a DIFFERENT booking', async () => {
    const mine = await seedBooking({ start: bookingStart() })
    // A rival booking immediately after mine ends (16:30 + 90 = 18:00).
    await seedBooking({
      start: futureLocal(5, 16, 30),
      clientId: fx.rivalClientId,
    })

    // Excluding MY booking must not excuse anyone else's.
    const code = await refusalCode(() =>
      hold({ start: futureLocal(5, 16, 30), rescheduleBookingId: mine }),
    )
    expect(code).toBe('TIME_BOOKED')

    authState.current = fx.clientId
    const answer = await askDay({
      date: ymdOf(bookingStart()),
      rescheduleBookingId: mine,
    })
    expect(answer.slots.map(localMinutes)).not.toContain(16 * 60 + 30)
  })

  it('excludes nothing for an ordinary hold', async () => {
    const bookingId = await seedBooking({ start: bookingStart() })

    // Same client, same time, but NOT moving that booking — the booking is a
    // plain obstacle again.
    const code = await refusalCode(() => hold({ start: overlappingStart() }))
    expect(code).toBe('TIME_BOOKED')
    expect(bookingId).toBeTruthy()
  })

  it('keeps the booking-excluded answer out of the public cache entry', () => {
    const common = {
      professionalId: fx.professionalId,
      serviceId: fx.serviceId,
      locationId: fx.salonLocationId,
      locationType: ServiceLocationType.SALON,
      dateStr: '2026-09-01',
      timeZone: ZONE,
      stepMinutes: 15,
      leadTimeMinutes: 0,
      locationBufferMinutes: 0,
      scheduleVersion: 1,
      scheduleConfigVersion: 1,
      addOnIds: [],
      durationMinutes: BOOKED_MINUTES,
      clientAddressId: null,
    }

    // B3-A could share the public entry because the answer was a pure function
    // of the WIDTH. It no longer is — a busy set with a hole in it is a
    // different answer — so the exclusion has to be in the key.
    const publicKey = buildDayCacheKey(common)
    const rescheduleKey = buildDayCacheKey({
      ...common,
      excludeBookingId: 'booking_1',
    })

    expect(rescheduleKey).not.toBe(publicKey)
    // …and a request that does NOT exclude anything still hashes exactly as it
    // did before this field existed, so no public entry is orphaned on deploy.
    expect(buildDayCacheKey({ ...common, excludeBookingId: null })).toBe(
      publicKey,
    )
  })
})
