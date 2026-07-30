// tests/integration/global-calendar-block.test.ts
//
// Global (`locationId: null`) calendar blocks — the WRITE paths.
//
// `CalendarBlock.locationId` is nullable and the schema says what null means:
// "null = blocks all locations (rare, but useful)". Every READER already honours
// it (`buildCalendarBlockConflictWhere` / `buildCalendarBlockWindowWhere` fold a
// null-location block into a location-scoped query, and the K3 calendar feed
// ORs it in). Only the two write paths refused it, in two ways:
//
//   1. `POST /api/v1/pro/calendar/blocked` returned 400 LOCATION_ID_REQUIRED —
//      so the web modal's "Block all locations" checkbox was a guaranteed error.
//   2. 🔴 `PATCH /api/v1/pro/calendar/blocked/[id]` refused any block whose
//      location had gone away, which made a LOCATION DELETE strand blocks as
//      permanently uneditable. Both halves of the delete stranded them:
//        - a location with no bookings is HARD-deleted, and `onDelete: SetNull`
//          turns its blocks into `locationId: null` → 400 BLOCK_LOCATION_MISSING
//        - a location with bookings is ARCHIVED (`isBookable: false`), and the
//          route's `isBookable: true` lookup then missed it → 404
//          BLOCK_LOCATION_NOT_FOUND
//      Either way the block kept occupying time and could never be moved again;
//      DELETE has no such guard, so delete-and-recreate was the only escape.
//
// This suite drives the REAL routes against a REAL Postgres, because both
// defects live in the interaction between an FK action (`SetNull`), the
// locations DELETE route's archive-vs-delete branch, and the block routes'
// location lookup. A mocked client proves none of that.
//
// Run with: pnpm test:integration
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import {
  BookingStatus,
  Prisma,
  PrismaClient,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
} from '@prisma/client'

import { isRecord } from '@/lib/guards'
import {
  getTimeRangeConflict,
  loadBusyIntervalsForWindow,
} from '@/lib/booking/conflictQueries'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with: pnpm test:integration')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const TAG = `glob_block_${Date.now()}`
const ZONE = 'America/Los_Angeles'

/** The two buffers the MAX rule picks between. Mobile's is the answer. */
const SALON_BUFFER_MINUTES = 10
const MOBILE_BUFFER_MINUTES = 30

// The routes' `@/app/api/_utils` barrel pulls in the session reader at module
// load, which refuses to load without this. No JWT is ever minted here — the
// viewer comes from the `requirePro` mock below.
vi.hoisted(() => {
  process.env.JWT_SECRET ||= 'global-block-integration-secret-not-for-signing'
})

// Who the routes see. Mocked at the LEAF module rather than the `_utils` barrel:
// the blocked routes import `requirePro` through the barrel but
// `app/api/v1/pro/locations/[id]/route.ts` imports it directly, and this suite
// drives both.
const authState = vi.hoisted(() => ({
  professionalId: null as string | null,
  userId: null as string | null,
}))

vi.mock('@/app/api/_utils/auth/requirePro', () => ({
  requirePro: async () => ({
    ok: true,
    user: null,
    userId: authState.userId,
    professionalId: authState.professionalId,
    proId: authState.professionalId,
  }),
}))

// Imported AFTER the mock so each route's own `requirePro` binding is the mock.
const { POST: blockPOST } = await import(
  '@/app/api/v1/pro/calendar/blocked/route'
)
const { PATCH: blockPATCH, GET: blockGET } = await import(
  '@/app/api/v1/pro/calendar/blocked/[id]/route'
)
const { DELETE: locationDELETE } = await import(
  '@/app/api/v1/pro/locations/[id]/route'
)
const { GET: calendarGET } = await import('@/app/api/v1/pro/calendar/route')
const { resolveBlockScope } = await import(
  '@/app/api/v1/pro/calendar/blocked/_blockScope'
)

