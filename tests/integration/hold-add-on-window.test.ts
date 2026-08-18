// tests/integration/hold-add-on-window.test.ts
//
// B1-A — "the hold reserves what finalize will take".
//
// The three windows a booking passes through are the OFFER (availability), the
// RESERVE (the hold) and the COMMIT (finalize). Finalize has always enforced
// `base + add-ons`; the hold used to reserve the base service alone, so a client
// who ticked an add-on held less time than they were about to book. Two things
// followed, both driven in `booking-overlap-concurrency.test.ts` before the fix:
// the un-held tail could be taken by someone else, and the last starts of EVERY
// working day stopped fitting the moment any add-on was selected — refused at
// the END of checkout as a generic toast.
//
// This suite drives the fix against real Postgres: the reservation is sized
// base + add-ons at create, an existing hold can be re-sized through the very
// gate finalize runs, and a refusal leaves the client holding what they had.
//
// Runs against the test database — `pnpm test:integration` (or the whole
// integration config).
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
  createProBooking,
  finalizeBookingFromHold,
  updateHoldAddOns,
} from '@/lib/booking/writeBoundary'
import { resolveDurationWithAddOns } from '@/lib/availability/data/addOnContext'
import { resolveBookingAddOns } from '@/lib/booking/addOnResolution'
import { isBookingError } from '@/lib/booking/errors'
import { minutesSinceMidnightInTimeZone } from '@/lib/time'

// A hold snapshots its location address through the PII envelope, so the real
// boundary needs a real keyring even though these fixtures are salon-only.
vi.hoisted(() => {
  const key32 = Buffer.alloc(32, 9).toString('base64')
  process.env.PII_LOOKUP_HMAC_KEYS_JSON ||= JSON.stringify({ 1: key32 })
  process.env.PII_AEAD_KEYS_JSON ||= JSON.stringify({ 'address-aead-v1': key32 })
})

// The schedule-version counter lives in Redis, which this suite neither has nor
// should touch (`.env.test.local` points at the shared instance). The BUMP is
// still the thing under test — whether a re-size invalidates the availability
// cache and a no-op leaves it alone — so spy on the call rather than the
// counter. Reading the counter back would also have asserted nothing: the
// helper swallows a Redis failure and returns 0, so `0 === 0` passes for both
// branches.
const cacheVersion = vi.hoisted(() => ({
  bumpScheduleVersion: vi.fn(async () => 1),
}))

vi.mock('@/lib/booking/cacheVersion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/booking/cacheVersion')>()),
  bumpScheduleVersion: cacheVersion.bumpScheduleVersion,
}))

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with: pnpm test:integration')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const TAG = `hold_addon_${Date.now()}`
const ZONE = 'America/Los_Angeles'
const BASE_DURATION_MINUTES = 60
const ADD_ON_MINUTES = 30

type Fixtures = {
  tenantId: string
  proUserId: string
  professionalId: string
  clientId: string
  rivalClientId: string
  serviceId: string
  categoryId: string
  salonLocationId: string
  offeringId: string
  /** +30 min, priced by the link override. */
  addOnId: string
  /** 5 min on the link — below the platform's 15-minute floor. */
  shortAddOnId: string
  /** Stores a negative duration; unbookable, and must read as such. */
  brokenAddOnId: string
  /** Stores an exact 0 — a legal instant/retail add-on, adds no time. */
  zeroMinuteAddOnId: string
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
    salonDurationMinutes: BASE_DURATION_MINUTES,
    mobileDurationMinutes: null,
    salonPriceStartingAt: new Prisma.Decimal('100.00'),
    mobilePriceStartingAt: null,
    professionalTimeZone: ZONE,
  }
}

