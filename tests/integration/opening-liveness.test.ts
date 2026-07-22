// tests/integration/opening-liveness.test.ts
//
// F15, driven against real Postgres: a last-minute opening the pro's schedule
// can no longer serve must stop being visible to the client, and one it CAN
// still serve must keep being visible.
//
// The second half is the one that needs the real database. Every refusal here is
// over-determined — an opening can vanish because it was booked, because the
// pro's hours moved, or simply because the check is too strict — so a suite made
// only of "it disappeared" assertions would pass against a filter that hides
// everything. The ALLOW cases below (a clean slot, the viewer's OWN hold, an
// off-grid start a pro chose) are what pin it.
//
// Run with `pnpm test:integration`.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  BookingStatus,
  LastMinuteOfferType,
  LastMinuteTier,
  LastMinuteVisibilityMode,
  Prisma,
  PrismaClient,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
} from '@prisma/client'

import {
  checkStoredSlotsAreOpen,
  type StoredSlotCandidate,
} from '@/lib/booking/storedSlotLiveness'
import { openingLivenessCandidate } from '@/lib/lastMinute/openingLiveness'
import { createLastMinuteOpening } from '@/lib/lastMinute/commands/createLastMinuteOpening'
import { loadOfferingDetail } from '@/app/(main)/offerings/[offeringId]/_data/loadOfferingDetail'
import { minutesSinceMidnightInTimeZone } from '@/lib/time'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with: pnpm test:integration')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const TAG = `opening_liveness_${Date.now()}`
const ZONE = 'America/Los_Angeles'

type Fixtures = {
  tenantId: string
  professionalId: string
  clientId: string
  rivalClientId: string
  serviceId: string
  salonLocationId: string
  offeringId: string
}

let fx: Fixtures

function futureUtc(daysAhead: number, hourUtc: number): Date {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + daysAhead)
  d.setUTCHours(hourUtc, 0, 0, 0)
  return d
}

/** A future UTC instant at exactly `hh:mm` LOCAL in the fixture's zone. */
function futureLocal(daysAhead: number, hh: number, mm = 0): Date {
  const anchor = futureUtc(daysAhead, 20)
  const anchorLocalMinutes = minutesSinceMidnightInTimeZone(anchor, ZONE)
  return new Date(anchor.getTime() + (hh * 60 + mm - anchorLocalMinutes) * 60_000)
}

function workingHours(start = '09:00', end = '18:00'): Prisma.InputJsonValue {
  const all = { enabled: true, start, end }
  return { mon: all, tue: all, wed: all, thu: all, fri: all, sat: all, sun: all }
}

/**
 * The opening as a client-facing feed reads it. The shape is not hand-written:
 * `openingLivenessCandidate` takes `OpeningLivenessRow`, so a select missing a
 * field fails to compile — which is how the four real feeds are kept honest too.
 */
async function loadOpeningRow(openingId: string) {
  const row = await db.lastMinuteOpening.findUniqueOrThrow({
    where: { id: openingId },
    select: {
      id: true,
      professionalId: true,
      startAt: true,
      locationId: true,
      locationType: true,
      professional: { select: { timeZone: true } },
      services: {
        where: { offering: { is: { isActive: true } } },
        select: {
          service: { select: { defaultDurationMinutes: true } },
          offering: {
            select: {
              salonDurationMinutes: true,
              mobileDurationMinutes: true,
            },
          },
        },
      },
    },
  })

  return row
}

async function isOpeningVisible(
  openingId: string,
  viewerClientId: string | null,
): Promise<{ open: boolean; reason?: string }> {
  const candidate = openingLivenessCandidate(await loadOpeningRow(openingId))
  if (!candidate) throw new Error('opening carries no active service')

  const verdicts = await checkStoredSlotsAreOpen({
    candidates: [candidate],
    viewerClientId,
  })

  const verdict = verdicts.get(candidate.key)
  if (!verdict) throw new Error('no verdict for candidate')

  return verdict.open ? { open: true } : { open: false, reason: verdict.reason }
}

