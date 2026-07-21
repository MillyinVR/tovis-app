// tests/integration/rebook-token-step-grid.test.ts
//
// F4 (docs/design/scheduling-conflict-audit-fix-plan.md): the public aftercare
// rebook link is a CLIENT path that ran through `evaluateProSchedulingDecision`,
// where STEP_MISMATCH is deliberately non-fatal because a PRO may put an
// appointment on any minute of their own calendar. Nothing else snapped the
// requested start (`normalizeToMinute` only drops seconds), so a crafted POST
// to `/api/v1/client/rebook/[token]` could put a client appointment at 10:07 and
// fragment the pro's grid for the rest of the day.
//
// These tests drive the real write boundary against real Postgres and pin the
// distinction the fix turns on — WHO picked the minute:
//
//   1. client-chosen (public link) + off-grid  → refused with STEP_MISMATCH;
//   2. client-chosen, a slot the availability engine emitted → still books;
//   3. PRO-chosen (direct rebook) + off-grid   → still books;
//   4. PRO-chosen (pro create, path #4) + off-grid → still books;
//   5. PRO reschedule (path #5) onto an off-grid minute → still allowed;
//   6. client CONFIRMING a pro-proposed off-grid `rebookedFor` → still books.
//
// (3)-(6) are the discriminating half — one per `enforceStepGrid: false` in the
// write boundary. A refusal test proves almost nothing here (plenty of other
// gates refuse with plenty of other codes), but an over-broad `enforceStepGrid`
// shows up ONLY as a path that should succeed and doesn't.
// (6) in particular is the dead-end this fix had to avoid: the client cannot
// change a minute the pro chose.
//
// Runs against the docker test database like the other integration suites:
//   pnpm test:integration

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  AftercareRebookMode,
  BookingCheckoutStatus,
  BookingServiceItemType,
  BookingStatus,
  Prisma,
  PrismaClient,
  Role,
  ServiceLocationType,
} from '@prisma/client'

import {
  confirmClientAftercareNextAppointment,
  createClientRebookedBookingFromAftercare,
  createProBooking,
  createRebookedBookingFromCompletedBooking,
  updateProBooking,
} from '@/lib/booking/writeBoundary'
import { computeDaySlotsFast } from '@/lib/availability/core/dayComputation'
import { isBookingError } from '@/lib/booking/errors'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error(
    'Missing DATABASE_URL. Run this test with: pnpm test:integration',
  )
}

const db = new PrismaClient({
  datasources: { db: { url: databaseUrl } },
})

const tag = `rebook_step_${Date.now()}_${Math.random()
  .toString(36)
  .slice(2, 8)}`

const DURATION_MINUTES = 60
const BUFFER_MINUTES = 15
const STEP_MINUTES = 15

// The location runs on UTC and opens at 09:00, so a UTC wall minute IS the
// local offset from the window start: :00/:15/:30/:45 are on the grid and :07
// is not. Nothing here depends on a DST-free zone by accident — it is UTC.
const ON_GRID_HOUR_UTC = 14
const ON_GRID_MINUTE_UTC = 30
const OFF_GRID_MINUTE_UTC = 37

let tenantId = ''
let clientId = ''
let proUserId = ''
let professionalId = ''
let locationId = ''
let serviceId = ''
let categoryId = ''
let offeringId = ''
let sourceBookingId = ''
let aftercareId = ''

const seededUserEmails: string[] = []

const openAllWeek = {
  mon: { enabled: true, start: '09:00', end: '18:00' },
  tue: { enabled: true, start: '09:00', end: '18:00' },
  wed: { enabled: true, start: '09:00', end: '18:00' },
  thu: { enabled: true, start: '09:00', end: '18:00' },
  fri: { enabled: true, start: '09:00', end: '18:00' },
  sat: { enabled: true, start: '09:00', end: '18:00' },
  sun: { enabled: true, start: '09:00', end: '18:00' },
}

/** A future instant on a fixed calendar day, at the given UTC wall clock. */
function futureAt(hourUtc: number, minuteUtc: number): Date {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + 30)
  d.setUTCHours(hourUtc, minuteUtc, 0, 0)
  return d
}

