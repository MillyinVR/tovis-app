// tests/integration/consultation-proposal-schedule.test.ts
//
// F12 (docs/design/scheduling-conflict-audit-fix-plan.md): before F12 the
// consultation PROPOSAL was authored with no schedule check of any kind — the
// pro picked services and the CLIENT was the one who discovered, at approve,
// that they ran into a block or that the appointment now ended after closing.
//
// F2 fixed the approve side. F12 moves the same question forward to the pro,
// and the only way that is worth anything is if both sides answer with the SAME
// number. These tests drive the real queries against real Postgres and pin:
//
//   1. the end time the PROPOSE side predicts is exactly the one the APPROVE
//      side materializes — the claim the whole card rests on;
//   2. that number comes from the OFFERING CATALOG, not from the durations the
//      pro typed into the form (which the approval discards);
//   3. the block probe sees a real CalendarBlock in the extension window, and
//      does NOT see one sitting over the already-booked window;
//   4. the working-hours outlook tells "these services did it" apart from "this
//      appointment was already running late", against real working hours;
//   5. an offering that does not serve the booking's location mode is refused
//      HERE, at proposal time, instead of at approve.
//
// Runs against the docker test database like the other integration suites:
//   pnpm test:integration

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  BookingServiceItemType,
  BookingStatus,
  ConsultationApprovalStatus,
  Prisma,
  PrismaClient,
  Role,
  ServiceLocationType,
  SessionStep,
} from '@prisma/client'

import { hasCalendarBlockConflict } from '@/lib/booking/conflictQueries'
import { isBookingError } from '@/lib/booking/errors'
import { approveConsultationAndMaterializeBooking } from '@/lib/booking/writeBoundary'
import {
  consultationExtensionWindow,
  resolveConsultationMaterialization,
  resolveConsultationScheduleOutlook,
} from '@/lib/consultation/proposalSchedule'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error(
    'Missing DATABASE_URL. Run this test with: pnpm test:integration',
  )
}

const db = new PrismaClient({
  datasources: { db: { url: databaseUrl } },
})

const tag = `consult_prop_${Date.now()}_${Math.random()
  .toString(36)
  .slice(2, 8)}`

// The appointment: 60 minutes + 15 buffer from 12:00 local, so its original
// window ends at 13:15. The proposal materializes 180 minutes, pushing the end
// to 15:15 — an extension window of [13:15, 15:15).
const ORIGINAL_DURATION_MINUTES = 60
const BUFFER_MINUTES = 15
const PROPOSED_DURATION_MINUTES = 180

// The salon opens 09:00 and closes 18:00 in its own zone. A deliberately
// non-UTC zone so the working-hours math has to actually convert.
const TIME_ZONE = 'America/Los_Angeles'

let tenantId = ''
let clientId = ''
let professionalId = ''
let locationId = ''
let serviceId = ''
let categoryId = ''
let baseOfferingId = ''
let proposedOfferingId = ''
let mobileOnlyOfferingId = ''
let bookingId = ''
let scheduledFor = new Date()

const seededUserEmails: string[] = []

function minutesAfterStart(minutes: number): Date {
  return new Date(scheduledFor.getTime() + minutes * 60_000)
}

/**
 * The proposal JSON the pro's form would send. `durationMinutes` is deliberately
 * a lie (1 minute): nothing may read it, because the approval does not.
 */
function proposalJson(offeringId = proposedOfferingId) {
  return {
    currency: 'USD',
    items: [
      {
        offeringId,
        serviceId: null,
        itemType: BookingServiceItemType.BASE,
        price: '180.00',
        durationMinutes: 1,
        sortOrder: 0,
      },
    ],
  }
}

