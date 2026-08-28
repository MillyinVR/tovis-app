// tests/integration/waitlist-mobile-offer.test.ts
//
// Real-DB drive of MOBILE waitlist offers — `pnpm test:integration`.
//
// Two things are under test here, and the second is the one that needs a real
// database to be worth anything:
//
//  1. A mobile offer can be MADE and then CONFIRMED. Until 2026-08-27 it could
//     not: `confirmClientWaitlistOffer` booked with a hardcoded
//     `clientAddressId: null`, so every mobile offer would have dead-ended at
//     `CLIENT_SERVICE_ADDRESS_REQUIRED` — which is why the mode was excluded
//     from `WAITLIST_FULFILLABLE_MODES` rather than shipped broken.
//
//  2. The privacy boundary holds SERVER-SIDE. While an offer is PENDING the pro
//     may know how far and roughly where, and nothing more. The tests below
//     assert that against the actual JSON `GET /api/v1/pro/waitlist` returns —
//     not against what a component chooses to render — because a response that
//     carries the address is a leak whatever the UI does with it.
//
// The fixture geography is real coordinates so the distances are checkable by
// hand: the pro's mobile base is in downtown San Diego, the near client is ~1.9
// miles away in Coronado, and the far client is in Los Angeles (~110 miles),
// well outside the pro's 25-mile radius.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingStatus,
  ClientAddressKind,
  Prisma,
  PrismaClient,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
  WaitlistOfferStatus,
  WaitlistPreferenceType,
  WaitlistStatus,
} from '@prisma/client'

vi.hoisted(() => {
  process.env.JWT_SECRET ||= 'integration-test-jwt-secret'
})

const mockRequirePro = vi.hoisted(() => vi.fn())
const mockRequireClient = vi.hoisted(() => vi.fn())

vi.mock('@/app/api/_utils/auth/requirePro', () => ({
  requirePro: mockRequirePro,
}))
vi.mock('@/app/api/_utils/auth/requireClient', () => ({
  requireClient: mockRequireClient,
}))

import { GET as getClientWaitlistOffers } from '@/app/api/v1/client/waitlist-offers/route'
import { GET as getProWaitlist } from '@/app/api/v1/pro/waitlist/route'
import { GET as getOfferOptions } from '@/app/api/v1/pro/waitlist/[entryId]/offer/route'
import {
  confirmClientWaitlistOffer,
  createWaitlistOffer,
} from '@/lib/booking/writeBoundary'
import { resolveBookingLocationMeta } from '@/lib/booking/locationMeta'
import {
  PRO_WAITLIST_PENDING_OFFER_SELECT,
  buildProWaitlistPendingOfferSummary,
} from '@/lib/waitlist/proOfferSummary'
import { minutesSinceMidnightInTimeZone } from '@/lib/time'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with: pnpm test:integration')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const TAG = `wl_mobile_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
const ZONE = 'America/Los_Angeles'

/** Downtown San Diego — the pro's mobile base. */
const BASE_LAT = '32.7157000'
const BASE_LNG = '-117.1611000'

/** Coronado — the near client. ~1.9 miles from the base. */
const NEAR_LAT = '32.6859000'
const NEAR_LNG = '-117.1831000'
const NEAR_STREET = '77 Orange Ave, Coronado, CA 92118'

/** Downtown Los Angeles — the far client. ~110 miles from the base. */
const FAR_LAT = '34.0522000'
const FAR_LNG = '-118.2437000'
const FAR_STREET = '404 Far Away Blvd, Los Angeles, CA 90012'

const RADIUS_MILES = 25

type Fx = {
  tenantId: string
  proUserId: string
  professionalId: string
  mobileBaseId: string
  serviceId: string
  offeringId: string
  /** In-radius client, with a saved service address. */
  nearClientId: string
  nearClientUserId: string
  nearAddressId: string
  /** Out-of-radius client, with a saved service address. */
  farClientId: string
  farClientUserId: string
  /** In-radius-but-address-less client — nothing to travel to. */
  addresslessClientId: string
  addresslessClientUserId: string
}