type Fixtures = {
  tenantId: string
  proUserId: string
  professionalId: string
  clientId: string
  serviceId: string
  categoryId: string
  offeringId: string
  /** Primary, bookable, buffer 10. */
  salonLocationId: string
  /** Bookable, buffer 30 — the MAX the global-block rule must pick. */
  mobileLocationId: string
  /** No references, so DELETE hard-deletes it and SetNulls its blocks. */
  doomedLocationId: string
  /** Has a booking, so DELETE archives it (`isBookable: false`) instead. */
  retiredLocationId: string
  /** A second pro with no locations at all. */
  locationlessUserId: string
  locationlessProfessionalId: string
}

let fx: Fixtures

/** A future UTC instant, whole hours, so the ranges are easy to reason about. */
function futureUtc(daysAhead: number, hourUtc: number): Date {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + daysAhead)
  date.setUTCHours(hourUtc, 0, 0, 0)
  return date
}

function workingHours(): Prisma.InputJsonValue {
  const all = { enabled: true, start: '00:00', end: '23:59' }
  return { mon: all, tue: all, wed: all, thu: all, fri: all, sat: all, sun: all }
}

const HOUR_MS = 60 * 60_000

// One fixture day, one hour per scenario, so nothing overlaps by accident.
const DAY = 14
const GLOBAL_CREATE_START = futureUtc(DAY, 14)
const SALON_BOOKING_START = futureUtc(DAY, 16)
const CROSS_LOCATION_START = futureUtc(DAY, 18)
const DOOMED_BLOCK_START = futureUtc(DAY, 20)
const RETIRED_BLOCK_START = futureUtc(DAY, 22)
// The booking that forces `retired` down the ARCHIVE branch. On its own day so
// it can never collide with the pro-wide booking overlap constraint.
const RETIRED_BOOKING_START = futureUtc(DAY + 3, 12)

type BlockPayload = {
  id: string
  startsAt: string
  endsAt: string
  locationId: string | null
}

type RouteResult<T> = {
  status: number
  code: string | null
  error: string | null
  body: T | null
}

function readBlock(payload: unknown): BlockPayload | null {
  if (!isRecord(payload) || !isRecord(payload.block)) return null

  const block = payload.block

  return {
    id: String(block.id ?? ''),
    startsAt: String(block.startsAt ?? ''),
    endsAt: String(block.endsAt ?? ''),
    locationId:
      typeof block.locationId === 'string' ? block.locationId : null,
  }
}

async function readRouteResult(
  response: Response,
): Promise<RouteResult<BlockPayload>> {
  const payload: unknown = await response.json()

  return {
    status: response.status,
    code:
      isRecord(payload) && typeof payload.code === 'string'
        ? payload.code
        : null,
    error:
      isRecord(payload) && typeof payload.error === 'string'
        ? payload.error
        : null,
    body: readBlock(payload),
  }
}

function blockRequest(body: Record<string, unknown>): Request {
  return new Request('https://tovis.test/api/v1/pro/calendar/blocked', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function postBlock(body: Record<string, unknown>) {
  return readRouteResult(await blockPOST(blockRequest(body)))
}

async function patchBlock(blockId: string, body: Record<string, unknown>) {
  const request = new Request(
    `https://tovis.test/api/v1/pro/calendar/blocked/${blockId}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )

  return readRouteResult(
    await blockPATCH(request, { params: Promise.resolve({ id: blockId }) }),
  )
}

async function getBlock(blockId: string) {
  return readRouteResult(
    await blockGET(
      new Request(
        `https://tovis.test/api/v1/pro/calendar/blocked/${blockId}`,
      ),
      { params: Promise.resolve({ id: blockId }) },
    ),
  )
}

/** Drives the REAL locations DELETE route — archive-vs-delete branch included. */
async function deleteLocation(locationId: string): Promise<number> {
  const response = await locationDELETE(
    new NextRequest(
      `https://tovis.test/api/v1/pro/locations/${locationId}`,
      { method: 'DELETE' },
    ),
    { params: Promise.resolve({ id: locationId }) },
  )

  return response.status
}

type CalendarEventRow = {
  id: string
  kind: string
  locationId: string | null
}