/** The propose-side computation, exactly as the route runs it. */
async function proposeSideSchedule(args?: {
  offeringId?: string
  locationType?: ServiceLocationType
}) {
  const booking = await db.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: {
      scheduledFor: true,
      totalDurationMinutes: true,
      bufferMinutes: true,
      locationId: true,
      locationType: true,
      locationTimeZone: true,
      professional: { select: { timeZone: true } },
    },
  })

  const materialization = await resolveConsultationMaterialization({
    tx: db,
    professionalId,
    locationType: args?.locationType ?? booking.locationType,
    proposedServicesJson: proposalJson(args?.offeringId),
  })

  const extension = consultationExtensionWindow({
    scheduledFor: booking.scheduledFor,
    previousDurationMinutes: booking.totalDurationMinutes,
    bufferMinutes: booking.bufferMinutes,
    materializedDurationMinutes: materialization.computedDurationMinutes,
  })

  const blocked = extension.extendsAppointment
    ? await hasCalendarBlockConflict({
        tx: db,
        professionalId,
        locationId: booking.locationId,
        requestedStart: extension.extensionStart,
        requestedEnd: extension.materializedEnd,
      })
    : false

  const outlook = await resolveConsultationScheduleOutlook({
    tx: db,
    professionalId,
    locationId: booking.locationId,
    bookingLocationTimeZone: booking.locationTimeZone,
    professionalTimeZone: booking.professional?.timeZone ?? null,
    scheduledFor: booking.scheduledFor,
    previousEnd: extension.previousEnd,
    materializedEnd: extension.materializedEnd,
  })

  return { materialization, extension, blocked, outlook }
}

