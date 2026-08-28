// tests/integration/waitlist-location-capability.test.ts
//
// Real-DB drive of the waitlist location-capability gate — `pnpm test:integration`.
//
// The bug this locks down: nothing on the waitlist path checked what a pro could
// ACTUALLY host.
//   • the availability bootstrap answered `waitlistSupported: true` for everyone;
//   • the client's join wrote a `WaitlistEntry` with no check at all;
//   • the pro's offer endpoint then refused with a bare `locationType !== SALON`.
// So a mobile-only pro collected salon waitlisters they could never make an offer
// to, and neither side was ever told why.
//
// The fixture is deliberately the shape PROD holds: `offersInSalon` used to be
// `@default(true)` and the pro's form pre-checked it, so a mobile-only pro's
// offering CLAIMS in-salon. Everything here must therefore refuse on the pro's
// real LOCATIONS, never on that flag.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Prisma,
  PrismaClient,
  ClientAddressKind,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
  WaitlistPreferenceType,
  WaitlistStatus,
} from '@prisma/client'

vi.hoisted(() => {
  process.env.JWT_SECRET ||= 'integration-test-jwt-secret'
})

const mockRequireClient = vi.hoisted(() => vi.fn())
const mockRequirePro = vi.hoisted(() => vi.fn())
const mockEnforceRateLimit = vi.hoisted(() => vi.fn())

vi.mock('@/app/api/_utils/auth/requireClient', () => ({
  requireClient: mockRequireClient,
}))
vi.mock('@/app/api/_utils/auth/requirePro', () => ({
  requirePro: mockRequirePro,
}))
// ⚠️ NOT the real limiter: `.env.test.local` points at the same Upstash instance
// as prod, so a test must never spend from a real bucket.
vi.mock('@/lib/rateLimit/enforce', () => ({
  enforceRateLimit: mockEnforceRateLimit,
}))

import { POST as joinWaitlist } from '@/app/api/v1/waitlist/route'
import { POST as offerTime } from '@/app/api/v1/pro/waitlist/[entryId]/offer/route'
import { loadAvailabilityOfferingContext } from '@/lib/availability/data/offeringContext'
import {
  isWaitlistSupportedForModes,
  loadWaitlistHostability,
} from '@/lib/waitlist/hostability'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with: pnpm test:integration')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const TAG = `wl_cap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
const ZONE = 'America/Los_Angeles'

type ProFixture = {
  userId: string
  professionalId: string
  offeringId: string
  /** Present only for the salon-capable pro. */
  salonLocationId: string | null
}

let tenantId = ''
let clientUserId = ''
let clientId = ''
let serviceId = ''
let categoryId = ''
let clientAddressId = ''

/** Bookable in-salon + mobile: the control. */
let bothPro: ProFixture
/** MOBILE_BASE only, but the offering still CLAIMS salon — the prod shape. */
let mobileOnlyPro: ProFixture
/** An offering with no bookable location of any kind behind it. */
let noLocationPro: ProFixture

function workingHours(): Prisma.InputJsonValue {
  const all = { enabled: true, start: '09:00', end: '18:00' }
  return { mon: all, tue: all, wed: all, thu: all, fri: all, sat: all, sun: all }
}

