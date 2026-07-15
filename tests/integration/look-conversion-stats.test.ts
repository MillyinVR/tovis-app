// tests/integration/look-conversion-stats.test.ts
//
// Real-Postgres coverage for refreshLookPostConversionStats + the serve reader
// (personalization spec §4.2 booking_conversion_rate, lib/looks/conversionStats.ts).
// Runs against the docker test database:
//   npm run test:integration
//
// Covers what unit mocks can't — that the grouped SQL join (a) counts only
// attributed NON-CANCELLED bookings per source look, (b) snapshots the look's
// saveCount + viewCount as the interest denominator, (c) "skips the zeros" so a
// look with no attributed booking gets no row, (d) excludes bookings whose source
// look is unpublished/unapproved, and (e) that a later refresh REPLACES the table
// (a look that loses its bookings loses its row). The shared test DB is seeded, so
// everything is fixture-scoped (unique TAG) and assertions are scoped to this
// test's own looks, never table totals.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  BookingSource,
  BookingStatus,
  LookPostStatus,
  MediaType,
  ModerationStatus,
  Prisma,
  PrismaClient,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
  VerificationStatus,
} from '@prisma/client'

import {
  fetchLookConversionSignals,
  refreshLookPostConversionStats,
} from '@/lib/looks/conversionStats'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with: npm run test:integration')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const TAG = `convstat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
const NOW = new Date()
const DAY_MS = 24 * 60 * 60 * 1000

type Fixtures = {
  tenantId: string
  professionalId: string
  proUserId: string
  clientId: string
  clientUserId: string
  serviceId: string
  categoryId: string
  locationId: string
  // look ids by role
  convertsId: string
  prettyId: string
  noneId: string
  draftId: string
}

let fx: Fixtures | null = null

async function cleanup(): Promise<void> {
  await db.lookPostConversionStat.deleteMany({
    where: { lookPost: { professional: { businessName: `${TAG} Studio` } } },
  })
  await db.booking.deleteMany({
    where: { professional: { businessName: `${TAG} Studio` } },
  })
  await db.lookPost.deleteMany({
    where: { professional: { businessName: `${TAG} Studio` } },
  })
  await db.mediaAsset.deleteMany({ where: { storagePath: { startsWith: TAG } } })
  await db.professionalLocation.deleteMany({
    where: { professional: { businessName: `${TAG} Studio` } },
  })
  await db.service.deleteMany({ where: { name: { startsWith: `${TAG} Svc` } } })
  await db.serviceCategory.deleteMany({ where: { slug: { startsWith: TAG } } })
  await db.professionalProfile.deleteMany({
    where: { businessName: `${TAG} Studio` },
  })
  await db.clientProfile.deleteMany({ where: { user: { email: { startsWith: TAG } } } })
  await db.user.deleteMany({ where: { email: { startsWith: TAG } } })
}

