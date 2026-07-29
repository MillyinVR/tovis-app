// tests/integration/pro-calendar-all-locations.test.ts
//
// K3 — does the pro calendar show the time the pro actually does not have?
//
// 🔴 The audit this step exists for: `Booking_no_active_professional_overlap`
// excludes on `professionalId` ALONE. There is no location term in it, so the
// database treats a pro as ONE resource — but the calendar feed filtered to one
// `locationId`, and so rendered empty space that a job at another location
// already owned. Same for B5's live checkout HOLDS, whose own constraint is
// equally location-blind.
//
// This suite drives the REAL route against a REAL Postgres and ties the two
// halves together: the database is made to REFUSE a cross-location overlap, and
// the feed is then required to contain the very row that caused the refusal.
// A unit test with a mocked client could not prove either half — the constraint
// only exists in the database, and the point of the fix is what the query
// returns from it.
//
// Run with: pnpm test:integration
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  BookingStatus,
  Prisma,
  PrismaClient,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
} from '@prisma/client'

import { BOOKING_OVERLAP_CONSTRAINT_NAME } from '@/lib/booking/constants'
import { isRecord } from '@/lib/guards'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with: pnpm test:integration')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const TAG = `cal_all_loc_${Date.now()}`
const ZONE = 'America/Los_Angeles'

// The route's `@/app/api/_utils` barrel pulls in the session reader at module
// load, which refuses to load without this. No JWT is ever minted here — the
// viewer comes from the `requirePro` mock below.
vi.hoisted(() => {
  process.env.JWT_SECRET ||= 'k3-integration-secret-not-used-for-signing'
})

// Who the route sees. The suite never mints a JWT; the viewer comes from here.
const authState = vi.hoisted(() => ({ professionalId: null as string | null }))

vi.mock('@/app/api/_utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/api/_utils')>()

  return {
    ...actual,
    requirePro: async () =>
      authState.professionalId
        ? {
            ok: true,
            user: null,
            userId: `${TAG}_user`,
            professionalId: authState.professionalId,
            proId: authState.professionalId,
          }
        : { ok: false, res: actual.jsonFail(401, 'Sign in to continue.') },
  }
})

// Imported AFTER the mock so the route's own `@/app/api/_utils` binding is the
// mocked one.
const { GET: calendarGET } = await import('@/app/api/v1/pro/calendar/route')

type Fixtures = {
  tenantId: string
  proUserId: string
  professionalId: string
  clientId: string
  serviceId: string
  categoryId: string
  /** Primary, and what a pre-K3 feed would have shown on its own. */
  salonLocationId: string
  /** The location whose occupancy the old feed hid. */
  mobileLocationId: string
  offeringId: string
}

let fx: Fixtures

/** A future UTC instant, whole hours, so the range window is easy to reason about. */
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

const SALON_START = futureUtc(7, 17)
const MOBILE_START = futureUtc(7, 19)
const HOLD_START = futureUtc(7, 21)
const BLOCK_START = futureUtc(7, 23)

type CalendarEventRow = {
  id: string
  kind: string
  locationId: string | null
}

type CalendarBody = {
  scope: string
  events: CalendarEventRow[]
  location: { id: string } | null
}

function readCalendarBody(payload: unknown): CalendarBody {
  if (!isRecord(payload)) {
    throw new Error('Calendar response was not an object.')
  }

  const events = Array.isArray(payload.events) ? payload.events : []

  return {
    scope: String(payload.scope ?? ''),
    location: isRecord(payload.location)
      ? { id: String(payload.location.id) }
      : null,
    events: events.filter(isRecord).map((event) => ({
      id: String(event.id),
      kind: String(event.kind),
      locationId:
        typeof event.locationId === 'string' ? event.locationId : null,
    })),
  }
}

/**
 * Drives the route the way the browser does. The window spans the whole
 * fixture day so nothing is excluded for being out of range.
 */