async function fetchCalendarEvents(scope: string): Promise<CalendarEventRow[]> {
  const url = new URL('https://tovis.test/api/v1/pro/calendar')
  url.searchParams.set('from', futureUtc(DAY, 0).toISOString())
  url.searchParams.set('to', futureUtc(DAY + 1, 0).toISOString())
  url.searchParams.set('scope', scope)

  const response = await calendarGET(new Request(url))
  expect(response.status).toBe(200)

  const payload: unknown = await response.json()
  const events =
    isRecord(payload) && Array.isArray(payload.events) ? payload.events : []

  return events.filter(isRecord).map((event) => ({
    id: String(event.id ?? ''),
    kind: String(event.kind ?? ''),
    locationId:
      typeof event.locationId === 'string' ? event.locationId : null,
  }))
}

async function createBooking(args: {
  locationId: string
  locationType: ServiceLocationType
  scheduledFor: Date
}): Promise<string> {
  const booking = await db.booking.create({
    data: {
      client: { connect: { id: fx.clientId } },
      professional: { connect: { id: fx.professionalId } },
      proTenant: { connect: { id: fx.tenantId } },
      clientHomeTenant: { connect: { id: fx.tenantId } },
      service: { connect: { id: fx.serviceId } },
      offering: { connect: { id: fx.offeringId } },
      location: { connect: { id: args.locationId } },
      status: BookingStatus.ACCEPTED,
      scheduledFor: args.scheduledFor,
      totalDurationMinutes: 60,
      bufferMinutes: 0,
      locationType: args.locationType,
      locationTimeZone: ZONE,
      subtotalSnapshot: new Prisma.Decimal('100.00'),
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
      firstName: 'Every',
      lastName: 'Location',
      businessName: 'Everywhere Studio',
      timeZone: ZONE,
    },
    select: { id: true },
  })

  const locationlessUser = await db.user.create({
    data: {
      email: `${TAG}_nowhere@example.com`,
      password: 'x',
      role: Role.PRO,
    },
    select: { id: true },
  })

  const locationlessPro = await db.professionalProfile.create({
    data: {
      userId: locationlessUser.id,
      homeTenantId: tenant.id,
      firstName: 'No',
      lastName: 'Where',
      businessName: 'Nowhere Studio',
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
      firstName: 'Cross',
      lastName: 'Location',
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
      allowMobile: true,
    },
    select: { id: true },
  })

  const locationDefaults = {
    professionalId: professional.id,
    isBookable: true,
    countryCode: 'US',
    timeZone: ZONE,
    workingHours: workingHours(),
    stepMinutes: 15,
    advanceNoticeMinutes: 0,
    maxDaysAhead: 365,
  }

  const salon = await db.professionalLocation.create({
    data: {
      ...locationDefaults,
      type: ProfessionalLocationType.SALON,
      name: 'Main Salon',
      isPrimary: true,
      bufferMinutes: SALON_BUFFER_MINUTES,
      formattedAddress: '123 Salon St, San Diego, CA 92101',
      addressLine1: '123 Salon St',
      city: 'San Diego',
      state: 'CA',
      postalCode: '92101',
      lat: new Prisma.Decimal('32.7157000'),
      lng: new Prisma.Decimal('-117.1611000'),
    },
    select: { id: true },
  })

  const mobile = await db.professionalLocation.create({
    data: {
      ...locationDefaults,
      type: ProfessionalLocationType.MOBILE_BASE,
      name: 'Mobile Base',
      isPrimary: false,
      bufferMinutes: MOBILE_BUFFER_MINUTES,
      formattedAddress: '900 Base Ave, San Diego, CA 92101',
      addressLine1: '900 Base Ave',
      city: 'San Diego',
      state: 'CA',
      postalCode: '92101',
      lat: new Prisma.Decimal('32.7200000'),
      lng: new Prisma.Decimal('-117.1700000'),
    },
    select: { id: true },
  })

  // Both of these carry a buffer BELOW the mobile base's, so removing them
  // cannot move the MAX the global-block rule reports.
  const doomed = await db.professionalLocation.create({
    data: {
      ...locationDefaults,
      type: ProfessionalLocationType.SALON,
      name: 'Chair Sublet',
      isPrimary: false,
      bufferMinutes: 5,
      formattedAddress: '17 Sublet Row, San Diego, CA 92101',
      addressLine1: '17 Sublet Row',
      city: 'San Diego',
      state: 'CA',
      postalCode: '92101',
      lat: new Prisma.Decimal('32.7300000'),
      lng: new Prisma.Decimal('-117.1800000'),
    },
    select: { id: true },
  })

  const retired = await db.professionalLocation.create({
    data: {
      ...locationDefaults,
      type: ProfessionalLocationType.SALON,
      name: 'Old Studio',
      isPrimary: false,
      bufferMinutes: 20,
      formattedAddress: '4 Old Studio Way, San Diego, CA 92101',
      addressLine1: '4 Old Studio Way',
      city: 'San Diego',
      state: 'CA',
      postalCode: '92101',
      lat: new Prisma.Decimal('32.7400000'),
      lng: new Prisma.Decimal('-117.1900000'),
    },
    select: { id: true },
  })

  const offering = await db.professionalServiceOffering.create({
    data: {
      professionalId: professional.id,
      serviceId: service.id,
      isActive: true,
      offersInSalon: true,
      offersMobile: true,
      salonPriceStartingAt: new Prisma.Decimal('100.00'),
      salonDurationMinutes: 60,
      mobilePriceStartingAt: new Prisma.Decimal('120.00'),
      mobileDurationMinutes: 60,
    },
    select: { id: true },
  })

  fx = {
    tenantId: tenant.id,
    proUserId: proUser.id,
    professionalId: professional.id,
    clientId: client.id,
    serviceId: service.id,
    categoryId: category.id,
    offeringId: offering.id,
    salonLocationId: salon.id,
    mobileLocationId: mobile.id,
    doomedLocationId: doomed.id,
    retiredLocationId: retired.id,
    locationlessUserId: locationlessUser.id,
    locationlessProfessionalId: locationlessPro.id,
  }

  authState.professionalId = professional.id
  authState.userId = proUser.id

  // The booking that sends `retired` down the ARCHIVE branch of DELETE.
  await createBooking({
    locationId: fx.retiredLocationId,
    locationType: ServiceLocationType.SALON,
    scheduledFor: RETIRED_BOOKING_START,
  })
})

