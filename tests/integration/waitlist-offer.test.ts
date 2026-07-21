// tests/integration/waitlist-offer.test.ts
//
// Real-DB drive of the waitlist "Offer a time" client-confirm gate. Runs against
// the test database — `pnpm test:integration` (or the whole integration config).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  BookingStatus,
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
  confirmClientWaitlistOffer,
  createWaitlistOffer,
  declineClientWaitlistOffer,
} from '@/lib/booking/writeBoundary'

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
  serviceId: string
  salonLocationId: string
  offeringId: string
}

let fx: Fixtures

/** A future UTC instant that lands mid-day (9:00–18:00) in America/Los_Angeles. */
function futureUtc(daysAhead: number, hourUtc: number): Date {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + daysAhead)
  d.setUTCHours(hourUtc, 0, 0, 0)
  return d
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
    await db.waitlistOffer.deleteMany({ where: pro })
    await db.waitlistEntry.deleteMany({ where: pro })
    await db.booking.deleteMany({ where: pro })
    await db.professionalServiceOffering.deleteMany({ where: pro })
    await db.professionalLocation.deleteMany({ where: pro })
    await db.professionalPaymentSettings.deleteMany({ where: pro })
    await db.service.deleteMany({ where: { id: fx.serviceId } })
    await db.serviceCategory.deleteMany({ where: { name: `${TAG} Cat` } })
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

    // The slot evaporates between offer and confirm (no hold is placed — see F5).
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
})