beforeAll(async () => {
  const tenant = await db.tenant.create({
    data: { slug: `${tag}-tenant`, name: 'Consult Proposal', isActive: true },
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
      firstName: 'Consult',
      lastName: `Proposal_${tag}`,
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

  const pro = await db.professionalProfile.create({
    data: {
      userId: proUser.id,
      firstName: 'Pro',
      lastName: 'Proposal',
      businessName: `${tag} studio`,
      homeTenantId: tenantId,
      timeZone: TIME_ZONE,
    },
    select: { id: true },
  })
  professionalId = pro.id

  const nineToSix = {
    mon: { enabled: true, start: '09:00', end: '18:00' },
    tue: { enabled: true, start: '09:00', end: '18:00' },
    wed: { enabled: true, start: '09:00', end: '18:00' },
    thu: { enabled: true, start: '09:00', end: '18:00' },
    fri: { enabled: true, start: '09:00', end: '18:00' },
    sat: { enabled: true, start: '09:00', end: '18:00' },
    sun: { enabled: true, start: '09:00', end: '18:00' },
  }

  const location = await db.professionalLocation.create({
    data: {
      professionalId,
      type: 'SALON',
      name: `${tag} salon`,
      isPrimary: true,
      isBookable: true,
      timeZone: TIME_ZONE,
      bufferMinutes: BUFFER_MINUTES,
      workingHours: nineToSix,
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
      defaultDurationMinutes: ORIGINAL_DURATION_MINUTES,
      minPrice: new Prisma.Decimal('50.00'),
      isActive: true,
    },
    select: { id: true },
  })
  serviceId = service.id

  const baseOffering = await db.professionalServiceOffering.create({
    data: {
      professionalId,
      serviceId,
      offersInSalon: true,
      offersMobile: false,
      salonDurationMinutes: ORIGINAL_DURATION_MINUTES,
      salonPriceStartingAt: new Prisma.Decimal('50.00'),
      isActive: true,
    },
    select: { id: true },
  })
  baseOfferingId = baseOffering.id

  // One offering per service (@@unique([professionalId, serviceId])), so the
  // longer proposed service needs its own.
  const bigService = await db.service.create({
    data: {
      name: `${tag} big service`,
      categoryId,
      defaultDurationMinutes: PROPOSED_DURATION_MINUTES,
      minPrice: new Prisma.Decimal('180.00'),
      isActive: true,
    },
    select: { id: true },
  })

  const proposedOffering = await db.professionalServiceOffering.create({
    data: {
      professionalId,
      serviceId: bigService.id,
      offersInSalon: true,
      offersMobile: false,
      salonDurationMinutes: PROPOSED_DURATION_MINUTES,
      salonPriceStartingAt: new Prisma.Decimal('180.00'),
      isActive: true,
    },
    select: { id: true },
  })
  proposedOfferingId = proposedOffering.id

  // Active, bookable, and MOBILE-only — the case the propose route's own
  // validation never asked about.
  const mobileService = await db.service.create({
    data: {
      name: `${tag} mobile service`,
      categoryId,
      defaultDurationMinutes: 45,
      minPrice: new Prisma.Decimal('90.00'),
      isActive: true,
    },
    select: { id: true },
  })

  const mobileOffering = await db.professionalServiceOffering.create({
    data: {
      professionalId,
      serviceId: mobileService.id,
      offersInSalon: false,
      offersMobile: true,
      mobileDurationMinutes: 45,
      mobilePriceStartingAt: new Prisma.Decimal('90.00'),
      isActive: true,
    },
    select: { id: true },
  })
  mobileOnlyOfferingId = mobileOffering.id

  // 12:00 in the salon's zone, 30 days out. Built by walking the UTC hour until
  // the local wall clock reads 12:00, so the fixture is right on both sides of
  // a DST change rather than only in the half of the year I happened to run it.
  const day = new Date()
  day.setUTCDate(day.getUTCDate() + 30)

  scheduledFor = (() => {
    for (let hour = 0; hour < 48; hour += 1) {
      const candidate = new Date(day)
      candidate.setUTCHours(hour, 0, 0, 0)
      const local = new Intl.DateTimeFormat('en-US', {
        timeZone: TIME_ZONE,
        hour: '2-digit',
        hour12: false,
      }).format(candidate)
      if (Number(local) === 12) return candidate
    }
    throw new Error('could not place a 12:00 local start')
  })()

  const booking = await db.booking.create({
    data: {
      clientId,
      professionalId,
      serviceId,
      offeringId: baseOfferingId,
      scheduledFor,
      status: BookingStatus.IN_PROGRESS,
      startedAt: new Date(),
      sessionStep: SessionStep.CONSULTATION,
      locationType: ServiceLocationType.SALON,
      locationId,
      locationTimeZone: TIME_ZONE,
      subtotalSnapshot: new Prisma.Decimal('50.00'),
      totalDurationMinutes: ORIGINAL_DURATION_MINUTES,
      bufferMinutes: BUFFER_MINUTES,
      proTenantId: tenantId,
      clientHomeTenantId: tenantId,
    },
    select: { id: true },
  })
  bookingId = booking.id
}, 120_000)

afterAll(async () => {
  await db.calendarBlock.deleteMany({ where: { professionalId } })
  await db.consultationApproval.deleteMany({ where: { bookingId } })
  await db.bookingServiceItem.deleteMany({ where: { bookingId } })
  await db.booking.deleteMany({ where: { id: bookingId } })
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

beforeEach(async () => {
  await db.calendarBlock.deleteMany({ where: { professionalId } })
  await db.consultationApproval.deleteMany({ where: { bookingId } })
  await db.bookingServiceItem.deleteMany({ where: { bookingId } })

  await db.bookingServiceItem.create({
    data: {
      bookingId,
      serviceId,
      offeringId: baseOfferingId,
      itemType: BookingServiceItemType.BASE,
      priceSnapshot: new Prisma.Decimal('50.00'),
      durationMinutesSnapshot: ORIGINAL_DURATION_MINUTES,
      sortOrder: 0,
    },
  })

  await db.booking.update({
    where: { id: bookingId },
    data: {
      scheduledFor,
      totalDurationMinutes: ORIGINAL_DURATION_MINUTES,
      subtotalSnapshot: new Prisma.Decimal('50.00'),
      allowsOverlap: false,
      consultationConfirmedAt: null,
      sessionStep: SessionStep.CONSULTATION,
      locationType: ServiceLocationType.SALON,
    },
  })
})

describe('consultation proposal-time schedule check (F12)', () => {
  it('predicts exactly the end time the approval goes on to materialize', async () => {
    // This is the claim F12 rests on. A warning at proposal time is worth
    // nothing if the number it is computed from is not the number the booking
    // actually becomes.
    const { extension, materialization } = await proposeSideSchedule()

    await db.consultationApproval.create({
      data: {
        bookingId,
        clientId,
        proId: professionalId,
        status: ConsultationApprovalStatus.PENDING,
        proposedTotal: new Prisma.Decimal('180.00'),
        proposedServicesJson: proposalJson(),
      },
    })
    await db.booking.update({
      where: { id: bookingId },
      data: { sessionStep: SessionStep.CONSULTATION_PENDING_CLIENT },
    })

    await approveConsultationAndMaterializeBooking({
      bookingId,
      clientId,
      professionalId,
    })

    const after = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: {
        scheduledFor: true,
        totalDurationMinutes: true,
        bufferMinutes: true,
      },
    })

    expect(after.totalDurationMinutes).toBe(
      materialization.computedDurationMinutes,
    )

    const actualEnd = new Date(
      after.scheduledFor.getTime() +
        ((after.totalDurationMinutes ?? 0) + after.bufferMinutes) * 60_000,
    )
    expect(actualEnd.toISOString()).toBe(extension.materializedEnd.toISOString())
  })

  it('takes the duration from the catalog, not from what the pro typed', async () => {
    const { materialization, extension } = await proposeSideSchedule()

    // The proposal JSON says 1 minute. The offering says 180.
    expect(materialization.computedDurationMinutes).toBe(
      PROPOSED_DURATION_MINUTES,
    )
    expect(extension.previousEnd.toISOString()).toBe(
      minutesAfterStart(ORIGINAL_DURATION_MINUTES + BUFFER_MINUTES).toISOString(),
    )
    expect(extension.materializedEnd.toISOString()).toBe(
      minutesAfterStart(PROPOSED_DURATION_MINUTES + BUFFER_MINUTES).toISOString(),
    )
    expect(extension.extendsAppointment).toBe(true)
  })

  it('sees a real calendar block sitting in the extension window', async () => {
    // Original window ends at +75min; this block sits at +120min, inside the
    // extension the proposal would add.
    await db.calendarBlock.create({
      data: {
        professionalId,
        locationId,
        startsAt: minutesAfterStart(120),
        endsAt: minutesAfterStart(150),
        note: 'F12 block',
      },
    })

    const { blocked } = await proposeSideSchedule()
    expect(blocked).toBe(true)
  })

  it('ALLOWS a proposal when the extension window is clear', async () => {
    // Far past the materialized end (+195min).
    await db.calendarBlock.create({
      data: {
        professionalId,
        locationId,
        startsAt: minutesAfterStart(600),
        endsAt: minutesAfterStart(660),
        note: 'F12 late block',
      },
    })

    const { blocked } = await proposeSideSchedule()
    expect(blocked).toBe(false)
  })

  it('ALLOWS a block that sits over the ALREADY-BOOKED window', async () => {
    // The ICS importer writes blocks with no booking-conflict check, so a
    // migrated pro can legitimately have one laid over a live appointment.
    // Refusing the proposal for that would be refusing over a pre-existing
    // condition nobody in the room caused.
    await db.calendarBlock.create({
      data: {
        professionalId,
        locationId,
        startsAt: minutesAfterStart(10),
        endsAt: minutesAfterStart(40),
        note: 'F12 pre-existing block',
      },
    })

    const { blocked } = await proposeSideSchedule()
    expect(blocked).toBe(false)
  })

  it('says nothing when the new end is still inside the pro’s hours', async () => {
    // 12:00 + 180 + 15 = 15:15 local, comfortably before the 18:00 close.
    const { outlook } = await proposeSideSchedule()
    expect(outlook.outlook).toBe('WITHIN_WORKING_HOURS')
    expect(outlook.timeZone).toBe(TIME_ZONE)
  })

  it('says THESE services pushed the end past closing', async () => {
    // Start at 16:00 local instead: 16:00 + 60 + 15 = 17:15 (inside), but
    // 16:00 + 180 + 15 = 19:15 (past the 18:00 close).
    await db.booking.update({
      where: { id: bookingId },
      data: { scheduledFor: minutesAfterStart(4 * 60) },
    })

    const { outlook } = await proposeSideSchedule()
    expect(outlook.outlook).toBe('PAST_WORKING_HOURS')
  })

  it('does NOT blame the proposal for an appointment already running late', async () => {
    // Start at 19:00 local — already past the 18:00 close before anything was
    // proposed.
    await db.booking.update({
      where: { id: bookingId },
      data: { scheduledFor: minutesAfterStart(7 * 60) },
    })

    const { outlook } = await proposeSideSchedule()
    expect(outlook.outlook).toBe('ALREADY_OUTSIDE_WORKING_HOURS')
  })

  it('refuses an offering that does not serve this appointment’s location mode', async () => {
    // Salon appointment, mobile-only offering. The propose route's own
    // validation passes it (active offering, right pro); the approval would
    // have thrown INVALID_SERVICE_ITEMS at the CLIENT.
    const error = await proposeSideSchedule({
      offeringId: mobileOnlyOfferingId,
    }).catch((caught: unknown) => caught)

    expect(isBookingError(error) && error.code).toBe('INVALID_SERVICE_ITEMS')
  })
})
