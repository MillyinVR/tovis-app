// tests/integration/reminder-cadence-resync.test.ts
//
// B7 — "a cadence a client never hears about".
//
// Appointment reminders are planned ONCE, at the booking write, from the pro's
// cadence as it stood at that instant. Nothing re-reads the cadence afterwards
// except the drain, and the drain can only judge rows that already exist. So
// before this card, a pro who added "2 hours before" to their reminder settings
// changed nothing for anybody already on their calendar — while the settings
// card promises to "automatically remind clients before their appointment" and
// names "already in the past" as the only exclusion.
//
// This suite drives the cadence WRITE against real Postgres: adding a lead time
// reaches the bookings that are already made, removing one takes them back, and
// the fan-out only touches bookings that are actually still remindable.
//
// Runs against the test database — `pnpm test:integration` (or the whole
// integration config).
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  BookingServiceItemType,
  BookingStatus,
  NotificationEventKey,
  Prisma,
  PrismaClient,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
} from '@prisma/client'

import { cancelBooking } from '@/lib/booking/writeBoundary'
import { applyProReminderCadence } from '@/lib/reminderSettings/applyReminderCadence'

// The write boundary snapshots addresses through the PII envelope; the locked
// transaction this suite drives shares that code path.
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

const TAG = `reminder_cadence_${Date.now()}`
const ZONE = 'America/Los_Angeles'
const DURATION_MINUTES = 60

const ONE_DAY = 1440
const TWO_HOURS = 120

type Fixtures = {
  tenantId: string
  professionalId: string
  clientId: string
  serviceId: string
  categoryId: string
  locationId: string
  offeringId: string
}

let fx: Fixtures

/** A UTC instant `daysAhead` from now, at a fixed hour, minute-aligned. */
function future(daysAhead: number, hourUtc: number): Date {
  const at = new Date()
  at.setUTCDate(at.getUTCDate() + daysAhead)
  at.setUTCHours(hourUtc, 0, 0, 0)
  return at
}

function past(daysBehind: number, hourUtc: number): Date {
  const at = new Date()
  at.setUTCDate(at.getUTCDate() - daysBehind)
  at.setUTCHours(hourUtc, 0, 0, 0)
  return at
}

async function seedBooking(args: {
  scheduledFor: Date
  status?: BookingStatus
  finishedAt?: Date | null
}): Promise<string> {
  const booking = await db.booking.create({
    data: {
      clientId: fx.clientId,
      professionalId: fx.professionalId,
      serviceId: fx.serviceId,
      offeringId: fx.offeringId,
      scheduledFor: args.scheduledFor,
      status: args.status ?? BookingStatus.ACCEPTED,
      finishedAt: args.finishedAt ?? null,
      locationType: ServiceLocationType.SALON,
      locationId: fx.locationId,
      locationTimeZone: ZONE,
      subtotalSnapshot: new Prisma.Decimal('100.00'),
      totalDurationMinutes: DURATION_MINUTES,
      bufferMinutes: 0,
      proTenantId: fx.tenantId,
      clientHomeTenantId: fx.tenantId,
    },
    select: { id: true },
  })

  await db.bookingServiceItem.create({
    data: {
      bookingId: booking.id,
      serviceId: fx.serviceId,
      offeringId: fx.offeringId,
      itemType: BookingServiceItemType.BASE,
      priceSnapshot: new Prisma.Decimal('100.00'),
      durationMinutesSnapshot: DURATION_MINUTES,
      sortOrder: 0,
    },
  })

  return booking.id
}

/** Live (pending) appointment-reminder rows for a booking, soonest first. */
async function pendingReminders(bookingId: string) {
  return db.scheduledClientNotification.findMany({
    where: {
      bookingId,
      eventKey: NotificationEventKey.APPOINTMENT_REMINDER,
      cancelledAt: null,
      processedAt: null,
    },
    orderBy: { runAt: 'asc' },
    select: { dedupeKey: true, runAt: true, data: true },
  })
}