async function seed(): Promise<Fixtures> {
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
      firstName: 'Conv',
      lastName: 'Pro',
      businessName: `${TAG} Studio`,
      timeZone: 'America/Los_Angeles',
      verificationStatus: VerificationStatus.APPROVED,
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
      firstName: 'Client',
      lastName: 'C',
    },
    select: { id: true },
  })

  const category = await db.serviceCategory.create({
    data: { name: `${TAG} Category`, slug: `${TAG}-category`, isActive: true },
    select: { id: true },
  })
  const service = await db.service.create({
    data: {
      name: `${TAG} Svc`,
      categoryId: category.id,
      defaultDurationMinutes: 60,
      minPrice: new Prisma.Decimal('100.00'),
      isActive: true,
    },
    select: { id: true },
  })

  const location = await db.professionalLocation.create({
    data: {
      professionalId: professional.id,
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

  async function createLook(args: {
    suffix: string
    saveCount: number
    viewCount: number
    status?: LookPostStatus
    moderationStatus?: ModerationStatus
    publishedAt?: Date | null
  }): Promise<string> {
    const media = await db.mediaAsset.create({
      data: {
        professionalId: professional.id,
        proTenantId: tenant.id,
        primaryServiceId: service.id,
        mediaType: MediaType.IMAGE,
        storageBucket: 'media-public',
        storagePath: `${TAG}/${args.suffix}.jpg`,
      },
      select: { id: true },
    })
    const look = await db.lookPost.create({
      data: {
        professionalId: professional.id,
        primaryMediaAssetId: media.id,
        serviceId: service.id,
        status: args.status ?? LookPostStatus.PUBLISHED,
        moderationStatus: args.moderationStatus ?? ModerationStatus.APPROVED,
        publishedAt: args.publishedAt === undefined ? NOW : args.publishedAt,
        saveCount: args.saveCount,
        viewCount: args.viewCount,
      },
      select: { id: true },
    })
    return look.id
  }

  // converts: efficient — few exposures, several bookings.
  const convertsId = await createLook({ suffix: 'converts', saveCount: 4, viewCount: 8 })
  // pretty: heavily exposed, one booking.
  const prettyId = await createLook({ suffix: 'pretty', saveCount: 50, viewCount: 2950 })
  // none: exposed but never booked → no row (skip the zeros).
  const noneId = await createLook({ suffix: 'none', saveCount: 10, viewCount: 100 })
  // draft: has a booking but is not feed-eligible → excluded from the aggregate.
  const draftId = await createLook({
    suffix: 'draft',
    saveCount: 1,
    viewCount: 1,
    status: LookPostStatus.DRAFT,
    publishedAt: null,
  })

  return {
    tenantId: tenant.id,
    professionalId: professional.id,
    proUserId: proUser.id,
    clientId: client.id,
    clientUserId: clientUser.id,
    serviceId: service.id,
    categoryId: category.id,
    locationId: location.id,
    convertsId,
    prettyId,
    noneId,
    draftId,
  }
}

/** Distinct future slots so the active-overlap EXCLUDE constraint never bites. */
function futureSlot(index: number): Date {
  return new Date(NOW.getTime() + (index + 2) * DAY_MS)
}

let slotIndex = 0
async function createBooking(args: {
  sourceLookPostId: string
  status: BookingStatus
}): Promise<void> {
  if (!fx) throw new Error('Fixtures not initialized')
  await db.booking.create({
    data: {
      clientId: fx.clientId,
      professionalId: fx.professionalId,
      proTenantId: fx.tenantId,
      clientHomeTenantId: fx.tenantId,
      serviceId: fx.serviceId,
      sourceLookPostId: args.sourceLookPostId,
      scheduledFor: futureSlot(slotIndex++),
      status: args.status,
      source: BookingSource.REQUESTED,
      locationType: ServiceLocationType.SALON,
      locationId: fx.locationId,
      locationTimeZone: 'America/Los_Angeles',
      locationAddressSnapshot: { formattedAddress: '123 Salon St' },
      locationLatSnapshot: 32.7157,
      locationLngSnapshot: -117.1611,
      clientAddressSnapshot: Prisma.JsonNull,
      subtotalSnapshot: new Prisma.Decimal('100.00'),
      totalDurationMinutes: 60,
      bufferMinutes: 15,
    },
    select: { id: true },
  })
}

beforeAll(async () => {
  await cleanup()
  fx = await seed()

  // converts: 3 non-cancelled + 1 CANCELLED (excluded from the numerator).
  await createBooking({ sourceLookPostId: fx.convertsId, status: BookingStatus.ACCEPTED })
  await createBooking({ sourceLookPostId: fx.convertsId, status: BookingStatus.COMPLETED })
  await createBooking({ sourceLookPostId: fx.convertsId, status: BookingStatus.PENDING })
  await createBooking({ sourceLookPostId: fx.convertsId, status: BookingStatus.CANCELLED })
  // pretty: 1 non-cancelled.
  await createBooking({ sourceLookPostId: fx.prettyId, status: BookingStatus.COMPLETED })
  // draft: 1 non-cancelled, but the source look is not feed-eligible.
  await createBooking({ sourceLookPostId: fx.draftId, status: BookingStatus.COMPLETED })
  // none: no bookings at all.
})

afterAll(async () => {
  await cleanup()
  await db.$disconnect()
})

describe('refreshLookPostConversionStats (real Postgres)', () => {
  it('aggregates attributed non-cancelled bookings with the interest snapshot, skipping zeros + ineligible looks', async () => {
    if (!fx) throw new Error('Fixtures not initialized')

    const result = await refreshLookPostConversionStats(db, NOW)
    // The seeded DB may hold other converting looks — assert on OUR rows.
    expect(result.looks).toBeGreaterThanOrEqual(2)

    const converts = await db.lookPostConversionStat.findUnique({
      where: { lookPostId: fx.convertsId },
    })
    expect(converts).not.toBeNull()
    // 3 non-cancelled (the CANCELLED one excluded); interest = save + view.
    expect(converts?.bookingCount).toBe(3)
    expect(converts?.interestCount).toBe(4 + 8)
    expect(converts?.computedAt.getTime()).toBe(NOW.getTime())

    const pretty = await db.lookPostConversionStat.findUnique({
      where: { lookPostId: fx.prettyId },
    })
    expect(pretty?.bookingCount).toBe(1)
    expect(pretty?.interestCount).toBe(50 + 2950)

    // none: never booked → no row (skip the zeros).
    expect(
      await db.lookPostConversionStat.findUnique({
        where: { lookPostId: fx.noneId },
      }),
    ).toBeNull()

    // draft: booked but not published/approved → excluded from the aggregate.
    expect(
      await db.lookPostConversionStat.findUnique({
        where: { lookPostId: fx.draftId },
      }),
    ).toBeNull()
  })

  it('serves the stored rows keyed by lookPostId, absent for un-converted looks', async () => {
    if (!fx) throw new Error('Fixtures not initialized')
    await refreshLookPostConversionStats(db, NOW)

    const map = await fetchLookConversionSignals(db, [
      fx.convertsId,
      fx.prettyId,
      fx.noneId,
    ])
    expect(map.get(fx.convertsId)).toEqual({ bookingCount: 3, interestCount: 12 })
    expect(map.get(fx.prettyId)).toEqual({ bookingCount: 1, interestCount: 3000 })
    expect(map.has(fx.noneId)).toBe(false)
  })

  it('a later refresh REPLACES the contents — a look that loses its bookings loses its row', async () => {
    if (!fx) throw new Error('Fixtures not initialized')
    await db.booking.deleteMany({
      where: { professional: { businessName: `${TAG} Studio` } },
    })

    await refreshLookPostConversionStats(db, new Date())

    expect(
      await db.lookPostConversionStat.findUnique({
        where: { lookPostId: fx.convertsId },
      }),
    ).toBeNull()
    expect(
      await db.lookPostConversionStat.findUnique({
        where: { lookPostId: fx.prettyId },
      }),
    ).toBeNull()
  })
})
