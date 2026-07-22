// tests/integration/consultation-extension-blocked.test.ts
//
// F2 (docs/design/scheduling-conflict-audit-fix-plan.md): approving a
// consultation rewrites the booking's duration from the agreed services, which
// can push the appointment past its original window. That growth used to be
// checked with findSchedulingConflicts, which is BLOCK-BLIND — so a pro
// proposing extra services could run a live appointment straight through a
// calendar block they had explicitly set aside.
//
// These tests drive the real approval write against real Postgres (no mocked
// conflict engine) and pin three things:
//
//   1. an extension that runs into blocked time is refused with TIME_BLOCKED,
//      and the booking is left completely untouched;
//   2. an extension into clear time still commits;
//   3. a block sitting over the ALREADY-BOOKED window does NOT refuse — the
//      ICS importer writes blocks with no booking-conflict check, so a
//      migrated pro can legitimately have one over a live appointment, and the
//      client cannot act on it.
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

import { approveConsultationAndMaterializeBooking } from '@/lib/booking/writeBoundary'
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

const tag = `consult_ext_${Date.now()}_${Math.random()
  .toString(36)
  .slice(2, 8)}`

// The appointment: 60 minutes + 15 minutes buffer from 12:00Z, so its original
// window ends at 13:15Z. The proposal materializes 180 minutes, pushing the end
// to 15:15Z — an extension window of [13:15Z, 15:15Z).
const ORIGINAL_DURATION_MINUTES = 60
const BUFFER_MINUTES = 15
const PROPOSED_DURATION_MINUTES = 180

let tenantId = ''
let clientId = ''
let professionalId = ''
let locationId = ''
let serviceId = ''
let categoryId = ''
let baseOfferingId = ''
let proposedOfferingId = ''
let bookingId = ''
let scheduledFor = new Date()

const seededUserEmails: string[] = []

function minutesAfterStart(minutes: number): Date {
  return new Date(scheduledFor.getTime() + minutes * 60_000)
}

beforeAll(async () => {
  const tenant = await db.tenant.create({
    data: { slug: `${tag}-tenant`, name: 'Consult Extension', isActive: true },
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
      lastName: `Extension_${tag}`,
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
      lastName: 'Extension',
      businessName: `${tag} studio`,
      homeTenantId: tenantId,
    },
    select: { id: true },
  })
  professionalId = pro.id

  const openAllWeek = {
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
      timeZone: 'UTC',
      bufferMinutes: BUFFER_MINUTES,
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

  // A second, longer offering for the proposal — one offering per service is
  // enforced by @@unique([professionalId, serviceId]), so this needs its own.
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

  scheduledFor = new Date()
  scheduledFor.setUTCDate(scheduledFor.getUTCDate() + 30)
  scheduledFor.setUTCHours(12, 0, 0, 0)

  const booking = await db.booking.create({
    data: {
      clientId,
      professionalId,
      serviceId,
      offeringId: baseOfferingId,
      scheduledFor,
      status: BookingStatus.IN_PROGRESS,
      startedAt: new Date(),
      sessionStep: SessionStep.CONSULTATION_PENDING_CLIENT,
      locationType: ServiceLocationType.SALON,
      locationId,
      subtotalSnapshot: new Prisma.Decimal('50.00'),
      totalDurationMinutes: ORIGINAL_DURATION_MINUTES,
      bufferMinutes: BUFFER_MINUTES,
      proTenantId: tenantId,
      clientHomeTenantId: tenantId,
    },
    select: { id: true },
  })
  bookingId = booking.id

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

// Each test re-arms a PENDING proposal and clears any blocks/decision state so
// the cases stay independent.
beforeEach(async () => {
  await db.calendarBlock.deleteMany({ where: { professionalId } })
  await db.consultationApproval.deleteMany({ where: { bookingId } })
  // Any extra booking a test parked on this pro's calendar. Kept here rather
  // than in the test so a mid-test failure can't leak one into the next.
  await db.booking.deleteMany({
    where: { professionalId, id: { not: bookingId } },
  })
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
      totalDurationMinutes: ORIGINAL_DURATION_MINUTES,
      subtotalSnapshot: new Prisma.Decimal('50.00'),
      allowsOverlap: false,
      consultationConfirmedAt: null,
      sessionStep: SessionStep.CONSULTATION_PENDING_CLIENT,
    },
  })

  await db.consultationApproval.create({
    data: {
      bookingId,
      clientId,
      proId: professionalId,
      status: ConsultationApprovalStatus.PENDING,
      proposedTotal: new Prisma.Decimal('180.00'),
      proposedServicesJson: {
        currency: 'USD',
        items: [
          {
            offeringId: proposedOfferingId,
            serviceId: null,
            itemType: BookingServiceItemType.BASE,
            price: '180.00',
            sortOrder: 0,
          },
        ],
      },
    },
  })
})

