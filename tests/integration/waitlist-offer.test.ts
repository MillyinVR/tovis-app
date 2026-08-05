// tests/integration/waitlist-offer.test.ts
//
// Real-DB drive of the waitlist "Offer a time" client-confirm gate. Runs against
// the test database — `pnpm test:integration` (or the whole integration config).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  BookingStatus,
  NotificationEventKey,
  Prisma,
  PrismaClient,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
  WaitlistOfferStatus,
  WaitlistPreferenceType,
  WaitlistStatus,
} from '@prisma/client'

import {
  cancelClientWaitlistEntry,
  confirmClientWaitlistOffer,
  createHold,
  createWaitlistOffer,
  declineClientWaitlistOffer,
  expireLapsedWaitlistOffers,
  releaseHold,
} from '@/lib/booking/writeBoundary'
import { WAITLIST_OFFER_TTL_MINUTES } from '@/lib/booking/constants'
import { computeDaySlotsFast } from '@/lib/availability/core/dayComputation'
import { parseYYYYMMDD } from '@/lib/availability/core/summaryWindow'
import { loadBusyIntervalsForWindow } from '@/lib/booking/conflictQueries'
import { checkStoredSlotsAreOpen } from '@/lib/booking/storedSlotLiveness'
import { waitlistOfferLivenessCandidate } from '@/lib/waitlist/offerLiveness'
import { minutesSinceMidnightInTimeZone, utcDateToLocalYmd } from '@/lib/time'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with: pnpm test:integration')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const TAG = `waitlist_offer_${Date.now()}`

type Fixtures = {
  tenantId: string
  proUserId: string
  professionalId: string
  clientId: string
  /** A second client, for "someone else takes the slot" races. */
  rivalClientId: string
  serviceId: string
  salonLocationId: string
  offeringId: string
}

let fx: Fixtures

const ZONE = 'America/Los_Angeles'

/** A future UTC instant that lands mid-day (9:00–18:00) in America/Los_Angeles. */
function futureUtc(daysAhead: number, hourUtc: number): Date {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + daysAhead)
  d.setUTCHours(hourUtc, 0, 0, 0)
  return d
}

/**
 * A future UTC instant at exactly `hh:mm` LOCAL time in the fixture's zone,
 * derived from the zone itself rather than a hardcoded UTC offset (the suite
 * runs on both sides of a DST switch). Anchored at 20:00Z, which is the same
 * local calendar day in PT year-round, then shifted by the local delta.
 */
function futureLocal(daysAhead: number, hh: number, mm = 0): Date {
  const anchor = futureUtc(daysAhead, 20)
  const anchorLocalMinutes = minutesSinceMidnightInTimeZone(anchor, ZONE)
  return new Date(
    anchor.getTime() + (hh * 60 + mm - anchorLocalMinutes) * 60_000,
  )
}

function workingHours(): Prisma.InputJsonValue {
  const all = { enabled: true, start: '09:00', end: '18:00' }
  return { mon: all, tue: all, wed: all, thu: all, fri: all, sat: all, sun: all }
}

async function createEntry(): Promise<string> {
  const entry = await db.waitlistEntry.create({
    data: {
      clientId: fx.clientId,
      professionalId: fx.professionalId,
      serviceId: fx.serviceId,
      preferenceType: WaitlistPreferenceType.ANY_TIME,
      status: WaitlistStatus.ACTIVE,
    },
    select: { id: true },
  })
  return entry.id
}

