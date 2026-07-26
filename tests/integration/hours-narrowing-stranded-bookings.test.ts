// tests/integration/hours-narrowing-stranded-bookings.test.ts
//
// B8 — narrowing working hours vs the bookings already sitting in the time
// being given up. Two halves, both against real Postgres.
//
// HALF 1 — the REPORT (Tori's call, 2026-07-25: warn and list, save anyway).
// Nothing in the product retro-validated a booking when the hours moved and
// nothing told the pro either, so a narrowed week silently stranded whatever
// was already booked there. `findBookingsOutsideWorkingHours` is the read that
// makes the save able to say so. What it must and must NOT count is the whole
// point: the appointment window only (buffer excluded — see the module header),
// occupying statuses only, future only, per-location timezone.
//
// HALF 2 — the bookings still BEHAVE. A stranded booking is not a broken one:
// its reminder still sends, it can still be cancelled, and it can still be
// moved OUT of the dead time even though nothing can be booked INTO it. That
// asymmetry is the sharp case the card names, and it is a property of the
// reschedule policy validating the REQUESTED slot and never the current one.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  BookingCheckoutStatus,
  BookingServiceItemType,
  BookingStatus,
  NotificationEventKey,
  Prisma,
  PrismaClient,
  Role,
  ServiceLocationType,
} from '@prisma/client'

import { findBookingsOutsideWorkingHours } from '@/lib/scheduling/strandedBookings'
import { workingHoursEqual } from '@/lib/scheduling/workingHoursValidation'
import { evaluateRescheduleDecision } from '@/lib/booking/policies/reschedulePolicy'
import {
  syncBookingAppointmentReminders,
  validateDueAppointmentReminder,
} from '@/lib/notifications/appointmentReminders'
import { cancelBooking } from '@/lib/booking/writeBoundary'
import {
  addDaysToYMD,
  getZonedParts,
  startOfLocalDayUtc,
  utcFromDayAndMinutesInTimeZone,
  weekdayInTimeZone,
} from '@/lib/time'

// The PII keyring the encrypted client columns need. CI sets it; locally an
// unset key makes every seed fail in a way that looks like a regression in the
// code under test (the B7 recipe — a `vi.hoisted` block so it lands before the
// Prisma client module is imported).
vi.hoisted(() => {
  if (!process.env.PII_AEAD_KEYS_JSON) {
    const key = Buffer.alloc(32, 7).toString('base64')
    process.env.PII_AEAD_KEYS_JSON = JSON.stringify({
      'client-aead-v1': key,
      'address-aead-v1': key,
      'pro-aead-v1': key,
      'support-aead-v1': key,
    })
  }
  if (!process.env.PII_LOOKUP_HMAC_KEYS_JSON) {
    process.env.PII_LOOKUP_HMAC_KEYS_JSON = JSON.stringify({
      'lookup-hmac-v1': Buffer.alloc(32, 9).toString('base64'),
    })
  }
})

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error(
    'Missing DATABASE_URL. Run this test with: pnpm test:integration',
  )
}

const db = new PrismaClient({
  datasources: { db: { url: databaseUrl } },
})

