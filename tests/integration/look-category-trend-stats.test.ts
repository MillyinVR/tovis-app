// tests/integration/look-category-trend-stats.test.ts
//
// Real-Postgres coverage for refreshLookCategoryTrendStats + the serve reader
// (camera-perfect C10, lib/looks/categoryTrendStats.ts). Runs against the docker
// test database:
//   pnpm test:integration
//
// Covers what unit mocks can't — that the windowed grouped SQL + the leaf→root
// fold actually (a) roll a child category's looks up into their top-level FAMILY
// row, (b) exclude looks published outside the trailing window, and (c) that the
// serve reader turns the stored rows into per-family strengths. The shared test
// DB is seeded, so everything here is fixture-scoped (unique TAG); the refresh
// itself replaces the whole trend table (that's its contract), so assertions are
// scoped to this test's own family/leaf/other categories, never table totals.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  LookPostStatus,
  MediaType,
  ModerationStatus,
  Prisma,
  PrismaClient,
  Role,
  VerificationStatus,
} from '@prisma/client'

import { LOOK_POST_RANK_WEIGHTS } from '@/lib/looks/ranking'
import {
  LOOK_CATEGORY_TREND,
  fetchCategoryTrendStrengths,
  refreshLookCategoryTrendStats,
} from '@/lib/looks/categoryTrendStats'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with: pnpm test:integration')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const TAG = `trendstat_${Date.now()}`
const NOW = new Date()
const DAY_MS = 24 * 60 * 60 * 1000

let familyCatId = ''
let leafCatId = ''
let otherCatId = ''
const familySlug = `${TAG}-family`
const otherSlug = `${TAG}-other`

// look1 (recent, under the leaf): heavy engagement, view-dominated impressions.
const look1 = { likeCount: 2, saveCount: 4, viewCount: 300 }
// look2 (recent, under the leaf): light engagement.
const look2 = { likeCount: 0, saveCount: 1, viewCount: 50 }
// look3 (recent, under the OTHER top-level family).
const look3 = { likeCount: 1, saveCount: 2, viewCount: 120 }

function weighted(l: { likeCount: number; saveCount: number }): number {
  return l.likeCount * LOOK_POST_RANK_WEIGHTS.like + l.saveCount * LOOK_POST_RANK_WEIGHTS.save
}
function impressions(l: { likeCount: number; saveCount: number; viewCount: number }): number {
  return Math.max(l.viewCount, l.likeCount + l.saveCount)
}

beforeAll(async () => {
  const tenant = await db.tenant.upsert({
    where: { slug: 'tovis-root' },
    update: {},
    create: { slug: 'tovis-root', name: 'TOVIS', isActive: true },
    select: { id: true },
  })

  // family (root) ← leaf (child); other (separate root).
  const family = await db.serviceCategory.create({
    data: { name: `${TAG} Family`, slug: familySlug, isActive: true },
    select: { id: true },
  })
  familyCatId = family.id
  const leaf = await db.serviceCategory.create({
    data: {
      name: `${TAG} Leaf`,
      slug: `${TAG}-leaf`,
      isActive: true,
      parentId: family.id,
    },
    select: { id: true },
  })
  leafCatId = leaf.id
  const other = await db.serviceCategory.create({
    data: { name: `${TAG} Other`, slug: otherSlug, isActive: true },
    select: { id: true },
  })
  otherCatId = other.id

  async function makeService(categoryId: string, letter: string): Promise<string> {
    const service = await db.service.create({
      data: {
        name: `${TAG} Svc ${letter}`,
        categoryId,
        defaultDurationMinutes: 60,
        minPrice: new Prisma.Decimal('100.00'),
        isActive: true,
      },
      select: { id: true },
    })
    return service.id
  }

  const proUser = await db.user.create({
    data: { email: `${TAG}_pro@example.com`, password: 'x', role: Role.PRO },
    select: { id: true },
  })
  const professional = await db.professionalProfile.create({
    data: {
      userId: proUser.id,
      homeTenantId: tenant.id,
      firstName: 'Trend',
      lastName: 'Pro',
      businessName: `${TAG} Studio`,
      timeZone: 'America/Los_Angeles',
      verificationStatus: VerificationStatus.APPROVED,
    },
    select: { id: true },
  })

  const leafServiceId = await makeService(leaf.id, 'Leaf')
  const otherServiceId = await makeService(other.id, 'Other')

  async function createLook(
    serviceId: string,
    suffix: string,
    counts: { likeCount: number; saveCount: number; viewCount: number },
    publishedAt: Date,
  ): Promise<void> {
    const media = await db.mediaAsset.create({
      data: {
        professionalId: professional.id,
        proTenantId: tenant.id,
        primaryServiceId: serviceId,
        mediaType: MediaType.IMAGE,
        storageBucket: 'media-public',
        storagePath: `${TAG}/${suffix}.jpg`,
      },
      select: { id: true },
    })
    await db.lookPost.create({
      data: {
        professionalId: professional.id,
        primaryMediaAssetId: media.id,
        serviceId,
        status: LookPostStatus.PUBLISHED,
        moderationStatus: ModerationStatus.APPROVED,
        publishedAt,
        likeCount: counts.likeCount,
        saveCount: counts.saveCount,
        viewCount: counts.viewCount,
      },
    })
  }

  await createLook(leafServiceId, 'look1', look1, NOW)
  await createLook(leafServiceId, 'look2', look2, NOW)
  await createLook(otherServiceId, 'look3', look3, NOW)
  // Out-of-window (60 days old, well past the 30-day window) with huge
  // engagement — must be EXCLUDED so it can't pollute the family sum.
  await createLook(
    leafServiceId,
    'stale',
    { likeCount: 0, saveCount: 999, viewCount: 9999 },
    new Date(NOW.getTime() - 60 * DAY_MS),
  )
})