beforeAll(async () => {
  const tenant = await db.tenant.create({
    data: { slug: `${tag}-tenant`, name: 'Rebook Step Grid', isActive: true },
    select: { id: true },
  })
  tenantId = tenant.id

  const clientEmail = `${tag}_client@example.com`
  const clientUser = await db.user.create({
    data: { email: clientEmail, password: 'test-password', role: Role.CLIENT },
    select: { id: true },
  })
  seededUserEmails.push(clientEmail)

  const client = await db.clientProfile.create({
    data: {
      userId: clientUser.id,
      firstName: 'Rebook',
      lastName: `StepGrid_${tag}`,
      homeTenantId: tenantId,
    },
    select: { id: true },
  })
  clientId = client.id

  const proEmail = `${tag}_pro@example.com`
  const proUser = await db.user.create({
    data: { email: proEmail, password: 'test-password', role: Role.PRO },
    select: { id: true },
  })
  seededUserEmails.push(proEmail)
  proUserId = proUser.id

  const pro = await db.professionalProfile.create({
    data: {
      userId: proUser.id,
      firstName: 'Pro',
      lastName: 'StepGrid',
      businessName: `${tag} studio`,
      homeTenantId: tenantId,
      timeZone: 'UTC',
    },
    select: { id: true },
  })
  professionalId = pro.id

  const location = await db.professionalLocation.create({
    data: {
      professionalId,
      type: 'SALON',
      name: `${tag} salon`,
      isPrimary: true,
      isBookable: true,
      formattedAddress: '1 Grid St, San Diego, CA 92101',
      // Coordinates are not decoration: without them the pro-readiness gate
      // reports LOCATION_MISSING_GEO → NO_BOOKABLE_LOCATION on createProBooking.
      lat: new Prisma.Decimal('32.7157000'),
      lng: new Prisma.Decimal('-117.1611000'),
      timeZone: 'UTC',
      bufferMinutes: BUFFER_MINUTES,
      stepMinutes: STEP_MINUTES,
      advanceNoticeMinutes: 0,
      maxDaysAhead: 365,
      workingHours: openAllWeek,
    },
    select: { id: true },
  })
  locationId = location.id

  const category = await db.serviceCategory.create({
    data: { name: `${tag} category`, slug: `${tag}-category`, isActive: true },
    select: { id: true },
  })
  categoryId = category.id

  const service = await db.service.create({
    data: {
      name: `${tag} service`,
      categoryId,
      defaultDurationMinutes: DURATION_MINUTES,
      minPrice: new Prisma.Decimal('50.00'),
      isActive: true,
    },
    select: { id: true },
  })
  serviceId = service.id

  const offering = await db.professionalServiceOffering.create({
    data: {
      professionalId,
      serviceId,
      offersInSalon: true,
      offersMobile: false,
      salonDurationMinutes: DURATION_MINUTES,
      salonPriceStartingAt: new Prisma.Decimal('50.00'),
      isActive: true,
    },
    select: { id: true },
  })
  offeringId = offering.id

  // A finished, fully-paid appointment in the past — the only shape
  // assertCanCreateRebookFromSourceBooking accepts for a client rebook.
  const past = new Date()
  past.setUTCDate(past.getUTCDate() - 7)
  past.setUTCHours(14, 0, 0, 0)

  const booking = await db.booking.create({
    data: {
      clientId,
      professionalId,
      serviceId,
      offeringId,
      scheduledFor: past,
      status: BookingStatus.COMPLETED,
      finishedAt: past,
      checkoutStatus: BookingCheckoutStatus.PAID,
      paymentCollectedAt: past,
      locationType: ServiceLocationType.SALON,
      locationId,
      locationTimeZone: 'UTC',
      subtotalSnapshot: new Prisma.Decimal('50.00'),
      totalDurationMinutes: DURATION_MINUTES,
      bufferMinutes: BUFFER_MINUTES,
      proTenantId: tenantId,
      clientHomeTenantId: tenantId,
    },
    select: { id: true },
  })
  sourceBookingId = booking.id

  await db.bookingServiceItem.create({
    data: {
      bookingId: sourceBookingId,
      serviceId,
      offeringId,
      itemType: BookingServiceItemType.BASE,
      priceSnapshot: new Prisma.Decimal('50.00'),
      durationMinutesSnapshot: DURATION_MINUTES,
      sortOrder: 0,
    },
  })

  const aftercare = await db.aftercareSummary.create({
    data: {
      bookingId: sourceBookingId,
      rebookMode: AftercareRebookMode.RECOMMENDED_WINDOW,
      sentToClientAt: new Date(),
    },
    select: { id: true },
  })
  aftercareId = aftercare.id
}, 120_000)

