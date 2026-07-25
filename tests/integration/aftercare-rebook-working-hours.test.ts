// tests/integration/aftercare-rebook-working-hours.test.ts
//
// The aftercare "book their next appointment" slot is PRO-CHOSEN, and a pro
// may deliberately book a client on a day their public calendar shows as off
// (Tori, 2026-07-25: "I have a few specific clients I take on Saturdays").
// These cases pin the three sides of that authority against real Postgres:
//
//   1. Without the explicit flag, an off-day slot is still REFUSED — the
//      override is a deliberate confirm, never a silent allow.
//   2. With `allowOutsideWorkingHours`, the save books the slot outright and
//      writes a BookingOverrideAuditLog row (same contract as
//      POST /api/v1/pro/bookings).
//   3. The relaxation keys on WHO CHOSE the time, not who acts:
//      - a client CONFIRMING a stored pro-chosen slot is provenance-allowed
//        (they cannot answer a pro's override prompt — refusing would
//        dead-end them on a time only the pro can change), while
//      - a client PICKING their own time on the public token path is held to
//        working hours exactly as before, and
//      - an override the pro has no permission for (MAX_DAYS_AHEAD without a
//        BookingOverridePermission grant) is still FORBIDDEN.
//
// Fixture shape mirrors rebook-token-step-grid.test.ts; the location's
// schedule disables Saturday so "an off day" is a real weekday-keyed refusal,
// not a synthetic hours window.

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
  SessionStep,
} from '@prisma/client'

import {
  confirmClientAftercareNextAppointment,
  createClientRebookedBookingFromAftercare,
  upsertBookingAftercare,
} from '@/lib/booking/writeBoundary'
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