async function approve(): Promise<unknown> {
  return approveConsultationAndMaterializeBooking({
    bookingId,
    clientId,
    professionalId,
  }).catch((error: unknown) => error)
}

describe('consultation approval vs calendar blocks (F2)', () => {
  it('refuses with TIME_BLOCKED when the extension runs into blocked time', async () => {
    // Original window ends at +75min; the block sits at +120min, inside the
    // extension but outside the already-booked time.
    await db.calendarBlock.create({
      data: {
        professionalId,
        locationId,
        startsAt: minutesAfterStart(120),
        endsAt: minutesAfterStart(150),
        note: `${tag} blocked`,
      },
    })

    const result = await approve()

    expect(isBookingError(result)).toBe(true)
    if (isBookingError(result)) {
      expect(result.code).toBe('TIME_BLOCKED')
      expect(result.httpStatus).toBe(409)
    }

    // The refusal must leave nothing half-written: the duration, the service
    // items and the approval status all roll back with the transaction.
    const booking = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: {
        totalDurationMinutes: true,
        consultationConfirmedAt: true,
        allowsOverlap: true,
      },
    })
    expect(booking.totalDurationMinutes).toBe(ORIGINAL_DURATION_MINUTES)
    expect(booking.consultationConfirmedAt).toBeNull()
    expect(booking.allowsOverlap).toBe(false)

    const approval = await db.consultationApproval.findUniqueOrThrow({
      where: { bookingId },
      select: { status: true },
    })
    expect(approval.status).toBe(ConsultationApprovalStatus.PENDING)

    const items = await db.bookingServiceItem.findMany({
      where: { bookingId },
      select: { offeringId: true },
    })
    expect(items).toHaveLength(1)
    expect(items[0]?.offeringId).toBe(baseOfferingId)
  })

  it('commits the extension when the new time is clear', async () => {
    const result = await approve()

    expect(isBookingError(result)).toBe(false)

    const booking = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { totalDurationMinutes: true, consultationConfirmedAt: true },
    })
    expect(booking.totalDurationMinutes).toBe(PROPOSED_DURATION_MINUTES)
    expect(booking.consultationConfirmedAt).not.toBeNull()

    const approval = await db.consultationApproval.findUniqueOrThrow({
      where: { bookingId },
      select: { status: true },
    })
    expect(approval.status).toBe(ConsultationApprovalStatus.APPROVED)
  })

  // F8. This is the ONE path that grows a booking's occupied range IN PLACE, so
  // widening the EXCLUDE predicate to cover COMPLETED made it the only place a
  // brand-new 23P01 could appear: the extension can now collide with a finished
  // appointment that used to sit outside the index entirely. It doesn't, because
  // the same write already stamps allowsOverlap from a conflict reader that has
  // always counted COMPLETED — but that stamp only became load-bearing here with
  // the migration, and nothing pinned it. This does.
  it('extends over a COMPLETED booking as an authorized overlap, not a 23P01', async () => {
    // Sits at +120..+150min: inside the 180min extension, clear of the original
    // 60+15min window — the same geometry the calendar-block case above uses.
    await db.booking.create({
      data: {
        clientId,
        professionalId,
        serviceId,
        offeringId: baseOfferingId,
        scheduledFor: minutesAfterStart(120),
        status: BookingStatus.COMPLETED,
        finishedAt: minutesAfterStart(150),
        locationType: ServiceLocationType.SALON,
        locationId,
        subtotalSnapshot: new Prisma.Decimal('40.00'),
        totalDurationMinutes: 30,
        bufferMinutes: 0,
        proTenantId: tenantId,
        clientHomeTenantId: tenantId,
      },
      select: { id: true },
    })

    const result = await approve()

    // The pro authored the proposal knowing the appointment is underway, so the
    // collision is authorized — it must commit, not refuse and not blow up.
    expect(isBookingError(result)).toBe(false)

    const booking = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { totalDurationMinutes: true, allowsOverlap: true },
    })
    expect(booking.totalDurationMinutes).toBe(PROPOSED_DURATION_MINUTES)
    // The row must have LEFT the GIST index, or Postgres would have rejected
    // the update above. Asserted directly so a future refactor that drops the
    // stamp fails here rather than as an unhandled 500 in production.
    expect(booking.allowsOverlap).toBe(true)
  })

  it('still approves when a block covers only the ALREADY-BOOKED window', async () => {
    // Entirely inside [start, start+75min) — the ICS importer can write one of
    // these over a live appointment, and refusing here would strand a client
    // who has no way to clear it.
    await db.calendarBlock.create({
      data: {
        professionalId,
        locationId,
        startsAt: minutesAfterStart(10),
        endsAt: minutesAfterStart(40),
        note: `${tag} blocked pre-existing`,
      },
    })

    const result = await approve()

    expect(isBookingError(result)).toBe(false)

    const booking = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { totalDurationMinutes: true },
    })
    expect(booking.totalDurationMinutes).toBe(PROPOSED_DURATION_MINUTES)
  })
})
