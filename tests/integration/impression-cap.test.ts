// tests/integration/impression-cap.test.ts
//
// Real-Postgres smoke for the §4.6 per-viewer impression cap. Runs against the
// docker test database:
//   pnpm test:integration
//
// Covers what unit mocks can't — the full round-trip on real Prisma:
//   (a) the APPLY_LOOK_VIEWS processor increments a per-(viewer, look) counter
//       via the composite-PK upsert, only for eligible FEED impressions;
//   (b) loadCappedLookIds lists a look once it reaches the exposure cap;
//   (c) buildPersonalizedFeedPage hard-excludes the capped look (and reports
//       cappedExcludedCount) while un-capped / detail-only / fresh looks survive.
//
// The shared test DB is seeded, so everything here is fixture-scoped (unique TAG,
// high rankScores so the fixtures land on page one, teardown by TAG).

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  LookImpressionSource,
  LookPostStatus,
  MediaType,
  ModerationStatus,
  Prisma,
  PrismaClient,
  Role,
  VerificationStatus,
} from '@prisma/client'

import { processApplyLookViews } from '@/lib/jobs/looksSocial/applyLookViews'
import { buildPersonalizedFeedPage } from '@/lib/looks/personalizedFeed'
import {
  IMPRESSION_CAP_EXPOSURES,
  loadCappedLookIds,
} from '@/lib/looks/viewerImpressionCap'
import { rootTenantContext } from '@/lib/tenant/context'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with: pnpm test:integration')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const TAG = `impcap_${Date.now()}`
const NOW = new Date()
// High so the fixtures beat any low-rankScore seed rows onto page one.
const RANK = 100

let tenantId = ''
let viewerUserId = ''
let viewerClientId = ''
// A look exposed to the cap → excluded; one below the cap; one seen only on its
// detail page; one never seen. All in one category/pro so only the cap differs.
let cappedId = ''
let belowCapId = ''
let detailOnlyId = ''
let freshId = ''

beforeAll(async () => {
  const tenant = await db.tenant.upsert({
    where: { slug: 'tovis-root' },
    update: {},
    create: { slug: 'tovis-root', name: 'TOVIS', isActive: true },
    select: { id: true },
  })
  tenantId = tenant.id

  const viewerUser = await db.user.create({
    data: {
      email: `${TAG}_viewer@example.com`,
      password: 'x',
      role: Role.CLIENT,
    },
    select: { id: true },
  })
  viewerUserId = viewerUser.id
  const viewerClient = await db.clientProfile.create({
    data: {
      userId: viewerUser.id,
      homeTenantId: tenant.id,
      firstName: 'Cap',
      lastName: 'Viewer',
    },
    select: { id: true },
  })
  viewerClientId = viewerClient.id

  const proUser = await db.user.create({
    data: { email: `${TAG}_pro@example.com`, password: 'x', role: Role.PRO },
    select: { id: true },
  })
  const professional = await db.professionalProfile.create({
    data: {
      userId: proUser.id,
      homeTenantId: tenant.id,
      firstName: 'Cap',
      lastName: 'Pro',
      businessName: `${TAG} Studio`,
      timeZone: 'America/Los_Angeles',
      verificationStatus: VerificationStatus.APPROVED,
    },
    select: { id: true },
  })

  const category = await db.serviceCategory.create({
    data: { name: `${TAG} Cat`, slug: `${TAG}-cat`, isActive: true },
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
        rankScore: RANK,
      },
      select: { id: true },
    })
    return look.id
  }

  cappedId = await createLook('capped')
  belowCapId = await createLook('belowcap')
  detailOnlyId = await createLook('detailonly')
  freshId = await createLook('fresh')

  // Drive the REAL processor, once per "session" — the composite-PK upsert
  // increments each time. cappedId reaches the cap; belowCapId gets one FEED
  // exposure; detailOnlyId is only ever a DETAIL open (never counts).
  for (let i = 0; i < IMPRESSION_CAP_EXPOSURES; i += 1) {
    await processApplyLookViews(
      db,
      {
        viewerId: viewerUserId,
        impressions: [
          { lookPostId: cappedId, source: LookImpressionSource.FEED },
          ...(i === 0
            ? [
                { lookPostId: belowCapId, source: LookImpressionSource.FEED },
                {
                  lookPostId: detailOnlyId,
                  source: LookImpressionSource.DETAIL,
                },
              ]
            : []),
        ],
      },
      { now: NOW },
    )
  }
})

afterAll(async () => {
  const lookIds = [cappedId, belowCapId, detailOnlyId, freshId]
  await db.lookViewerImpressionStat.deleteMany({
    where: { userId: viewerUserId },
  })
  await db.lookPostImpressionStat.deleteMany({
    where: { lookPostId: { in: lookIds } },
  })
  await db.lookPost.deleteMany({ where: { id: { in: lookIds } } })
  await db.mediaAsset.deleteMany({
    where: { storagePath: { startsWith: TAG } },
  })
  await db.service.deleteMany({ where: { name: `${TAG} Svc` } })
  await db.serviceCategory.deleteMany({ where: { slug: `${TAG}-cat` } })
  await db.clientProfile.deleteMany({ where: { id: viewerClientId } })
  await db.professionalProfile.deleteMany({
    where: { businessName: `${TAG} Studio` },
  })
  await db.user.deleteMany({ where: { email: { startsWith: TAG } } })
  await db.$disconnect()
})

describe('§4.6 impression cap (real Postgres)', () => {
  it('increments the per-viewer counter only for eligible FEED exposures', async () => {
    const cappedRow = await db.lookViewerImpressionStat.findUnique({
      where: { userId_lookPostId: { userId: viewerUserId, lookPostId: cappedId } },
      select: { count: true },
    })
    expect(cappedRow?.count).toBe(IMPRESSION_CAP_EXPOSURES)

    const belowRow = await db.lookViewerImpressionStat.findUnique({
      where: {
        userId_lookPostId: { userId: viewerUserId, lookPostId: belowCapId },
      },
      select: { count: true },
    })
    expect(belowRow?.count).toBe(1)

    // A DETAIL-only open never creates a cap row.
    const detailRow = await db.lookViewerImpressionStat.findUnique({
      where: {
        userId_lookPostId: { userId: viewerUserId, lookPostId: detailOnlyId },
      },
      select: { count: true },
    })
    expect(detailRow).toBeNull()
  })

  it('lists only the at-or-above-cap look ids', async () => {
    const capped = await loadCappedLookIds(db, { userId: viewerUserId })
    expect(capped).toContain(cappedId)
    expect(capped).not.toContain(belowCapId)
    expect(capped).not.toContain(detailOnlyId)
    expect(capped).not.toContain(freshId)
  })

  it('excludes the capped look from the personalized feed and reports the count', async () => {
    const page = await buildPersonalizedFeedPage({
      tenant: rootTenantContext(tenantId),
      userId: viewerUserId,
      clientId: viewerClientId,
      limit: 50,
      cursor: null,
      seenLookIds: new Set(),
      now: NOW,
    })

    const ids = page.items.map((item) => item.id)
    // Capped out of the feed…
    expect(ids).not.toContain(cappedId)
    // …but the below-cap, detail-only, and never-seen looks still surface.
    expect(ids).toContain(belowCapId)
    expect(ids).toContain(detailOnlyId)
    expect(ids).toContain(freshId)
    expect(page.meta.cappedExcludedCount).toBe(1)
  })
})