async function createPro(args: {
  label: string
  locations: Array<{ type: ProfessionalLocationType; isBookable: boolean }>
  offersInSalon: boolean
  offersMobile: boolean
}): Promise<ProFixture> {
  const user = await db.user.create({
    data: {
      email: `${TAG}_${args.label}@example.com`,
      password: 'x',
      role: Role.PRO,
    },
    select: { id: true },
  })
  const professional = await db.professionalProfile.create({
    data: {
      userId: user.id,
      homeTenantId: tenantId,
      firstName: 'Cap',
      lastName: args.label,
      businessName: `${args.label} Studio`,
      timeZone: ZONE,
      // BOTH, or `assertProfessionalIsBookingReady` blocks with
      // MOBILE_MISSING_BASE_CONFIG the moment the pro has a bookable
      // MOBILE_BASE — including on the SALON offer path.
      mobileRadiusMiles: 25,
      mobileBasePostalCode: '92101',
    },
    select: { id: true },
  })

  let salonLocationId: string | null = null
  let isFirst = true
  for (const location of args.locations) {
    const created = await db.professionalLocation.create({
      data: {
        professionalId: professional.id,
        type: location.type,
        name: `${args.label} ${location.type}`,
        isPrimary: isFirst,
        isBookable: location.isBookable,
        formattedAddress: '123 Cap St, San Diego, CA 92101',
        addressLine1: '123 Cap St',
        city: 'San Diego',
        state: 'CA',
        postalCode: '92101',
        countryCode: 'US',
        lat: new Prisma.Decimal('32.7157000'),
        lng: new Prisma.Decimal('-117.1611000'),
        timeZone: ZONE,
        workingHours: workingHours(),
        bufferMinutes: 0,
        stepMinutes: 15,
        advanceNoticeMinutes: 0,
        maxDaysAhead: 365,
      },
      select: { id: true, type: true, isBookable: true },
    })
    isFirst = false
    if (
      created.isBookable &&
      (created.type === ProfessionalLocationType.SALON ||
        created.type === ProfessionalLocationType.SUITE)
    ) {
      salonLocationId = created.id
    }
  }

  const offering = await db.professionalServiceOffering.create({
    data: {
      professionalId: professional.id,
      serviceId,
      isActive: true,
      offersInSalon: args.offersInSalon,
      offersMobile: args.offersMobile,
      salonPriceStartingAt: new Prisma.Decimal('100.00'),
      salonDurationMinutes: 60,
      mobilePriceStartingAt: new Prisma.Decimal('120.00'),
      mobileDurationMinutes: 60,
    },
    select: { id: true },
  })

  return {
    userId: user.id,
    professionalId: professional.id,
    offeringId: offering.id,
    salonLocationId,
  }
}

beforeAll(async () => {
  const tenant = await db.tenant.upsert({
    where: { slug: 'tovis-root' },
    update: {},
    create: { slug: 'tovis-root', name: 'TOVIS', isActive: true },
    select: { id: true },
  })
  tenantId = tenant.id

  const clientUser = await db.user.create({
    data: { email: `${TAG}_client@example.com`, password: 'x', role: Role.CLIENT },
    select: { id: true },
  })
  clientUserId = clientUser.id
  const client = await db.clientProfile.create({
    data: {
      userId: clientUser.id,
      homeTenantId: tenantId,
      firstName: 'Cara',
      lastName: 'Capability',
    },
    select: { id: true },
  })
  clientId = client.id

  // A mobile-only pro's availability resolves in MOBILE mode, which needs a
  // destination — without one the drawer refuses before `waitlistSupported` is
  // ever computed. Give the client one so the mobile-only case below is really
  // exercising the waitlist verdict rather than an earlier refusal.
  const address = await db.clientAddress.create({
    data: {
      clientId,
      kind: ClientAddressKind.SERVICE_ADDRESS,
      label: 'Home',
      isDefault: true,
      formattedAddress: '9 Client Ave, San Diego, CA 92101',
      addressLine1: '9 Client Ave',
      city: 'San Diego',
      state: 'CA',
      postalCode: '92101',
      countryCode: 'US',
      lat: new Prisma.Decimal('32.7157000'),
      lng: new Prisma.Decimal('-117.1611000'),
    },
    select: { id: true },
  })
  clientAddressId = address.id

  const category = await db.serviceCategory.create({
    data: { name: `${TAG} Cat`, slug: `${TAG}-cat`, isActive: true },
    select: { id: true },
  })
  categoryId = category.id
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
  serviceId = service.id

  bothPro = await createPro({
    label: 'both',
    locations: [
      { type: ProfessionalLocationType.SALON, isBookable: true },
      { type: ProfessionalLocationType.MOBILE_BASE, isBookable: true },
    ],
    offersInSalon: true,
    offersMobile: true,
  })

  mobileOnlyPro = await createPro({
    label: 'mobileonly',
    locations: [{ type: ProfessionalLocationType.MOBILE_BASE, isBookable: true }],
    // The prod shape: the offering CLAIMS salon it cannot host.
    offersInSalon: true,
    offersMobile: true,
  })

  noLocationPro = await createPro({
    label: 'nolocation',
    // A "Set salon address" placeholder is written isBookable:false — present,
    // but never a capability claim.
    locations: [{ type: ProfessionalLocationType.SALON, isBookable: false }],
    offersInSalon: true,
    offersMobile: false,
  })
})