async function saveCadence(offsetMinutes: number[], enabled = true) {
  return applyProReminderCadence({
    professionalId: fx.professionalId,
    update: { enabled, offsetMinutes },
  })
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
      firstName: 'Remi',
      lastName: 'Nder',
      businessName: 'Cadence Studio',
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
      firstName: 'Cadi',
      lastName: 'Client',
    },
    select: { id: true },
  })

  const category = await db.serviceCategory.create({
    data: { name: `${TAG} Cat`, slug: `${TAG}-cat`, isActive: true },
    select: { id: true },
  })
  const service = await db.service.create({
    data: {
      name: `${TAG} Silk Press`,
      categoryId: category.id,
      defaultDurationMinutes: DURATION_MINUTES,
      minPrice: new Prisma.Decimal('100.00'),
      isActive: true,
    },
    select: { id: true },
  })

  const location = await db.professionalLocation.create({
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
      timeZone: ZONE,
      workingHours: {
        mon: { enabled: true, start: '09:00', end: '18:00' },
        tue: { enabled: true, start: '09:00', end: '18:00' },
        wed: { enabled: true, start: '09:00', end: '18:00' },
        thu: { enabled: true, start: '09:00', end: '18:00' },
        fri: { enabled: true, start: '09:00', end: '18:00' },
        sat: { enabled: true, start: '09:00', end: '18:00' },
        sun: { enabled: true, start: '09:00', end: '18:00' },
      },
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
      salonDurationMinutes: DURATION_MINUTES,
    },
    select: { id: true },
  })

  fx = {
    tenantId: tenant.id,
    professionalId: professional.id,
    clientId: client.id,
    serviceId: service.id,
    categoryId: category.id,
    locationId: location.id,
    offeringId: offering.id,
  }
})

afterEach(async () => {
  const pro = { professionalId: fx.professionalId }
  await db.scheduledClientNotification.deleteMany({
    where: { clientId: fx.clientId },
  })
  await db.bookingServiceItem.deleteMany({ where: { booking: pro } })
  await db.booking.deleteMany({ where: pro })
  await db.proReminderSettings.deleteMany({ where: pro })
})

afterAll(async () => {
  if (fx) {
    const pro = { professionalId: fx.professionalId }
    await db.scheduledClientNotification.deleteMany({
      where: { clientId: fx.clientId },
    })
    await db.clientNotification.deleteMany({ where: { clientId: fx.clientId } })
    await db.proReminderSettings.deleteMany({ where: pro })
    await db.bookingServiceItem.deleteMany({ where: { booking: pro } })
    await db.booking.deleteMany({ where: pro })
    await db.professionalServiceOffering.deleteMany({ where: pro })
    await db.professionalLocation.deleteMany({ where: pro })
    await db.service.deleteMany({ where: { categoryId: fx.categoryId } })
    await db.serviceCategory.deleteMany({ where: { id: fx.categoryId } })
    await db.clientProfile.deleteMany({ where: { id: fx.clientId } })
    await db.professionalProfile.deleteMany({ where: { id: fx.professionalId } })
    await db.user.deleteMany({
      where: {
        email: { in: [`${TAG}_pro@example.com`, `${TAG}_client@example.com`] },
      },
    })
  }
  await db.$disconnect()
})