async function createOpeningAt(startAt: Date): Promise<string> {
  const created = await createLastMinuteOpening({
    professionalId: fx.professionalId,
    offeringIds: [fx.offeringId],
    startAt,
    locationType: ServiceLocationType.SALON,
    requestedLocationId: fx.salonLocationId,
    visibilityMode: LastMinuteVisibilityMode.PUBLIC_AT_DISCOVERY,
    // All three tiers are mandatory; the incentive itself is irrelevant here.
    tierPlans: [
      { tier: LastMinuteTier.WAITLIST, offerType: LastMinuteOfferType.PERCENT_OFF, percentOff: 10 },
      { tier: LastMinuteTier.REACTIVATION, offerType: LastMinuteOfferType.PERCENT_OFF, percentOff: 15 },
      { tier: LastMinuteTier.DISCOVERY, offerType: LastMinuteOfferType.PERCENT_OFF, percentOff: 20 },
    ],
  })

  return created.id
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
      firstName: 'Opie',
      lastName: 'Pro',
      businessName: 'Opening Studio',
      timeZone: ZONE,
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
      firstName: 'Cleo',
      lastName: 'Client',
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
      // The pro-readiness gate needs coordinates.
      lat: new Prisma.Decimal('32.7157000'),
      lng: new Prisma.Decimal('-117.1611000'),
      timeZone: ZONE,
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

  await db.lastMinuteSettings.create({
    data: { professionalId: professional.id, enabled: true },
    select: { id: true },
  })

  fx = {
    tenantId: tenant.id,
    professionalId: professional.id,
    clientId: client.id,
    rivalClientId: rivalClient.id,
    serviceId: service.id,
    salonLocationId: salon.id,
    offeringId: offering.id,
  }
})

beforeEach(async () => {
  if (!fx) return
  const pro = { professionalId: fx.professionalId }
  await db.bookingHold.deleteMany({ where: pro })
  await db.calendarBlock.deleteMany({ where: pro })
  await db.bookingServiceItem.deleteMany({ where: { booking: pro } })
  await db.booking.deleteMany({ where: pro })
  await db.lastMinuteOpeningService.deleteMany({ where: { opening: pro } })
  await db.lastMinuteOpening.deleteMany({ where: pro })
  await db.professionalLocation.update({
    where: { id: fx.salonLocationId },
    data: { workingHours: workingHours(), stepMinutes: 15 },
  })
})