afterAll(async () => {
  const proIds = [
    bothPro?.professionalId,
    mobileOnlyPro?.professionalId,
    noLocationPro?.professionalId,
  ].filter((id): id is string => Boolean(id))
  const proUserIds = [
    bothPro?.userId,
    mobileOnlyPro?.userId,
    noLocationPro?.userId,
  ].filter((id): id is string => Boolean(id))

  if (proIds.length) {
    const pro = { professionalId: { in: proIds } }
    await db.clientNotification.deleteMany({ where: { clientId } })
    await db.notification.deleteMany({ where: pro })
    // Holds before offers/locations: ProfessionalLocation RESTRICTs a
    // referencing hold, and an offer's hold otherwise only goes via its cascade.
    await db.bookingHold.deleteMany({ where: pro })
    await db.waitlistOffer.deleteMany({ where: pro })
    await db.waitlistEntry.deleteMany({ where: pro })
    // The offer route persists an idempotency row keyed to the acting pro.
    await db.idempotencyKey.deleteMany({
      where: { actorUserId: { in: proUserIds } },
    })
    await db.professionalServiceOffering.deleteMany({ where: pro })
    await db.professionalLocation.deleteMany({ where: pro })

    // An admitted join SEEDS a WAITLIST message thread (that is how the pro's
    // inbox surfaces a waitlister), and MessageThread FKs the professional
    // without a cascade — so the profile delete below fails on it. Attachments
    // and messages first, then participants, then the threads.
    const threads = await db.messageThread.findMany({
      where: { professionalId: { in: proIds } },
      select: { id: true },
    })
    const threadIds = threads.map((thread) => thread.id)
    if (threadIds.length) {
      await db.messageAttachment.deleteMany({
        where: { message: { threadId: { in: threadIds } } },
      })
      await db.message.deleteMany({ where: { threadId: { in: threadIds } } })
      await db.messageThreadParticipant.deleteMany({
        where: { threadId: { in: threadIds } },
      })
      await db.messageThread.deleteMany({ where: { id: { in: threadIds } } })
    }

    await db.professionalProfile.deleteMany({ where: { id: { in: proIds } } })
  }

  await db.clientProfile.deleteMany({ where: { id: clientId } })
  await db.service.deleteMany({ where: { id: serviceId } })
  await db.serviceCategory.deleteMany({ where: { id: categoryId } })
  await db.user.deleteMany({ where: { email: { startsWith: TAG } } })
  await db.$disconnect()
})

beforeEach(async () => {
  vi.clearAllMocks()
  mockEnforceRateLimit.mockResolvedValue({ allowed: true })
  mockRequireClient.mockResolvedValue({
    ok: true,
    clientId,
    user: { id: clientUserId },
  })
  await db.waitlistEntry.deleteMany({ where: { clientId } })
})

function joinRequest(professionalId: string): Request {
  return new Request('https://example.test/api/v1/waitlist', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      professionalId,
      serviceId,
      preferenceType: WaitlistPreferenceType.ANY_TIME,
    }),
  })
}

describe('loadWaitlistHostability (real locations, real offering)', () => {
  it('reports SALON for a pro with a bookable salon', async () => {
    const result = await loadWaitlistHostability({
      professionalId: bothPro.professionalId,
      serviceId,
    })

    expect(result).toMatchObject({ ok: true, offeringId: bothPro.offeringId })
    if (!result.ok) throw new Error('expected hostable')
    expect(result.modes).toEqual([ServiceLocationType.SALON])
  })

  it('refuses a mobile-only pro even though the offering CLAIMS in-salon', async () => {
    // Proof the flag is not what is being read.
    const offering = await db.professionalServiceOffering.findUniqueOrThrow({
      where: { id: mobileOnlyPro.offeringId },
      select: { offersInSalon: true },
    })
    expect(offering.offersInSalon).toBe(true)

    const result = await loadWaitlistHostability({
      professionalId: mobileOnlyPro.professionalId,
      serviceId,
    })

    expect(result).toEqual({
      ok: false,
      refusal: { kind: 'NO_HOSTABLE_MODE', advertisesMobileOnly: true },
    })
  })

  it('refuses a pro whose only salon row is isBookable:false', async () => {
    const result = await loadWaitlistHostability({
      professionalId: noLocationPro.professionalId,
      serviceId,
    })

    expect(result).toEqual({
      ok: false,
      refusal: { kind: 'NO_HOSTABLE_MODE', advertisesMobileOnly: false },
    })
  })

  it('refuses when the offering is inactive — matching the offer path’s own lookup', async () => {
    await db.professionalServiceOffering.update({
      where: { id: bothPro.offeringId },
      data: { isActive: false },
    })
    try {
      const result = await loadWaitlistHostability({
        professionalId: bothPro.professionalId,
        serviceId,
      })
      expect(result).toEqual({
        ok: false,
        refusal: { kind: 'NO_ACTIVE_OFFERING' },
      })
    } finally {
      await db.professionalServiceOffering.update({
        where: { id: bothPro.offeringId },
        data: { isActive: true },
      })
    }
  })
})