describe('saving a reminder cadence re-plans existing bookings (real DB)', () => {
  it('reaches a booking that was already on the calendar', async () => {
    const bookingId = await seedBooking({ scheduledFor: future(10, 17) })

    // The booking was written before this cadence existed, so it carries no
    // reminder rows at all — exactly the state a pro's first save finds.
    expect(await pendingReminders(bookingId)).toHaveLength(0)

    const result = await saveCadence([ONE_DAY, TWO_HOURS])

    expect(result.resyncedBookingCount).toBe(1)
    expect(result.hitResyncCap).toBe(false)

    const rows = await pendingReminders(bookingId)
    expect(rows.map((row) => row.dedupeKey)).toEqual([
      `CLIENT_REMINDER:M${ONE_DAY}:${bookingId}`,
      `CLIENT_REMINDER:M${TWO_HOURS}:${bookingId}`,
    ])

    // The sub-day lead is an exact instant offset from the appointment.
    const appointment = (
      await db.booking.findUniqueOrThrow({
        where: { id: bookingId },
        select: { scheduledFor: true },
      })
    ).scheduledFor

    expect(rows[1]?.runAt.getTime()).toBe(
      appointment.getTime() - TWO_HOURS * 60_000,
    )
  })

  it('adds only the newly enabled lead when the cadence grows', async () => {
    const bookingId = await seedBooking({ scheduledFor: future(10, 17) })

    await saveCadence([ONE_DAY])
    expect((await pendingReminders(bookingId)).map((r) => r.dedupeKey)).toEqual([
      `CLIENT_REMINDER:M${ONE_DAY}:${bookingId}`,
    ])

    await saveCadence([ONE_DAY, TWO_HOURS])

    expect((await pendingReminders(bookingId)).map((r) => r.dedupeKey)).toEqual([
      `CLIENT_REMINDER:M${ONE_DAY}:${bookingId}`,
      `CLIENT_REMINDER:M${TWO_HOURS}:${bookingId}`,
    ])
  })

  it('takes a lead back at once when it is removed, without waiting for the drain', async () => {
    const bookingId = await seedBooking({ scheduledFor: future(10, 17) })

    await saveCadence([ONE_DAY, TWO_HOURS])
    expect(await pendingReminders(bookingId)).toHaveLength(2)

    await saveCadence([ONE_DAY])

    expect((await pendingReminders(bookingId)).map((r) => r.dedupeKey)).toEqual([
      `CLIENT_REMINDER:M${ONE_DAY}:${bookingId}`,
    ])
  })

  it('cancels every pending reminder when reminders are turned off', async () => {
    const bookingId = await seedBooking({ scheduledFor: future(10, 17) })

    await saveCadence([ONE_DAY, TWO_HOURS])
    expect(await pendingReminders(bookingId)).toHaveLength(2)

    const result = await saveCadence([], false)

    expect(result.settings.enabled).toBe(false)
    expect(await pendingReminders(bookingId)).toHaveLength(0)
  })

  it('leaves past, finished and non-accepted bookings alone', async () => {
    const upcoming = await seedBooking({ scheduledFor: future(10, 17) })
    const alreadyHappened = await seedBooking({ scheduledFor: past(3, 17) })
    const pending = await seedBooking({
      scheduledFor: future(11, 17),
      status: BookingStatus.PENDING,
    })
    const finished = await seedBooking({
      scheduledFor: future(12, 17),
      status: BookingStatus.ACCEPTED,
      finishedAt: new Date(),
    })

    const result = await saveCadence([ONE_DAY])

    expect(result.resyncedBookingCount).toBe(1)
    expect(await pendingReminders(upcoming)).toHaveLength(1)
    expect(await pendingReminders(alreadyHappened)).toHaveLength(0)
    expect(await pendingReminders(pending)).toHaveLength(0)
    expect(await pendingReminders(finished)).toHaveLength(0)
  })

  it('does not resurrect the reminders a cancel already took away', async () => {
    const bookingId = await seedBooking({ scheduledFor: future(10, 17) })

    await saveCadence([ONE_DAY])
    expect(await pendingReminders(bookingId)).toHaveLength(1)

    await cancelBooking({
      bookingId,
      actor: { kind: 'pro', professionalId: fx.professionalId },
      notifyClient: false,
      reason: 'Testing the cadence fan-out.',
    })

    expect(await pendingReminders(bookingId)).toHaveLength(0)

    // `scheduleClientNotification` clears `cancelledAt` when it re-arms a row,
    // so a fan-out that swept in a cancelled booking would un-cancel its
    // reminders. It must not: the booking is no longer remindable.
    await saveCadence([ONE_DAY, TWO_HOURS])

    expect(await pendingReminders(bookingId)).toHaveLength(0)
  })

  // The 6 write paths that make a booking un-remindable WITHOUT cancelling its
  // reminders (session start, closeout, aftercare completion, the imported-event
  // reconciler) leave a live row behind on purpose — the drain refuses it at its
  // runAt. A cadence save must not adopt such a row either way: not re-plan it,
  // and not cancel it early on the pro's behalf.
  it('leaves a stale row on a no-longer-eligible booking exactly where it is', async () => {
    const bookingId = await seedBooking({ scheduledFor: future(10, 17) })

    await saveCadence([ONE_DAY])
    const [before] = await pendingReminders(bookingId)
    expect(before).toBeDefined()

    await db.booking.update({
      where: { id: bookingId },
      data: { status: BookingStatus.COMPLETED },
    })

    await saveCadence([ONE_DAY, TWO_HOURS])

    const after = await pendingReminders(bookingId)
    expect(after).toHaveLength(1)
    expect(after[0]?.dedupeKey).toBe(before?.dedupeKey)
    expect(after[0]?.runAt.getTime()).toBe(before?.runAt.getTime())
  })
})