async function hold(args: { start: Date; addOnIds: string[]; clientId?: string }) {
  return createHold({
    clientId: args.clientId ?? fx.clientId,
    bookingEntryPoint: 'DIRECT_PROFILE',
    addOnIds: args.addOnIds,
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
      expiresAt: true,
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

async function createAddOnLink(args: {
  serviceName: string
  durationOverrideMinutes: number | null
  defaultDurationMinutes: number
  sortOrder: number
}): Promise<string> {
  const service = await db.service.create({
    data: {
      name: `${TAG} ${args.serviceName}`,
      categoryId: fx.categoryId,
      defaultDurationMinutes: args.defaultDurationMinutes,
      minPrice: new Prisma.Decimal('25.00'),
      isActive: true,
      isAddOnEligible: true,
    },
    select: { id: true },
  })

  const link = await db.offeringAddOn.create({
    data: {
      offeringId: fx.offeringId,
      addOnServiceId: service.id,
      isActive: true,
      sortOrder: args.sortOrder,
      priceOverride: new Prisma.Decimal('25.00'),
      durationOverrideMinutes: args.durationOverrideMinutes,
    },
    select: { id: true },
  })

  return link.id
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
      firstName: 'Addy',
      lastName: 'Onn',
      businessName: 'Add-on Studio',
      timeZone: ZONE,
    },
    select: { id: true },
  })

  const clientUser = await db.user.create({
    data: {
      email: `${TAG}_client@example.com`,
      password: 'x',
      role: Role.CLIENT,
    },
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
    data: {
      email: `${TAG}_rival@example.com`,
      password: 'x',
      role: Role.CLIENT,
    },
    select: { id: true },
  })
  const rival = await db.clientProfile.create({
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
      defaultDurationMinutes: BASE_DURATION_MINUTES,
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
      salonDurationMinutes: BASE_DURATION_MINUTES,
    },
    select: { id: true },
  })

  fx = {
    tenantId: tenant.id,
    proUserId: proUser.id,
    professionalId: professional.id,
    clientId: client.id,
    rivalClientId: rival.id,
    serviceId: service.id,
    categoryId: category.id,
    salonLocationId: salon.id,
    offeringId: offering.id,
    addOnId: '',
    shortAddOnId: '',
    brokenAddOnId: '',
    zeroMinuteAddOnId: '',
  }

  fx.addOnId = await createAddOnLink({
    serviceName: 'Gloss',
    durationOverrideMinutes: ADD_ON_MINUTES,
    defaultDurationMinutes: ADD_ON_MINUTES,
    sortOrder: 1,
  })

  fx.shortAddOnId = await createAddOnLink({
    serviceName: 'Trim',
    durationOverrideMinutes: 5,
    defaultDurationMinutes: 5,
    sortOrder: 2,
  })

  // A stored NEGATIVE duration is still unusable data — `??` only skips
  // null/undefined, so this never falls through to `defaultDurationMinutes`.
  fx.brokenAddOnId = await createAddOnLink({
    serviceName: 'Broken',
    durationOverrideMinutes: -5,
    defaultDurationMinutes: 15,
    sortOrder: 3,
  })

  // An EXACT 0 is the add-on-specific legal exception (an instant/retail
  // add-on that adds no time) — distinct from the genuinely-broken negative
  // case above.
  fx.zeroMinuteAddOnId = await createAddOnLink({
    serviceName: 'Take-home kit',
    durationOverrideMinutes: 0,
    defaultDurationMinutes: 0,
    sortOrder: 4,
  })
})

