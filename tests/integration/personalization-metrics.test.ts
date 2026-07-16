// tests/integration/personalization-metrics.test.ts
//
// Real-Postgres coverage for computePersonalizationMetrics — the §9
// personalization funnel + health rollup (lib/looks/personalizationMetrics.ts).
// Runs against the docker test database:
//   node scripts/with-test-db.mjs npx vitest run \
//     tests/integration/personalization-metrics.test.ts \
//     --config vitest.integration.config.mts
//
// This reader returns PLATFORM-WIDE totals (not fixture-scoped rows), so the
// shared seeded DB means we can't assert absolute values. Instead we snapshot
// the metrics BEFORE seeding and AFTER, and assert our seeded contribution as
// exact deltas. That's robust to whatever else is in the DB, and assumes no
// other writer touches these tables mid-run (true for a manual integration run).
//
// The seed exercises every metric: a converted save (client A saved + booked
// look L1), a saved-not-booked gap (client B saved L2, never booked), a board→
// booking conversion (A), "not for me" hides, FEED impressions, a repeat client
// (C, two completed) vs a one-and-done (D), and a per-trigger opt-out (B muted
// the saved-look category).

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  BookingSource,
  BookingStatus,
  LookImpressionSource,
  LookPostStatus,
  MediaType,
  ModerationStatus,
  NotificationEventKey,
  Prisma,
  PrismaClient,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
  VerificationStatus,
} from '@prisma/client'

import {
  computePersonalizationMetrics,
  type PersonalizationMetrics,
} from '@/lib/looks/personalizationMetrics'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with the test DB harness.')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const TAG = `pmetrics_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
const NOW = new Date()
const DAY_MS = 24 * 60 * 60 * 1000
const WINDOW_DAYS = 30

function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

type Fixtures = {
  tenantId: string
  professionalId: string
  serviceId: string
  locationId: string
  clientAId: string
  clientBId: string
  clientCId: string
  clientDId: string
  look1Id: string
  look2Id: string
}

let fx: Fixtures | null = null

