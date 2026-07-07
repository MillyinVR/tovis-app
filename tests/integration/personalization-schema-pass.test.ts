// tests/integration/personalization-schema-pass.test.ts
//
// Real-Postgres smoke for the personalization shared-schema pass (spec §6.6 +
// §4.1 per-category prior). Runs against the docker test database:
//   pnpm test:integration
//
// Covers what unit mocks can't:
// - ClientProfile.selfProfile JSONB round-trip through the store helpers
//   (normalize-on-read, DbNull clear, board-answer write-through merge)
// - the refreshLookCategoryRankStats raw-SQL aggregate (column names, enum
//   casts, GREATEST impression floor) against real LookPost rows
// - resolveLookPostRankPrior → recomputeLookPostRankScore consuming the stat
//   table end-to-end

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  LookPostStatus,
  MediaType,
  ModerationStatus,
  Prisma,
  PrismaClient,
  Role,
} from '@prisma/client'

import {
  applyBoardAnswersWriteThrough,
  readClientSelfProfile,
  writeClientSelfProfilePatch,
} from '@/lib/personalization/selfProfileStore'
import {
  LOOK_CATEGORY_PRIOR_MIN_IMPRESSIONS,
  refreshLookCategoryRankStats,
  resolveLookPostRankPrior,
} from '@/lib/looks/categoryRankStats'
import {
  computeLookPostRankScore,
  recomputeLookPostRankScore,
} from '@/lib/looks/counters'
import { LOOK_POST_RANK_PRIOR } from '@/lib/looks/ranking'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error(
    'Missing DATABASE_URL. Run this test with: pnpm test:integration',
  )
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const TAG = `selfprof_${Date.now()}`

let clientId = ''
let categoryId = ''
let lookPostId = ''

beforeAll(async () => {
  const tenant = await db.tenant.upsert({
    where: { slug: 'tovis-root' },
    update: {},
    create: { slug: 'tovis-root', name: 'TOVIS', isActive: true },
    select: { id: true },
  })

  const clientUser = await db.user.create({
    data: {
      email: `${TAG}_client@example.com`,
      password: 'x',
      role: Role.CLIENT,
    },
    select: { id: true },
  })
  const client = await db.clientProfile.create({
    data: {
      userId: clientUser.id,
      homeTenantId: tenant.id,
      firstName: 'Selfie',
      lastName: 'Profile',
    },
    select: { id: true },
  })
  clientId = client.id

  const proUser = await db.user.create({
    data: { email: `${TAG}_pro@example.com`, password: 'x', role: Role.PRO },
    select: { id: true },
  })
  const professional = await db.professionalProfile.create({
    data: {
      userId: proUser.id,
      homeTenantId: tenant.id,
      firstName: 'Rank',
      lastName: 'Stats',
      businessName: 'Stats Studio',
      timeZone: 'America/Los_Angeles',
    },
    select: { id: true },
  })

  const category = await db.serviceCategory.create({
    data: { name: `${TAG} Cat`, slug: `${TAG}-cat`, isActive: true },
    select: { id: true },
  })
  categoryId = category.id

  const service = await db.service.create({
    data: {
      name: `${TAG} Color`,
      categoryId: category.id,
      defaultDurationMinutes: 60,
      minPrice: new Prisma.Decimal('100.00'),
      isActive: true,
    },
    select: { id: true },
  })

  const media = await db.mediaAsset.create({
    data: {
      professionalId: professional.id,
      proTenantId: tenant.id,
      primaryServiceId: service.id,
      mediaType: MediaType.IMAGE,
      storageBucket: 'media-public',
      storagePath: `${TAG}/look.jpg`,
    },
    select: { id: true },
  })

  // Enough floored impressions to clear the prior threshold on its own.
  const look = await db.lookPost.create({
    data: {
      professionalId: professional.id,
      primaryMediaAssetId: media.id,
      serviceId: service.id,
      status: LookPostStatus.PUBLISHED,
      moderationStatus: ModerationStatus.APPROVED,
      publishedAt: new Date(),
      likeCount: 10,
      saveCount: 30,
      shareCount: 0,
      commentCount: 0,
      viewCount: LOOK_CATEGORY_PRIOR_MIN_IMPRESSIONS * 2,
    },
    select: { id: true },
  })
  lookPostId = look.id
})

