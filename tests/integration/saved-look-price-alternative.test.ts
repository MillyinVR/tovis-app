// tests/integration/saved-look-price-alternative.test.ts
//
// Real-Postgres coverage for runSavedLookPriceAlternatives (personalization spec
// §6.8 price blocker response, gated by the §8.1 re-engagement budget). Exercises the
// end-to-end pipeline on a real DB — the aging-priced-save scan, the batched
// per-client learned price band (from completed bookings), the tenant-scoped in-band
// alternative-look DISCOVERY, and the notification emit:
//
//   - an aging save on a look priced well above the client's learned band, whose pro
//     the client never booked, produces exactly one SAVED_LOOK_PRICE_ALTERNATIVE
//     notification pointing at a same-category, in-band look from a DIFFERENT pro;
//   - a client with no completed bookings (no learned band) gets nothing;
//   - a client who already booked the over-budget pro gets nothing;
//   - a second run is idempotent (cooldown dedupe).
//
// Runs via `npm run test:integration` (test DB :5433). The shared test DB is SEEDED —
// this test scopes every fixture with a unique tag and cleans up only its own rows.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  BookingSource,
  BookingStatus,
  LookPostStatus,
  MediaType,
  ModerationStatus,
  NotificationEventKey,
  Prisma,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
  VerificationStatus,
} from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { runSavedLookPriceAlternatives } from '@/lib/notifications/savedLookPriceAlternative'

if (!process.env.DATABASE_URL) {
  throw new Error(
    'Missing DATABASE_URL. Run this test with: npm run test:integration',
  )
}