describe('availability bootstrap — waitlistSupported', () => {
  // The bootstrap derives it from the offering context's NARROWED modes, so this
  // drives that real loader rather than re-deriving capability a second way.
  async function loadContext(professionalId: string) {
    return loadAvailabilityOfferingContext({
      professionalId,
      serviceId,
      requestedLocationType: null,
      requestedLocationId: null,
      clientAddressId,
      scheduleConfigVersion: 1,
      cacheEnabled: false,
    })
  }

  async function narrowedModes(professionalId: string) {
    const context = await loadContext(professionalId)
    if (!context.ok) throw new Error(`context failed: ${JSON.stringify(context)}`)
    return context.value.offeringPayload
  }

  it('is true for a salon-capable pro', async () => {
    const modes = await narrowedModes(bothPro.professionalId)
    expect(modes.offersInSalon).toBe(true)
    expect(isWaitlistSupportedForModes(modes)).toBe(true)
  })

  it('is FALSE for the mobile-only pro whose offering claims in-salon', async () => {
    const modes = await narrowedModes(mobileOnlyPro.professionalId)
    // The read boundary already took the unhostable claim off…
    expect(modes.offersInSalon).toBe(false)
    expect(modes.offersMobile).toBe(true)
    // …and the waitlist is therefore not offered at all.
    expect(isWaitlistSupportedForModes(modes)).toBe(false)
  })

  it('never even reaches a payload for a pro with no bookable location', async () => {
    // Stronger than `waitlistSupported: false`: with nothing bookable anywhere
    // the drawer cannot resolve a placement at all, so the route 4xxs and no
    // waitlist panel is rendered in the first place. Recorded here because it is
    // the reason the "zero bookable locations" case cannot be asserted on the
    // payload — not because the derivation was skipped.
    const context = await loadContext(noLocationPro.professionalId)
    expect(context.ok).toBe(false)

    // And the verdict the payload WOULD have carried is still false.
    expect(
      isWaitlistSupportedForModes({ offersInSalon: false, offersMobile: false }),
    ).toBe(false)
  })
})