afterAll(async () => {
  await db.lookCategoryTrendStat.deleteMany({
    where: { categoryId: { in: [familyCatId, leafCatId, otherCatId] } },
  })
  await db.lookPost.deleteMany({ where: { professional: { businessName: `${TAG} Studio` } } })
  await db.mediaAsset.deleteMany({ where: { storagePath: { startsWith: TAG } } })
  await db.service.deleteMany({ where: { name: { startsWith: `${TAG} Svc` } } })
  await db.serviceCategory.deleteMany({ where: { slug: { startsWith: TAG } } })
  await db.professionalProfile.deleteMany({ where: { businessName: `${TAG} Studio` } })
  await db.user.deleteMany({ where: { email: { startsWith: TAG } } })
  await db.$disconnect()
})

describe('refreshLookCategoryTrendStats (real Postgres)', () => {
  it('rolls leaf looks up into the family row and windows out stale looks', async () => {
    const result = await refreshLookCategoryTrendStats(db, NOW)
    expect(result.windowDays).toBe(LOOK_CATEGORY_TREND.windowDays)
    expect(result.families).toBeGreaterThanOrEqual(2)

    // The family row aggregates BOTH recent leaf looks — the child category's
    // engagement rolled up to its top-level root — and excludes the stale look.
    const familyRow = await db.lookCategoryTrendStat.findUnique({
      where: { categoryId: familyCatId },
    })
    expect(familyRow).not.toBeNull()
    expect(familyRow?.categorySlug).toBe(familySlug)
    expect(familyRow?.lookCount).toBe(2)
    expect(familyRow?.weightedEngagement).toBeCloseTo(weighted(look1) + weighted(look2), 5)
    expect(familyRow?.impressions).toBe(impressions(look1) + impressions(look2))
    expect(familyRow?.windowDays).toBe(LOOK_CATEGORY_TREND.windowDays)
    expect(familyRow?.computedAt.getTime()).toBe(NOW.getTime())

    // No standalone LEAF row — the leaf folded into its family.
    const leafRow = await db.lookCategoryTrendStat.findUnique({
      where: { categoryId: leafCatId },
    })
    expect(leafRow).toBeNull()

    // The separate top-level family got its own row.
    const otherRow = await db.lookCategoryTrendStat.findUnique({
      where: { categoryId: otherCatId },
    })
    expect(otherRow?.categorySlug).toBe(otherSlug)
    expect(otherRow?.lookCount).toBe(1)
    expect(otherRow?.impressions).toBe(impressions(look3))
  })

  it('serves per-family strengths in [0,1] for the refreshed rows', async () => {
    await refreshLookCategoryTrendStats(db, NOW)
    const strengths = await fetchCategoryTrendStrengths(db)

    const familyStrength = strengths.get(familySlug)
    const otherStrength = strengths.get(otherSlug)
    expect(familyStrength).toBeGreaterThanOrEqual(0)
    expect(familyStrength).toBeLessThanOrEqual(1)
    expect(otherStrength).toBeGreaterThanOrEqual(0)
    expect(otherStrength).toBeLessThanOrEqual(1)
  })
})