let fx: Fx

function workingHours(): Prisma.InputJsonValue {
  const all = { enabled: true, start: '09:00', end: '18:00' }
  return { mon: all, tue: all, wed: all, thu: all, fri: all, sat: all, sun: all }
}

/**
 * A future UTC instant at `hh:mm` LOCAL in the fixture zone, derived from the
 * zone rather than a hardcoded offset — the suite runs on both sides of a DST
 * switch. (Same helper, same reason, as waitlist-offer.test.ts.)
 */
function futureLocal(daysAhead: number, hh: number, mm = 0): Date {
  const anchor = new Date()
  anchor.setUTCDate(anchor.getUTCDate() + daysAhead)
  anchor.setUTCHours(20, 0, 0, 0)
  const anchorLocalMinutes = minutesSinceMidnightInTimeZone(anchor, ZONE)
  return new Date(
    anchor.getTime() + (hh * 60 + mm - anchorLocalMinutes) * 60_000,
  )
}

async function createClient(args: {
  label: string
  firstName: string
  address: {
    formattedAddress: string
    addressLine1: string
    city: string
    state: string
    postalCode: string
    lat: string
    lng: string
  } | null
}): Promise<{ clientId: string; userId: string; addressId: string | null }> {
  const user = await db.user.create({
    data: {
      email: `${TAG}_${args.label}@example.com`,
      password: 'x',
      role: Role.CLIENT,
    },
    select: { id: true },
  })
  const client = await db.clientProfile.create({
    data: {
      userId: user.id,
      homeTenantId: fx.tenantId,
      firstName: args.firstName,
      lastName: 'Waiter',
    },
    select: { id: true },
  })

  let addressId: string | null = null
  if (args.address) {
    const address = await db.clientAddress.create({
      data: {
        clientId: client.id,
        kind: ClientAddressKind.SERVICE_ADDRESS,
        label: 'Home',
        isDefault: true,
        formattedAddress: args.address.formattedAddress,
        addressLine1: args.address.addressLine1,
        city: args.address.city,
        state: args.address.state,
        postalCode: args.address.postalCode,
        postalCodePrefix: args.address.postalCode,
        countryCode: 'US',
        lat: new Prisma.Decimal(args.address.lat),
        lng: new Prisma.Decimal(args.address.lng),
      },
      select: { id: true },
    })
    addressId = address.id
  }

  return { clientId: client.id, userId: user.id, addressId }
}

async function createEntry(clientId: string): Promise<string> {
  const entry = await db.waitlistEntry.create({
    data: {
      clientId,
      professionalId: fx.professionalId,
      serviceId: fx.serviceId,
      preferenceType: WaitlistPreferenceType.ANY_TIME,
      status: WaitlistStatus.ACTIVE,
    },
    select: { id: true },
  })
  return entry.id
}