const NOW = new Date('2026-07-15T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
const TAG = `pricealt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

const AFFORDABLE_PRO_NAME = 'Rivera Studio'

type Ids = {
  tenantId: string
  expensiveProId: string
  affordableProId: string
  bandProId: string
  categoryId: string
  serviceId: string
  expensiveLookId: string
  affordableLookId: string
  clientEligibleId: string
  clientNoBandId: string
  clientBookedId: string
  clientIds: string[]
  proIds: string[]
  userIds: string[]
}

let ids: Ids

async function cleanup(): Promise<void> {
  if (!ids) return
  await prisma.notificationDispatch.deleteMany({
    where: { clientId: { in: ids.clientIds } },
  })
  await prisma.clientNotification.deleteMany({
    where: { clientId: { in: ids.clientIds } },
  })
  await prisma.boardItem.deleteMany({
    where: { lookPostId: { in: [ids.expensiveLookId, ids.affordableLookId] } },
  })
  await prisma.board.deleteMany({ where: { clientId: { in: ids.clientIds } } })
  await prisma.booking.deleteMany({ where: { professionalId: { in: ids.proIds } } })
  await prisma.lookPost.deleteMany({
    where: { id: { in: [ids.expensiveLookId, ids.affordableLookId] } },
  })
  await prisma.mediaAsset.deleteMany({
    where: { professionalId: { in: ids.proIds } },
  })
  await prisma.professionalLocation.deleteMany({
    where: { professionalId: { in: ids.proIds } },
  })
  await prisma.service.deleteMany({ where: { id: ids.serviceId } })
  await prisma.serviceCategory.deleteMany({ where: { id: ids.categoryId } })
  await prisma.clientProfile.deleteMany({ where: { id: { in: ids.clientIds } } })
  await prisma.professionalProfile.deleteMany({
    where: { id: { in: ids.proIds } },
  })
  await prisma.user.deleteMany({ where: { id: { in: ids.userIds } } })
}

async function makeUser(role: Role, suffix: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `${TAG}_${suffix}@example.com`,
      password: 'test-password',
      role,
      emailVerifiedAt: NOW,
    },
    select: { id: true },
  })
  return user.id
}

async function seed(): Promise<Ids> {
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'tovis-root' },
    update: {},
    create: { slug: 'tovis-root', name: 'TOVIS', isActive: true },
    select: { id: true },
  })

  const userIds: string[] = []
  const proIds: string[] = []

  const makePro = async (suffix: string, businessName: string) => {
    const userId = await makeUser(Role.PRO, suffix)
    userIds.push(userId)
    const pro = await prisma.professionalProfile.create({
      data: {
        userId,
        homeTenantId: tenant.id,
        businessName,
        timeZone: 'America/Los_Angeles',
        // The alternative-look discovery filters on APPROVED pros.
        verificationStatus: VerificationStatus.APPROVED,
      },
      select: { id: true },
    })
    proIds.push(pro.id)
    return pro.id
  }

  const expensiveProId = await makePro('proexp', 'Lux Atelier')
  const affordableProId = await makePro('proaff', AFFORDABLE_PRO_NAME)
  const bandProId = await makePro('proband', 'Band Salon')

  // One shared, TAG-scoped category so the saved look and the alternative match, and
  // no seeded look can sneak into the pool.
  const category = await prisma.serviceCategory.create({
    data: { name: `${TAG} Balayage`, slug: `${TAG}-balayage`, isActive: true },
    select: { id: true },
  })

  const service = await prisma.service.create({
    data: {
      name: `${TAG} Balayage Service`,
      categoryId: category.id,
      defaultDurationMinutes: 90,
      minPrice: new Prisma.Decimal('60.00'),
      isActive: true,
    },
    select: { id: true },
  })

  const makeLocation = async (professionalId: string) => {
    const location = await prisma.professionalLocation.create({
      data: {
        professionalId,
        type: ProfessionalLocationType.SALON,
        name: 'Salon',
        isPrimary: true,
        isBookable: true,
        formattedAddress: '123 Salon St',
        addressLine1: '123 Salon St',
        city: 'San Diego',
        state: 'CA',
        postalCode: '92101',
        countryCode: 'US',
        lat: new Prisma.Decimal('32.7157000'),
        lng: new Prisma.Decimal('-117.1611000'),
        timeZone: 'America/Los_Angeles',
        workingHours: {},
        bufferMinutes: 15,
        stepMinutes: 15,
        advanceNoticeMinutes: 0,
        maxDaysAhead: 365,
      },
      select: { id: true },
    })
    return location.id
  }

  const bandLocationId = await makeLocation(bandProId)
  const expensiveLocationId = await makeLocation(expensiveProId)

  const makeLook = async (
    professionalId: string,
    price: string,
    suffix: string,
  ) => {
    const media = await prisma.mediaAsset.create({
      data: {
        professionalId,
        proTenantId: tenant.id,
        primaryServiceId: service.id,
        mediaType: MediaType.IMAGE,
        storageBucket: 'media-public',
        storagePath: `${TAG}/${suffix}.jpg`,
      },
      select: { id: true },
    })
    const look = await prisma.lookPost.create({
      data: {
        professionalId,
        primaryMediaAssetId: media.id,
        serviceId: service.id,
        status: LookPostStatus.PUBLISHED,
        moderationStatus: ModerationStatus.APPROVED,
        publishedAt: NOW,
        priceStartingAt: new Prisma.Decimal(price),
        rankScore: 10,
      },
      select: { id: true },
    })
    return look.id
  }

  // The over-budget saved look ($200 » a $60 band) and the in-band alternative ($75).
  const expensiveLookId = await makeLook(expensiveProId, '200.00', 'expensive')
  const affordableLookId = await makeLook(affordableProId, '75.00', 'affordable')

  const makeClient = async (suffix: string) => {
    const userId = await makeUser(Role.CLIENT, `client_${suffix}`)
    userIds.push(userId)
    const client = await prisma.clientProfile.create({
      data: { userId, homeTenantId: tenant.id, firstName: 'Client' },
      select: { id: true },
    })
    return client.id
  }

  const clientEligibleId = await makeClient('eligible')
  const clientNoBandId = await makeClient('noband')
  const clientBookedId = await makeClient('booked')

  const saveLook = async (args: {
    clientId: string
    lookPostId: string
    ageDays: number
  }) => {
    const board = await prisma.board.create({
      data: {
        clientId: args.clientId,
        name: `${TAG} ${args.clientId} board`,
        slug: `${TAG}-${args.clientId}`,
      },
      select: { id: true },
    })
    await prisma.boardItem.create({
      data: {
        boardId: board.id,
        lookPostId: args.lookPostId,
        createdAt: new Date(NOW.getTime() - args.ageDays * DAY_MS),
      },
    })
  }

  // All three save the pricey look 10 days ago.
  await saveLook({ clientId: clientEligibleId, lookPostId: expensiveLookId, ageDays: 10 })
  await saveLook({ clientId: clientNoBandId, lookPostId: expensiveLookId, ageDays: 10 })
  await saveLook({ clientId: clientBookedId, lookPostId: expensiveLookId, ageDays: 10 })

  const makeBooking = async (args: {
    clientId: string
    professionalId: string
    locationId: string
    subtotal: string
    ageDays: number
  }) => {
    await prisma.booking.create({
      data: {
        clientId: args.clientId,
        professionalId: args.professionalId,
        proTenantId: tenant.id,
        clientHomeTenantId: tenant.id,
        serviceId: service.id,
        scheduledFor: new Date(NOW.getTime() - args.ageDays * DAY_MS),
        status: BookingStatus.COMPLETED,
        source: BookingSource.REQUESTED,
        locationType: ServiceLocationType.SALON,
        locationId: args.locationId,
        locationTimeZone: 'America/Los_Angeles',
        locationAddressSnapshot: { formattedAddress: '123 Salon St' },
        locationLatSnapshot: 32.7157,
        locationLngSnapshot: -117.1611,
        clientAddressSnapshot: Prisma.JsonNull,
        subtotalSnapshot: new Prisma.Decimal(args.subtotal),
        totalDurationMinutes: 90,
        bufferMinutes: 15,
      },
    })
  }

  // Eligible: three ~$60 completed visits with an UNRELATED pro → a trustworthy $60
  // band, so the $200 saved look reads as over budget. Never booked the pricey pro.
  for (let i = 0; i < 3; i += 1) {
    await makeBooking({
      clientId: clientEligibleId,
      professionalId: bandProId,
      locationId: bandLocationId,
      subtotal: '60.00',
      ageDays: 20 + i * 10,
    })
  }

  // Booked: same $60 band, but the three visits are WITH the pricey pro — so the
  // pair is already engaged and must be excluded despite the over-budget save.
  for (let i = 0; i < 3; i += 1) {
    await makeBooking({
      clientId: clientBookedId,
      professionalId: expensiveProId,
      locationId: expensiveLocationId,
      subtotal: '60.00',
      ageDays: 20 + i * 10,
    })
  }

  // No-band client: zero completed bookings → no learned band → skipped.

  return {
    tenantId: tenant.id,
    expensiveProId,
    affordableProId,
    bandProId,
    categoryId: category.id,
    serviceId: service.id,
    expensiveLookId,
    affordableLookId,
    clientEligibleId,
    clientNoBandId,
    clientBookedId,
    clientIds: [clientEligibleId, clientNoBandId, clientBookedId],
    proIds,
    userIds,
  }
}

async function countPriceAltNotifications(clientId: string): Promise<number> {
  return prisma.clientNotification.count({
    where: {
      clientId,
      eventKey: NotificationEventKey.SAVED_LOOK_PRICE_ALTERNATIVE,
    },
  })
}

beforeAll(async () => {
  ids = await seed()
})

afterAll(async () => {
  await cleanup()
})

describe('runSavedLookPriceAlternatives (real DB)', () => {
  it('nudges only the eligible over-budget saved-not-booked client, with a real in-band alternative, and is idempotent', async () => {
    const first = await runSavedLookPriceAlternatives(prisma, { now: NOW })

    // Only the eligible client survives every filter.
    expect(first.sent).toBe(1)

    expect(await countPriceAltNotifications(ids.clientEligibleId)).toBe(1)
    expect(await countPriceAltNotifications(ids.clientNoBandId)).toBe(0)
    expect(await countPriceAltNotifications(ids.clientBookedId)).toBe(0)

    // The send created a dispatch — the pooled budget ledger (§8.1).
    const dispatches = await prisma.notificationDispatch.count({
      where: {
        clientId: ids.clientEligibleId,
        eventKey: NotificationEventKey.SAVED_LOOK_PRICE_ALTERNATIVE,
      },
    })
    expect(dispatches).toBe(1)

    // The inbox row deep-links to the ALTERNATIVE look (a different, in-band pro),
    // carries the cooldown-bucketed dedupeKey, and names the alternative pro — never
    // mentioning price.
    const row = await prisma.clientNotification.findFirst({
      where: {
        clientId: ids.clientEligibleId,
        eventKey: NotificationEventKey.SAVED_LOOK_PRICE_ALTERNATIVE,
      },
      select: { href: true, dedupeKey: true, title: true, data: true },
    })
    expect(row?.href).toBe(`/looks/${ids.affordableLookId}`)
    expect(row?.dedupeKey).toContain('saved-price-alt:')
    expect(row?.title).toBe(`${AFFORDABLE_PRO_NAME} has a similar look`)
    const data = row?.data as { alternativeLookPostId?: string } | null
    expect(data?.alternativeLookPostId).toBe(ids.affordableLookId)

    // Idempotent: a second run in the same cooldown window sends nothing new.
    const second = await runSavedLookPriceAlternatives(prisma, { now: NOW })
    expect(second.sent).toBe(0)
    expect(await countPriceAltNotifications(ids.clientEligibleId)).toBe(1)
  })
})
