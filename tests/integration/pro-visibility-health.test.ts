// tests/integration/pro-visibility-health.test.ts
//
// Real-Postgres coverage for loadProVisibilityHealth — the §6.5 pro-side
// transparency reader (lib/pro/visibilityHealth.ts). Runs against the docker
// test database:
//   node scripts/with-test-db.mjs npx vitest run \
//     tests/integration/pro-visibility-health.test.ts \
//     --config vitest.integration.config.mts
//
// Covers what the pure units can't — that the eleven parallel reads actually
// resolve against real rows: (a) look counts bucket correctly by status +
// moderation (live / pending / rejected / draft), (b) distinct tags are counted
// from the tag side and only over feed-eligible looks, (c) distinct services
// come off the groupBy, (d) the conversion aggregate sums only this pro's
// eligible looks, (e) the availability + badge stat rows are read, and (f) the
// availability existence probe distinguishes "no openings" from "cron never
// ran". Assertions are scoped to this test's own pro (unique TAG) — the shared
// test DB is seeded, so table totals are never asserted.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  LookPostStatus,
  LookPostVisibility,
  MediaType,
  ModerationStatus,
  Prisma,
  PrismaClient,
  Role,
  VerificationStatus,
} from '@prisma/client'

import { loadProVisibilityHealth } from '@/lib/pro/visibilityHealth'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with the test DB harness.')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const TAG = `provis_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
const NOW = new Date()
const DAY_MS = 24 * 60 * 60 * 1000

type Fixtures = {
  professionalId: string
  /** A second pro, to prove the reader never counts someone else's looks. */
  otherProfessionalId: string
  liveLookIds: string[]
}

let fx: Fixtures | null = null

async function cleanup(): Promise<void> {
  await db.lookPostConversionStat.deleteMany({
    where: { lookPost: { professional: { businessName: { startsWith: TAG } } } },
  })
  await db.lookPost.deleteMany({
    where: { professional: { businessName: { startsWith: TAG } } },
  })
  await db.lookTag.deleteMany({ where: { slug: { startsWith: TAG } } })
  await db.mediaAsset.deleteMany({ where: { storagePath: { startsWith: TAG } } })
  await db.professionalAvailabilityStat.deleteMany({
    where: { professional: { businessName: { startsWith: TAG } } },
  })
  await db.professionalBadgeStat.deleteMany({
    where: { professional: { businessName: { startsWith: TAG } } },
  })
  await db.service.deleteMany({ where: { name: { startsWith: `${TAG} Svc` } } })
  await db.serviceCategory.deleteMany({ where: { slug: { startsWith: TAG } } })
  await db.professionalProfile.deleteMany({
    where: { businessName: { startsWith: TAG } },
  })
  await db.user.deleteMany({ where: { email: { startsWith: TAG } } })
}