afterAll(async () => {
  if (fx) {
    const pro = { professionalId: fx.professionalId }

    await db.calendarBlock.deleteMany({ where: pro })
    await db.bookingServiceItem.deleteMany({ where: { booking: pro } })
    await db.bookingHold.deleteMany({ where: pro })
    await db.booking.deleteMany({ where: pro })
    await db.professionalServiceOffering.deleteMany({ where: pro })
    await db.professionalSearchIndex.deleteMany({ where: pro })
    await db.professionalLocation.deleteMany({ where: pro })
    await db.professionalPaymentSettings.deleteMany({ where: pro })
    await db.service.deleteMany({ where: { id: fx.serviceId } })
    await db.serviceCategory.deleteMany({ where: { id: fx.categoryId } })
    await db.clientProfile.deleteMany({ where: { id: fx.clientId } })
    await db.professionalProfile.deleteMany({
      where: {
        id: { in: [fx.professionalId, fx.locationlessProfessionalId] },
      },
    })
    await db.user.deleteMany({
      where: {
        email: {
          in: [
            `${TAG}_pro@example.com`,
            `${TAG}_client@example.com`,
            `${TAG}_nowhere@example.com`,
          ],
        },
      },
    })
  }

  await db.$disconnect()
})

describe('global calendar blocks — create (real DB)', () => {
  it('accepts the modal’s "Block all locations" payload', async () => {
    const result = await postBlock({
      startsAt: GLOBAL_CREATE_START.toISOString(),
      endsAt: new Date(GLOBAL_CREATE_START.getTime() + HOUR_MS).toISOString(),
      note: `${TAG} everywhere`,
      locationId: null,
    })

    expect({ status: result.status, code: result.code }).toEqual({
      status: 201,
      code: null,
    })
    expect(result.body?.locationId).toBeNull()

    const stored = await db.calendarBlock.findUnique({
      where: { id: result.body?.id ?? '' },
      select: { locationId: true },
    })

    expect(stored?.locationId).toBeNull()
  })

  it('refuses an unscoped block from a pro with no bookable location', async () => {
    // The existence guard that replaces BLOCK_LOCATION_NOT_FOUND: with no
    // location to name, "this location is yours and bookable" becomes "you have
    // a bookable location at all".
    authState.professionalId = fx.locationlessProfessionalId
    authState.userId = fx.locationlessUserId

    try {
      const result = await postBlock({
        startsAt: futureUtc(DAY + 1, 14).toISOString(),
        endsAt: futureUtc(DAY + 1, 15).toISOString(),
        locationId: null,
      })

      expect({ status: result.status, code: result.code }).toEqual({
        status: 409,
        code: 'NO_BOOKABLE_LOCATION',
      })

      const created = await db.calendarBlock.count({
        where: { professionalId: fx.locationlessProfessionalId },
      })

      expect(created).toBe(0)
    } finally {
      authState.professionalId = fx.professionalId
      authState.userId = fx.proUserId
    }
  })

  it('still refuses a locationId that is not this pro’s', async () => {
    const result = await postBlock({
      startsAt: futureUtc(DAY + 1, 16).toISOString(),
      endsAt: futureUtc(DAY + 1, 17).toISOString(),
      locationId: 'not-a-real-location',
    })

    expect({ status: result.status, code: result.code }).toEqual({
      status: 404,
      code: 'BLOCK_LOCATION_NOT_FOUND',
    })
  })
})