describe('POST /api/v1/waitlist — join', () => {
  it('admits a join for a pro who can host it, and writes the entry', async () => {
    const res = await joinWaitlist(joinRequest(bothPro.professionalId))

    expect(res.status).toBe(201)
    const rows = await db.waitlistEntry.findMany({
      where: { clientId, professionalId: bothPro.professionalId },
      select: { status: true },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe(WaitlistStatus.ACTIVE)
  })

  it('REFUSES a mobile-only pro and writes NO row', async () => {
    const res = await joinWaitlist(joinRequest(mobileOnlyPro.professionalId))

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toContain('only travels to clients')

    expect(
      await db.waitlistEntry.count({
        where: { clientId, professionalId: mobileOnlyPro.professionalId },
      }),
    ).toBe(0)
  })

  it('REFUSES a pro with no bookable location and writes NO row', async () => {
    const res = await joinWaitlist(joinRequest(noLocationPro.professionalId))

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toContain('cannot take in-salon appointments')

    expect(
      await db.waitlistEntry.count({
        where: { clientId, professionalId: noLocationPro.professionalId },
      }),
    ).toBe(0)
  })
})

describe('POST /api/v1/pro/waitlist/[entryId]/offer', () => {
  async function seedEntry(professionalId: string): Promise<string> {
    const entry = await db.waitlistEntry.create({
      data: {
        clientId,
        professionalId,
        serviceId,
        preferenceType: WaitlistPreferenceType.ANY_TIME,
        status: WaitlistStatus.ACTIVE,
      },
      select: { id: true },
    })
    return entry.id
  }

  function offerRequest(args: {
    locationId: string
    /** Raw wire value — the route parses it, so an invalid one is representable. */
    locationType: string
    idempotencyKey?: string
  }): Request {
    // 10:00 local, three days out — inside the fixture's 09:00–18:00 hours.
    const startsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
    startsAt.setUTCHours(18, 0, 0, 0)
    const endsAt = new Date(startsAt.getTime() + 60 * 60_000)

    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (args.idempotencyKey) headers['idempotency-key'] = args.idempotencyKey

    return new Request('https://example.test/api/v1/pro/waitlist/e/offer', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        scheduledFor: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        locationId: args.locationId,
        locationType: args.locationType,
        durationMinutes: 60,
      }),
    })
  }

  function ctx(entryId: string) {
    return { params: Promise.resolve({ entryId }) }
  }

  it('creates a PENDING offer for the mode the pro can actually provide', async () => {
    mockRequirePro.mockResolvedValue({
      ok: true,
      professionalId: bothPro.professionalId,
      userId: bothPro.userId,
    })
    const entryId = await seedEntry(bothPro.professionalId)
    const salonLocationId = bothPro.salonLocationId
    if (!salonLocationId) throw new Error('fixture missing salon location')

    const res = await offerTime(
      offerRequest({
        locationId: salonLocationId,
        locationType: ServiceLocationType.SALON,
        idempotencyKey: `${TAG}-offer-ok`,
      }),
      ctx(entryId),
    )

    const body = await res.json()
    expect(res.status, JSON.stringify(body)).toBe(201)
    expect(body.offer.locationType).toBe(ServiceLocationType.SALON)

    const stored = await db.waitlistOffer.findFirstOrThrow({
      where: { waitlistEntryId: entryId },
      select: { status: true, locationType: true },
    })
    expect(stored.status).toBe('PENDING')
    expect(stored.locationType).toBe(ServiceLocationType.SALON)
  })

  it('refuses a mobile-only pro by NAMING the reason, not a bare 400', async () => {
    mockRequirePro.mockResolvedValue({
      ok: true,
      professionalId: mobileOnlyPro.professionalId,
      userId: mobileOnlyPro.userId,
    })
    const entryId = await seedEntry(mobileOnlyPro.professionalId)
    const mobileBase = await db.professionalLocation.findFirstOrThrow({
      where: {
        professionalId: mobileOnlyPro.professionalId,
        type: ProfessionalLocationType.MOBILE_BASE,
      },
      select: { id: true },
    })

    const res = await offerTime(
      offerRequest({
        locationId: mobileBase.id,
        locationType: ServiceLocationType.MOBILE,
      }),
      ctx(entryId),
    )

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toContain('only offer this service mobile')
    expect(await db.waitlistOffer.count({ where: { waitlistEntryId: entryId } })).toBe(0)
  })

  it('rejects an unparseable locationType before touching the boundary', async () => {
    mockRequirePro.mockResolvedValue({
      ok: true,
      professionalId: bothPro.professionalId,
      userId: bothPro.userId,
    })
    const entryId = await seedEntry(bothPro.professionalId)

    const res = await offerTime(
      offerRequest({
        locationId: bothPro.salonLocationId ?? '',
        locationType: 'CARRIER_PIGEON',
      }),
      ctx(entryId),
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Invalid or missing locationType')
  })

  it('404s an entry belonging to a different pro, without leaking hostability', async () => {
    mockRequirePro.mockResolvedValue({
      ok: true,
      professionalId: bothPro.professionalId,
      userId: bothPro.userId,
    })
    const foreignEntryId = await seedEntry(mobileOnlyPro.professionalId)

    const res = await offerTime(
      offerRequest({
        locationId: bothPro.salonLocationId ?? '',
        locationType: ServiceLocationType.SALON,
      }),
      ctx(foreignEntryId),
    )

    expect(res.status).toBe(404)
  })
})