beforeAll(async () => {
  // Backstop the partial unique index (schema push omits it — it lives only in
  // the raw-SQL migration), so this run matches prod regardless of DB state.
  await db.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "WaitlistOffer_one_pending_per_entry" ON "WaitlistOffer"("waitlistEntryId") WHERE "status" = 'PENDING';`,
  )

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
      firstName: 'Wait',
      lastName: 'Pro',
      businessName: 'Waitlist Studio',
      timeZone: 'America/Los_Angeles',
    },
    select: { id: true },
  })

  const clientUser = await db.user.create({
    data: { email: `${TAG}_client@example.com`, password: 'x', role: Role.CLIENT },
    select: { id: true },
  })
  const client = await db.clientProfile.create({
    data: {
      userId: clientUser.id,
      homeTenantId: tenant.id,
      firstName: 'Wanda',
      lastName: 'Waiter',
    },
    select: { id: true },
  })

  const rivalUser = await db.user.create({
    data: { email: `${TAG}_rival@example.com`, password: 'x', role: Role.CLIENT },
    select: { id: true },
  })
  const rivalClient = await db.clientProfile.create({
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
      defaultDurationMinutes: 60,
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
      timeZone: 'America/Los_Angeles',
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
      salonDurationMinutes: 60,
    },
    select: { id: true },
  })

  fx = {
    tenantId: tenant.id,
    proUserId: proUser.id,
    professionalId: professional.id,
    clientId: client.id,
    rivalClientId: rivalClient.id,
    serviceId: service.id,
    salonLocationId: salon.id,
    offeringId: offering.id,
  }
})

afterAll(async () => {
  if (fx) {
    const pro = { professionalId: fx.professionalId }
    // FK-safe teardown: clear rows that reference bookings/clients first, then
    // the pro's bookings/offers, then catalog + profiles, then the users.
    await db.scheduledClientNotification.deleteMany({ where: { clientId: fx.clientId } })
    await db.clientNotification.deleteMany({ where: { clientId: fx.clientId } })
    await db.reminder.deleteMany({ where: pro })
    await db.notification.deleteMany({ where: pro })
    await db.bookingServiceItem.deleteMany({ where: { booking: pro } })
    // Holds before offers/locations: ProfessionalLocation RESTRICTs a referencing
    // hold, and an offer's own hold would otherwise only go via its cascade.
    await db.bookingHold.deleteMany({ where: pro })
    await db.waitlistOffer.deleteMany({ where: pro })
    await db.waitlistEntry.deleteMany({ where: pro })
    await db.booking.deleteMany({ where: pro })
    await db.professionalServiceOffering.deleteMany({ where: pro })
    await db.professionalLocation.deleteMany({ where: pro })
    await db.professionalPaymentSettings.deleteMany({ where: pro })
    await db.service.deleteMany({ where: { id: fx.serviceId } })
    await db.serviceCategory.deleteMany({ where: { name: `${TAG} Cat` } })
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

describe('waitlist offer → client confirm (real DB)', () => {
  it('creates a PENDING offer, notifies the client, and moves the entry to NOTIFIED', async () => {
    const entryId = await createEntry()
    const start = futureUtc(7, 19) // ~noon PT

    const { offer } = await createWaitlistOffer({
      professionalId: fx.professionalId,
      actorUserId: fx.proUserId,
      waitlistEntryId: entryId,
      scheduledFor: start,
      endsAt: new Date(start.getTime() + 60 * 60_000),
      locationId: fx.salonLocationId,
      locationType: ServiceLocationType.SALON,
      durationMinutes: 60,
    })

    expect(offer.status).toBe(WaitlistOfferStatus.PENDING)

    const entry = await db.waitlistEntry.findUnique({ where: { id: entryId } })
    expect(entry?.status).toBe(WaitlistStatus.NOTIFIED)

    const notif = await db.clientNotification.findFirst({
      where: { clientId: fx.clientId },
    })
    expect(notif).not.toBeNull()
  })

  it('supersedes a prior PENDING offer (partial unique index holds)', async () => {
    const entryId = await createEntry()
    const s1 = futureUtc(8, 18)
    const s2 = futureUtc(9, 19)

    const first = await createWaitlistOffer({
      professionalId: fx.professionalId,
      actorUserId: fx.proUserId,
      waitlistEntryId: entryId,
      scheduledFor: s1,
      endsAt: new Date(s1.getTime() + 60 * 60_000),
      locationId: fx.salonLocationId,
      locationType: ServiceLocationType.SALON,
      durationMinutes: 60,
    })

    const second = await createWaitlistOffer({
      professionalId: fx.professionalId,
      actorUserId: fx.proUserId,
      waitlistEntryId: entryId,
      scheduledFor: s2,
      endsAt: new Date(s2.getTime() + 60 * 60_000),
      locationId: fx.salonLocationId,
      locationType: ServiceLocationType.SALON,
      durationMinutes: 60,
    })

    const firstRow = await db.waitlistOffer.findUnique({
      where: { id: first.offer.id },
    })
    expect(firstRow?.status).toBe(WaitlistOfferStatus.CANCELLED)

    const pendingCount = await db.waitlistOffer.count({
      where: { waitlistEntryId: entryId, status: WaitlistOfferStatus.PENDING },
    })
    expect(pendingCount).toBe(1)
    expect(second.offer.status).toBe(WaitlistOfferStatus.PENDING)
  })

  it('rejects a direct second PENDING row via the partial unique index', async () => {
    const entryId = await createEntry()
    const base = {
      waitlistEntryId: entryId,
      professionalId: fx.professionalId,
      clientId: fx.clientId,
      offeringId: fx.offeringId,
      locationId: fx.salonLocationId,
      locationType: ServiceLocationType.SALON,
      startsAt: futureUtc(10, 19),
      endsAt: futureUtc(10, 20),
      durationMinutes: 60,
      status: WaitlistOfferStatus.PENDING,
    }
    await db.waitlistOffer.create({ data: base })
    await expect(db.waitlistOffer.create({ data: base })).rejects.toMatchObject({
      code: 'P2002',
    })
  })

  it('confirm materializes an ACCEPTED booking and marks the entry BOOKED', async () => {
    const entryId = await createEntry()
    const start = futureUtc(11, 19)

    const { offer } = await createWaitlistOffer({
      professionalId: fx.professionalId,
      actorUserId: fx.proUserId,
      waitlistEntryId: entryId,
      scheduledFor: start,
      endsAt: new Date(start.getTime() + 60 * 60_000),
      locationId: fx.salonLocationId,
      locationType: ServiceLocationType.SALON,
      durationMinutes: 60,
    })

    const result = await confirmClientWaitlistOffer({
      offerId: offer.id,
      clientId: fx.clientId,
      idempotencyKey: `${TAG}-confirm-1`,
    })

    expect(result.booking.status).toBe(BookingStatus.ACCEPTED)

    const booking = await db.booking.findUnique({
      where: { id: result.booking.id },
      select: { status: true, professionalId: true, clientId: true, offeringId: true },
    })
    expect(booking?.status).toBe(BookingStatus.ACCEPTED)
    expect(booking?.clientId).toBe(fx.clientId)

    const offerRow = await db.waitlistOffer.findUnique({ where: { id: offer.id } })
    expect(offerRow?.status).toBe(WaitlistOfferStatus.ACCEPTED)
    expect(offerRow?.bookingId).toBe(result.booking.id)

    const entry = await db.waitlistEntry.findUnique({ where: { id: entryId } })
    expect(entry?.status).toBe(WaitlistStatus.BOOKED)

    // A second confirm of the now-accepted offer is rejected (not double-booked).
    await expect(
      confirmClientWaitlistOffer({
        offerId: offer.id,
        clientId: fx.clientId,
        idempotencyKey: `${TAG}-confirm-2`,
      }),
    ).rejects.toMatchObject({ code: 'WAITLIST_OFFER_NOT_PENDING' })
  })

  // F5 notes that no hold is placed between offer and confirm, so the slot can
  // evaporate; this pins that it "fails cleanly with TIME_BOOKED" rather than
  // double-booking or 500ing.
  //
  // It also pins WHICH LAYER refused. The app gate and the database EXCLUDE
  // constraint both surface `TIME_BOOKED`, so asserting the error code alone
  // cannot tell them apart — this test passed with the conflict finder
  // deliberately blinded, because Postgres was quietly doing the refusing. The
  // `booking_conflict` log line is the only discriminator, so it is asserted
  // here: the app gate must be what refused, and the durable backstop must NOT
  // have fired.
  it('confirm refuses with TIME_BOOKED, and it is the APP GATE that refuses', async () => {
    const entryId = await createEntry()
    const start = futureUtc(13, 19)

    const { offer } = await createWaitlistOffer({
      professionalId: fx.professionalId,
      actorUserId: fx.proUserId,
      waitlistEntryId: entryId,
      scheduledFor: start,
      endsAt: new Date(start.getTime() + 60 * 60_000),
      locationId: fx.salonLocationId,
      locationType: ServiceLocationType.SALON,
      durationMinutes: 60,
    })

    // The slot evaporates between offer and confirm. Since F14 the offer DOES
    // place a BookingHold — but a direct Booking insert bypasses the app gate,
    // and the Booking-table EXCLUDE doesn't cross-check BookingHold, so the
    // rival row lands anyway. Which is the point: confirm must still refuse
    // cleanly when the reservation failed to protect the slot.
    await db.booking.create({
      data: {
        client: { connect: { id: fx.clientId } },
        professional: { connect: { id: fx.professionalId } },
        proTenant: { connect: { id: fx.tenantId } },
        clientHomeTenant: { connect: { id: fx.tenantId } },
        service: { connect: { id: fx.serviceId } },
        offering: { connect: { id: fx.offeringId } },
        location: { connect: { id: fx.salonLocationId } },
        status: BookingStatus.ACCEPTED,
        scheduledFor: new Date(start.getTime() + 30 * 60_000),
        totalDurationMinutes: 60,
        bufferMinutes: 0,
        locationType: ServiceLocationType.SALON,
        locationTimeZone: 'America/Los_Angeles',
        subtotalSnapshot: new Prisma.Decimal('100.00'),
        totalAmount: new Prisma.Decimal('100.00'),
      },
      select: { id: true },
    })

    // logBookingConflict writes a JSON line to console.warn; that is the only
    // place the two enforcement layers are distinguishable.
    const conflictLines: string[] = []
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation((...parts: unknown[]) => {
        conflictLines.push(parts.map((part) => String(part)).join(' '))
      })

    try {
      await expect(
        confirmClientWaitlistOffer({
          offerId: offer.id,
          clientId: fx.clientId,
          idempotencyKey: `${TAG}-confirm-conflict`,
        }),
      ).rejects.toMatchObject({ code: 'TIME_BOOKED' })
    } finally {
      warnSpy.mockRestore()
    }

    const conflictEvents = conflictLines
      .map((line) => {
        try {
          return JSON.parse(line) as {
            event?: string
            meta?: Record<string, unknown> | null
          }
        } catch {
          return null
        }
      })
      .filter((parsed) => parsed?.event === 'booking_conflict')

    expect(conflictEvents.length).toBeGreaterThan(0)

    // The app-level overlap gate refused: it logged a decision code.
    expect(
      conflictEvents.some((e) => e?.meta?.overlapDecisionCode != null),
    ).toBe(true)

    // ...and the durable DB backstop never had to fire. If this flips, the gate
    // stopped finding conflicts and Postgres is silently covering for it.
    expect(conflictEvents.some((e) => e?.meta?.layer === 'db_backstop')).toBe(
      false,
    )

    // The refusal left the offer claimable, not consumed.
    const offerRow = await db.waitlistOffer.findUnique({
      where: { id: offer.id },
    })
    expect(offerRow?.status).toBe(WaitlistOfferStatus.PENDING)
    expect(offerRow?.bookingId).toBeNull()
  })

  // ── F5: the offer must promise only what the confirm can actually book ──────
  //
  // `confirmClientWaitlistOffer` runs `performLockedCreateProBooking` with
  // `allowOutsideWorkingHours: false`, so an off-hours offer is one the client
  // physically cannot accept. Before the fix these three cases were asymmetric:
  // the offer was created happily and the client's Confirm 400'd — a refusal
  // aimed at the one person who cannot act on it.

  it('refuses an offer whose window runs past the pro’s closing time', async () => {
    const entryId = await createEntry()
    // 17:30 local start + 60 min = 18:30, past the fixture's 18:00 close. The
    // START is inside working hours, so only the full-range guard can catch it.
    const start = futureLocal(14, 17, 30)

    await expect(
      createWaitlistOffer({
        professionalId: fx.professionalId,
        actorUserId: fx.proUserId,
        waitlistEntryId: entryId,
        scheduledFor: start,
        endsAt: new Date(start.getTime() + 60 * 60_000),
        locationId: fx.salonLocationId,
        locationType: ServiceLocationType.SALON,
        durationMinutes: 60,
      }),
    ).rejects.toMatchObject({ code: 'OUTSIDE_WORKING_HOURS' })

    // The refusal wrote nothing: no offer row, and the entry never left ACTIVE.
    const offerCount = await db.waitlistOffer.count({
      where: { waitlistEntryId: entryId },
    })
    expect(offerCount).toBe(0)

    const entry = await db.waitlistEntry.findUnique({ where: { id: entryId } })
    expect(entry?.status).toBe(WaitlistStatus.ACTIVE)
  })

  // A start BEFORE the window opens fails the step-alignment helper first
  // (`reason: before-window-start`). The confirm passes `enforceStepGrid: false`
  // because the PRO picked the minute, so the offer gate must too — if this ever
  // reports STEP_MISMATCH the offer became stricter than the confirm it mirrors.
  it('refuses an offer before the pro opens — as OUTSIDE_WORKING_HOURS, not STEP_MISMATCH', async () => {
    const entryId = await createEntry()
    const start = futureLocal(15, 7, 0) // 07:00 local, two hours before the 09:00 open

    await expect(
      createWaitlistOffer({
        professionalId: fx.professionalId,
        actorUserId: fx.proUserId,
        waitlistEntryId: entryId,
        scheduledFor: start,
        endsAt: new Date(start.getTime() + 60 * 60_000),
        locationId: fx.salonLocationId,
        locationType: ServiceLocationType.SALON,
        durationMinutes: 60,
      }),
    ).rejects.toMatchObject({ code: 'OUTSIDE_WORKING_HOURS' })
  })

  // The discriminating half. A refusal test proves nothing about a gate that is
  // too strict, and over-enforcement here is invisible from the refusal side: it
  // shows up only as an offer the pro should be able to send and cannot. This
  // pins the exact boundary — a window ending ON the closing minute — and takes
  // it all the way through the client's confirm.
  it('still offers, and confirms, a window that ends exactly at closing time', async () => {
    const entryId = await createEntry()
    const start = futureLocal(16, 17, 0) // 17:00 + 60 min = 18:00 sharp

    const { offer } = await createWaitlistOffer({
      professionalId: fx.professionalId,
      actorUserId: fx.proUserId,
      waitlistEntryId: entryId,
      scheduledFor: start,
      endsAt: new Date(start.getTime() + 60 * 60_000),
      locationId: fx.salonLocationId,
      locationType: ServiceLocationType.SALON,
      durationMinutes: 60,
    })
    expect(offer.status).toBe(WaitlistOfferStatus.PENDING)

    const result = await confirmClientWaitlistOffer({
      offerId: offer.id,
      clientId: fx.clientId,
      idempotencyKey: `${TAG}-confirm-closing-edge`,
    })
    expect(result.booking.status).toBe(BookingStatus.ACCEPTED)
    expect(result.booking.scheduledFor.getTime()).toBe(start.getTime())
  })

  // The conflict check moved from a standalone getTimeRangeConflict call into
  // the shared scheduling gate, so this pins that a calendar block still stops
  // an offer on real Postgres — and now over the buffered window the confirm
  // reserves, not the caller's raw start/end pair.
  it('still refuses an offer over a calendar block', async () => {
    const entryId = await createEntry()
    const start = futureLocal(17, 13, 0)

    const block = await db.calendarBlock.create({
      data: {
        professionalId: fx.professionalId,
        locationId: fx.salonLocationId,
        startsAt: new Date(start.getTime() + 30 * 60_000),
        endsAt: new Date(start.getTime() + 90 * 60_000),
        note: 'Lunch',
      },
      select: { id: true },
    })

    try {
      await expect(
        createWaitlistOffer({
          professionalId: fx.professionalId,
          actorUserId: fx.proUserId,
          waitlistEntryId: entryId,
          scheduledFor: start,
          endsAt: new Date(start.getTime() + 60 * 60_000),
          locationId: fx.salonLocationId,
          locationType: ServiceLocationType.SALON,
          durationMinutes: 60,
        }),
      ).rejects.toMatchObject({ code: 'TIME_BLOCKED' })
    } finally {
      await db.calendarBlock.delete({ where: { id: block.id } })
    }
  })

  // Booking/hold conflicts are only fatal in the shared gate when the caller
  // says no overlap policy will run afterwards. Nothing runs after this one, so
  // deferring would silently let the pro promise a slot that is already taken.
  it('still refuses an offer over an existing booking', async () => {
    const entryId = await createEntry()
    const start = futureLocal(18, 13, 0)

    const taken = await db.booking.create({
      data: {
        client: { connect: { id: fx.clientId } },
        professional: { connect: { id: fx.professionalId } },
        proTenant: { connect: { id: fx.tenantId } },
        clientHomeTenant: { connect: { id: fx.tenantId } },
        service: { connect: { id: fx.serviceId } },
        offering: { connect: { id: fx.offeringId } },
        location: { connect: { id: fx.salonLocationId } },
        status: BookingStatus.ACCEPTED,
        scheduledFor: new Date(start.getTime() + 30 * 60_000),
        totalDurationMinutes: 60,
        bufferMinutes: 0,
        locationType: ServiceLocationType.SALON,
        locationTimeZone: ZONE,
        subtotalSnapshot: new Prisma.Decimal('100.00'),
        totalAmount: new Prisma.Decimal('100.00'),
      },
      select: { id: true },
    })

    try {
      await expect(
        createWaitlistOffer({
          professionalId: fx.professionalId,
          actorUserId: fx.proUserId,
          waitlistEntryId: entryId,
          scheduledFor: start,
          endsAt: new Date(start.getTime() + 60 * 60_000),
          locationId: fx.salonLocationId,
          locationType: ServiceLocationType.SALON,
          durationMinutes: 60,
        }),
      ).rejects.toMatchObject({ code: 'TIME_BOOKED' })
    } finally {
      await db.booking.delete({ where: { id: taken.id } })
    }
  })

  // ── F14: a pro-CHOSEN time reserves the spot ────────────────────────────────
  //
  // Tori, 2026-07-21: "if a pro chooses a time it should reserve the spot."
  // The offer now places a BookingHold over the window it promised, released
  // wherever the offer stops being live.

  /** The hold reserving an offer's slot, or null. */
  async function holdForOffer(offerId: string) {
    return db.bookingHold.findFirst({ where: { waitlistOfferId: offerId } })
  }

  /** The offering fields createHold needs, for a rival client racing the slot. */
  const holdOffering = () => ({
    id: fx.offeringId,
    professionalId: fx.professionalId,
    offersInSalon: true,
    offersMobile: false,
    salonDurationMinutes: 60,
    mobileDurationMinutes: null,
    salonPriceStartingAt: new Prisma.Decimal('100.00'),
    mobilePriceStartingAt: null,
    professionalTimeZone: ZONE,
  })

  /** Does the pro's live availability still emit `start` as a bookable slot? */
  async function availabilityOffers(start: Date): Promise<boolean> {
    const busy = await loadBusyIntervalsForWindow({
      professionalId: fx.professionalId,
      locationId: fx.salonLocationId,
      windowStartUtc: new Date(start.getTime() - 6 * 60 * 60_000),
      windowEndUtc: new Date(start.getTime() + 6 * 60 * 60_000),
      defaultBufferMinutes: 0,
    })

    const dateYMD = parseYYYYMMDD(utcDateToLocalYmd(start, ZONE))
    if (!dateYMD) throw new Error('fixture start is not a valid local date')

    const result = await computeDaySlotsFast({
      dateYMD,
      durationMinutes: 60,
      stepMinutes: 15,
      timeZone: ZONE,
      workingHours: workingHours(),
      leadTimeMinutes: 0,
      locationBufferMinutes: 0,
      maxAdvanceDays: 365,
      busy,
    })

    if (!result.ok) throw new Error(`availability failed: ${result.code}`)

    return result.slots.some(
      (slot) => new Date(slot).getTime() === start.getTime(),
    )
  }

  it('reserves the offered slot with a hold that expires with the offer', async () => {
    const entryId = await createEntry()
    const start = futureLocal(20, 13, 0)

    // The slot is genuinely on offer before we take it, or the assertion below
    // would pass against a slot that was never bookable.
    expect(await availabilityOffers(start)).toBe(true)

    const before = Date.now()
    const { offer } = await createWaitlistOffer({
      professionalId: fx.professionalId,
      actorUserId: fx.proUserId,
      waitlistEntryId: entryId,
      scheduledFor: start,
      endsAt: new Date(start.getTime() + 60 * 60_000),
      locationId: fx.salonLocationId,
      locationType: ServiceLocationType.SALON,
      durationMinutes: 60,
    })

    const hold = await holdForOffer(offer.id)
    expect(hold).not.toBeNull()
    expect(hold?.scheduledFor.getTime()).toBe(start.getTime())
    expect(hold?.clientId).toBe(fx.clientId)
    expect(hold?.durationMinutesSnapshot).toBe(60)
    expect(hold?.endsAtSnapshot?.getTime()).toBe(start.getTime() + 60 * 60_000)

    // The reservation and the offer die together: one policy, two rows.
    expect(hold?.expiresAt.getTime()).toBe(offer.expiresAt.getTime())

    // 24h TTL — the slot is 20 days out, so the advance-notice ceiling
    // (advanceNoticeMinutes = 0 here) is not the binding one.
    const ttlMs = WAITLIST_OFFER_TTL_MINUTES * 60_000
    expect(offer.expiresAt.getTime()).toBeGreaterThanOrEqual(before + ttlMs - 5_000)
    expect(offer.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + ttlMs)

    // …and the point of all of it: the slot has left the pro's availability.
    expect(await availabilityOffers(start)).toBe(false)
  })

  // The guarantee itself. Without the hold this create SUCCEEDS and the waitlist
  // client's confirm later fails — exactly the promise F14 forbids.
  it('stops another client taking the offered slot', async () => {
    const entryId = await createEntry()
    const start = futureLocal(21, 13, 0)

    await createWaitlistOffer({
      professionalId: fx.professionalId,
      actorUserId: fx.proUserId,
      waitlistEntryId: entryId,
      scheduledFor: start,
      endsAt: new Date(start.getTime() + 60 * 60_000),
      locationId: fx.salonLocationId,
      locationType: ServiceLocationType.SALON,
      durationMinutes: 60,
    })

    await expect(
      createHold({
        clientId: fx.rivalClientId,
        bookingEntryPoint: 'DIRECT_PROFILE',
        addOnIds: [],
        offering: holdOffering(),
        requestedStart: start,
        requestedLocationId: fx.salonLocationId,
        locationType: ServiceLocationType.SALON,
        clientAddressId: null,
      }),
    ).rejects.toMatchObject({ code: 'TIME_HELD' })
  })

  // The offered client browsing for a DIFFERENT appointment must not silently
  // hand their reservation back: performLockedCreateHold drops that client's
  // live holds with this pro, and the offer's hold is exempt by waitlistOfferId.
  it('survives the same client starting an unrelated hold', async () => {
    const entryId = await createEntry()
    const offered = futureLocal(22, 13, 0)
    const elsewhere = futureLocal(22, 16, 0)

    const { offer } = await createWaitlistOffer({
      professionalId: fx.professionalId,
      actorUserId: fx.proUserId,
      waitlistEntryId: entryId,
      scheduledFor: offered,
      endsAt: new Date(offered.getTime() + 60 * 60_000),
      locationId: fx.salonLocationId,
      locationType: ServiceLocationType.SALON,
      durationMinutes: 60,
    })

    const own = await createHold({
      clientId: fx.clientId,
      bookingEntryPoint: 'DIRECT_PROFILE',
      addOnIds: [],
      offering: holdOffering(),
      requestedStart: elsewhere,
      requestedLocationId: fx.salonLocationId,
      locationType: ServiceLocationType.SALON,
      clientAddressId: null,
    })

    expect(await holdForOffer(offer.id)).not.toBeNull()
    expect(await availabilityOffers(offered)).toBe(false)

    // The client's own hold is still subject to the one-per-pro rule.
    await db.bookingHold.deleteMany({ where: { id: own.hold.id } })
  })

  // Declining is how the client gives the time back.
  it('decline releases the reservation', async () => {
    const entryId = await createEntry()
    const start = futureLocal(23, 13, 0)

    const { offer } = await createWaitlistOffer({
      professionalId: fx.professionalId,
      actorUserId: fx.proUserId,
      waitlistEntryId: entryId,
      scheduledFor: start,
      endsAt: new Date(start.getTime() + 60 * 60_000),
      locationId: fx.salonLocationId,
      locationType: ServiceLocationType.SALON,
      durationMinutes: 60,
    })
    expect(await holdForOffer(offer.id)).not.toBeNull()

    await declineClientWaitlistOffer({ offerId: offer.id, clientId: fx.clientId })

    expect(await holdForOffer(offer.id)).toBeNull()
    expect(await availabilityOffers(start)).toBe(true)
  })

  // Re-offering an OVERLAPPING time is the case the day-apart supersede test
  // above cannot reach: the pro's own outstanding reservation is a fatal HOLD
  // conflict at the gate, so the supersede has to release it FIRST.
  it('re-offers an overlapping time, releasing the superseded reservation first', async () => {
    const entryId = await createEntry()
    const first = futureLocal(24, 13, 0)
    const second = futureLocal(24, 13, 30) // overlaps the first 60-min window

    const one = await createWaitlistOffer({
      professionalId: fx.professionalId,
      actorUserId: fx.proUserId,
      waitlistEntryId: entryId,
      scheduledFor: first,
      endsAt: new Date(first.getTime() + 60 * 60_000),
      locationId: fx.salonLocationId,
      locationType: ServiceLocationType.SALON,
      durationMinutes: 60,
    })

    const two = await createWaitlistOffer({
      professionalId: fx.professionalId,
      actorUserId: fx.proUserId,
      waitlistEntryId: entryId,
      scheduledFor: second,
      endsAt: new Date(second.getTime() + 60 * 60_000),
      locationId: fx.salonLocationId,
      locationType: ServiceLocationType.SALON,
      durationMinutes: 60,
    })

    expect(await holdForOffer(one.offer.id)).toBeNull()
    expect(await holdForOffer(two.offer.id)).not.toBeNull()

    // Exactly one reservation for this entry — the replacement's.
    const liveHolds = await db.bookingHold.count({
      where: { waitlistOffer: { waitlistEntryId: entryId } },
    })
    expect(liveHolds).toBe(1)
  })

  // Confirming books over the offer's OWN reservation. The create runs the
  // overlap policy as a CLIENT, so an unreleased hold refuses with TIME_HELD.
  it('confirm books the reserved slot and consumes the reservation', async () => {
    const entryId = await createEntry()
    const start = futureLocal(25, 13, 0)

    const { offer } = await createWaitlistOffer({
      professionalId: fx.professionalId,
      actorUserId: fx.proUserId,
      waitlistEntryId: entryId,
      scheduledFor: start,
      endsAt: new Date(start.getTime() + 60 * 60_000),
      locationId: fx.salonLocationId,
      locationType: ServiceLocationType.SALON,
      durationMinutes: 60,
    })

    const result = await confirmClientWaitlistOffer({
      offerId: offer.id,
      clientId: fx.clientId,
      idempotencyKey: `${TAG}-confirm-reserved`,
    })

    expect(result.booking.status).toBe(BookingStatus.ACCEPTED)
    expect(result.booking.scheduledFor.getTime()).toBe(start.getTime())
    expect(await holdForOffer(offer.id)).toBeNull()
  })

  // The reservation is the pro's, not the client's: DECLINE gives it back, a
  // hold release does not. Unreachable through the UI (the hold id is never on
  // an offer surface) — asserted so it stays that way.
  it('refuses a client releasing the reservation as an ordinary hold', async () => {
    const entryId = await createEntry()
    const start = futureLocal(26, 13, 0)

    const { offer } = await createWaitlistOffer({
      professionalId: fx.professionalId,
      actorUserId: fx.proUserId,
      waitlistEntryId: entryId,
      scheduledFor: start,
      endsAt: new Date(start.getTime() + 60 * 60_000),
      locationId: fx.salonLocationId,
      locationType: ServiceLocationType.SALON,
      durationMinutes: 60,
    })

    const hold = await holdForOffer(offer.id)
    expect(hold).not.toBeNull()

    await expect(
      releaseHold({ holdId: hold!.id, clientId: fx.clientId }),
    ).rejects.toMatchObject({ code: 'HOLD_FORBIDDEN' })

    expect(await holdForOffer(offer.id)).not.toBeNull()
  })

  // The hold EXCLUDE constraint carries no expiry predicate, so a dead hold row
  // still occupies the index until the 5-minute sweep cron clears it — while the
  // app gate, which filters on expiresAt, calls the slot free. The offer must
  // clear the pro's expired rows itself or the insert 23P01s on a hold the gate
  // already waved through. An ALLOW case: the refusal side cannot show this.
  it('offers a slot whose only occupant is an expired hold', async () => {
    const entryId = await createEntry()
    const start = futureLocal(28, 13, 0)

    const stale = await db.bookingHold.create({
      data: {
        professionalId: fx.professionalId,
        clientId: fx.rivalClientId,
        offeringId: fx.offeringId,
        locationId: fx.salonLocationId,
        locationType: ServiceLocationType.SALON,
        scheduledFor: start,
        endsAtSnapshot: new Date(start.getTime() + 60 * 60_000),
        durationMinutesSnapshot: 60,
        bufferMinutesSnapshot: 0,
        expiresAt: new Date(Date.now() - 60_000),
      },
      select: { id: true },
    })

    const { offer } = await createWaitlistOffer({
      professionalId: fx.professionalId,
      actorUserId: fx.proUserId,
      waitlistEntryId: entryId,
      scheduledFor: start,
      endsAt: new Date(start.getTime() + 60 * 60_000),
      locationId: fx.salonLocationId,
      locationType: ServiceLocationType.SALON,
      durationMinutes: 60,
    })

    expect(await holdForOffer(offer.id)).not.toBeNull()
    expect(
      await db.bookingHold.findUnique({ where: { id: stale.id } }),
    ).toBeNull()
  })

  // The TTL's other half: an offer must not outlive the moment its confirm
  // starts refusing ADVANCE_NOTICE_REQUIRED, which lands well inside 24h for a
  // pro with real advance notice.
  it('expires at the advance-notice cutoff when that comes before 24h', async () => {
    const entryId = await createEntry()
    // Tomorrow at 13:00 local: 20–44h out depending on the clock, so the notice
    // is derived from the real gap rather than assumed. One hour short of it
    // keeps the offer sendable (the gate needs start >= now + notice) while
    // putting the cutoff an hour from now — far inside the 24h TTL, whichever
    // of the two would otherwise win.
    const start = futureLocal(1, 13, 0)
    const gapMinutes = Math.floor((start.getTime() - Date.now()) / 60_000)
    const advanceNoticeMinutes = Math.min(24 * 60, Math.max(15, gapMinutes - 60))

    await db.professionalLocation.update({
      where: { id: fx.salonLocationId },
      data: { advanceNoticeMinutes },
    })

    try {
      const { offer } = await createWaitlistOffer({
        professionalId: fx.professionalId,
        actorUserId: fx.proUserId,
        waitlistEntryId: entryId,
        scheduledFor: start,
        endsAt: new Date(start.getTime() + 60 * 60_000),
        locationId: fx.salonLocationId,
        locationType: ServiceLocationType.SALON,
        durationMinutes: 60,
      })

      expect(offer.expiresAt.getTime()).toBe(
        start.getTime() - advanceNoticeMinutes * 60_000,
      )

      const hold = await holdForOffer(offer.id)
      expect(hold?.expiresAt.getTime()).toBe(offer.expiresAt.getTime())
    } finally {
      await db.professionalLocation.update({
        where: { id: fx.salonLocationId },
        data: { advanceNoticeMinutes: 0 },
      })
    }
  })

  it('decline marks the offer DECLINED and returns the entry to ACTIVE', async () => {
    const entryId = await createEntry()
    const start = futureUtc(12, 19)

    const { offer } = await createWaitlistOffer({
      professionalId: fx.professionalId,
      actorUserId: fx.proUserId,
      waitlistEntryId: entryId,
      scheduledFor: start,
      endsAt: new Date(start.getTime() + 60 * 60_000),
      locationId: fx.salonLocationId,
      locationType: ServiceLocationType.SALON,
      durationMinutes: 60,
    })

    await declineClientWaitlistOffer({ offerId: offer.id, clientId: fx.clientId })

    const offerRow = await db.waitlistOffer.findUnique({ where: { id: offer.id } })
    expect(offerRow?.status).toBe(WaitlistOfferStatus.DECLINED)

    const entry = await db.waitlistEntry.findUnique({ where: { id: entryId } })
    expect(entry?.status).toBe(WaitlistStatus.ACTIVE)

    // A foreign client cannot act on the offer (uniform not-found).
    await expect(
      declineClientWaitlistOffer({ offerId: offer.id, clientId: 'someone_else' }),
    ).rejects.toMatchObject({ code: 'WAITLIST_OFFER_NOT_FOUND' })
  })

  // ---------------------------------------------------------------------------
  // F15 — the client's offer card is re-checked against the live schedule.
  //
  // F14 closed "someone else took it" with a real reservation. What a hold
  // cannot stop is the PRO changing their mind afterwards: blocking that time,
  // or shortening the day around it. Either leaves a Confirm button whose only
  // outcome is a refusal, which is the shape of card F5 existed to remove.
  // ---------------------------------------------------------------------------
  describe('client feed liveness (F15)', () => {
    /** The offer as `GET /api/v1/client/waitlist-offers` reads it. */
    async function offerVisibility(offerId: string) {
      const row = await db.waitlistOffer.findUniqueOrThrow({
        where: { id: offerId },
        select: {
          id: true,
          professionalId: true,
          professional: { select: { timeZone: true } },
          locationId: true,
          locationType: true,
          startsAt: true,
          durationMinutes: true,
          hold: { select: { id: true } },
        },
      })

      const candidate = waitlistOfferLivenessCandidate(row)
      const verdicts = await checkStoredSlotsAreOpen({
        candidates: [candidate],
        viewerClientId: fx.clientId,
      })

      const verdict = verdicts.get(candidate.key)
      if (!verdict) throw new Error('no verdict for offer')
      return verdict.open ? { open: true } : { open: false, reason: verdict.reason }
    }

    async function offerAt(start: Date) {
      const entryId = await createEntry()
      const { offer } = await createWaitlistOffer({
        professionalId: fx.professionalId,
        actorUserId: fx.proUserId,
        waitlistEntryId: entryId,
        scheduledFor: start,
        endsAt: new Date(start.getTime() + 60 * 60_000),
        locationId: fx.salonLocationId,
        locationType: ServiceLocationType.SALON,
        durationMinutes: 60,
      })
      return offer
    }

    // THE ALLOW CASE, and the one that matters most here: F14 gave the offer its
    // own hold, so a naive "is this slot free?" read would answer NO for every
    // live offer and empty the feed.
    it('shows a live offer, discounting the reservation the offer itself placed', async () => {
      const offer = await offerAt(futureLocal(30, 13, 0))

      // The reservation really is there — this is not passing because F14 is off.
      const hold = await holdForOffer(offer.id)
      expect(hold).not.toBeNull()

      expect(await offerVisibility(offer.id)).toEqual({ open: true })
    })

    it('hides an offer the pro blocked off afterwards', async () => {
      const start = futureLocal(31, 13, 0)
      const offer = await offerAt(start)

      await db.calendarBlock.create({
        data: {
          professionalId: fx.professionalId,
          locationId: fx.salonLocationId,
          startsAt: new Date(start.getTime() - 15 * 60_000),
          endsAt: new Date(start.getTime() + 15 * 60_000),
          note: 'Closed',
        },
      })

      expect(await offerVisibility(offer.id)).toEqual({
        open: false,
        reason: 'TIME_BLOCKED',
      })
    })

    it('hides an offer that fell outside newly-narrowed working hours', async () => {
      const start = futureLocal(32, 16, 0)
      const offer = await offerAt(start)

      const original = await db.professionalLocation.findUniqueOrThrow({
        where: { id: fx.salonLocationId },
        select: { workingHours: true },
      })

      const narrowed = { enabled: true, start: '09:00', end: '15:00' }
      await db.professionalLocation.update({
        where: { id: fx.salonLocationId },
        data: {
          workingHours: {
            mon: narrowed,
            tue: narrowed,
            wed: narrowed,
            thu: narrowed,
            fri: narrowed,
            sat: narrowed,
            sun: narrowed,
          },
        },
      })

      try {
        expect(await offerVisibility(offer.id)).toEqual({
          open: false,
          reason: 'OUTSIDE_WORKING_HOURS',
        })
      } finally {
        await db.professionalLocation.update({
          where: { id: fx.salonLocationId },
          data: {
            workingHours: (original.workingHours ?? {}) as Prisma.InputJsonValue,
          },
        })
      }
    })

    // A pro MAY double-book themselves (`PRO_AUTHORIZED_OVERLAP` stamps
    // allowsOverlap), so a booking really can land on top of the reservation —
    // and then the client's confirm, which runs as a CLIENT, refuses.
    it('hides an offer the pro booked over', async () => {
      const start = futureLocal(33, 13, 0)
      const offer = await offerAt(start)

      await db.booking.create({
        data: {
          professionalId: fx.professionalId,
          clientId: fx.rivalClientId,
          serviceId: fx.serviceId,
          offeringId: fx.offeringId,
          locationId: fx.salonLocationId,
          locationType: ServiceLocationType.SALON,
          scheduledFor: start,
          totalDurationMinutes: 60,
          bufferMinutes: 0,
          status: BookingStatus.ACCEPTED,
          locationTimeZone: ZONE,
          subtotalSnapshot: new Prisma.Decimal('100.00'),
          proTenantId: fx.tenantId,
          clientHomeTenantId: fx.tenantId,
          allowsOverlap: true,
        },
      })

      expect(await offerVisibility(offer.id)).toEqual({
        open: false,
        reason: 'TIME_BOOKED',
      })
    })

    // The confirm runs `performLockedCreateProBooking`, which never calls
    // `deleteActiveHoldsForClient` (that helper has exactly one call site and it
    // is `performLockedCreateHold`). So the offered client's own ORDINARY hold
    // over the same window really does refuse this confirm, and really must hide
    // the card — unlike an opening, whose claim drops that hold first.
    //
    // Reachable only for a pre-F14 offer that reserved nothing: while the
    // offer's own hold exists no second hold can overlap it.
    it('hides an unreserved offer the client’s own ordinary hold now covers', async () => {
      const start = futureLocal(35, 13, 0)
      const offer = await offerAt(start)

      // Drop the reservation, leaving the pre-F14 shape.
      await db.bookingHold.deleteMany({ where: { waitlistOfferId: offer.id } })
      expect(await offerVisibility(offer.id)).toEqual({ open: true })

      await db.bookingHold.create({
        data: {
          professionalId: fx.professionalId,
          clientId: fx.clientId,
          offeringId: fx.offeringId,
          locationId: fx.salonLocationId,
          locationType: ServiceLocationType.SALON,
          scheduledFor: start,
          endsAtSnapshot: new Date(start.getTime() + 60 * 60_000),
          durationMinutesSnapshot: 60,
          bufferMinutesSnapshot: 0,
          expiresAt: new Date(Date.now() + 10 * 60_000),
        },
      })

      expect(await offerVisibility(offer.id)).toEqual({
        open: false,
        reason: 'TIME_HELD',
      })
    })

    // ALLOW CASE. The pro chose this minute, and the confirm does not enforce the
    // slot grid (F4) — so a re-anchored grid must not hide the offer.
    it('keeps an offer whose start no longer sits on the pro’s grid', async () => {
      const start = futureLocal(34, 13, 0)
      const offer = await offerAt(start)

      const original = await db.professionalLocation.findUniqueOrThrow({
        where: { id: fx.salonLocationId },
        select: { workingHours: true },
      })

      const shifted = { enabled: true, start: '09:07', end: '18:00' }
      await db.professionalLocation.update({
        where: { id: fx.salonLocationId },
        data: {
          workingHours: {
            mon: shifted,
            tue: shifted,
            wed: shifted,
            thu: shifted,
            fri: shifted,
            sat: shifted,
            sun: shifted,
          },
        },
      })

      try {
        expect(await offerVisibility(offer.id)).toEqual({ open: true })
      } finally {
        await db.professionalLocation.update({
          where: { id: fx.salonLocationId },
          data: {
            workingHours: (original.workingHours ?? {}) as Prisma.InputJsonValue,
          },
        })
      }
    })
  })

  // ---------------------------------------------------------------------------
  // B4 — leaving the waitlist withdraws what the pro promised.
  //
  // A PENDING offer reserves a real slot (F14), and cancelling the entry is the
  // only event in the system that can orphan one: decline, supersede and
  // confirm each release the hold in their own transaction, and expiry kills
  // offer and hold at the same instant by construction. The entry-cancel path
  // did neither — it flipped the status and stopped.
  // ---------------------------------------------------------------------------
  describe('leaving the waitlist (B4)', () => {
    it('withdraws the PENDING offer, releases its reservation, and frees the slot', async () => {
      const entryId = await createEntry()
      const start = futureLocal(36, 13, 0)

      // The slot is genuinely bookable first, or "it came back" proves nothing.
      expect(await availabilityOffers(start)).toBe(true)

      const { offer } = await createWaitlistOffer({
        professionalId: fx.professionalId,
        actorUserId: fx.proUserId,
        waitlistEntryId: entryId,
        scheduledFor: start,
        endsAt: new Date(start.getTime() + 60 * 60_000),
        locationId: fx.salonLocationId,
        locationType: ServiceLocationType.SALON,
        durationMinutes: 60,
      })

      expect(await holdForOffer(offer.id)).not.toBeNull()
      expect(await availabilityOffers(start)).toBe(false)

      const result = await cancelClientWaitlistEntry({
        entryId,
        clientId: fx.clientId,
      })
      expect(result).toEqual({
        cancelled: true,
        releasedOffers: 1,
        notifiedProfessional: true,
      })

      const offerRow = await db.waitlistOffer.findUnique({
        where: { id: offer.id },
      })
      expect(offerRow?.status).toBe(WaitlistOfferStatus.CANCELLED)
      expect(offerRow?.respondedAt).not.toBeNull()

      const entry = await db.waitlistEntry.findUnique({ where: { id: entryId } })
      expect(entry?.status).toBe(WaitlistStatus.CANCELLED)

      // The two halves that have to happen together: the offer stops being
      // live AND the time goes back on the market, in the same breath.
      expect(await holdForOffer(offer.id)).toBeNull()
      expect(await availabilityOffers(start)).toBe(true)
    })

    it('leaves the departed client unable to confirm the withdrawn offer', async () => {
      const entryId = await createEntry()
      const start = futureLocal(37, 13, 0)

      const { offer } = await createWaitlistOffer({
        professionalId: fx.professionalId,
        actorUserId: fx.proUserId,
        waitlistEntryId: entryId,
        scheduledFor: start,
        endsAt: new Date(start.getTime() + 60 * 60_000),
        locationId: fx.salonLocationId,
        locationType: ServiceLocationType.SALON,
        durationMinutes: 60,
      })

      await cancelClientWaitlistEntry({ entryId, clientId: fx.clientId })

      // The confirm reads the OFFER, never the entry — so before the withdraw
      // this booked a real appointment and resurrected the CANCELLED entry to
      // BOOKED. The status the withdraw writes is what stops it.
      await expect(
        confirmClientWaitlistOffer({ offerId: offer.id, clientId: fx.clientId }),
      ).rejects.toMatchObject({ code: 'WAITLIST_OFFER_NOT_PENDING' })

      const entry = await db.waitlistEntry.findUnique({ where: { id: entryId } })
      expect(entry?.status).toBe(WaitlistStatus.CANCELLED)

      const booked = await db.booking.count({
        where: { professionalId: fx.professionalId, scheduledFor: start },
      })
      expect(booked).toBe(0)
    })

    it('cancels an entry that has no live offer, releasing nothing', async () => {
      const entryId = await createEntry()

      expect(
        await cancelClientWaitlistEntry({ entryId, clientId: fx.clientId }),
      ).toEqual({
        cancelled: true,
        releasedOffers: 0,
        notifiedProfessional: false,
      })

      const entry = await db.waitlistEntry.findUnique({ where: { id: entryId } })
      expect(entry?.status).toBe(WaitlistStatus.CANCELLED)
    })

    it('is idempotent on a second leave, and uniform not-found for a stranger', async () => {
      const entryId = await createEntry()

      await cancelClientWaitlistEntry({ entryId, clientId: fx.clientId })

      // A double-tap releases nothing and is not an error.
      expect(
        await cancelClientWaitlistEntry({ entryId, clientId: fx.clientId }),
      ).toEqual({
        cancelled: false,
        releasedOffers: 0,
        notifiedProfessional: false,
      })

      // Someone else's entry is indistinguishable from a missing one.
      await expect(
        cancelClientWaitlistEntry({ entryId, clientId: fx.rivalClientId }),
      ).rejects.toMatchObject({ code: 'WAITLIST_ENTRY_NOT_FOUND' })
    })

    it('refuses to leave an entry that already became a booking', async () => {
      const entryId = await createEntry()
      const start = futureLocal(38, 13, 0)

      const { offer } = await createWaitlistOffer({
        professionalId: fx.professionalId,
        actorUserId: fx.proUserId,
        waitlistEntryId: entryId,
        scheduledFor: start,
        endsAt: new Date(start.getTime() + 60 * 60_000),
        locationId: fx.salonLocationId,
        locationType: ServiceLocationType.SALON,
        durationMinutes: 60,
      })

      const confirmed = await confirmClientWaitlistOffer({
        offerId: offer.id,
        clientId: fx.clientId,
      })

      try {
        // The entry is BOOKED now. Leaving would silently drop the client's
        // link to a live appointment, so it refuses with its own code rather
        // than the uniform not-found.
        await expect(
          cancelClientWaitlistEntry({ entryId, clientId: fx.clientId }),
        ).rejects.toMatchObject({ code: 'WAITLIST_ENTRY_ALREADY_BOOKED' })

        const entry = await db.waitlistEntry.findUnique({
          where: { id: entryId },
        })
        expect(entry?.status).toBe(WaitlistStatus.BOOKED)
      } finally {
        await db.bookingServiceItem.deleteMany({
          where: { bookingId: confirmed.booking.id },
        })
        await db.waitlistOffer.update({
          where: { id: offer.id },
          data: { bookingId: null },
        })
        await db.booking.delete({ where: { id: confirmed.booking.id } })
      }
    })
  })
  // The two ends of an offer's life that nothing used to own: it lapsing, and
  // the client walking away from a live one.
  describe('offer expiry + the pro being told (real DB)', () => {
    /** Force an existing offer past its countdown, exactly as time would. */
    async function backdateExpiry(offerId: string, expiresAt: Date) {
      await db.waitlistOffer.update({ where: { id: offerId }, data: { expiresAt } })
      // The reservation shares the offer's expiry, so time moves both together —
      // otherwise the hold outlives the offer only in this test.
      await db.bookingHold.updateMany({
        where: { waitlistOfferId: offerId },
        data: { expiresAt },
      })
    }

    async function proNotifications(eventKey: NotificationEventKey) {
      return db.notification.findMany({
        where: { professionalId: fx.professionalId, eventKey },
        select: { title: true, body: true, dedupeKey: true, href: true },
      })
    }

    /** An offer for a fresh entry at `start`, returning both ids. */
    async function offerAt(start: Date) {
      const entryId = await createEntry()
      const { offer } = await createWaitlistOffer({
        professionalId: fx.professionalId,
        actorUserId: fx.proUserId,
        waitlistEntryId: entryId,
        scheduledFor: start,
        endsAt: new Date(start.getTime() + 60 * 60_000),
        locationId: fx.salonLocationId,
        locationType: ServiceLocationType.SALON,
        durationMinutes: 60,
      })
      return { entryId, offerId: offer.id }
    }

    // THE assertion this whole card exists for. Before the sweep, an offer the
    // client never answered stayed PENDING and its entry stayed NOTIFIED
    // forever — the client silently stopped being offerable, and nothing on
    // either side said why.
    it('expires a lapsed offer and revives its entry to ACTIVE', async () => {
      const start = futureLocal(50, 13, 0)
      const { entryId, offerId } = await offerAt(start)

      // Pre-state: this is what "stuck" looked like.
      expect(
        (await db.waitlistEntry.findUnique({ where: { id: entryId } }))?.status,
      ).toBe(WaitlistStatus.NOTIFIED)

      const now = new Date()
      await backdateExpiry(offerId, new Date(now.getTime() - 60_000))

      const result = await expireLapsedWaitlistOffers({ now })

      expect(result.expired).toBeGreaterThanOrEqual(1)
      expect(result.failed).toBe(0)

      const offerRow = await db.waitlistOffer.findUnique({ where: { id: offerId } })
      expect(offerRow?.status).toBe(WaitlistOfferStatus.EXPIRED)
      expect(offerRow?.respondedAt).not.toBeNull()

      // Back on the pro's list, which is the whole point.
      expect(
        (await db.waitlistEntry.findUnique({ where: { id: entryId } }))?.status,
      ).toBe(WaitlistStatus.ACTIVE)

      // F14: the reservation cannot outlive the offer, and the time is bookable
      // again — checked against real availability, not just the row.
      expect(await holdForOffer(offerId)).toBeNull()
      expect(await availabilityOffers(start)).toBe(true)

      const notes = await proNotifications(
        NotificationEventKey.WAITLIST_OFFER_EXPIRED,
      )
      const mine = notes.filter(
        (n) => n.dedupeKey === `WAITLIST_OFFER_EXPIRED:${offerId}`,
      )
      expect(mine).toHaveLength(1)
      expect(mine[0]?.title).toBe('Wanda Waiter didn’t respond')
      expect(mine[0]?.body).toContain('they’re back on your list')
      expect(mine[0]?.href).toBe('/pro/waitlist')
    })

    // The other direction, and the one a too-eager `expiresAt <= now` gets
    // wrong: a fresh offer must survive the sweep untouched.
    it('leaves a FRESH offer completely alone', async () => {
      const start = futureLocal(51, 13, 0)
      const { entryId, offerId } = await offerAt(start)

      const before = await db.waitlistOffer.findUnique({ where: { id: offerId } })
      expect(before?.status).toBe(WaitlistOfferStatus.PENDING)
      expect(before?.expiresAt?.getTime()).toBeGreaterThan(Date.now())

      await expireLapsedWaitlistOffers({ now: new Date() })

      const after = await db.waitlistOffer.findUnique({ where: { id: offerId } })
      expect(after?.status).toBe(WaitlistOfferStatus.PENDING)
      expect(after?.respondedAt).toBeNull()
      // Still NOTIFIED — the entry is not dragged back while the offer is live.
      expect(
        (await db.waitlistEntry.findUnique({ where: { id: entryId } }))?.status,
      ).toBe(WaitlistStatus.NOTIFIED)
      // And its reservation still holds the slot.
      expect(await holdForOffer(offerId)).not.toBeNull()
      expect(await availabilityOffers(start)).toBe(false)

      const notes = await proNotifications(
        NotificationEventKey.WAITLIST_OFFER_EXPIRED,
      )
      expect(
        notes.some((n) => n.dedupeKey === `WAITLIST_OFFER_EXPIRED:${offerId}`),
      ).toBe(false)
    })

    // Offers written before F14 carry NO expiry and must never lapse. This is
    // the null case the two obvious spellings of "expired" disagree on, and the
    // one where getting it wrong expires every legacy row on the first run — so
    // it is proven against the real query, not just the predicate's shape.
    it('never expires a legacy offer with a null expiresAt', async () => {
      const start = futureLocal(55, 13, 0)
      const { entryId, offerId } = await offerAt(start)

      await db.waitlistOffer.update({
        where: { id: offerId },
        data: { expiresAt: null },
      })

      // `now` far in the FUTURE: nothing about this row is recent, and it still
      // must not be claimed.
      await expireLapsedWaitlistOffers({
        now: new Date(Date.now() + 365 * 24 * 60 * 60_000),
      })

      expect(
        (await db.waitlistOffer.findUnique({ where: { id: offerId } }))?.status,
      ).toBe(WaitlistOfferStatus.PENDING)
      expect(
        (await db.waitlistEntry.findUnique({ where: { id: entryId } }))?.status,
      ).toBe(WaitlistStatus.NOTIFIED)
    })

    // Re-running the cron over the same window must not stack inbox rows, and
    // must not re-claim a row it already expired.
    it('is idempotent across two runs', async () => {
      const start = futureLocal(52, 13, 0)
      const { offerId } = await offerAt(start)

      const now = new Date()
      await backdateExpiry(offerId, new Date(now.getTime() - 60_000))

      await expireLapsedWaitlistOffers({ now })
      const second = await expireLapsedWaitlistOffers({ now })

      // The row is EXPIRED, so it is no longer PENDING and the query cannot
      // even see it.
      expect(
        second.considered === 0 ||
          !(await db.waitlistOffer.findMany({
            where: { id: offerId, status: WaitlistOfferStatus.PENDING },
            select: { id: true },
          })).length,
      ).toBe(true)

      const mine = (
        await proNotifications(NotificationEventKey.WAITLIST_OFFER_EXPIRED)
      ).filter((n) => n.dedupeKey === `WAITLIST_OFFER_EXPIRED:${offerId}`)
      expect(mine).toHaveLength(1)
    })

    // Leaving WITH a live offer: the pro loses a slot they had deliberately
    // taken off their calendar, so they hear about it.
    it('tells the pro when a client leaves while a LIVE offer is out', async () => {
      const start = futureLocal(53, 13, 0)
      const { entryId, offerId } = await offerAt(start)

      const result = await cancelClientWaitlistEntry({
        entryId,
        clientId: fx.clientId,
      })
      expect(result.notifiedProfessional).toBe(true)

      const mine = (
        await proNotifications(NotificationEventKey.WAITLIST_CLIENT_LEFT)
      ).filter((n) => n.dedupeKey === `WAITLIST_CLIENT_LEFT:${entryId}`)

      expect(mine).toHaveLength(1)
      expect(mine[0]?.title).toBe('Wanda Waiter left your waitlist')
      expect(mine[0]?.body).toContain('free to re-offer')

      // Sanity: the offer really was withdrawn, so this is not a notification
      // about a slot that is still reserved.
      expect(
        (await db.waitlistOffer.findUnique({ where: { id: offerId } }))?.status,
      ).toBe(WaitlistOfferStatus.CANCELLED)
    })

    // Leaving WITHOUT one: silent, by explicit decision. This is the assertion
    // that fails the moment someone "helpfully" notifies on every leave.
    it('stays silent when a client leaves with no offer pending', async () => {
      const entryId = await createEntry()

      const result = await cancelClientWaitlistEntry({
        entryId,
        clientId: fx.clientId,
      })
      expect(result.notifiedProfessional).toBe(false)

      const notes = await proNotifications(
        NotificationEventKey.WAITLIST_CLIENT_LEFT,
      )
      expect(
        notes.some((n) => n.dedupeKey === `WAITLIST_CLIENT_LEFT:${entryId}`),
      ).toBe(false)
    })

    // A PENDING offer that already lapsed is still withdrawn — but it stopped
    // being a promise when its countdown ran out, so the leave says nothing and
    // the expiry sweep keeps sole ownership of that story.
    it('withdraws an already-lapsed offer on leave, silently', async () => {
      const start = futureLocal(54, 13, 0)
      const { entryId, offerId } = await offerAt(start)

      await backdateExpiry(offerId, new Date(Date.now() - 60_000))

      const result = await cancelClientWaitlistEntry({
        entryId,
        clientId: fx.clientId,
      })

      expect(result.releasedOffers).toBe(1)
      expect(result.notifiedProfessional).toBe(false)
      expect(
        (await db.waitlistOffer.findUnique({ where: { id: offerId } }))?.status,
      ).toBe(WaitlistOfferStatus.CANCELLED)

      const notes = await proNotifications(
        NotificationEventKey.WAITLIST_CLIENT_LEFT,
      )
      expect(
        notes.some((n) => n.dedupeKey === `WAITLIST_CLIENT_LEFT:${entryId}`),
      ).toBe(false)
    })
  })
})