describe('global calendar blocks — conflicts in both directions (real DB)', () => {
  it('conflicts with a booking at any location — book, then block', async () => {
    await createBooking({
      locationId: fx.salonLocationId,
      locationType: ServiceLocationType.SALON,
      scheduledFor: SALON_BOOKING_START,
    })

    const result = await postBlock({
      startsAt: SALON_BOOKING_START.toISOString(),
      endsAt: new Date(SALON_BOOKING_START.getTime() + HOUR_MS).toISOString(),
      locationId: null,
    })

    expect(result.status).toBe(409)
    expect(result.code).toBe('TIME_BOOKED')
  })

  it('conflicts with a booking at any location — block, then book', async () => {
    // The block lands unscoped…
    const created = await postBlock({
      startsAt: CROSS_LOCATION_START.toISOString(),
      endsAt: new Date(CROSS_LOCATION_START.getTime() + HOUR_MS).toISOString(),
      note: `${TAG} cross location`,
      locationId: null,
    })

    expect(created.status).toBe(201)

    // …and every booking write path's gate now refuses that window at EVERY
    // location, including the one the block was never scoped to. This is the
    // shared gate itself (`getTimeRangeConflict`), which is what the booking
    // routes and the write boundary call.
    for (const locationId of [fx.salonLocationId, fx.mobileLocationId]) {
      await expect(
        getTimeRangeConflict({
          professionalId: fx.professionalId,
          locationId,
          requestedStart: CROSS_LOCATION_START,
          requestedEnd: new Date(CROSS_LOCATION_START.getTime() + HOUR_MS),
          defaultBufferMinutes: 0,
        }),
      ).resolves.toBe('BLOCKED')
    }

    // And the READ side agrees, so the slot is never offered in the first place.
    for (const locationId of [fx.salonLocationId, fx.mobileLocationId]) {
      const intervals = await loadBusyIntervalsForWindow({
        professionalId: fx.professionalId,
        locationId,
        windowStartUtc: futureUtc(DAY, 0),
        windowEndUtc: futureUtc(DAY + 1, 0),
        defaultBufferMinutes: 0,
      })

      expect(
        intervals.some(
          (interval) =>
            interval.start.getTime() <= CROSS_LOCATION_START.getTime() &&
            interval.end.getTime() > CROSS_LOCATION_START.getTime(),
        ),
      ).toBe(true)
    }
  })

  it('renders on every location’s grid and in each single-location view', async () => {
    const allScope = await fetchCalendarEvents('ALL')
    const salonScope = await fetchCalendarEvents(fx.salonLocationId)
    const mobileScope = await fetchCalendarEvents(fx.mobileLocationId)

    const globalBlocks = (events: CalendarEventRow[]) =>
      events.filter((event) => event.kind === 'BLOCK' && !event.locationId)

    expect(globalBlocks(allScope).length).toBeGreaterThan(0)
    expect(globalBlocks(salonScope).length).toBeGreaterThan(0)
    expect(globalBlocks(mobileScope).length).toBeGreaterThan(0)
  })
})