afterAll(async () => {
  await db.lookCategoryRankStat.deleteMany({ where: { categoryId } })
  if (lookPostId) await db.lookPost.delete({ where: { id: lookPostId } })
  await db.mediaAsset.deleteMany({
    where: { professional: { user: { email: `${TAG}_pro@example.com` } } },
  })
  await db.service.deleteMany({ where: { name: `${TAG} Color` } })
  await db.serviceCategory.deleteMany({ where: { slug: `${TAG}-cat` } })
  await db.clientProfile.deleteMany({ where: { id: clientId } })
  await db.professionalProfile.deleteMany({
    where: { businessName: 'Stats Studio', firstName: 'Rank' },
  })
  await db.user.deleteMany({ where: { email: { startsWith: TAG } } })
  await db.$disconnect()
})

describe('self-profile store (real JSONB round-trip)', () => {
  it('writes, normalizes, merges, and clears through the store helpers', async () => {
    const now = new Date('2026-07-07T12:00:00.000Z')

    const written = await writeClientSelfProfilePatch(db, {
      clientId,
      patch: { hair_type: 'curly', interests: ['nails'] },
      now,
    })
    expect(written?.selfProfile).toEqual({
      hair_type: 'curly',
      interests: ['nails'],
    })
    expect(written?.selfProfileUpdatedAt?.toISOString()).toBe(
      now.toISOString(),
    )

    // Board-answer write-through merges person-describing keys only.
    const merged = await applyBoardAnswersWriteThrough(db, {
      clientId,
      answers: { current_color: 'brunette', dress_color: 'red' },
      now: new Date('2026-07-07T13:00:00.000Z'),
    })
    expect(merged?.selfProfile).toEqual({
      hair_type: 'curly',
      hair_color: 'brunette',
      interests: ['nails'],
    })

    // Clearing everything stores SQL NULL, and reads back as null.
    await writeClientSelfProfilePatch(db, {
      clientId,
      patch: {
        hair_type: null,
        hair_color: null,
        interests: null,
      },
      now: new Date('2026-07-07T14:00:00.000Z'),
    })
    const cleared = await readClientSelfProfile(db, clientId)
    expect(cleared?.selfProfile).toBeNull()

    const raw = await db.clientProfile.findUnique({
      where: { id: clientId },
      select: { selfProfile: true },
    })
    expect(raw?.selfProfile).toBeNull()
  })
})

describe('category rank stats (real SQL aggregate + prior consumption)', () => {
  it('aggregates weighted engagement and floored impressions per category', async () => {
    const now = new Date()
    const result = await refreshLookCategoryRankStats(db, now)
    expect(result.categories).toBeGreaterThanOrEqual(1)

    const stat = await db.lookCategoryRankStat.findUnique({
      where: { categoryId },
    })
    // like 10×1 + save 30×5 = 160; impressions = max(viewCount, raw 40)
    expect(stat?.weightedEngagement).toBe(160)
    expect(stat?.impressions).toBe(LOOK_CATEGORY_PRIOR_MIN_IMPRESSIONS * 2)
    expect(stat?.lookCount).toBe(1)
  })

  it('feeds the per-category prior into a real rank recompute', async () => {
    const prior = await resolveLookPostRankPrior(db, categoryId)
    // 160 / 1000 = 0.16 — distinct from the global 0.08.
    expect(prior.rate).toBeCloseTo(
      160 / (LOOK_CATEGORY_PRIOR_MIN_IMPRESSIONS * 2),
      10,
    )
    expect(prior.rate).not.toBe(LOOK_POST_RANK_PRIOR.rate)
    expect(prior.strength).toBe(LOOK_POST_RANK_PRIOR.strength)

    const persisted = await recomputeLookPostRankScore(db, lookPostId)
    const row = await db.lookPost.findUnique({
      where: { id: lookPostId },
      select: {
        status: true,
        moderationStatus: true,
        publishedAt: true,
        likeCount: true,
        commentCount: true,
        saveCount: true,
        shareCount: true,
        viewCount: true,
        rankScore: true,
      },
    })

    expect(row?.rankScore).toBe(persisted)
    // The persisted score matches a pure recompute under the category prior
    // (allowing for the tiny now() drift between the two computations).
    if (!row) throw new Error('look row missing')
    expect(persisted).toBeCloseTo(
      computeLookPostRankScore(row, { prior }),
      1,
    )
  })
})