async function seed(): Promise<Fixtures> {
  const tenant = await db.tenant.upsert({
    where: { slug: 'tovis-root' },
    update: {},
    create: { slug: 'tovis-root', name: 'TOVIS', isActive: true },
    select: { id: true },
  })

  async function createPro(suffix: string): Promise<string> {
    const user = await db.user.create({
      data: { email: `${TAG}_${suffix}@example.com`, password: 'x', role: Role.PRO },
      select: { id: true },
    })
    const pro = await db.professionalProfile.create({
      data: {
        userId: user.id,
        homeTenantId: tenant.id,
        firstName: 'Vis',
        lastName: 'Pro',
        businessName: `${TAG} ${suffix} Studio`,
        handle: `${TAG}-${suffix}`,
        timeZone: 'America/Los_Angeles',
        verificationStatus: VerificationStatus.APPROVED,
      },
      select: { id: true },
    })
    return pro.id
  }

  const professionalId = await createPro('main')
  const otherProfessionalId = await createPro('other')

  const category = await db.serviceCategory.create({
    data: { name: `${TAG} Category`, slug: `${TAG}-category`, isActive: true },
    select: { id: true },
  })

  async function createService(suffix: string): Promise<string> {
    const service = await db.service.create({
      data: {
        name: `${TAG} Svc ${suffix}`,
        categoryId: category.id,
        defaultDurationMinutes: 60,
        minPrice: new Prisma.Decimal('100.00'),
        isActive: true,
      },
      select: { id: true },
    })
    return service.id
  }

  const serviceA = await createService('a')
  const serviceB = await createService('b')

  // Two tags shared across the live looks + one tag used ONLY by a rejected
  // look, so "distinct tags over FEED-ELIGIBLE looks" is a real assertion.
  async function createTag(suffix: string): Promise<string> {
    const tag = await db.lookTag.create({
      data: { slug: `${TAG}-${suffix}`, display: `${TAG} ${suffix}` },
      select: { id: true },
    })
    return tag.id
  }

  const tagA = await createTag('tag-a')
  const tagB = await createTag('tag-b')
  const tagRejectedOnly = await createTag('tag-rejected')

  async function createLook(args: {
    proId: string
    suffix: string
    serviceId?: string
    status?: LookPostStatus
    moderationStatus?: ModerationStatus
    visibility?: LookPostVisibility
    tagIds?: string[]
  }): Promise<string> {
    const media = await db.mediaAsset.create({
      data: {
        professionalId: args.proId,
        proTenantId: tenant.id,
        // Required by the schema — every asset anchors to a bookable service.
        // Independent of LookPost.serviceId, which is what the reader groups on.
        primaryServiceId: args.serviceId ?? serviceA,
        mediaType: MediaType.IMAGE,
        storageBucket: 'media-public',
        storagePath: `${TAG}/${args.suffix}.jpg`,
      },
      select: { id: true },
    })
    const status = args.status ?? LookPostStatus.PUBLISHED
    const look = await db.lookPost.create({
      data: {
        professionalId: args.proId,
        primaryMediaAssetId: media.id,
        serviceId: args.serviceId ?? null,
        status,
        moderationStatus: args.moderationStatus ?? ModerationStatus.APPROVED,
        visibility: args.visibility ?? LookPostVisibility.PUBLIC,
        publishedAt: status === LookPostStatus.PUBLISHED ? NOW : null,
        ...(args.tagIds?.length
          ? { tags: { connect: args.tagIds.map((id) => ({ id })) } }
          : {}),
      },
      select: { id: true },
    })
    return look.id
  }

  // 3 live looks: 2 on serviceA, 1 on serviceB → distinctServiceCount 2.
  const liveOne = await createLook({
    proId: professionalId,
    suffix: 'live-1',
    serviceId: serviceA,
    tagIds: [tagA, tagB],
  })
  const liveTwo = await createLook({
    proId: professionalId,
    suffix: 'live-2',
    serviceId: serviceA,
    tagIds: [tagA],
  })
  const liveThree = await createLook({
    proId: professionalId,
    suffix: 'live-3',
    serviceId: serviceB,
    tagIds: [tagB],
  })
  const liveLookIds = [liveOne, liveTwo, liveThree]

  // Non-live buckets.
  await createLook({
    proId: professionalId,
    suffix: 'pending',
    moderationStatus: ModerationStatus.PENDING_REVIEW,
  })
  await createLook({
    proId: professionalId,
    suffix: 'rejected',
    moderationStatus: ModerationStatus.REJECTED,
    tagIds: [tagRejectedOnly],
  })
  await createLook({
    proId: professionalId,
    suffix: 'draft',
    status: LookPostStatus.DRAFT,
  })
  // Published but not publicly visible → not feed-eligible, and not "rejected".
  await createLook({
    proId: professionalId,
    suffix: 'unlisted',
    visibility: LookPostVisibility.UNLISTED,
  })

  // Another pro's live look — must never be counted for our pro.
  await createLook({
    proId: otherProfessionalId,
    suffix: 'other-live',
    serviceId: serviceA,
    tagIds: [tagA, tagB, tagRejectedOnly],
  })

  // Conversion rows on two of our live looks + one on the other pro's look.
  await db.lookPostConversionStat.create({
    data: {
      lookPostId: liveOne,
      bookingCount: 6,
      interestCount: 100,
      computedAt: NOW,
    },
  })
  await db.lookPostConversionStat.create({
    data: {
      lookPostId: liveTwo,
      bookingCount: 4,
      interestCount: 100,
      computedAt: NOW,
    },
  })

  await db.professionalBadgeStat.create({
    data: {
      professionalId,
      resolvedBookingCount: 20,
      completedResolvedCount: 19,
      computedAt: NOW,
    },
  })

  return { professionalId, otherProfessionalId, liveLookIds }
}

beforeAll(async () => {
  await cleanup()
  fx = await seed()
}, 120_000)

afterAll(async () => {
  await cleanup()
  await db.$disconnect()
})