describe('global calendar blocks — the stranded block (real DB)', () => {
  it('keeps a hard-deleted location’s block editable', async () => {
    const created = await postBlock({
      startsAt: DOOMED_BLOCK_START.toISOString(),
      endsAt: new Date(DOOMED_BLOCK_START.getTime() + HOUR_MS).toISOString(),
      note: `${TAG} sublet`,
      locationId: fx.doomedLocationId,
    })

    expect(created.status).toBe(201)
    const blockId = created.body?.id ?? ''
    expect(blockId).not.toBe('')

    // The pro drops the location. No bookings reference it, so it is really
    // deleted and `onDelete: SetNull` rewrites the block underneath them.
    expect(await deleteLocation(fx.doomedLocationId)).toBe(200)

    const stranded = await db.calendarBlock.findUnique({
      where: { id: blockId },
      select: { locationId: true },
    })

    expect(stranded).not.toBeNull()
    expect(stranded?.locationId).toBeNull()

    // It still occupies the pro's time…
    const stillVisible = await getBlock(blockId)
    expect(stillVisible.status).toBe(200)

    // …and it can still be moved, which is what used to be impossible.
    const movedStart = new Date(DOOMED_BLOCK_START.getTime() + 15 * 60_000)
    const moved = await patchBlock(blockId, {
      startsAt: movedStart.toISOString(),
      endsAt: new Date(movedStart.getTime() + HOUR_MS).toISOString(),
    })

    expect({ status: moved.status, code: moved.code }).toEqual({
      status: 200,
      code: null,
    })
    expect(moved.body?.startsAt).toBe(movedStart.toISOString())
    expect(moved.body?.locationId).toBeNull()
  })

  it('keeps an archived location’s block editable', async () => {
    const created = await postBlock({
      startsAt: RETIRED_BLOCK_START.toISOString(),
      endsAt: new Date(RETIRED_BLOCK_START.getTime() + HOUR_MS).toISOString(),
      note: `${TAG} old studio`,
      locationId: fx.retiredLocationId,
    })

    expect(created.status).toBe(201)
    const blockId = created.body?.id ?? ''
    expect(blockId).not.toBe('')

    // This location anchors a booking, so DELETE takes the ARCHIVE branch: the
    // row survives with `isBookable: false`, and the block keeps its locationId.
    expect(await deleteLocation(fx.retiredLocationId)).toBe(200)

    const archived = await db.professionalLocation.findUnique({
      where: { id: fx.retiredLocationId },
      select: { archivedAt: true, isBookable: true },
    })

    expect(archived?.isBookable).toBe(false)
    expect(archived?.archivedAt).not.toBeNull()

    const stranded = await db.calendarBlock.findUnique({
      where: { id: blockId },
      select: { locationId: true },
    })

    expect(stranded?.locationId).toBe(fx.retiredLocationId)

    // The other half of the same defect: a location that is merely no longer
    // bookable must not freeze its blocks either.
    const movedStart = new Date(RETIRED_BLOCK_START.getTime() + 15 * 60_000)
    const moved = await patchBlock(blockId, {
      startsAt: movedStart.toISOString(),
      endsAt: new Date(movedStart.getTime() + HOUR_MS).toISOString(),
    })

    expect({ status: moved.status, code: moved.code }).toEqual({
      status: 200,
      code: null,
    })
    expect(moved.body?.startsAt).toBe(movedStart.toISOString())
  })
})