async function cleanup(): Promise<void> {
  await db.clientNotificationPreference.deleteMany({
    where: { client: { user: { email: { startsWith: TAG } } } },
  })
  await db.booking.deleteMany({
    where: { professional: { businessName: `${TAG} Studio` } },
  })
  await db.lookHide.deleteMany({
    where: { lookPost: { professional: { businessName: `${TAG} Studio` } } },
  })
  await db.lookPostImpressionStat.deleteMany({
    where: { lookPost: { professional: { businessName: `${TAG} Studio` } } },
  })
  await db.boardItem.deleteMany({
    where: { board: { client: { user: { email: { startsWith: TAG } } } } },
  })
  await db.board.deleteMany({
    where: { client: { user: { email: { startsWith: TAG } } } },
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
  await db.clientProfile.deleteMany({
    where: { user: { email: { startsWith: TAG } } },
  })
  await db.user.deleteMany({ where: { email: { startsWith: TAG } } })
}

async function makeClient(suffix: string): Promise<string> {
  const user = await db.user.create({
    data: {
      email: `${TAG}_${suffix}@example.com`,
      password: 'x',
      role: Role.CLIENT,
    },
    select: { id: true },
  })
  const client = await db.clientProfile.create({
    data: {
      userId: user.id,
      homeTenantId: fx!.tenantId,
      firstName: 'C',
      lastName: suffix,
    },
    select: { id: true },
  })
  return client.id
}

let slotIndex = 0
async function makeBooking(args: {
  clientId: string
  status: BookingStatus
  sourceLookPostId?: string
}): Promise<void> {
  await db.booking.create({
    data: {
      clientId: args.clientId,
      professionalId: fx!.professionalId,
      proTenantId: fx!.tenantId,
      clientHomeTenantId: fx!.tenantId,
      serviceId: fx!.serviceId,
      sourceLookPostId: args.sourceLookPostId,
      // Distinct future slots so the pro's active-overlap constraint never bites.
      scheduledFor: new Date(NOW.getTime() + (slotIndex++ + 2) * DAY_MS),
      status: args.status,
      source: BookingSource.REQUESTED,
      locationType: ServiceLocationType.SALON,
      locationId: fx!.locationId,
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

async function saveLook(args: {
  clientId: string
  lookPostId: string
}): Promise<void> {
  const board = await db.board.create({
    data: {
      clientId: args.clientId,
      name: `${TAG} board ${args.clientId}`,
      slug: `${TAG}-board-${args.clientId}`,
      // Well within the window; the follow-up booking (createdAt ≈ now) lands after.
      createdAt: new Date(NOW.getTime() - 2 * DAY_MS),
    },
    select: { id: true },
  })
  await db.boardItem.create({
    data: {
      boardId: board.id,
      lookPostId: args.lookPostId,
      createdAt: new Date(NOW.getTime() - DAY_MS),
    },
  })
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
      firstName: 'Metrics',
      lastName: 'Pro',
      businessName: `${TAG} Studio`,
      timeZone: 'America/Los_Angeles',
      verificationStatus: VerificationStatus.APPROVED,
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

  async function createLook(suffix: string): Promise<string> {
    const media = await db.mediaAsset.create({
      data: {
        professionalId: professional.id,
        proTenantId: tenant.id,
        primaryServiceId: service.id,
        mediaType: MediaType.IMAGE,
        storageBucket: 'media-public',
        storagePath: `${TAG}/${suffix}.jpg`,
      },
      select: { id: true },
    })
    const look = await db.lookPost.create({
      data: {
        professionalId: professional.id,
        primaryMediaAssetId: media.id,
        serviceId: service.id,
        status: LookPostStatus.PUBLISHED,
        moderationStatus: ModerationStatus.APPROVED,
        publishedAt: NOW,
      },
      select: { id: true },
    })
    return look.id
  }

  const look1Id = await createLook('look1')
  const look2Id = await createLook('look2')

  return {
    tenantId: tenant.id,
    professionalId: professional.id,
    serviceId: service.id,
    locationId: location.id,
    clientAId: '',
    clientBId: '',
    clientCId: '',
    clientDId: '',
    look1Id,
    look2Id,
  }
}

function optOutRate(
  metrics: PersonalizationMetrics,
  key: string,
): number {
  const row = metrics.notificationOptOut.categories.find((c) => c.key === key)
  return row ? row.mutedClients : 0
}

let before: PersonalizationMetrics | null = null
let after: PersonalizationMetrics | null = null

beforeAll(async () => {
  await cleanup()
  fx = await seed()

  before = await computePersonalizationMetrics(db, {
    now: NOW,
    windowDays: WINDOW_DAYS,
  })

  // Four clients with distinct roles.
  fx.clientAId = await makeClient('a') // saves L1 + books L1 (converted)
  fx.clientBId = await makeClient('b') // saves L2, never books (gap) + mutes saved-looks
  fx.clientCId = await makeClient('c') // two completed bookings (repeat)
  fx.clientDId = await makeClient('d') // one completed booking

  // Saves (board + item, both in-window).
  await saveLook({ clientId: fx.clientAId, lookPostId: fx.look1Id })
  await saveLook({ clientId: fx.clientBId, lookPostId: fx.look2Id })

  // Bookings.
  await makeBooking({
    clientId: fx.clientAId,
    status: BookingStatus.ACCEPTED,
    sourceLookPostId: fx.look1Id, // (A, L1) converts the save
  })
  await makeBooking({ clientId: fx.clientCId, status: BookingStatus.COMPLETED })
  await makeBooking({ clientId: fx.clientCId, status: BookingStatus.COMPLETED })
  await makeBooking({ clientId: fx.clientDId, status: BookingStatus.COMPLETED })

  // Hides by A's user on both looks (unique per (look, user)).
  const clientAUser = await db.clientProfile.findUniqueOrThrow({
    where: { id: fx.clientAId },
    select: { userId: true },
  })
  for (const lookPostId of [fx.look1Id, fx.look2Id]) {
    await db.lookHide.create({
      data: { lookPostId, userId: clientAUser.userId! },
    })
  }

  // FEED impressions today: 100 for L1, 50 for L2 → +150.
  await db.lookPostImpressionStat.create({
    data: {
      lookPostId: fx.look1Id,
      source: LookImpressionSource.FEED,
      windowDate: utcMidnight(NOW),
      count: 100,
    },
  })
  await db.lookPostImpressionStat.create({
    data: {
      lookPostId: fx.look2Id,
      source: LookImpressionSource.FEED,
      windowDate: utcMidnight(NOW),
      count: 50,
    },
  })

  // B mutes the saved-look re-engagement trigger (all channels off).
  await db.clientNotificationPreference.create({
    data: {
      clientId: fx.clientBId,
      eventKey: NotificationEventKey.SAVED_LOOK_AVAILABILITY_OPENED,
      inAppEnabled: false,
      emailEnabled: false,
      pushEnabled: false,
      smsEnabled: false,
    },
  })

  after = await computePersonalizationMetrics(db, {
    now: NOW,
    windowDays: WINDOW_DAYS,
  })
}, 120_000)

afterAll(async () => {
  await cleanup()
  await db.$disconnect()
})

describe('computePersonalizationMetrics (integration)', () => {
  it('reports the window it ran over', () => {
    expect(after!.windowDays).toBe(WINDOW_DAYS)
  })

  it('counts the save→book funnel and the saved-not-booked gap', () => {
    const b = before!.saveToBook
    const a = after!.saveToBook
    expect(a.savedPairs - b.savedPairs).toBe(2) // (A,L1) + (B,L2)
    expect(a.bookedPairs - b.bookedPairs).toBe(1) // (A,L1) booked
    expect(a.notBookedPairs - b.notBookedPairs).toBe(1) // (B,L2) gap
  })

  it('counts board→booking conversion', () => {
    const b = before!.boardToBooking
    const a = after!.boardToBooking
    expect(a.boardCreators - b.boardCreators).toBe(2) // A + B created boards
    expect(a.bookedAfterBoard - b.bookedAfterBoard).toBe(1) // only A booked after
  })

  it('counts hides and FEED impressions', () => {
    expect(after!.hideRate.hides - before!.hideRate.hides).toBe(2)
    expect(after!.hideRate.feedImpressions - before!.hideRate.feedImpressions).toBe(
      150,
    )
    expect(after!.hideRate.rate).toBeGreaterThanOrEqual(0)
  })

  it('counts repeat vs one-and-done clients for the rebook rate', () => {
    // C (2 completed) + D (1 completed) both become booked clients; only C repeats.
    // A's ACCEPTED booking is not COMPLETED, so A never counts here.
    expect(after!.rebook.bookedClients - before!.rebook.bookedClients).toBe(2)
    expect(after!.rebook.repeatClients - before!.rebook.repeatClients).toBe(1)
  })

  it('counts a per-trigger opt-out (B muted the saved-look category)', () => {
    expect(optOutRate(after!, 'SAVED_LOOKS') - optOutRate(before!, 'SAVED_LOOKS')).toBe(
      1,
    )
    // A category B did not mute is unchanged.
    expect(optOutRate(after!, 'REBOOK_REMINDERS') - optOutRate(before!, 'REBOOK_REMINDERS')).toBe(
      0,
    )
  })

  it('adds the four seeded clients to the opt-out denominator', () => {
    expect(
      after!.notificationOptOut.totalClients -
        before!.notificationOptOut.totalClients,
    ).toBe(4)
  })
})