async function offerMobile(args: {
  waitlistEntryId: string
  startsAt: Date
}): Promise<{ id: string }> {
  const result = await createWaitlistOffer({
    professionalId: fx.professionalId,
    actorUserId: fx.proUserId,
    waitlistEntryId: args.waitlistEntryId,
    scheduledFor: args.startsAt,
    endsAt: new Date(args.startsAt.getTime() + 60 * 60_000),
    locationId: fx.mobileBaseId,
    locationType: ServiceLocationType.MOBILE,
    durationMinutes: 60,
  })
  return { id: result.offer.id }
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
      firstName: 'Mo',
      lastName: 'Bile',
      businessName: 'Travelling Studio',
      timeZone: ZONE,
      // `assertProfessionalIsBookingReady` demands BOTH before it will let a
      // pro with a bookable MOBILE_BASE take work (MOBILE_MISSING_BASE_CONFIG).
      mobileBasePostalCode: '92101',
      mobileRadiusMiles: RADIUS_MILES,
    },
    select: { id: true },
  })

  // MOBILE_BASE only. This pro cannot host in-salon at all, which is exactly the
  // pro the salon-only gate used to lock out of the waitlist entirely.
  const base = await db.professionalLocation.create({
    data: {
      professionalId: professional.id,
      type: ProfessionalLocationType.MOBILE_BASE,
      name: 'Home base',
      isPrimary: true,
      isBookable: true,
      formattedAddress: '1 Base St, San Diego, CA 92101',
      addressLine1: '1 Base St',
      city: 'San Diego',
      state: 'CA',
      postalCode: '92101',
      countryCode: 'US',
      lat: new Prisma.Decimal(BASE_LAT),
      lng: new Prisma.Decimal(BASE_LNG),
      timeZone: ZONE,
      workingHours: workingHours(),
      bufferMinutes: 0,
      stepMinutes: 15,
      advanceNoticeMinutes: 0,
      maxDaysAhead: 365,
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

  const offering = await db.professionalServiceOffering.create({
    data: {
      professionalId: professional.id,
      serviceId: service.id,
      isActive: true,
      // The prod shape: the offering CLAIMS in-salon it cannot host. Everything
      // here must refuse on the pro's real LOCATIONS, never on this flag.
      offersInSalon: true,
      offersMobile: true,
      mobilePriceStartingAt: new Prisma.Decimal('120.00'),
      mobileDurationMinutes: 60,
    },
    select: { id: true },
  })

  fx = {
    tenantId: tenant.id,
    proUserId: proUser.id,
    professionalId: professional.id,
    mobileBaseId: base.id,
    serviceId: service.id,
    offeringId: offering.id,
    nearClientId: '',
    nearClientUserId: '',
    nearAddressId: '',
    farClientId: '',
    farClientUserId: '',
    addresslessClientId: '',
    addresslessClientUserId: '',
  }

  const near = await createClient({
    label: 'near',
    firstName: 'Nadia',
    address: {
      formattedAddress: NEAR_STREET,
      addressLine1: '77 Orange Ave',
      city: 'Coronado',
      state: 'CA',
      postalCode: '92118',
      lat: NEAR_LAT,
      lng: NEAR_LNG,
    },
  })
  fx.nearClientId = near.clientId
  fx.nearClientUserId = near.userId
  fx.nearAddressId = near.addressId ?? ''

  const far = await createClient({
    label: 'far',
    firstName: 'Farrah',
    address: {
      formattedAddress: FAR_STREET,
      addressLine1: '404 Far Away Blvd',
      city: 'Los Angeles',
      state: 'CA',
      postalCode: '90012',
      lat: FAR_LAT,
      lng: FAR_LNG,
    },
  })
  fx.farClientId = far.clientId
  fx.farClientUserId = far.userId

  const addressless = await createClient({
    label: 'noaddr',
    firstName: 'Ada',
    address: null,
  })
  fx.addresslessClientId = addressless.clientId
  fx.addresslessClientUserId = addressless.userId
})

afterAll(async () => {
  if (fx) {
    const pro = { professionalId: fx.professionalId }
    const clientIds = [
      fx.nearClientId,
      fx.farClientId,
      fx.addresslessClientId,
    ].filter(Boolean)
    const userIds = [
      fx.proUserId,
      fx.nearClientUserId,
      fx.farClientUserId,
      fx.addresslessClientUserId,
    ].filter(Boolean)

    // FK-safe teardown, mirroring waitlist-offer.test.ts: rows referencing
    // bookings/clients first, then the pro's bookings/offers, then catalog +
    // profiles, then the users.
    await db.scheduledClientNotification.deleteMany({
      where: { clientId: { in: clientIds } },
    })
    await db.clientNotification.deleteMany({
      where: { clientId: { in: clientIds } },
    })
    await db.reminder.deleteMany({ where: pro })
    await db.notification.deleteMany({ where: pro })
    await db.bookingServiceItem.deleteMany({ where: { booking: pro } })
    await db.bookingHold.deleteMany({ where: pro })
    await db.waitlistOffer.deleteMany({ where: pro })
    await db.waitlistEntry.deleteMany({ where: pro })
    await db.booking.deleteMany({ where: pro })
    await db.messageThread.deleteMany({ where: pro })
    await db.clientAddress.deleteMany({
      where: { clientId: { in: clientIds } },
    })
    await db.professionalServiceOffering.deleteMany({ where: pro })
    await db.professionalLocation.deleteMany({ where: pro })
    await db.clientProfile.deleteMany({ where: { id: { in: clientIds } } })
    await db.professionalProfile.deleteMany({ where: { id: fx.professionalId } })
    await db.service.deleteMany({ where: { name: `${TAG} Cut` } })
    await db.serviceCategory.deleteMany({ where: { slug: `${TAG}-cat` } })
    await db.user.deleteMany({ where: { id: { in: userIds } } })
  }
  await db.$disconnect()
})

beforeEach(() => {
  vi.clearAllMocks()
  mockRequirePro.mockResolvedValue({
    ok: true,
    professionalId: fx.professionalId,
    userId: fx.proUserId,
  })
  mockRequireClient.mockResolvedValue({
    ok: true,
    clientId: fx.nearClientId,
    userId: fx.nearClientUserId,
  })
})

describe('creating a MOBILE waitlist offer', () => {
  it('succeeds for a client inside the radius, and stores the destination + trip summary', async () => {
    const entryId = await createEntry(fx.nearClientId)
    const startsAt = futureLocal(3, 10)

    const { id: offerId } = await offerMobile({
      waitlistEntryId: entryId,
      startsAt,
    })

    const stored = await db.waitlistOffer.findUniqueOrThrow({
      where: { id: offerId },
      select: {
        status: true,
        locationType: true,
        locationId: true,
        clientAddressId: true,
        clientDistanceMiles: true,
        clientAreaLabel: true,
      },
    })

    expect(stored.status).toBe(WaitlistOfferStatus.PENDING)
    expect(stored.locationType).toBe(ServiceLocationType.MOBILE)
    expect(stored.locationId).toBe(fx.mobileBaseId)

    // Resolved SERVER-SIDE — the caller never passed an address, and has no
    // argument through which it could.
    expect(stored.clientAddressId).toBe(fx.nearAddressId)

    // Base → Coronado is ~1.9 miles. Asserted as a range rather than a literal
    // so this does not become a test of the haversine constant, while still
    // failing loudly if the wrong two points were measured.
    const miles = Number(stored.clientDistanceMiles)
    expect(miles).toBeGreaterThan(1.5)
    expect(miles).toBeLessThan(2.5)

    // City + state. Never the street line, and never the postal prefix while a
    // city is known.
    expect(stored.clientAreaLabel).toBe('Coronado, CA')
  })

  it('reserves the slot with a MOBILE hold, not a SALON one', async () => {
    const entryId = await createEntry(fx.nearClientId)
    const { id: offerId } = await offerMobile({
      waitlistEntryId: entryId,
      startsAt: futureLocal(4, 11),
    })

    const hold = await db.bookingHold.findFirstOrThrow({
      where: { waitlistOfferId: offerId },
      select: { locationType: true, locationId: true, clientAddressId: true },
    })

    expect(hold.locationType).toBe(ServiceLocationType.MOBILE)
    expect(hold.locationId).toBe(fx.mobileBaseId)
    // The hold is pure occupancy on the pro's calendar and is deleted before the
    // confirm books over it. Carrying the destination too would be a second copy
    // of it with no reader.
    expect(hold.clientAddressId).toBeNull()
  })

  it('REFUSES a client outside the radius, and writes no offer', async () => {
    const entryId = await createEntry(fx.farClientId)

    await expect(
      offerMobile({ waitlistEntryId: entryId, startsAt: futureLocal(5, 10) }),
    ).rejects.toMatchObject({
      code: 'CLIENT_SERVICE_ADDRESS_INVALID',
    })

    // The whole offer is one locked transaction, so a refusal leaves nothing —
    // no offer, and no hold squatting on a slot the pro can never fill.
    expect(
      await db.waitlistOffer.count({ where: { waitlistEntryId: entryId } }),
    ).toBe(0)
    expect(
      await db.waitlistEntry.findUniqueOrThrow({
        where: { id: entryId },
        select: { status: true },
      }),
    ).toEqual({ status: WaitlistStatus.ACTIVE })
  })

  it('REFUSES a client who has saved no service address, naming what the PRO can do', async () => {
    const entryId = await createEntry(fx.addresslessClientId)

    await expect(
      offerMobile({ waitlistEntryId: entryId, startsAt: futureLocal(6, 10) }),
    ).rejects.toMatchObject({
      code: 'CLIENT_SERVICE_ADDRESS_REQUIRED',
    })

    expect(
      await db.waitlistOffer.count({ where: { waitlistEntryId: entryId } }),
    ).toBe(0)
  })

  it('REFUSES a SALON offer from this pro — the narrowing half of the rule still bites', async () => {
    const entryId = await createEntry(fx.nearClientId)

    await expect(
      createWaitlistOffer({
        professionalId: fx.professionalId,
        actorUserId: fx.proUserId,
        waitlistEntryId: entryId,
        scheduledFor: futureLocal(7, 10),
        endsAt: futureLocal(7, 11),
        // The mobile base, offered as though it were a salon.
        locationId: fx.mobileBaseId,
        locationType: ServiceLocationType.SALON,
        durationMinutes: 60,
      }),
    ).rejects.toMatchObject({ code: 'BAD_LOCATION' })
  })
})

describe('what the PRO can see while the offer is PENDING', () => {
  it('carries a distance and an area, and NOT the address, in the API response itself', async () => {
    const entryId = await createEntry(fx.nearClientId)
    await offerMobile({ waitlistEntryId: entryId, startsAt: futureLocal(8, 10) })

    const res = await getProWaitlist()
    const payload = (await res.json()) as unknown
    const raw = JSON.stringify(payload)

    // The whole response, not one field: this is what actually leaves the
    // server, and a leak anywhere in it is a leak.
    expect(raw).not.toContain(NEAR_STREET)
    expect(raw).not.toContain('77 Orange Ave')
    // No coordinates at any precision — a ~11m grid reverse-geocodes to the
    // front door just as well as an exact pair does.
    expect(raw).not.toContain(NEAR_LAT)
    expect(raw).not.toContain(NEAR_LNG)
    expect(raw).not.toContain('32.68')
    expect(raw).not.toContain('-117.18')
    // Nor the address's own id, which would be a handle onto it.
    expect(raw).not.toContain(fx.nearAddressId)

    // …and what IS there is the trip summary.
    expect(raw).toContain('Coronado, CA')
    expect(raw).toContain('mi away')
  })

  it('shapes the pending offer as {id, startsAt, locationType, travel} and nothing else', async () => {
    const entryId = await createEntry(fx.nearClientId)
    await offerMobile({ waitlistEntryId: entryId, startsAt: futureLocal(9, 10) })

    const res = await getProWaitlist()
    const payload = (await res.json()) as {
      services: Array<{
        entries: Array<{
          waitlistEntryId: string
          pendingOffer: Record<string, unknown> | null
        }>
      }>
    }

    const entry = payload.services
      .flatMap((group) => group.entries)
      .find((row) => row.waitlistEntryId === entryId)

    expect(entry?.pendingOffer).toBeTruthy()
    // A key set, not a subset match. A future field carrying the address would
    // pass `toMatchObject` and fail here — which is the point.
    expect(Object.keys(entry?.pendingOffer ?? {}).sort()).toEqual([
      'id',
      'locationType',
      'startsAt',
      'travel',
    ])

    const travel = entry?.pendingOffer?.travel as Record<string, unknown>
    expect(Object.keys(travel).sort()).toEqual([
      'areaLabel',
      'distanceMiles',
      'summary',
    ])
    expect(travel.areaLabel).toBe('Coronado, CA')
  })

  it('offers MOBILE in the create-offer picker, anchored to the pro’s own base', async () => {
    const entryId = await createEntry(fx.nearClientId)

    const res = await getOfferOptions(
      new Request('https://example.test/api/v1/pro/waitlist/e/offer'),
      { params: Promise.resolve({ entryId }) },
    )
    const body = (await res.json()) as {
      offeringId: string | null
      options: Array<Record<string, unknown>>
      blockedReason: string | null
    }

    expect(res.status).toBe(200)
    expect(body.offeringId).toBe(fx.offeringId)
    expect(body.blockedReason).toBeNull()
    // This pro can host mobile and only mobile, so that is the only option —
    // and the location is THEIR base, never anything of the client's.
    expect(body.options).toHaveLength(1)
    expect(body.options[0]).toMatchObject({
      locationType: 'MOBILE',
      locationId: fx.mobileBaseId,
      durationMinutes: 60,
    })
    expect(JSON.stringify(body)).not.toContain(NEAR_STREET)
    expect(JSON.stringify(body)).not.toContain(fx.nearAddressId)
  })
})

describe('what the CLIENT is TOLD when the offer lands', () => {
  it('says the pro comes to THEM, and carries no address onto the lock screen', async () => {
    // The notification is the first thing the client sees, and it is rendered
    // verbatim onto a push. With the in-salon wording it invited them to confirm
    // a home visit while reading a sentence about a slot being "open".
    const entryId = await createEntry(fx.nearClientId)
    await offerMobile({
      waitlistEntryId: entryId,
      startsAt: futureLocal(13, 10),
    })

    const offer = await db.waitlistOffer.findFirstOrThrow({
      where: { waitlistEntryId: entryId },
      select: { id: true },
    })
    const notification = await db.clientNotification.findFirstOrThrow({
      where: { dedupeKey: `WAITLIST_TIME_OFFERED:${offer.id}` },
      select: { body: true, title: true },
    })

    // Names the client's OWN label for the address, because the offer resolved
    // to their DEFAULT and they may have several saved — without it they cannot
    // tell Home from Office until after they confirm.
    expect(notification.body).toContain('can come to you at Home on ')
    // The fixture's own service + pro, so this proves the real values are
    // interpolated rather than a placeholder sentence being stored.
    expect(notification.body).toContain(`${TAG} Cut`)
    expect(notification.body).toContain('Travelling Studio')
    expect(notification.body).toContain("Tap to confirm before it's gone.")
    // The in-salon phrasing must be gone, not merely joined by the new one.
    expect(notification.body).not.toContain('open for your')

    // 🔴 A push body is read off a lock screen by whoever holds the phone.
    // "Comes to you" is the fact they need; WHICH address is the offer card's
    // job, behind the session.
    expect(notification.body).not.toContain(NEAR_STREET)
    expect(notification.body).not.toContain('Orange Ave')
    expect(notification.body).not.toContain('Coronado')
    expect(notification.body).not.toContain('92118')
  })

  it('leaves the SALON notification wording untouched', async () => {
    // Proven against a real SALON offer rather than asserted about one: this
    // fix must not have reworded the mode it did not change. The fixture pro is
    // mobile-only, so the sentence is exercised through the shared helper the
    // write path calls — see lib/waitlist/offerNotificationCopy.test.ts for the
    // byte-for-byte assertion.
    const { buildWaitlistOfferNotificationBody } = await import(
      '@/lib/waitlist/offerNotificationCopy'
    )

    expect(
      buildWaitlistOfferNotificationBody({
        locationType: ServiceLocationType.SALON,
        proName: 'Mo Bile',
        when: 'Fri, Sep 4 at 10:00 AM',
        serviceName: 'Balayage',
      }),
    ).toBe(
      "Mo Bile has Fri, Sep 4 at 10:00 AM open for your Balayage. Tap to confirm before it's gone.",
    )
  })
})

describe('what the CLIENT can see about the same PENDING offer', () => {
  it('names their OWN address in full — the mirror of the pro’s coarse view', async () => {
    // Deliberately the opposite verdict to the pro-facing test above, against the
    // very same offer row. The pro gets "1.9 mi away · Coronado, CA"; the client
    // gets the street, because it is theirs and it is what they are being asked
    // to agree to. A card that said only "Balayage, Tuesday 10am" would have them
    // confirm a home visit without being told it was one.
    const entryId = await createEntry(fx.nearClientId)
    await offerMobile({
      waitlistEntryId: entryId,
      startsAt: futureLocal(12, 10),
    })

    const res = await getClientWaitlistOffers()
    const payload = (await res.json()) as {
      offers: Array<{
        locationType: string
        clientAddressLabel: string | null
      }>
    }

    const offer = payload.offers.find((row) => row.locationType === 'MOBILE')
    expect(offer, JSON.stringify(payload)).toBeTruthy()
    expect(offer?.clientAddressLabel).toBe(NEAR_STREET)
  })
})

describe('confirming a MOBILE offer', () => {
  it('books to the real address, and the pro can then see it', async () => {
    const entryId = await createEntry(fx.nearClientId)
    const { id: offerId } = await offerMobile({
      waitlistEntryId: entryId,
      startsAt: futureLocal(10, 10),
    })

    const result = await confirmClientWaitlistOffer({
      offerId,
      clientId: fx.nearClientId,
    })

    const booking = await db.booking.findUniqueOrThrow({
      where: { id: result.booking.id },
      select: {
        status: true,
        locationType: true,
        clientAddressId: true,
        clientAddressSnapshot: true,
        clientAddressLatSnapshot: true,
        clientAddressLngSnapshot: true,
        locationAddressSnapshot: true,
        locationLatSnapshot: true,
        locationLngSnapshot: true,
      },
    })

    expect(booking.status).toBe(BookingStatus.ACCEPTED)
    expect(booking.locationType).toBe(ServiceLocationType.MOBILE)
    // The hardcoded `clientAddressId: null` this replaced is what made every
    // mobile offer unconfirmable.
    expect(booking.clientAddressId).toBe(fx.nearAddressId)

    // Post-acceptance the pro reads the destination through the SAME helper
    // every other mobile booking uses — no second reveal mechanism.
    const meta = resolveBookingLocationMeta({
      locationType: booking.locationType,
      locationAddressSnapshot: booking.locationAddressSnapshot,
      locationLatSnapshot: Number(booking.locationLatSnapshot),
      locationLngSnapshot: Number(booking.locationLngSnapshot),
      clientAddressSnapshot: booking.clientAddressSnapshot,
      clientAddressLatSnapshot: Number(booking.clientAddressLatSnapshot),
      clientAddressLngSnapshot: Number(booking.clientAddressLngSnapshot),
    })
    expect(meta.isMobile).toBe(true)
    expect(meta.formattedAddress).toBe(NEAR_STREET)

    // The offer and entry both move on, and the reservation is handed back.
    const offer = await db.waitlistOffer.findUniqueOrThrow({
      where: { id: offerId },
      select: { status: true, bookingId: true },
    })
    expect(offer.status).toBe(WaitlistOfferStatus.ACCEPTED)
    expect(offer.bookingId).toBe(result.booking.id)
    expect(
      await db.bookingHold.count({ where: { waitlistOfferId: offerId } }),
    ).toBe(0)
    expect(
      await db.waitlistEntry.findUniqueOrThrow({
        where: { id: entryId },
        select: { status: true },
      }),
    ).toEqual({ status: WaitlistStatus.BOOKED })
  })

  it('refuses when the client deleted the saved address after the offer was made', async () => {
    // `onDelete: SetNull` strands the offer rather than deleting it, and the
    // confirm must then refuse cleanly instead of booking a trip to nowhere.
    const throwaway = await createClient({
      label: `gone_${Math.random().toString(36).slice(2, 8)}`,
      firstName: 'Gwen',
      address: {
        formattedAddress: NEAR_STREET,
        addressLine1: '77 Orange Ave',
        city: 'Coronado',
        state: 'CA',
        postalCode: '92118',
        lat: NEAR_LAT,
        lng: NEAR_LNG,
      },
    })

    try {
      const entryId = await createEntry(throwaway.clientId)
      const { id: offerId } = await offerMobile({
        waitlistEntryId: entryId,
        startsAt: futureLocal(11, 10),
      })

      await db.clientAddress.delete({ where: { id: throwaway.addressId ?? '' } })

      expect(
        await db.waitlistOffer.findUniqueOrThrow({
          where: { id: offerId },
          select: { clientAddressId: true },
        }),
      ).toEqual({ clientAddressId: null })

      await expect(
        confirmClientWaitlistOffer({
          offerId,
          clientId: throwaway.clientId,
        }),
      ).rejects.toMatchObject({ code: 'CLIENT_SERVICE_ADDRESS_REQUIRED' })
    } finally {
      await db.clientNotification.deleteMany({
        where: { clientId: throwaway.clientId },
      })
      await db.bookingHold.deleteMany({ where: { clientId: throwaway.clientId } })
      await db.waitlistOffer.deleteMany({ where: { clientId: throwaway.clientId } })
      await db.waitlistEntry.deleteMany({ where: { clientId: throwaway.clientId } })
      await db.messageThread.deleteMany({ where: { clientId: throwaway.clientId } })
      await db.clientAddress.deleteMany({ where: { clientId: throwaway.clientId } })
      await db.clientProfile.deleteMany({ where: { id: throwaway.clientId } })
      await db.user.deleteMany({ where: { id: throwaway.userId } })
    }
  })
})

describe('the pro-facing select', () => {
  it('fetches no ClientAddress column or relation', async () => {
    // The DTO can only leak what its query fetched. Asserting the SELECT — not
    // just the output — is what stops the next person adding
    // `clientAddress: { select: { formattedAddress: true } }` "just for the
    // tooltip" and having every shape test still pass.
    const keys = Object.keys(PRO_WAITLIST_PENDING_OFFER_SELECT)

    expect(keys.sort()).toEqual([
      'clientAreaLabel',
      'clientDistanceMiles',
      'id',
      'locationType',
      'startsAt',
      'waitlistEntryId',
    ])
    expect(keys).not.toContain('clientAddress')
    expect(keys).not.toContain('clientAddressId')
    expect(keys).not.toContain('client')
  })

  it('builds a SALON summary with no travel block at all', async () => {
    const summary = buildProWaitlistPendingOfferSummary({
      id: 'off_1',
      waitlistEntryId: 'w_1',
      startsAt: new Date('2026-09-01T17:00:00.000Z'),
      locationType: ServiceLocationType.SALON,
      clientDistanceMiles: new Prisma.Decimal('3.20'),
      clientAreaLabel: 'Coronado, CA',
    })

    // Even with the columns populated — which should not happen, but a stale row
    // or a future bug could — a SALON offer says nothing about a trip.
    expect(summary.travel).toBeNull()
  })
})