const tag = `stranded_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

const DURATION_MINUTES = 60
const BUFFER_MINUTES = 15
const STEP_MINUTES = 15
const TZ = 'America/Los_Angeles'

let tenantId = ''
let clientId = ''

let professionalId = ''
let locationId = ''
let serviceId = ''
let categoryId = ''
let offeringId = ''

let tuesdayInsideId = ''
let tuesdayEdgeId = ''
let saturdayId = ''
let saturdayCancelledId = ''
let pastSaturdayId = ''

const seededUserEmails: string[] = []

const week = (
  overrides: Partial<
    Record<
      'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun',
      { enabled: boolean; start: string; end: string }
    >
  > = {},
) => ({
  mon: { enabled: true, start: '09:00', end: '17:00' },
  tue: { enabled: true, start: '09:00', end: '17:00' },
  wed: { enabled: true, start: '09:00', end: '17:00' },
  thu: { enabled: true, start: '09:00', end: '17:00' },
  fri: { enabled: true, start: '09:00', end: '17:00' },
  sat: { enabled: true, start: '09:00', end: '17:00' },
  sun: { enabled: true, start: '09:00', end: '17:00' },
  ...overrides,
})

const OPEN_ALL_WEEK = week()
const SATURDAY_OFF = week({ sat: { enabled: false, start: '09:00', end: '17:00' } })
const OPENS_AT_ELEVEN = week({
  tue: { enabled: true, start: '11:00', end: '17:00' },
})
/** Both narrowings at once — strands the Tuesday 10:00 AND the Saturday. */
const OPENS_AT_ELEVEN_AND_SATURDAY_OFF = week({
  tue: { enabled: true, start: '11:00', end: '17:00' },
  sat: { enabled: false, start: '09:00', end: '17:00' },
})

/**
 * `weekday` 0=Sun..6=Sat, `hourLocal` in TZ, `weeksOut` to keep each fixture on
 * its own calendar day — `(professionalId, scheduledFor)` is UNIQUE.
 *
 * Built from the local calendar day, not from a UTC offset: America/Los_Angeles
 * is UTC-7 in summer and UTC-8 in winter, and a fixture that assumed one of
 * them would silently become a DST test half the year
 * ([[local-day-arithmetic-not-24h]]).
 */
function futureLocal(args: {
  weekday: number
  hourLocal: number
  weeksOut: number
}): Date {
  const today = getZonedParts(new Date(), TZ)

  let parts = addDaysToYMD(
    today.year,
    today.month,
    today.day,
    7 * args.weeksOut,
  )

  const dayStart = () =>
    startOfLocalDayUtc({ ...parts, timeZone: TZ })

  while (weekdayInTimeZone(dayStart(), TZ) !== args.weekday) {
    parts = addDaysToYMD(parts.year, parts.month, parts.day, 1)
  }

  return utcFromDayAndMinutesInTimeZone(dayStart(), args.hourLocal * 60, TZ)
}

async function seedBooking(args: {
  scheduledFor: Date
  status: BookingStatus
  durationMinutes?: number
}): Promise<string> {
  const booking = await db.booking.create({
    data: {
      clientId,
      professionalId,
      serviceId,
      offeringId,
      scheduledFor: args.scheduledFor,
      status: args.status,
      checkoutStatus: BookingCheckoutStatus.PAID,
      paymentCollectedAt: new Date(),
      locationType: ServiceLocationType.SALON,
      locationId,
      locationTimeZone: TZ,
      subtotalSnapshot: new Prisma.Decimal('50.00'),
      totalDurationMinutes: args.durationMinutes ?? DURATION_MINUTES,
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
      durationMinutesSnapshot: args.durationMinutes ?? DURATION_MINUTES,
      sortOrder: 0,
    },
  })

  return booking.id
}

function scan(workingHours: unknown, limit?: number) {
  return findBookingsOutsideWorkingHours({
    db,
    professionalId,
    locations: [{ id: locationId, timeZone: TZ, workingHours }],
    now: new Date(),
    limit,
  })
}

beforeAll(async () => {
  const tenant = await db.tenant.create({
    data: { slug: `${tag}-tenant`, name: 'Stranded', isActive: true },
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
      firstName: 'Jordan',
      lastName: 'Reyes',
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
      lastName: 'NarrowsHours',
      businessName: `${tag} studio`,
      homeTenantId: tenantId,
      timeZone: TZ,
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
      formattedAddress: '1 Narrow St, Los Angeles, CA 90001',
      lat: new Prisma.Decimal('34.0522000'),
      lng: new Prisma.Decimal('-118.2437000'),
      timeZone: TZ,
      bufferMinutes: BUFFER_MINUTES,
      stepMinutes: STEP_MINUTES,
      advanceNoticeMinutes: 0,
      maxDaysAhead: 365,
      workingHours: OPEN_ALL_WEEK,
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
      name: 'Balayage',
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

  // Tue 10:00–11:00 local — inside 09:00–17:00, outside 11:00–17:00.
  tuesdayInsideId = await seedBooking({
    scheduledFor: futureLocal({ weekday: 2, hourLocal: 10, weeksOut: 2 }),
    status: BookingStatus.ACCEPTED,
  })

  // Tue 16:00–17:00 local — ends EXACTLY at closing. Its 15-minute buffer runs
  // to 17:15, so this is the row that separates "appointment fits" from
  // "appointment + buffer fits".
  tuesdayEdgeId = await seedBooking({
    scheduledFor: futureLocal({ weekday: 2, hourLocal: 16, weeksOut: 3 }),
    status: BookingStatus.ACCEPTED,
  })

  // Sat 10:00 local — stranded the moment Saturday is switched off.
  saturdayId = await seedBooking({
    scheduledFor: futureLocal({ weekday: 6, hourLocal: 10, weeksOut: 2 }),
    status: BookingStatus.ACCEPTED,
  })

  // Same shape, CANCELLED — occupies nothing, so it is never stranded.
  saturdayCancelledId = await seedBooking({
    scheduledFor: futureLocal({ weekday: 6, hourLocal: 13, weeksOut: 2 }),
    status: BookingStatus.CANCELLED,
  })

  // A PAST Saturday. Outside the new hours in every arithmetic sense, and
  // completely uninteresting — the pro cannot act on it.
  const past = futureLocal({ weekday: 6, hourLocal: 10, weeksOut: 2 })
  past.setUTCDate(past.getUTCDate() - 28)
  pastSaturdayId = await seedBooking({
    scheduledFor: past,
    status: BookingStatus.COMPLETED,
  })
}, 120_000)

afterAll(async () => {
  await db.scheduledClientNotification.deleteMany({
    where: { booking: { professionalId } },
  })
  await db.reminder.deleteMany({ where: { booking: { professionalId } } })
  await db.notification.deleteMany({ where: { booking: { professionalId } } })
  await db.bookingCloseoutAuditLog.deleteMany({ where: { professionalId } })
  await db.bookingOverrideAuditLog.deleteMany({ where: { professionalId } })
  await db.bookingServiceItem.deleteMany({
    where: { booking: { professionalId } },
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

describe('B8 — which bookings a narrowed week strands', () => {
  it('reports nothing while the hours still contain every booking', async () => {
    const report = await scan(OPEN_ALL_WEEK)

    expect(report).toEqual({ total: 0, items: [] })
  })

  it('reports exactly the bookings on the day being switched off', async () => {
    const report = await scan(SATURDAY_OFF)

    expect(report.total).toBe(1)
    expect(report.items.map((b) => b.id)).toEqual([saturdayId])
    expect(report.items[0]).toMatchObject({
      locationId,
      durationMinutes: DURATION_MINUTES,
      clientName: 'Jordan Reyes',
      serviceName: 'Balayage',
    })
  })

  it('never reports a cancelled or a past booking', async () => {
    const report = await scan(SATURDAY_OFF)
    const ids = report.items.map((b) => b.id)

    expect(ids).not.toContain(saturdayCancelledId)
    expect(ids).not.toContain(pastSaturdayId)
  })

  it('reports a booking that now starts before opening', async () => {
    const report = await scan(OPENS_AT_ELEVEN)

    expect(report.items.map((b) => b.id)).toContain(tuesdayInsideId)
  })

  it('does NOT report a booking that ends exactly at closing', async () => {
    // 16:00–17:00 against 09:00–17:00. The write path would also weigh the
    // 15-minute buffer (17:15 > 17:00); this report deliberately does not,
    // because "your 4pm still fits" is the answer a human wants.
    const report = await scan(OPEN_ALL_WEEK)

    expect(report.items.map((b) => b.id)).not.toContain(tuesdayEdgeId)
  })

  it('counts every stranded booking in `total` while capping `items`', async () => {
    const uncapped = await scan(OPENS_AT_ELEVEN_AND_SATURDAY_OFF)
    expect(uncapped.total).toBe(2)

    const capped = await scan(OPENS_AT_ELEVEN_AND_SATURDAY_OFF, 1)

    expect(capped.total).toBe(uncapped.total)
    expect(capped.items).toHaveLength(1)
    // Soonest first, so the cap keeps the most urgent one.
    expect(capped.items[0]?.id).toBe(uncapped.items[0]?.id)
  })

  it('reports NOTHING when the resolved week is unparseable', async () => {
    // Reachable through the location PATCH's timezone-only branch, which
    // resolves the week from the stored row. `ensureWithinWorkingHours` answers
    // MISSING for a malformed week, so without this guard the pro would be told
    // every future booking had just been stranded. "We cannot tell" is silence.
    const report = await scan({ mon: { enabled: 'yes' } })

    expect(report).toEqual({ total: 0, items: [] })

    const stillWorks = await scan(SATURDAY_OFF)
    expect(stillWorks.total).toBe(1)
  })

  it('treats a save that changes nothing as a no-op', () => {
    expect(workingHoursEqual(OPEN_ALL_WEEK, week())).toBe(true)
    expect(workingHoursEqual(OPEN_ALL_WEEK, SATURDAY_OFF)).toBe(false)
    // A location that never had hours is genuinely being changed the first time.
    expect(workingHoursEqual(null, OPEN_ALL_WEEK)).toBe(false)
  })
})

describe('B8 — a stranded booking still behaves', () => {
  it('still sends its reminder after the hours moved out from under it', async () => {
    // Narrow the hours for real, exactly as the settings save does.
    await db.professionalLocation.update({
      where: { id: locationId },
      data: { workingHours: SATURDAY_OFF },
    })

    try {
      await db.$transaction(async (tx) => {
        await syncBookingAppointmentReminders({
          tx,
          bookingId: saturdayId,
          enabledOffsetMinutes: [24 * 60],
        })
      })

      const row = await db.scheduledClientNotification.findFirst({
        where: {
          bookingId: saturdayId,
          eventKey: NotificationEventKey.APPOINTMENT_REMINDER,
          cancelledAt: null,
          processedAt: null,
        },
        select: { id: true },
      })

      expect(row).not.toBeNull()

      // Make it due, then ask the drain what it would do with it.
      await db.scheduledClientNotification.update({
        where: { id: row?.id ?? '' },
        data: { runAt: new Date(Date.now() - 60_000) },
      })

      const narrowed = await db.$transaction(async (tx) =>
        validateDueAppointmentReminder({
          tx,
          scheduledClientNotificationId: row?.id ?? '',
        }),
      )

      // Reminder eligibility is status-based; working hours never enter it, so
      // the client still hears about the appointment they actually have. The
      // drain does NOT cancel — it re-arms to the canonical instant, which is
      // still ahead (B7's RESCHEDULE branch), because the appointment itself
      // never moved.
      expect(narrowed.action).not.toBe('CANCEL')
      expect(narrowed.action).toBe('RESCHEDULE')

      // The decisive claim: the answer is IDENTICAL with the hours put back.
      // Whatever the drain does with this row, narrowing the week did not
      // change it.
      await db.professionalLocation.update({
        where: { id: locationId },
        data: { workingHours: OPEN_ALL_WEEK },
      })

      const open = await db.$transaction(async (tx) =>
        validateDueAppointmentReminder({
          tx,
          scheduledClientNotificationId: row?.id ?? '',
        }),
      )

      expect(open.action).toBe(narrowed.action)
    } finally {
      await db.professionalLocation.update({
        where: { id: locationId },
        data: { workingHours: OPEN_ALL_WEEK },
      })
    }
  })

  it('can still be moved OUT of the dead time, but not further INTO it', async () => {
    const booking = await db.booking.findUniqueOrThrow({
      where: { id: saturdayId },
      select: { scheduledFor: true },
    })

    const outOfDeadTime = futureLocal({
      weekday: 3,
      hourLocal: 10,
      weeksOut: 4,
    })

    const deeperIntoDeadTime = new Date(
      booking.scheduledFor.getTime() + 60 * 60_000,
    )

    await db.$transaction(async (tx) => {
      const escape = await evaluateRescheduleDecision({
        tx,
        now: new Date(),
        professionalId,
        bookingId: saturdayId,
        holdId: '',
        requestedStart: outOfDeadTime,
        durationMinutes: DURATION_MINUTES,
        bufferMinutes: BUFFER_MINUTES,
        locationId,
        workingHours: SATURDAY_OFF,
        timeZone: TZ,
        stepMinutes: STEP_MINUTES,
        advanceNoticeMinutes: 0,
        maxDaysAhead: 365,
      })

      // The policy checks the REQUESTED slot and never the current one, so the
      // booking's own dead time does not trap it.
      expect(escape.ok).toBe(true)

      const stay = await evaluateRescheduleDecision({
        tx,
        now: new Date(),
        professionalId,
        bookingId: saturdayId,
        holdId: '',
        requestedStart: deeperIntoDeadTime,
        durationMinutes: DURATION_MINUTES,
        bufferMinutes: BUFFER_MINUTES,
        locationId,
        workingHours: SATURDAY_OFF,
        timeZone: TZ,
        stepMinutes: STEP_MINUTES,
        advanceNoticeMinutes: 0,
        maxDaysAhead: 365,
      })

      expect(stay.ok).toBe(false)
      if (!stay.ok) expect(stay.code).toBe('OUTSIDE_WORKING_HOURS')
    })
  })

  it('can still be cancelled by its client after the hours narrowed', async () => {
    await db.professionalLocation.update({
      where: { id: locationId },
      data: { workingHours: SATURDAY_OFF },
    })

    try {
      const result = await cancelBooking({
        bookingId: saturdayId,
        actor: { kind: 'client', clientId },
        notifyClient: false,
      })

      expect(result.booking.status).toBe(BookingStatus.CANCELLED)
      expect(result.priorStatus).toBe(BookingStatus.ACCEPTED)

      const after = await db.booking.findUniqueOrThrow({
        where: { id: saturdayId },
        select: { status: true },
      })
      expect(after.status).toBe(BookingStatus.CANCELLED)
    } finally {
      await db.booking.update({
        where: { id: saturdayId },
        data: { status: BookingStatus.ACCEPTED, cancelledAt: null },
      })
      await db.professionalLocation.update({
        where: { id: locationId },
        data: { workingHours: OPEN_ALL_WEEK },
      })
    }
  })
})