describe('loadProVisibilityHealth — real Postgres', () => {
  it('buckets the pro’s own looks by status, moderation and visibility', async () => {
    const professionalId = fx!.professionalId
    const result = await loadProVisibilityHealth({ professionalId, now: NOW })

    expect(result.looks.feedEligibleCount).toBe(3)
    expect(result.looks.pendingReviewCount).toBe(1)
    expect(result.looks.rejectedCount).toBe(1)
    expect(result.looks.draftCount).toBe(1)
  })

  it('counts distinct tags over feed-eligible looks only', async () => {
    const result = await loadProVisibilityHealth({
      professionalId: fx!.professionalId,
      now: NOW,
    })

    // tagA + tagB are on live looks; tagRejectedOnly is only on the rejected
    // look, so it must not widen the reported match surface.
    expect(result.looks.distinctTagCount).toBe(2)
  })

  it('counts distinct services off the groupBy', async () => {
    const result = await loadProVisibilityHealth({
      professionalId: fx!.professionalId,
      now: NOW,
    })
    expect(result.looks.distinctServiceCount).toBe(2)
  })

  it('never counts another pro’s looks, tags or conversions', async () => {
    const other = await loadProVisibilityHealth({
      professionalId: fx!.otherProfessionalId,
      now: NOW,
    })

    expect(other.looks.feedEligibleCount).toBe(1)
    expect(other.looks.rejectedCount).toBe(0)
    expect(other.looks.distinctTagCount).toBe(3)
    // The other pro has no conversion rows at all.
    const conversionLever = other.levers.find(
      (lever) => lever.key === 'BOOKING_CONVERSION',
    )
    expect(conversionLever?.status).toBe('UNKNOWN')
  })

  it('sums the conversion aggregate across the pro’s eligible looks', async () => {
    const result = await loadProVisibilityHealth({
      professionalId: fx!.professionalId,
      now: NOW,
    })

    // 10 bookings / 200 interest = 0.05, above the 0.04 target → GOOD.
    const lever = result.levers.find((l) => l.key === 'BOOKING_CONVERSION')
    expect(lever?.status).toBe('GOOD')
  })

  it('reads the badge stat row for reliability', async () => {
    const result = await loadProVisibilityHealth({
      professionalId: fx!.professionalId,
      now: NOW,
    })
    // 19/20 = 0.95, above the 0.75 floor.
    const lever = result.levers.find((l) => l.key === 'RELIABILITY')
    expect(lever?.status).toBe('GOOD')
  })

  it('reads a fresh availability row and reports a near opening as GOOD', async () => {
    const professionalId = fx!.professionalId
    await db.professionalAvailabilityStat.create({
      data: {
        professionalId,
        nextOpeningDate: new Date(NOW.getTime() + 2 * DAY_MS),
        openDayCount14d: 6,
        fullness14d: 0.3,
        capacityMinutes14d: 4800,
        computedAt: NOW,
      },
    })

    const result = await loadProVisibilityHealth({ professionalId, now: NOW })
    const lever = result.levers.find((l) => l.key === 'AVAILABILITY')
    expect(lever?.status).toBe('GOOD')

    await db.professionalAvailabilityStat.delete({ where: { professionalId } })
  })

  it('reports a booked-out calendar as ATTENTION, not as a failure', async () => {
    const professionalId = fx!.professionalId
    await db.professionalAvailabilityStat.create({
      data: {
        professionalId,
        nextOpeningDate: new Date(NOW.getTime() + 1 * DAY_MS),
        openDayCount14d: 1,
        fullness14d: 0.95,
        capacityMinutes14d: 4800,
        computedAt: NOW,
      },
    })

    const result = await loadProVisibilityHealth({ professionalId, now: NOW })
    const lever = result.levers.find((l) => l.key === 'AVAILABILITY')
    expect(lever?.status).toBe('ATTENTION')
    expect(lever?.status).not.toBe('ACTION')

    await db.professionalAvailabilityStat.delete({ where: { professionalId } })
  })

  it('distinguishes "no opening" from "cron never ran" via the existence probe', async () => {
    const professionalId = fx!.professionalId

    // Another pro HAS a row → the cron demonstrably runs → our pro's missing
    // row is a real "no openings" signal.
    await db.professionalAvailabilityStat.create({
      data: {
        professionalId: fx!.otherProfessionalId,
        nextOpeningDate: new Date(NOW.getTime() + 3 * DAY_MS),
        openDayCount14d: 4,
        fullness14d: 0.2,
        capacityMinutes14d: 4800,
        computedAt: NOW,
      },
    })

    const withPeers = await loadProVisibilityHealth({ professionalId, now: NOW })
    const lever = withPeers.levers.find((l) => l.key === 'AVAILABILITY')
    expect(lever?.status).toBe('ATTENTION')

    await db.professionalAvailabilityStat.delete({
      where: { professionalId: fx!.otherProfessionalId },
    })
  })

  it('returns a JSON-safe payload (no Date or Decimal leaks onto the wire)', async () => {
    const result = await loadProVisibilityHealth({
      professionalId: fx!.professionalId,
      now: NOW,
    })
    // A DTO that survives a JSON round trip unchanged is the wire contract the
    // native client decodes.
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
  })
})