const tag = `rebook_wh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

const DURATION_MINUTES = 60
const BUFFER_MINUTES = 15
const STEP_MINUTES = 15

let tenantId = ''
let clientId = ''
let proUserId = ''
let professionalId = ''
let locationId = ''
let serviceId = ''
let categoryId = ''
let offeringId = ''
// ACCEPTED + aftercare-eligible session step — the pro-authoring save path.
let saveSourceBookingId = ''
let saveAftercareId = ''
// COMPLETED + paid + sent — the client confirm / public token paths.
let confirmSourceBookingId = ''
let confirmAftercareId = ''

const seededUserEmails: string[] = []

// Saturday is OFF — the pro's public calendar shows no Saturday availability,
// which is exactly the day they take their off-book regulars.
const closedSaturdays = {
  mon: { enabled: true, start: '09:00', end: '18:00' },
  tue: { enabled: true, start: '09:00', end: '18:00' },
  wed: { enabled: true, start: '09:00', end: '18:00' },
  thu: { enabled: true, start: '09:00', end: '18:00' },
  fri: { enabled: true, start: '09:00', end: '18:00' },
  sat: { enabled: false, start: '09:00', end: '18:00' },
  sun: { enabled: true, start: '09:00', end: '18:00' },
}

/**
 * A future Saturday (~5 weeks out) at the given UTC wall clock. The location
 * runs on UTC, so the wall clock IS the local time; 14:00 sits inside the
 * enabled days' 09:00–18:00 window, making the weekday the ONLY reason for an
 * OUTSIDE_WORKING_HOURS refusal.
 */
function futureSaturdayAt(hourUtc: number, minuteUtc: number): Date {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + 30)
  while (d.getUTCDay() !== 6) d.setUTCDate(d.getUTCDate() + 1)
  d.setUTCHours(hourUtc, minuteUtc, 0, 0)
  return d
}

/** A future NON-Saturday past the 365-day horizon, inside working hours. */
function farFutureWeekdayAt(hourUtc: number): Date {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + 400)
  while (d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1)
  d.setUTCHours(hourUtc, 0, 0, 0)
  return d
}

async function baseSaveArgs() {
  const summary = await db.aftercareSummary.findUnique({
    where: { id: saveAftercareId },
    select: { version: true },
  })
  return {
    bookingId: saveSourceBookingId,
    professionalId,
    actorUserId: proUserId,
    notes: 'Working-hours override drive.',
    rebookMode: AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
    rebookWindowStart: null,
    rebookWindowEnd: null,
    allowOutsideWorkingHours: false,
    allowShortNotice: false,
    allowFarFuture: false,
    overrideReason: null,
    createRebookReminder: false,
    rebookReminderDaysBefore: 2,
    createProductReminder: false,
    productReminderDaysAfter: 7,
    recommendedProducts: [],
    sendToClient: false,
    version: summary?.version ?? 1,
  }
}

function slotAt(start: Date) {
  const endsAt = new Date(start.getTime() + DURATION_MINUTES * 60_000)
  return {
    offeringId,
    locationId,
    locationType: ServiceLocationType.SALON,
    clientAddressId: null,
    startsAt: start,
    endsAt,
  }
}

async function seedSourceBooking(args: {
  status: BookingStatus
  sessionStep: SessionStep
  finished: boolean
  /** Distinct per seed — (professionalId, scheduledFor) is unique. */
  hourUtc: number
}): Promise<{ bookingId: string; aftercareId: string }> {
  const past = new Date()
  past.setUTCDate(past.getUTCDate() - 7)
  past.setUTCHours(args.hourUtc, 0, 0, 0)

  const booking = await db.booking.create({
    data: {
      clientId,
      professionalId,
      serviceId,
      offeringId,
      scheduledFor: past,
      status: args.status,
      finishedAt: args.finished ? past : null,
      sessionStep: args.sessionStep,
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

  await db.bookingServiceItem.create({
    data: {
      bookingId: booking.id,
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
      bookingId: booking.id,
      rebookMode: AftercareRebookMode.NONE,
      sentToClientAt: new Date(),
    },
    select: { id: true },
  })

  return { bookingId: booking.id, aftercareId: aftercare.id }
}

beforeAll(async () => {
  const tenant = await db.tenant.create({
    data: { slug: `${tag}-tenant`, name: 'Rebook WH', isActive: true },
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
      lastName: `SaturdayRegular_${tag}`,
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
      lastName: 'ClosedSaturdays',
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
      formattedAddress: '1 Offday St, San Diego, CA 92101',
      lat: new Prisma.Decimal('32.7157000'),
      lng: new Prisma.Decimal('-117.1611000'),
      timeZone: 'UTC',
      bufferMinutes: BUFFER_MINUTES,
      stepMinutes: STEP_MINUTES,
      advanceNoticeMinutes: 0,
      maxDaysAhead: 365,
      workingHours: closedSaturdays,
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

  const save = await seedSourceBooking({
    status: BookingStatus.ACCEPTED,
    sessionStep: SessionStep.AFTER_PHOTOS,
    finished: false,
    hourUtc: 10,
  })
  saveSourceBookingId = save.bookingId
  saveAftercareId = save.aftercareId

  const confirm = await seedSourceBooking({
    status: BookingStatus.COMPLETED,
    sessionStep: SessionStep.DONE,
    finished: true,
    hourUtc: 14,
  })
  confirmSourceBookingId = confirm.bookingId
  confirmAftercareId = confirm.aftercareId
}, 120_000)

afterAll(async () => {
  await db.aftercareSummary.updateMany({
    where: { id: { in: [saveAftercareId, confirmAftercareId] } },
    data: { rebookedBookingId: null },
  })
  await db.bookingOverrideAuditLog.deleteMany({ where: { professionalId } })
  await db.aftercareRebookSlot.deleteMany({ where: { professionalId } })
  await db.reminder.deleteMany({ where: { booking: { professionalId } } })
  await db.notification.deleteMany({ where: { booking: { professionalId } } })
  await db.bookingCloseoutAuditLog.deleteMany({ where: { professionalId } })
  await db.bookingServiceItem.deleteMany({
    where: { booking: { professionalId } },
  })
  await db.aftercareSummary.deleteMany({
    where: { id: { in: [saveAftercareId, confirmAftercareId] } },
  })
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
  await db.aftercareSummary.updateMany({
    where: { id: { in: [saveAftercareId, confirmAftercareId] } },
    data: {
      rebookedBookingId: null,
      rebookMode: AftercareRebookMode.NONE,
      rebookedFor: null,
    },
  })
  await db.aftercareRebookSlot.deleteMany({ where: { professionalId } })
  await db.bookingOverrideAuditLog.deleteMany({ where: { professionalId } })

  const rebooks = await db.booking.findMany({
    where: {
      rebookOfBookingId: { in: [saveSourceBookingId, confirmSourceBookingId] },
    },
    select: { id: true },
  })
  const rebookIds = rebooks.map((row) => row.id)

  if (rebookIds.length > 0) {
    await db.reminder.deleteMany({ where: { bookingId: { in: rebookIds } } })
    await db.notification.deleteMany({
      where: { bookingId: { in: rebookIds } },
    })
    await db.bookingServiceItem.deleteMany({
      where: { bookingId: { in: rebookIds } },
    })
    await db.booking.deleteMany({ where: { id: { in: rebookIds } } })
  }
})

describe('aftercare rebook vs working hours — pro authority', () => {
  it('still refuses an off-day slot when the pro has not confirmed the override', async () => {
    const saturday = futureSaturdayAt(14, 0)

    await expect(
      upsertBookingAftercare({
        ...(await baseSaveArgs()),
        rebookedFor: saturday,
        rebookSlot: slotAt(saturday),
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isBookingError(error) && error.code === 'OUTSIDE_WORKING_HOURS',
    )

    // Refusal rolled the whole save back — no half-written proposal.
    const summary = await db.aftercareSummary.findUnique({
      where: { id: saveAftercareId },
      select: { rebookMode: true, rebookedBookingId: true },
    })
    expect(summary?.rebookMode).toBe(AftercareRebookMode.NONE)
    expect(summary?.rebookedBookingId).toBeNull()
  })

  it('books the off-day slot outright with allowOutsideWorkingHours, and audits the override', async () => {
    const saturday = futureSaturdayAt(14, 0)

    const result = await upsertBookingAftercare({
      ...(await baseSaveArgs()),
      rebookedFor: saturday,
      rebookSlot: slotAt(saturday),
      allowOutsideWorkingHours: true,
      overrideReason: 'Saturday regular — off-book standing appointment.',
    })

    expect(result.aftercare.rebookedBookingId).toBeTruthy()

    const booked = await db.booking.findUnique({
      where: { id: result.aftercare.rebookedBookingId ?? '' },
      select: { status: true, scheduledFor: true, rebookOfBookingId: true },
    })
    expect(booked?.status).toBe(BookingStatus.ACCEPTED)
    expect(booked?.scheduledFor.getTime()).toBe(saturday.getTime())
    expect(booked?.rebookOfBookingId).toBe(saveSourceBookingId)

    // The override is a recorded, attributed act — same contract as the pro
    // create/edit routes.
    const audits = await db.bookingOverrideAuditLog.findMany({
      where: { professionalId },
      select: { rule: true, actorUserId: true, reason: true, bookingId: true },
    })
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({
      rule: 'WORKING_HOURS',
      actorUserId: proUserId,
      reason: 'Saturday regular — off-book standing appointment.',
      bookingId: result.aftercare.rebookedBookingId,
    })
  })

  it('reschedules the booked slot to another off-day time only with the flag', async () => {
    const saturday = futureSaturdayAt(14, 0)

    const first = await upsertBookingAftercare({
      ...(await baseSaveArgs()),
      rebookedFor: saturday,
      rebookSlot: slotAt(saturday),
      allowOutsideWorkingHours: true,
    })
    const bookedId = first.aftercare.rebookedBookingId
    expect(bookedId).toBeTruthy()

    const laterSaturday = futureSaturdayAt(16, 0)

    // Same placement, new time, no flag → the time-only reschedule branch
    // must gate exactly like the create did.
    await expect(
      upsertBookingAftercare({
        ...(await baseSaveArgs()),
        rebookedFor: laterSaturday,
        rebookSlot: slotAt(laterSaturday),
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isBookingError(error) && error.code === 'OUTSIDE_WORKING_HOURS',
    )

    const second = await upsertBookingAftercare({
      ...(await baseSaveArgs()),
      rebookedFor: laterSaturday,
      rebookSlot: slotAt(laterSaturday),
      allowOutsideWorkingHours: true,
    })
    expect(second.aftercare.rebookedBookingId).toBe(bookedId)

    const moved = await db.booking.findUnique({
      where: { id: bookedId ?? '' },
      select: { scheduledFor: true, status: true },
    })
    expect(moved?.scheduledFor.getTime()).toBe(laterSaturday.getTime())
    expect(moved?.status).toBe(BookingStatus.ACCEPTED)
  })

  it('keeps MAX_DAYS_AHEAD permission-gated: allowFarFuture without a grant is FORBIDDEN', async () => {
    const farOut = farFutureWeekdayAt(14)

    await expect(
      upsertBookingAftercare({
        ...(await baseSaveArgs()),
        rebookedFor: farOut,
        rebookSlot: slotAt(farOut),
        allowFarFuture: true,
      }),
    ).rejects.toSatisfy(
      (error: unknown) => isBookingError(error) && error.code === 'FORBIDDEN',
    )
  })

  it('lets a client CONFIRM a stored pro-chosen slot the schedule no longer covers', async () => {
    // Legacy proposal shape: BOOKED summary + slot row, no mirrored booking —
    // exactly what a summary saved before book-at-save looks like, or what
    // narrowing working hours after proposing produces. The pro chose this
    // minute; the client's confirm must not dead-end on the pro's own rules.
    const saturday = futureSaturdayAt(14, 0)

    await db.aftercareSummary.update({
      where: { id: confirmAftercareId },
      data: {
        rebookMode: AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
        rebookedFor: saturday,
      },
    })
    await db.aftercareRebookSlot.create({
      data: {
        aftercareSummaryId: confirmAftercareId,
        professionalId,
        offeringId,
        locationId,
        locationType: ServiceLocationType.SALON,
        startsAt: saturday,
        endsAt: new Date(saturday.getTime() + DURATION_MINUTES * 60_000),
      },
    })

    const result = await confirmClientAftercareNextAppointment({
      bookingId: confirmSourceBookingId,
      clientId,
    })

    expect(result.booking.scheduledFor.getTime()).toBe(saturday.getTime())

    const booked = await db.booking.findUnique({
      where: { id: result.booking.id },
      select: { status: true },
    })
    expect(booked?.status).toBe(BookingStatus.ACCEPTED)

    // Provenance, not an override the client exercised — nothing to audit.
    const audits = await db.bookingOverrideAuditLog.count({
      where: { professionalId },
    })
    expect(audits).toBe(0)
  })

  it('still holds a CLIENT-chosen time on the public token path to working hours', async () => {
    // On-grid minute, inside the enabled days' window — the weekday is the
    // only violation, and the client picked it, so it must refuse.
    const saturday = futureSaturdayAt(14, 0)

    await db.aftercareSummary.update({
      where: { id: confirmAftercareId },
      data: { rebookMode: AftercareRebookMode.RECOMMENDED_WINDOW },
    })

    await expect(
      createClientRebookedBookingFromAftercare({
        aftercareId: confirmAftercareId,
        bookingId: confirmSourceBookingId,
        clientId,
        aftercareClientActionTokenId: `${tag}_token`,
        scheduledFor: saturday,
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isBookingError(error) && error.code === 'OUTSIDE_WORKING_HOURS',
    )
  })
})
