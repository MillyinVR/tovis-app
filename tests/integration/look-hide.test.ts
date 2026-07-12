// tests/integration/look-hide.test.ts
//
// Real-Postgres smoke for the §2.2 "not for me" hide control. Runs against the
// docker test database:
//   pnpm test:integration
//
// Covers what unit mocks can't — that an explicit hide (a real LookHide row)
// actually (a) drops the look from buildPersonalizedFeedPage's query, and
// (b) after repeated hides in a category, down-ranks a DIFFERENT, un-hidden look
// in that same category below an equal-rankScore look in another category.
// buildPersonalizedFeedPage runs on the app prisma singleton, which (like every
// integration test here) points at DATABASE_URL = the test DB. The shared test
// DB is seeded, so everything here is fixture-scoped (unique TAG, high rankScores
// so the fixtures land on page one, teardown by TAG).

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

import {
  buildPersonalizedFeedPage,
  loadPersonalizedAffinity,
} from '@/lib/looks/personalizedFeed'
import { rootTenantContext } from '@/lib/tenant/context'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with: pnpm test:integration')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const TAG = `lookhide_${Date.now()}`
const NOW = new Date()
// High so the fixtures beat any low-rankScore seed rows onto page one.
const RANK = 100

let tenantId = ''
let viewerUserId = ''
let viewerClientId = ''
let catASlug = ''
let catBSlug = ''
// Category A: three hidden + one survivor. Category B: one neutral peer.
const hiddenIds: string[] = []
let survivorAId = ''
let neutralBId = ''

beforeAll(async () => {
  const tenant = await db.tenant.upsert({
    where: { slug: 'tovis-root' },
    update: {},
    create: { slug: 'tovis-root', name: 'TOVIS', isActive: true },
    select: { id: true },
  })
  tenantId = tenant.id

  const viewerUser = await db.user.create({
    data: { email: `${TAG}_viewer@example.com`, password: 'x', role: Role.CLIENT },
    select: { id: true },
  })
  viewerUserId = viewerUser.id
  const viewerClient = await db.clientProfile.create({
    data: {
      userId: viewerUser.id,
      homeTenantId: tenant.id,
      firstName: 'Hide',
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
      firstName: 'Hide',
      lastName: 'Pro',
      businessName: `${TAG} Studio`,
      timeZone: 'America/Los_Angeles',
      verificationStatus: VerificationStatus.APPROVED,
    },
    select: { id: true },
  })

  async function makeService(letter: string): Promise<{ id: string; slug: string }> {
    const slug = `${TAG}-cat-${letter}`
    const category = await db.serviceCategory.create({
      data: { name: `${TAG} Cat ${letter}`, slug, isActive: true },
      select: { id: true },
    })
    const service = await db.service.create({
      data: {
        name: `${TAG} Svc ${letter}`,
        categoryId: category.id,
        defaultDurationMinutes: 60,
        minPrice: new Prisma.Decimal('100.00'),
        isActive: true,
      },
      select: { id: true },
    })
    return { id: service.id, slug }
  }

  const svcA = await makeService('A')
  const svcB = await makeService('B')
  catASlug = svcA.slug
  catBSlug = svcB.slug

  async function createLook(serviceId: string, suffix: string): Promise<string> {
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
    const look = await db.lookPost.create({
      data: {
        professionalId: professional.id,
        primaryMediaAssetId: media.id,
        serviceId,
        status: LookPostStatus.PUBLISHED,
        moderationStatus: ModerationStatus.APPROVED,
        publishedAt: NOW,
        rankScore: RANK,
      },
      select: { id: true },
    })
    return look.id
  }

  hiddenIds.push(await createLook(svcA.id, 'hidA1'))
  hiddenIds.push(await createLook(svcA.id, 'hidA2'))
  hiddenIds.push(await createLook(svcA.id, 'hidA3'))
  survivorAId = await createLook(svcA.id, 'survivorA')
  neutralBId = await createLook(svcB.id, 'neutralB')

  // The viewer hides all three catA looks (explicit "not for me").
  await db.lookHide.createMany({
    data: hiddenIds.map((lookPostId) => ({ lookPostId, userId: viewerUserId })),
  })
})

afterAll(async () => {
  await db.lookHide.deleteMany({ where: { userId: viewerUserId } })
  await db.lookPost.deleteMany({
    where: { id: { in: [...hiddenIds, survivorAId, neutralBId] } },
  })
  await db.mediaAsset.deleteMany({ where: { storagePath: { startsWith: TAG } } })
  await db.service.deleteMany({ where: { name: { startsWith: `${TAG} Svc` } } })
  await db.serviceCategory.deleteMany({ where: { slug: { startsWith: `${TAG}-cat` } } })
  await db.clientProfile.deleteMany({ where: { id: viewerClientId } })
  await db.professionalProfile.deleteMany({
    where: { businessName: `${TAG} Studio` },
  })
  await db.user.deleteMany({ where: { email: { startsWith: TAG } } })
  await db.$disconnect()
})

describe('§2.2 look hides (real Postgres)', () => {
  it('collects the hidden ids and decayed category suppression', async () => {
    const affinity = await loadPersonalizedAffinity({
      userId: viewerUserId,
      clientId: viewerClientId,
      now: NOW,
    })

    for (const id of hiddenIds) {
      expect(affinity.hiddenLookIds).toContain(id)
    }
    // Three fresh hides in category A → decayed weight ~3 (well past threshold).
    expect(affinity.categorySuppressionWeights?.get(catASlug) ?? 0).toBeCloseTo(
      3,
      1,
    )
    // Category B was never hidden.
    expect(affinity.categorySuppressionWeights?.get(catBSlug) ?? 0).toBe(0)
  })

  it('excludes hidden looks from the personalized feed', async () => {
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
    for (const hidden of hiddenIds) {
      expect(ids).not.toContain(hidden)
    }
    // The un-hidden looks still surface.
    expect(ids).toContain(survivorAId)
    expect(ids).toContain(neutralBId)
    expect(page.meta.hiddenExcludedCount).toBe(hiddenIds.length)
    expect(page.meta.categorySuppressionCount).toBeGreaterThanOrEqual(1)
  })

  it('down-ranks an un-hidden look in a repeatedly-hidden category below an equal peer', async () => {
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
    // survivorA and neutralB share rankScore; category-A suppression sinks
    // survivorA below neutralB even though nothing else differs.
    expect(ids.indexOf(neutralBId)).toBeLessThan(ids.indexOf(survivorAId))
  })
})