describe('global calendar blocks — re-scoping an existing block (real DB)', () => {
  // The pro's way out of a stranded (or simply mis-scoped) block: move it,
  // rather than delete-and-recreate. Authorized like a create.
  //
  // Every block here carries the RS_NOTE prefix and gets its OWN hour: these
  // tests deliberately create colliding windows, so a leftover row would make
  // the NEXT test fail for the wrong reason.
  const RS_NOTE = `${TAG} rs`

  afterEach(async () => {
    await db.calendarBlock.deleteMany({
      where: { professionalId: fx.professionalId, note: { startsWith: RS_NOTE } },
    })
  })

  async function createBlockAt(args: {
    hourUtc: number
    locationId: string
    label: string
  }): Promise<{ id: string; start: Date }> {
    const start = futureUtc(DAY + 6, args.hourUtc)

    const created = await postBlock({
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + HOUR_MS).toISOString(),
      note: `${RS_NOTE} ${args.label}`,
      locationId: args.locationId,
    })

    expect(created.status).toBe(201)

    return { id: created.body?.id ?? '', start }
  }

  it('moves a block to another of the pro’s locations', async () => {
    const block = await createBlockAt({
      hourUtc: 8,
      locationId: fx.salonLocationId,
      label: 'move',
    })

    const moved = await patchBlock(block.id, {
      locationId: fx.mobileLocationId,
    })

    expect({ status: moved.status, code: moved.code }).toEqual({
      status: 200,
      code: null,
    })
    expect(moved.body?.locationId).toBe(fx.mobileLocationId)

    // The stored row is the truth, not just the response.
    const stored = await db.calendarBlock.findUnique({
      where: { id: block.id },
      select: { locationId: true },
    })
    expect(stored?.locationId).toBe(fx.mobileLocationId)
  })

  it('widens a block to every location on an explicit null', async () => {
    const block = await createBlockAt({
      hourUtc: 10,
      locationId: fx.salonLocationId,
      label: 'widen',
    })

    const widened = await patchBlock(block.id, { locationId: null })

    expect(widened.status).toBe(200)
    expect(widened.body?.locationId).toBeNull()

    const stored = await db.calendarBlock.findUnique({
      where: { id: block.id },
      select: { locationId: true },
    })
    expect(stored?.locationId).toBeNull()
  })

  it('re-scopes a STRANDED block back to a real location', async () => {
    // The question the card left open, now answered: a block orphaned by a
    // location delete can be given a home again, not just moved in time.
    const throwaway = await db.professionalLocation.create({
      data: {
        professionalId: fx.professionalId,
        type: ProfessionalLocationType.SALON,
        name: 'Rescope Sublet',
        isPrimary: false,
        isBookable: true,
        countryCode: 'US',
        timeZone: ZONE,
        workingHours: workingHours(),
        bufferMinutes: 5,
        stepMinutes: 15,
        advanceNoticeMinutes: 0,
        maxDaysAhead: 365,
        formattedAddress: '31 Rescope Rd, San Diego, CA 92101',
        addressLine1: '31 Rescope Rd',
        city: 'San Diego',
        state: 'CA',
        postalCode: '92101',
      },
      select: { id: true },
    })

    const block = await createBlockAt({
      hourUtc: 12,
      locationId: throwaway.id,
      label: 'stranded',
    })

    expect(await deleteLocation(throwaway.id)).toBe(200)
    expect(
      (
        await db.calendarBlock.findUnique({
          where: { id: block.id },
          select: { locationId: true },
        })
      )?.locationId,
    ).toBeNull()

    const rehomed = await patchBlock(block.id, {
      locationId: fx.salonLocationId,
    })

    expect({ status: rehomed.status, code: rehomed.code }).toEqual({
      status: 200,
      code: null,
    })
    expect(rehomed.body?.locationId).toBe(fx.salonLocationId)
  })

  it('leaves the scope alone when the patch does not name a location', async () => {
    // The silent-widening guard: a plain time edit must not turn a scoped block
    // into a block on every location.
    const block = await createBlockAt({
      hourUtc: 14,
      locationId: fx.salonLocationId,
      label: 'time only',
    })

    const movedStart = new Date(block.start.getTime() + 30 * 60_000)
    const moved = await patchBlock(block.id, {
      startsAt: movedStart.toISOString(),
      endsAt: new Date(movedStart.getTime() + HOUR_MS).toISOString(),
    })

    expect(moved.status).toBe(200)
    expect(moved.body?.locationId).toBe(fx.salonLocationId)
  })

  it('refuses a location that is not this pro’s, and a blank one', async () => {
    const block = await createBlockAt({
      hourUtc: 16,
      locationId: fx.salonLocationId,
      label: 'refusals',
    })

    const foreign = await patchBlock(block.id, { locationId: 'not-this-pros' })
    expect({ status: foreign.status, code: foreign.code }).toEqual({
      status: 404,
      code: 'BLOCK_LOCATION_NOT_FOUND',
    })

    const blank = await patchBlock(block.id, { locationId: '   ' })
    expect({ status: blank.status, code: blank.code }).toEqual({
      status: 400,
      code: 'INVALID_LOCATION_ID',
    })

    // Neither refusal moved anything.
    const stored = await db.calendarBlock.findUnique({
      where: { id: block.id },
      select: { locationId: true },
    })
    expect(stored?.locationId).toBe(fx.salonLocationId)
  })

  it('re-checks conflicts under the NEW scope, not the old one', async () => {
    // A block at the salon and a block at the mobile base can coexist at the same
    // time. Moving one onto the other must be refused — which only happens if the
    // conflict query runs against the TARGET location.
    const start = futureUtc(DAY + 6, 20)
    const end = new Date(start.getTime() + HOUR_MS)

    const atSalon = await postBlock({
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      note: `${RS_NOTE} salon side`,
      locationId: fx.salonLocationId,
    })
    expect(atSalon.status).toBe(201)

    // Same window, other location — allowed, which is the premise of the test.
    const atMobile = await postBlock({
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      note: `${RS_NOTE} mobile side`,
      locationId: fx.mobileLocationId,
    })
    expect(atMobile.status).toBe(201)

    const collide = await patchBlock(atMobile.body?.id ?? '', {
      locationId: fx.salonLocationId,
    })

    expect(collide.status).toBe(409)
    expect(collide.code).toBe('TIME_BLOCKED')

    // Still at its own location, untouched.
    const stored = await db.calendarBlock.findUnique({
      where: { id: atMobile.body?.id ?? '' },
      select: { locationId: true },
    })
    expect(stored?.locationId).toBe(fx.mobileLocationId)
  })
})