async function fetchCalendar(scope: string): Promise<CalendarBody> {
  const from = futureUtc(7, 0)
  const to = futureUtc(8, 0)

  const url = new URL('https://tovis.test/api/v1/pro/calendar')
  url.searchParams.set('from', from.toISOString())
  url.searchParams.set('to', to.toISOString())
  url.searchParams.set('scope', scope)

  const response = await calendarGET(new Request(url))

  expect(response.status).toBe(200)

  return readCalendarBody(await response.json())
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
      firstName: 'Two',
      lastName: 'Places',
      businessName: 'Two Places Studio',
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
    bufferMinutes: 0,
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
    salonLocationId: salon.id,
    mobileLocationId: mobile.id,
    offeringId: offering.id,
  }

  authState.professionalId = professional.id

  // The pro's day, as the DATABASE sees it: one salon job, one mobile job, a
  // live client checkout at the mobile base, and personal time blocked there.
  await createBooking({
    locationId: fx.salonLocationId,
    locationType: ServiceLocationType.SALON,
    scheduledFor: SALON_START,
  })

  await createBooking({
    locationId: fx.mobileLocationId,
    locationType: ServiceLocationType.MOBILE,
    scheduledFor: MOBILE_START,
  })

  await db.bookingHold.create({
    data: {
      offeringId: fx.offeringId,
      professionalId: fx.professionalId,
      clientId: fx.clientId,
      scheduledFor: HOLD_START,
      // Well beyond the run: the feed shows only holds that are still live.
      expiresAt: new Date(Date.now() + 60 * 60_000),
      locationId: fx.mobileLocationId,
      locationType: ServiceLocationType.MOBILE,
      locationTimeZone: ZONE,
      durationMinutesSnapshot: 60,
      bufferMinutesSnapshot: 0,
    },
  })

  await db.calendarBlock.create({
    data: {
      professionalId: fx.professionalId,
      locationId: fx.mobileLocationId,
      startsAt: BLOCK_START,
      endsAt: new Date(BLOCK_START.getTime() + 60 * 60_000),
      note: `${TAG} mobile block`,
    },
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
    await db.professionalLocation.deleteMany({ where: pro })
    await db.professionalPaymentSettings.deleteMany({ where: pro })
    await db.service.deleteMany({ where: { id: fx.serviceId } })
    await db.serviceCategory.deleteMany({ where: { id: fx.categoryId } })
    await db.clientProfile.deleteMany({ where: { id: fx.clientId } })
    await db.professionalProfile.deleteMany({ where: { id: fx.professionalId } })
    await db.user.deleteMany({
      where: {
        email: {
          in: [`${TAG}_pro@example.com`, `${TAG}_client@example.com`],
        },
      },
    })
  }

  await db.$disconnect()
})

describe('pro calendar — all-locations scope (real DB)', () => {
  it('refuses a cross-location overlap at the database, with no location term', async () => {
    // The premise of the whole step, asserted rather than assumed: the pro is
    // ONE resource. A salon booking on top of the mobile job is rejected even
    // though the two are at different locations.
    await expect(
      createBooking({
        locationId: fx.salonLocationId,
        locationType: ServiceLocationType.SALON,
        scheduledFor: new Date(MOBILE_START.getTime() + 15 * 60_000),
      }),
    ).rejects.toThrow(BOOKING_OVERLAP_CONSTRAINT_NAME)
  })

  it('returns every location the constraint blocks on, including a cross-location hold', async () => {
    const body = await fetchCalendar('ALL')

    expect(body.scope).toBe('ALL')

    const bookingLocationIds = body.events
      .filter((event) => event.kind === 'BOOKING')
      .map((event) => event.locationId)

    // A mobile job and a salon job on the same day, on one grid.
    expect(bookingLocationIds).toContain(fx.salonLocationId)
    expect(bookingLocationIds).toContain(fx.mobileLocationId)

    // B5's hold, at the OTHER location. Left filtered, this is occupancy the
    // write path already refuses to book over and the pro cannot see.
    const holds = body.events.filter((event) => event.kind === 'HOLD')
    expect(holds.map((hold) => hold.locationId)).toEqual([fx.mobileLocationId])

    // Blocked personal time pinned to the other location.
    const blocks = body.events.filter((event) => event.kind === 'BLOCK')
    expect(blocks.map((block) => block.locationId)).toEqual([
      fx.mobileLocationId,
    ])
  })

  it('still filters to one location on request — which is what used to hide the rest', async () => {
    const body = await fetchCalendar(fx.salonLocationId)

    expect(body.scope).toBe('LOCATION')
    expect(body.location?.id).toBe(fx.salonLocationId)

    const locationIds = body.events.map((event) => event.locationId)

    expect(locationIds).toContain(fx.salonLocationId)

    // Everything the pro genuinely does not have free, absent — exactly the
    // day the feed used to show unconditionally.
    expect(locationIds).not.toContain(fx.mobileLocationId)
    expect(body.events.filter((event) => event.kind === 'HOLD')).toEqual([])
    expect(body.events.filter((event) => event.kind === 'BLOCK')).toEqual([])
  })

  it('defaults to the requested location when no scope is sent, so an unchanged client is unaffected', async () => {
    // The native client sends `locationId` (or nothing) and gets K3's widening
    // in its own step. Until then its feed must be byte-for-byte what it was.
    const url = new URL('https://tovis.test/api/v1/pro/calendar')
    url.searchParams.set('from', futureUtc(7, 0).toISOString())
    url.searchParams.set('to', futureUtc(8, 0).toISOString())
    url.searchParams.set('locationId', fx.salonLocationId)

    const response = await calendarGET(new Request(url))
    expect(response.status).toBe(200)

    const body = readCalendarBody(await response.json())

    expect(body.scope).toBe('LOCATION')
    expect(body.events.map((event) => event.locationId)).not.toContain(
      fx.mobileLocationId,
    )
  })
})