afterAll(async () => {
  if (fx) {
    const pro = { professionalId: fx.professionalId }
    await db.bookingHold.deleteMany({ where: pro })
    await db.calendarBlock.deleteMany({ where: pro })
    await db.bookingServiceItem.deleteMany({ where: { booking: pro } })
    await db.booking.deleteMany({ where: pro })
    await db.lastMinuteRecipient.deleteMany({ where: { opening: pro } })
    await db.lastMinuteTierPlan.deleteMany({ where: { opening: pro } })
    await db.lastMinuteOpeningService.deleteMany({ where: { opening: pro } })
    await db.lastMinuteOpening.deleteMany({ where: pro })
    await db.lastMinuteSettings.deleteMany({ where: pro })
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

async function bookOver(startAt: Date, durationMinutes = 60): Promise<string> {
  const booking = await db.booking.create({
    data: {
      professionalId: fx.professionalId,
      clientId: fx.rivalClientId,
      serviceId: fx.serviceId,
      offeringId: fx.offeringId,
      locationId: fx.salonLocationId,
      locationType: ServiceLocationType.SALON,
      scheduledFor: startAt,
      totalDurationMinutes: durationMinutes,
      bufferMinutes: 0,
      status: BookingStatus.ACCEPTED,
      locationTimeZone: ZONE,
      subtotalSnapshot: new Prisma.Decimal('100.00'),
      proTenantId: fx.tenantId,
      clientHomeTenantId: fx.tenantId,
    },
    select: { id: true },
  })
  return booking.id
}

describe('last-minute opening liveness (real DB)', () => {
  // THE ALLOW CASE. Without it every assertion below passes against a filter
  // that hides everything, which is the failure mode this whole card is about.
  it('shows an opening the pro can still serve', async () => {
    const start = futureLocal(3, 13)
    const openingId = await createOpeningAt(start)

    expect(await isOpeningVisible(openingId, fx.clientId)).toEqual({ open: true })
  })

  it('hides an opening whose slot was taken through the ordinary booking flow', async () => {
    const start = futureLocal(3, 13)
    const openingId = await createOpeningAt(start)

    // Nothing about the opening ROW changes — it stays ACTIVE with bookedAt
    // null, which is exactly why the feed's own filters miss this.
    await bookOver(start)

    const before = await db.lastMinuteOpening.findUniqueOrThrow({
      where: { id: openingId },
      select: { status: true, bookedAt: true, cancelledAt: true },
    })
    expect(before).toMatchObject({
      status: 'ACTIVE',
      bookedAt: null,
      cancelledAt: null,
    })

    expect(await isOpeningVisible(openingId, fx.clientId)).toEqual({
      open: false,
      reason: 'TIME_BOOKED',
    })
  })

  it('hides an opening the pro later blocked off', async () => {
    const start = futureLocal(3, 13)
    const openingId = await createOpeningAt(start)

    await db.calendarBlock.create({
      data: {
        professionalId: fx.professionalId,
        locationId: fx.salonLocationId,
        startsAt: new Date(start.getTime() - 15 * 60_000),
        endsAt: new Date(start.getTime() + 15 * 60_000),
        // The column is `note`, not `reason`.
        note: 'Dentist',
      },
    })

    expect(await isOpeningVisible(openingId, fx.clientId)).toEqual({
      open: false,
      reason: 'TIME_BLOCKED',
    })
  })

  it('hides an opening that fell outside newly-narrowed working hours', async () => {
    const start = futureLocal(3, 16)
    const openingId = await createOpeningAt(start)

    await db.professionalLocation.update({
      where: { id: fx.salonLocationId },
      data: { workingHours: workingHours('09:00', '15:00') },
    })

    expect(await isOpeningVisible(openingId, fx.clientId)).toEqual({
      open: false,
      reason: 'OUTSIDE_WORKING_HOURS',
    })
  })

  it('hides an opening another client is holding', async () => {
    const start = futureLocal(3, 13)
    const openingId = await createOpeningAt(start)

    await db.bookingHold.create({
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
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
    })

    expect(await isOpeningVisible(openingId, fx.clientId)).toEqual({
      open: false,
      reason: 'TIME_HELD',
    })
  })

  // ALLOW CASE. `performLockedCreateHold` deletes the client's own plain holds
  // with this pro BEFORE it evaluates conflicts, so the claim would succeed —
  // and hiding the card mid-checkout would tell the client their own reservation
  // is somebody else's.
  it('still shows an opening the VIEWING client is holding', async () => {
    const start = futureLocal(3, 13)
    const openingId = await createOpeningAt(start)

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

    expect(await isOpeningVisible(openingId, fx.clientId)).toEqual({ open: true })

    // ...and the same hold still hides it from everybody else.
    expect(await isOpeningVisible(openingId, fx.rivalClientId)).toEqual({
      open: false,
      reason: 'TIME_HELD',
    })
  })

  it('shows an opening again once the booking over it is cancelled', async () => {
    const start = futureLocal(3, 13)
    const openingId = await createOpeningAt(start)

    const bookingId = await bookOver(start)
    expect((await isOpeningVisible(openingId, fx.clientId)).open).toBe(false)

    await db.booking.update({
      where: { id: bookingId },
      data: { status: BookingStatus.CANCELLED },
    })

    expect(await isOpeningVisible(openingId, fx.clientId)).toEqual({ open: true })
  })

  // `commitGate` is the difference between the two kinds of stored time, and it
  // is invisible from the refusal side: an opening is claimed through the CLIENT
  // hold path (step fatal), a waitlist offer is confirmed through the pro create
  // path (step deferred, because the PRO picked the minute — F4).
  it('splits an off-grid start by which gate will commit it', async () => {
    const start = futureLocal(3, 13)
    const openingId = await createOpeningAt(start)

    // Re-anchor the grid under the published opening: 09:07 + 15-minute steps
    // leaves a 13:00 start off the grid.
    await db.professionalLocation.update({
      where: { id: fx.salonLocationId },
      data: { workingHours: workingHours('09:07', '18:00') },
    })

    const asOpening = openingLivenessCandidate(await loadOpeningRow(openingId))
    expect(asOpening).not.toBeNull()

    const asProChosenTime: StoredSlotCandidate = {
      ...asOpening!,
      key: 'pro-chosen',
      commitGate: 'PRO_CREATE',
    }

    const verdicts = await checkStoredSlotsAreOpen({
      candidates: [asOpening!, asProChosenTime],
      viewerClientId: fx.clientId,
    })

    expect(verdicts.get(asOpening!.key)).toEqual({
      open: false,
      reason: 'STEP_MISMATCH',
    })
    expect(verdicts.get('pro-chosen')).toEqual({ open: true })
  })

  it('hides an opening whose location stopped being bookable', async () => {
    const start = futureLocal(3, 13)
    const openingId = await createOpeningAt(start)

    await db.professionalLocation.update({
      where: { id: fx.salonLocationId },
      data: { isBookable: false },
    })

    try {
      expect(await isOpeningVisible(openingId, fx.clientId)).toEqual({
        open: false,
        reason: 'LOCATION_UNAVAILABLE',
      })
    } finally {
      await db.professionalLocation.update({
        where: { id: fx.salonLocationId },
        data: { isBookable: true },
      })
    }
  })

  // The claim PAGE, driven as the page and the native route drive it. This is
  // where the rule is answered rather than merely obeyed: the feeds hide a dead
  // opening, and a client who followed a notification lands here on "This
  // opening is no longer available" — which names no time.
  describe('the claim page a notification links to', () => {
    async function loadClaim(openingId: string, start: Date) {
      return loadOfferingDetail({
        offeringId: fx.offeringId,
        openingId,
        scheduledForRaw: start.toISOString(),
        clientId: fx.clientId,
      })
    }

    it('serves the claim while the pro can still take it', async () => {
      const start = futureLocal(3, 13)
      const openingId = await createOpeningAt(start)

      const detail = await loadClaim(openingId, start)
      expect(detail.claimable).toBe(true)
    })

    it('refuses the claim once the slot is booked, blocked or out of hours', async () => {
      const start = futureLocal(3, 13)
      const openingId = await createOpeningAt(start)

      await bookOver(start)

      // Not claimable — and the page renders its "no longer available" view off
      // exactly this flag, as does GET /api/v1/offerings/[id] (404).
      expect((await loadClaim(openingId, start)).claimable).toBe(false)
    })

    // ALLOW CASE, and the one a naive filter breaks: the claim page is reloaded
    // mid-checkout, when the client's OWN hold sits on the slot.
    it('still serves the claim to the client holding the slot', async () => {
      const start = futureLocal(3, 13)
      const openingId = await createOpeningAt(start)

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

      expect((await loadClaim(openingId, start)).claimable).toBe(true)

      // A signed-out viewer has no hold to discount, so the same slot reads as
      // taken — which is what the rival client would see too.
      const anonymous = await loadOfferingDetail({
        offeringId: fx.offeringId,
        openingId,
        scheduledForRaw: start.toISOString(),
        clientId: null,
      })
      expect(anonymous.claimable).toBe(false)
    })
  })

  it('answers for every candidate, including ones sharing a professional', async () => {
    const first = futureLocal(3, 13)
    const second = futureLocal(4, 13)
    const firstId = await createOpeningAt(first)
    const secondId = await createOpeningAt(second)

    await bookOver(second)

    const candidates = [
      openingLivenessCandidate(await loadOpeningRow(firstId))!,
      openingLivenessCandidate(await loadOpeningRow(secondId))!,
    ]

    const verdicts = await checkStoredSlotsAreOpen({
      candidates,
      viewerClientId: fx.clientId,
    })

    expect(verdicts.size).toBe(2)
    expect(verdicts.get(firstId)).toEqual({ open: true })
    expect(verdicts.get(secondId)).toEqual({ open: false, reason: 'TIME_BOOKED' })
  })
})