describe('global calendar blocks — the buffer an unscoped block uses', () => {
  // The one genuinely open decision on this card, pinned here: an unscoped block
  // has no single location to read `bufferMinutes` from, so it takes the MAX
  // across the pro's bookable locations. See the rationale on `resolveBlockScope`.
  it('takes the MAX bufferMinutes across the pro’s bookable locations', async () => {
    const resolved = await resolveBlockScope({
      tx: db,
      professionalId: fx.professionalId,
      locationId: null,
      mode: 'create',
    })

    expect(resolved).toEqual({
      ok: true,
      defaultBufferMinutes: MOBILE_BUFFER_MINUTES,
    })
  })

  it('takes the named location’s own bufferMinutes when there is one', async () => {
    const resolved = await resolveBlockScope({
      tx: db,
      professionalId: fx.professionalId,
      locationId: fx.salonLocationId,
      mode: 'create',
    })

    expect(resolved).toEqual({
      ok: true,
      defaultBufferMinutes: SALON_BUFFER_MINUTES,
    })
  })

  it('reads an archived location’s buffer when editing, but refuses to create there', async () => {
    // `retired` was archived above: still the block's location, no longer a
    // place a NEW block may be created.
    await expect(
      resolveBlockScope({
        tx: db,
        professionalId: fx.professionalId,
        locationId: fx.retiredLocationId,
        mode: 'edit',
      }),
    ).resolves.toEqual({ ok: true, defaultBufferMinutes: 20 })

    await expect(
      resolveBlockScope({
        tx: db,
        professionalId: fx.professionalId,
        locationId: fx.retiredLocationId,
        mode: 'create',
      }),
    ).resolves.toEqual({ ok: false, code: 'BLOCK_LOCATION_NOT_FOUND' })
  })

  it('never refuses an EDIT for want of a bookable location', async () => {
    // A pro with no bookable location must still be able to move a block they
    // already have — refusing here would re-create the stranding this card is
    // about.
    await expect(
      resolveBlockScope({
        tx: db,
        professionalId: fx.locationlessProfessionalId,
        locationId: null,
        mode: 'edit',
      }),
    ).resolves.toEqual({ ok: true, defaultBufferMinutes: 0 })

    await expect(
      resolveBlockScope({
        tx: db,
        professionalId: fx.locationlessProfessionalId,
        locationId: null,
        mode: 'create',
      }),
    ).resolves.toEqual({ ok: false, code: 'NO_BOOKABLE_LOCATION' })
  })
})