afterAll(async () => {
  await db.aftercareSummary.updateMany({
    where: { id: aftercareId },
    data: { rebookedBookingId: null },
  })
  await db.bookingServiceItem.deleteMany({
    where: { booking: { professionalId } },
  })
  await db.aftercareSummary.deleteMany({ where: { id: aftercareId } })
  await db.booking.deleteMany({ where: { professionalId } })
  await db.professionalServiceOffering.deleteMany({ where: { professionalId } })
  await db.professionalLocation.deleteMany({ where: { id: locationId } })
  await db.professionalProfile.deleteMany({ where: { id: professionalId } })
  await db.clientProfile.deleteMany({ where: { id: clientId } })
  await db.user.deleteMany({ where: { email: { in: seededUserEmails } } })
  await db.service.deleteMany({ where: { categoryId } })
  await db.serviceCategory.deleteMany({ where: { id: categoryId } })
  await db.tenant.deleteMany({ where: { id: tenantId } })
  await db.$disconnect()
}, 120_000)

// Every case starts from "nothing rebooked yet": a surviving rebook would make
// the next create replay it (the existingRebook short-circuit) or refuse with
// FORBIDDEN, and either would pass for the wrong reason.
beforeEach(async () => {
  await db.aftercareSummary.update({
    where: { id: aftercareId },
    data: {
      rebookedBookingId: null,
      rebookMode: AftercareRebookMode.RECOMMENDED_WINDOW,
      rebookedFor: null,
    },
  })

  const rebooks = await db.booking.findMany({
    where: { rebookOfBookingId: sourceBookingId },
    select: { id: true },
  })
  const rebookIds = rebooks.map((row) => row.id)

  if (rebookIds.length > 0) {
    await db.bookingServiceItem.deleteMany({
      where: { bookingId: { in: rebookIds } },
    })
    await db.booking.deleteMany({ where: { id: { in: rebookIds } } })
  }
})

async function clientRebookAt(start: Date): Promise<{ id: string }> {
  const result = await createClientRebookedBookingFromAftercare({
    aftercareId,
    bookingId: sourceBookingId,
    clientId,
    aftercareClientActionTokenId: `${tag}_token`,
    scheduledFor: start,
  })

  return { id: result.booking.id }
}