afterEach(async () => {
  const pro = { professionalId: fx.professionalId }
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
    await db.professionalPaymentSettings.deleteMany({ where: pro })
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

describe('hold reserves base + add-ons (real DB)', () => {
  it('sizes the reservation to base + add-ons at create', async () => {
    const start = futureLocal(7, 12)

    const created = await hold({ start, addOnIds: [fx.addOnId] })

    expect(created.hold.durationMinutes).toBe(
      BASE_DURATION_MINUTES + ADD_ON_MINUTES,
    )

    const row = await readHold(created.hold.id)
    expect(row.durationMinutesSnapshot).toBe(
      BASE_DURATION_MINUTES + ADD_ON_MINUTES,
    )
    expect(row.endsAtSnapshot?.getTime()).toBe(
      start.getTime() + (BASE_DURATION_MINUTES + ADD_ON_MINUTES) * 60_000,
    )
  })

  it('holds the add-on tail against a rival, which a base-sized hold did not', async () => {
    const start = futureLocal(8, 12)
    const tail = new Date(start.getTime() + BASE_DURATION_MINUTES * 60_000)

    // A: base-only — the tail is free, so the rival takes 13:00.
    const baseOnly = await hold({ start, addOnIds: [] })
    const rivalOnBaseOnly = await hold({
      start: tail,
      addOnIds: [],
      clientId: fx.rivalClientId,
    })
    expect(rivalOnBaseOnly.hold.id).toBeTruthy()

    await db.bookingHold.deleteMany({
      where: { id: { in: [baseOnly.hold.id, rivalOnBaseOnly.hold.id] } },
    })

    // B: the SAME slot with the add-on — the tail is now reserved, and the
    // rival is refused. This is the race B1-A left open.
    await hold({ start, addOnIds: [fx.addOnId] })

    expect(
      await refusalCode(() =>
        hold({ start: tail, addOnIds: [], clientId: fx.rivalClientId }),
      ),
    ).toBe('TIME_HELD')
  })

  it('refuses the last start of the day AT THE HOLD, not at checkout', async () => {
    // 17:00 + 60 min base fits a 09:00–18:00 day; + 30 min of add-ons does not.
    const lastStart = futureLocal(9, 17)

    expect(await hold({ start: lastStart, addOnIds: [] })).toBeTruthy()

    await db.bookingHold.deleteMany({ where: { professionalId: fx.professionalId } })

    expect(
      await refusalCode(() => hold({ start: lastStart, addOnIds: [fx.addOnId] })),
    ).toBe('OUTSIDE_WORKING_HOURS')
  })

  it('applies the same 15-minute floor to a short add-on as the write path', async () => {
    const start = futureLocal(10, 12)

    const created = await hold({ start, addOnIds: [fx.shortAddOnId] })

    // The link stores 5 minutes; both sides normalize it to the platform floor.
    const persisted = await resolveBookingAddOns({
      client: db,
      professionalId: fx.professionalId,
      offeringId: fx.offeringId,
      addOnIds: [fx.shortAddOnId],
      locationType: ServiceLocationType.SALON,
    })

    expect(persisted[0]?.durationMinutesSnapshot).toBe(15)
    expect(created.hold.durationMinutes).toBe(BASE_DURATION_MINUTES + 15)
  })

  it('refuses an add-on with a negative duration on BOTH sides', async () => {
    const start = futureLocal(11, 12)

    const offered = await resolveDurationWithAddOns({
      client: db,
      professionalId: fx.professionalId,
      offeringId: fx.offeringId,
      addOnIds: [fx.brokenAddOnId],
      locationType: ServiceLocationType.SALON,
      baseDurationMinutes: BASE_DURATION_MINUTES,
    })

    // Previously `ok: true` with the add-on counted as 0 minutes — an offer
    // sized for a booking finalize would refuse outright.
    expect(offered.ok).toBe(false)

    expect(
      await refusalCode(() => hold({ start, addOnIds: [fx.brokenAddOnId] })),
    ).toBe('ADDONS_INVALID')
  })

  /**
   * The add-on-specific exception, driven against real Postgres: an EXACT
   * zero (an instant/retail add-on like a take-home product) is legal on
   * BOTH sides and adds no time — distinct from the negative case above,
   * which stays refused.
   */
  it('accepts an add-on with an exact 0 duration on BOTH sides, adding no time', async () => {
    const start = futureLocal(11, 12)

    const offered = await resolveDurationWithAddOns({
      client: db,
      professionalId: fx.professionalId,
      offeringId: fx.offeringId,
      addOnIds: [fx.zeroMinuteAddOnId],
      locationType: ServiceLocationType.SALON,
      baseDurationMinutes: BASE_DURATION_MINUTES,
    })

    expect(offered.ok).toBe(true)
    if (offered.ok) {
      expect(offered.addOnDurationTotal).toBe(0)
      expect(offered.durationMinutes).toBe(BASE_DURATION_MINUTES)
    }

    const created = await hold({ start, addOnIds: [fx.zeroMinuteAddOnId] })
    expect(created.hold.durationMinutes).toBe(BASE_DURATION_MINUTES)

    const persisted = await resolveBookingAddOns({
      client: db,
      professionalId: fx.professionalId,
      offeringId: fx.offeringId,
      addOnIds: [fx.zeroMinuteAddOnId],
      locationType: ServiceLocationType.SALON,
    })
    expect(persisted[0]?.durationMinutesSnapshot).toBe(0)
  })
})

describe('updateHoldAddOns re-sizes a live hold (real DB)', () => {
  it('widens the reservation and leaves the expiry alone', async () => {
    const start = futureLocal(12, 12)

    const created = await hold({ start, addOnIds: [] })
    const before = await readHold(created.hold.id)

    const updated = await updateHoldAddOns({
      holdId: created.hold.id,
      clientId: fx.clientId,
      addOnIds: [fx.addOnId],
    })

    expect(updated.meta.mutated).toBe(true)
    expect(updated.hold.durationMinutes).toBe(
      BASE_DURATION_MINUTES + ADD_ON_MINUTES,
    )

    const after = await readHold(created.hold.id)
    expect(after.durationMinutesSnapshot).toBe(
      BASE_DURATION_MINUTES + ADD_ON_MINUTES,
    )
    expect(after.endsAtSnapshot?.getTime()).toBe(
      start.getTime() + (BASE_DURATION_MINUTES + ADD_ON_MINUTES) * 60_000,
    )

    // Re-sizing is not re-holding: toggling add-ons must not buy more time.
    expect(after.expiresAt.getTime()).toBe(before.expiresAt.getTime())
  })

  it('narrows back when the selection is cleared', async () => {
    const start = futureLocal(13, 12)

    const created = await hold({ start, addOnIds: [fx.addOnId] })

    const narrowed = await updateHoldAddOns({
      holdId: created.hold.id,
      clientId: fx.clientId,
      addOnIds: [],
    })

    expect(narrowed.hold.durationMinutes).toBe(BASE_DURATION_MINUTES)

    const after = await readHold(created.hold.id)
    expect(after.durationMinutesSnapshot).toBe(BASE_DURATION_MINUTES)
    expect(after.endsAtSnapshot?.getTime()).toBe(
      start.getTime() + BASE_DURATION_MINUTES * 60_000,
    )
  })

  it('refuses a widen whose tail is taken, and leaves the hold at its old size', async () => {
    const start = futureLocal(14, 12)
    const tail = new Date(start.getTime() + BASE_DURATION_MINUTES * 60_000)

    const created = await hold({ start, addOnIds: [] })

    await db.booking.create({
      data: {
        client: { connect: { id: fx.rivalClientId } },
        professional: { connect: { id: fx.professionalId } },
        proTenant: { connect: { id: fx.tenantId } },
        clientHomeTenant: { connect: { id: fx.tenantId } },
        service: { connect: { id: fx.serviceId } },
        offering: { connect: { id: fx.offeringId } },
        location: { connect: { id: fx.salonLocationId } },
        locationType: ServiceLocationType.SALON,
        locationTimeZone: ZONE,
        scheduledFor: tail,
        status: BookingStatus.ACCEPTED,
        source: BookingSource.REQUESTED,
        totalDurationMinutes: BASE_DURATION_MINUTES,
        bufferMinutes: 0,
        subtotalSnapshot: new Prisma.Decimal('100.00'),
        serviceSubtotalSnapshot: new Prisma.Decimal('100.00'),
        totalAmount: new Prisma.Decimal('100.00'),
      },
      select: { id: true },
    })

    expect(
      await refusalCode(() =>
        updateHoldAddOns({
          holdId: created.hold.id,
          clientId: fx.clientId,
          addOnIds: [fx.addOnId],
        }),
      ),
    ).toBe('TIME_BOOKED')

    // The client keeps the slot they had, at the width they had it.
    const after = await readHold(created.hold.id)
    expect(after.durationMinutesSnapshot).toBe(BASE_DURATION_MINUTES)
    expect(after.endsAtSnapshot?.getTime()).toBe(
      start.getTime() + BASE_DURATION_MINUTES * 60_000,
    )
  })

  it('refuses a widen that runs past the working day', async () => {
    const lastStart = futureLocal(15, 17)

    const created = await hold({ start: lastStart, addOnIds: [] })

    expect(
      await refusalCode(() =>
        updateHoldAddOns({
          holdId: created.hold.id,
          clientId: fx.clientId,
          addOnIds: [fx.addOnId],
        }),
      ),
    ).toBe('OUTSIDE_WORKING_HOURS')

    const after = await readHold(created.hold.id)
    expect(after.durationMinutesSnapshot).toBe(BASE_DURATION_MINUTES)
  })

  it('is a no-op when the size already matches, and does NOT dump the cache', async () => {
    const start = futureLocal(16, 12)

    const created = await hold({ start, addOnIds: [fx.addOnId] })
    cacheVersion.bumpScheduleVersion.mockClear()

    const again = await updateHoldAddOns({
      holdId: created.hold.id,
      clientId: fx.clientId,
      addOnIds: [fx.addOnId],
    })

    expect(again.meta.mutated).toBe(false)
    expect(again.hold.durationMinutes).toBe(
      BASE_DURATION_MINUTES + ADD_ON_MINUTES,
    )

    // The selection is caller-controlled and re-sent on every page load, so a
    // no-op that still bumped would let a client evict this pro's availability
    // cache at will. Succeeding is not the same as changing something.
    expect(cacheVersion.bumpScheduleVersion).not.toHaveBeenCalled()
  })

  it('bumps the schedule version when it DOES re-size', async () => {
    const start = futureLocal(19, 12)

    const created = await hold({ start, addOnIds: [] })
    cacheVersion.bumpScheduleVersion.mockClear()

    await updateHoldAddOns({
      holdId: created.hold.id,
      clientId: fx.clientId,
      addOnIds: [fx.addOnId],
    })

    // A re-sized hold occupies a different window; a reader still serving the
    // old version would offer the tail this hold now reserves.
    expect(cacheVersion.bumpScheduleVersion).toHaveBeenCalledWith(
      fx.professionalId,
    )
  })

  it('does not bump when the re-size is REFUSED', async () => {
    const lastStart = futureLocal(20, 17)

    const created = await hold({ start: lastStart, addOnIds: [] })
    cacheVersion.bumpScheduleVersion.mockClear()

    await refusalCode(() =>
      updateHoldAddOns({
        holdId: created.hold.id,
        clientId: fx.clientId,
        addOnIds: [fx.addOnId],
      }),
    )

    // Nothing changed, so nothing to invalidate.
    expect(cacheVersion.bumpScheduleVersion).not.toHaveBeenCalled()
  })

  it('refuses another client’s hold', async () => {
    const start = futureLocal(17, 12)

    const created = await hold({ start, addOnIds: [] })

    expect(
      await refusalCode(() =>
        updateHoldAddOns({
          holdId: created.hold.id,
          clientId: fx.rivalClientId,
          addOnIds: [fx.addOnId],
        }),
      ),
    ).toBe('HOLD_FORBIDDEN')
  })

  it('books exactly what the widened hold reserved', async () => {
    const start = futureLocal(18, 12)

    const created = await hold({ start, addOnIds: [] })

    await updateHoldAddOns({
      holdId: created.hold.id,
      clientId: fx.clientId,
      addOnIds: [fx.addOnId],
    })

    const reserved = await readHold(created.hold.id)

    const finalized = await finalizeBookingFromHold({
      clientId: fx.clientId,
      bookingEntryPoint: 'DIRECT_PROFILE',
      holdId: created.hold.id,
      openingId: null,
      addOnIds: [fx.addOnId],
      locationType: ServiceLocationType.SALON,
      source: BookingSource.REQUESTED,
      initialStatus: BookingStatus.PENDING,
      rebookOfBookingId: null,
      offering: {
        id: fx.offeringId,
        professionalId: fx.professionalId,
        serviceId: fx.serviceId,
        offersInSalon: true,
        offersMobile: false,
        salonPriceStartingAt: new Prisma.Decimal('100.00'),
        salonDurationMinutes: BASE_DURATION_MINUTES,
        mobilePriceStartingAt: null,
        mobileDurationMinutes: null,
        professionalTimeZone: ZONE,
      },
    })

    const booking = await db.booking.findUnique({
      where: { id: finalized.booking.id },
      select: { totalDurationMinutes: true },
    })

    // The whole point of the card: the window the client held is the window the
    // booking takes.
    expect(booking?.totalDurationMinutes).toBe(reserved.durationMinutesSnapshot)
    expect(booking?.totalDurationMinutes).toBe(
      BASE_DURATION_MINUTES + ADD_ON_MINUTES,
    )
  })
})

// ── B3 fold-in: the re-size INTERLEAVE, which B1-A shipped but never drove ──
//
// B1-A made a live hold's reserved range mutable, and recorded in §7.8 that the
// concurrency was reasoned about rather than driven. These are that drive.
//
// The card asks for "two clients widening into the same tail at once". That
// shape is not constructible, and finding out why is part of the answer: two
// live holds for one professional cannot overlap (the GIST EXCLUDE forbids it),
// and a widen only ever extends a hold's END — so of any two holds, only the
// earlier one can grow toward the other. Contention over one region always has
// exactly one widener. The races that ARE real are driven instead:
//
//   1. a widen vs a rival HOLD landing on the tail,
//   2. a widen vs a BOOKING landing on the tail,
//   3. two concurrent widens of the SAME hold (a double-tapped add-on toggle,
//      or two devices on one account — the realistic "two at once").
//
// In every case the professional's schedule lock serializes the two, so the
// assertion is on the invariant rather than on who wins: exactly one claims the
// tail, the loser is refused cleanly, and — the case B1-A flagged explicitly —
// a widen that LOSES leaves its hold alive at its OLD width rather than
// dropping it.
describe('re-sizing a live hold under concurrency (real DB)', () => {
  /** The settled outcomes, split into fulfilled/rejected. */
  function split(results: PromiseSettledResult<unknown>[]) {
    return {
      fulfilled: results.filter((r) => r.status === 'fulfilled'),
      rejected: results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      ),
    }
  }

  /** The booking code the single loser was refused with. */
  function soleRejectionCode(rejected: PromiseRejectedResult[]): string {
    const first = rejected[0]
    if (!first) throw new Error('Expected exactly one rejection, got none')
    const error: unknown = first.reason
    if (isBookingError(error)) return error.code
    throw error
  }

  it('a widen and a rival hold cannot both take the tail', async () => {
    const start = futureLocal(21, 12)
    const tail = new Date(start.getTime() + BASE_DURATION_MINUTES * 60_000)

    const created = await hold({ start, addOnIds: [] })

    const results = await Promise.allSettled([
      updateHoldAddOns({
        holdId: created.hold.id,
        clientId: fx.clientId,
        addOnIds: [fx.addOnId],
      }),
      hold({ start: tail, addOnIds: [], clientId: fx.rivalClientId }),
    ])

    const { fulfilled, rejected } = split(results)
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(soleRejectionCode(rejected)).toBe('TIME_HELD')

    // Which side wins is decided by lock arrival order and is NOT pinned here:
    // both orderings are legal, so the assertions are on the invariant. (Today
    // the widen reaches the lock first in this pairing and wins; the opposite
    // ordering is exercised for real by the booking race below.)
    const widenWon = results[0].status === 'fulfilled'
    const after = await readHold(created.hold.id)

    if (widenWon) {
      expect(after.durationMinutesSnapshot).toBe(
        BASE_DURATION_MINUTES + ADD_ON_MINUTES,
      )
    } else {
      // The loser was the WIDEN. Its transaction rolled back, and a rollback
      // must leave the client holding what they already had — not nothing.
      expect(after.durationMinutesSnapshot).toBe(BASE_DURATION_MINUTES)
      expect(after.endsAtSnapshot?.getTime()).toBe(
        start.getTime() + BASE_DURATION_MINUTES * 60_000,
      )
    }

    // Whoever won, the two reservations never coexist over the same minutes.
    const holds = await db.bookingHold.findMany({
      where: { professionalId: fx.professionalId },
      select: { scheduledFor: true, endsAtSnapshot: true },
      orderBy: { scheduledFor: 'asc' },
    })
    for (let i = 1; i < holds.length; i += 1) {
      const previous = holds[i - 1]
      const current = holds[i]
      if (!previous || !current) throw new Error('Unexpected sparse hold list')
      expect(
        (previous.endsAtSnapshot?.getTime() ?? 0) <=
          current.scheduledFor.getTime(),
      ).toBe(true)
    }
  })

  it('a widen and a booking cannot both take the tail', async () => {
    const start = futureLocal(22, 12)
    const tail = new Date(start.getTime() + BASE_DURATION_MINUTES * 60_000)

    const created = await hold({ start, addOnIds: [] })
    const beforeWiden = await readHold(created.hold.id)

    const results = await Promise.allSettled([
      updateHoldAddOns({
        holdId: created.hold.id,
        clientId: fx.clientId,
        addOnIds: [fx.addOnId],
      }),
      createProBooking({
        professionalId: fx.professionalId,
        actorUserId: fx.proUserId,
        overrideReason: null,
        clientId: fx.rivalClientId,
        offeringId: fx.offeringId,
        locationId: fx.salonLocationId,
        locationType: ServiceLocationType.SALON,
        scheduledFor: tail,
        clientAddressId: null,
        internalNotes: null,
        requestedBufferMinutes: null,
        requestedTotalDurationMinutes: null,
        allowOutsideWorkingHours: false,
        allowShortNotice: false,
        allowFarFuture: false,
      }),
    ])

    const { fulfilled, rejected } = split(results)
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)

    const widenWon = results[0].status === 'fulfilled'
    const after = await readHold(created.hold.id)

    if (widenWon) {
      // The pro's walk-in is refused because the widened hold now covers it.
      expect(soleRejectionCode(rejected)).toBe('TIME_HELD')
      expect(after.durationMinutesSnapshot).toBe(
        BASE_DURATION_MINUTES + ADD_ON_MINUTES,
      )
      await expect(
        db.booking.count({ where: { professionalId: fx.professionalId } }),
      ).resolves.toBe(0)
    } else {
      // ⚠️ THE case B1-A called out: the loser is the WIDEN, refused by a
      // booking that reached the lock first. Its transaction rolls back, and
      // the rollback must leave the hold ALIVE at its old width — losing the
      // add-on must never cost the client the slot itself. This is the branch
      // this pairing takes today, so the rollback is genuinely driven and not
      // merely reasoned about (B1-A §7.8).
      expect(soleRejectionCode(rejected)).toBe('TIME_BOOKED')
      expect(after.durationMinutesSnapshot).toBe(BASE_DURATION_MINUTES)
      expect(after.endsAtSnapshot?.getTime()).toBe(
        start.getTime() + BASE_DURATION_MINUTES * 60_000,
      )
      expect(after.expiresAt.getTime()).toBe(beforeWiden.expiresAt.getTime())
      await expect(
        db.booking.count({ where: { professionalId: fx.professionalId } }),
      ).resolves.toBe(1)
    }
  })

  it('two concurrent widens of the SAME hold converge, and neither corrupts it', async () => {
    const start = futureLocal(23, 12)

    const created = await hold({ start, addOnIds: [] })

    // The realistic shape: one client, one hold, the add-on tapped twice before
    // the first PATCH returns.
    const results = await Promise.allSettled([
      updateHoldAddOns({
        holdId: created.hold.id,
        clientId: fx.clientId,
        addOnIds: [fx.addOnId],
      }),
      updateHoldAddOns({
        holdId: created.hold.id,
        clientId: fx.clientId,
        addOnIds: [fx.addOnId],
      }),
    ])

    // Both are the same request, so both must succeed — the second is a no-op
    // rather than a self-collision against the hold it is re-sizing.
    const { fulfilled } = split(results)
    expect(fulfilled).toHaveLength(2)

    const after = await readHold(created.hold.id)
    expect(after.durationMinutesSnapshot).toBe(
      BASE_DURATION_MINUTES + ADD_ON_MINUTES,
    )
    expect(after.endsAtSnapshot?.getTime()).toBe(
      start.getTime() + (BASE_DURATION_MINUTES + ADD_ON_MINUTES) * 60_000,
    )

    await expect(
      db.bookingHold.count({ where: { professionalId: fx.professionalId } }),
    ).resolves.toBe(1)
  })
})