describe('public rebook token — step grid', () => {
  it('refuses an off-grid start the CLIENT picked, with STEP_MISMATCH', async () => {
    const offGrid = futureAt(ON_GRID_HOUR_UTC, OFF_GRID_MINUTE_UTC)

    await expect(clientRebookAt(offGrid)).rejects.toSatisfy((error: unknown) => {
      return isBookingError(error) && error.code === 'STEP_MISMATCH'
    })

    // Nothing half-written: the refusal happens before the row is created.
    const created = await db.booking.count({
      where: { rebookOfBookingId: sourceBookingId },
    })
    expect(created).toBe(0)
  })

  it('books a start that the availability engine itself offered', async () => {
    // The regression that would actually hurt: the new gate refusing a time the
    // RebookCard was allowed to show. So don't hand-pick a "valid" minute —
    // take one straight out of the slot generator behind /availability/day and
    // let the write boundary re-resolve its own context from the database.
    const day = futureAt(ON_GRID_HOUR_UTC, ON_GRID_MINUTE_UTC)
    const computed = await computeDaySlotsFast({
      dateYMD: {
        year: day.getUTCFullYear(),
        month: day.getUTCMonth() + 1,
        day: day.getUTCDate(),
      },
      durationMinutes: DURATION_MINUTES,
      stepMinutes: STEP_MINUTES,
      timeZone: 'UTC',
      workingHours: openAllWeek,
      leadTimeMinutes: 0,
      locationBufferMinutes: BUFFER_MINUTES,
      maxAdvanceDays: 365,
      busy: [],
    })

    if (!computed.ok) throw new Error(`availability failed: ${computed.code}`)
    const offered = computed.slots.map((iso) => new Date(iso))
    expect(offered.length).toBeGreaterThan(0)

    const onGrid = offered.find(
      (slot) => slot.getUTCHours() === ON_GRID_HOUR_UTC,
    )
    if (!onGrid) throw new Error('availability offered no afternoon slot')

    const { id } = await clientRebookAt(onGrid)

    const row = await db.booking.findUniqueOrThrow({
      where: { id },
      select: { scheduledFor: true, rebookOfBookingId: true },
    })
    expect(row.rebookOfBookingId).toBe(sourceBookingId)
    expect(row.scheduledFor.toISOString()).toBe(onGrid.toISOString())
  })

  it('still books an off-grid start the PRO picked (direct rebook)', async () => {
    // The discriminating case: a pro owns every minute of their own calendar.
    // If enforceStepGrid ever leaks onto the pro paths this is the only test
    // that notices — the refusal tests above stay green either way.
    const offGrid = futureAt(ON_GRID_HOUR_UTC, OFF_GRID_MINUTE_UTC)

    const result = await createRebookedBookingFromCompletedBooking({
      bookingId: sourceBookingId,
      professionalId,
      scheduledFor: offGrid,
    })

    const row = await db.booking.findUniqueOrThrow({
      where: { id: result.booking.id },
      select: { scheduledFor: true },
    })
    expect(row.scheduledFor.toISOString()).toBe(offGrid.toISOString())
  })

  it('still books an off-grid start on the pro-create path', async () => {
    // Path #4 in the audit matrix — the pro's most-used create, and the third
    // place `enforceStepGrid: false` is asserted. Calendar tap-to-create hands
    // it whatever minute the pro tapped.
    const offGrid = futureAt(ON_GRID_HOUR_UTC + 2, OFF_GRID_MINUTE_UTC)

    const result = await createProBooking({
      professionalId,
      actorUserId: proUserId,
      clientId,
      offeringId,
      locationId,
      locationType: ServiceLocationType.SALON,
      scheduledFor: offGrid,
      clientAddressId: null,
      internalNotes: null,
      overrideReason: null,
      requestedBufferMinutes: null,
      requestedTotalDurationMinutes: null,
      allowOutsideWorkingHours: false,
      allowShortNotice: false,
      allowFarFuture: false,
    })

    const row = await db.booking.findUniqueOrThrow({
      where: { id: result.booking.id },
      select: { scheduledFor: true },
    })
    expect(row.scheduledFor.toISOString()).toBe(offGrid.toISOString())
  })

  it('still allows a pro reschedule onto an off-grid minute', async () => {
    // Path #5 — drag / resize / reschedule, the fourth and last place
    // `enforceStepGrid: false` is asserted.
    // Early enough that start + 60 + 15 still lands before the 18:00 close.
    const onGrid = futureAt(ON_GRID_HOUR_UTC - 2, ON_GRID_MINUTE_UTC)
    const offGrid = futureAt(ON_GRID_HOUR_UTC - 2, OFF_GRID_MINUTE_UTC)

    const created = await createProBooking({
      professionalId,
      actorUserId: proUserId,
      clientId,
      offeringId,
      locationId,
      locationType: ServiceLocationType.SALON,
      scheduledFor: onGrid,
      clientAddressId: null,
      internalNotes: null,
      overrideReason: null,
      requestedBufferMinutes: null,
      requestedTotalDurationMinutes: null,
      allowOutsideWorkingHours: false,
      allowShortNotice: false,
      allowFarFuture: false,
    })

    await updateProBooking({
      professionalId,
      actorUserId: proUserId,
      bookingId: created.booking.id,
      nextStatus: null,
      notifyClient: false,
      allowOutsideWorkingHours: false,
      allowShortNotice: false,
      allowFarFuture: false,
      nextStart: offGrid,
      nextBuffer: null,
      nextDuration: null,
      parsedRequestedItems: null,
      hasBuffer: false,
      hasDuration: false,
      hasServiceItems: false,
      overrideReason: null,
    })

    const row = await db.booking.findUniqueOrThrow({
      where: { id: created.booking.id },
      select: { scheduledFor: true },
    })
    expect(row.scheduledFor.toISOString()).toBe(offGrid.toISOString())
  })

  it('still books when the CLIENT confirms a pro-proposed off-grid time', async () => {
    // The client is confirming, not choosing. Holding this to the grid would
    // dead-end them on a minute only the pro can change.
    const offGrid = futureAt(ON_GRID_HOUR_UTC, OFF_GRID_MINUTE_UTC)

    await db.aftercareSummary.update({
      where: { id: aftercareId },
      data: {
        rebookMode: AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
        rebookedFor: offGrid,
      },
    })

    const result = await confirmClientAftercareNextAppointment({
      bookingId: sourceBookingId,
      clientId,
    })

    const row = await db.booking.findUniqueOrThrow({
      where: { id: result.booking.id },
      select: { scheduledFor: true, status: true },
    })
    expect(row.scheduledFor.toISOString()).toBe(offGrid.toISOString())
    expect(row.status).toBe(BookingStatus.ACCEPTED)
  })
})
