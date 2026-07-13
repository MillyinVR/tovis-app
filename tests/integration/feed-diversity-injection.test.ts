// tests/integration/feed-diversity-injection.test.ts
//
// Real-Postgres smoke for the §4.3.1 diversity-injection exclusion predicate.
// Runs against the docker test database:
//   pnpm test:integration
//
// The exploration slice pulls high-rankScore looks from categories OUTSIDE the
// viewer's affinity graph via a nested to-one filter —
//   { service: { category: { slug: { notIn: [...affinity slugs] } } } }
// — which unit mocks can't exercise. This asserts the real Prisma semantics the
// personalized feed depends on: the filter (a) excludes looks in the excluded
// categories, (b) includes looks in other categories, and (c) drops looks with
// no service/category at all (a nested to-one filter requires the relation to
// exist). Everything is scoped to a dedicated pro so the shared seeded corpus
// can't perturb the assertion.

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

import { buildLooksFeedWhere, buildLooksFeedOrderBy } from '@/lib/looks/feed'
import { rootTenantContext } from '@/lib/tenant/context'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with: pnpm test:integration')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const TAG = `feeddiv_${Date.now()}`
const NOW = new Date()

let tenantId = ''
let proId = ''
let affinityCatSlug = ''
let offGraphLookId = ''
let affinityLookId = ''
let noServiceLookId = ''

beforeAll(async () => {
  const tenant = await db.tenant.upsert({
    where: { slug: 'tovis-root' },
    update: {},
    create: { slug: 'tovis-root', name: 'TOVIS', isActive: true },
    select: { id: true },
  })
  tenantId = tenant.id

  const proUser = await db.user.create({
    data: { email: `${TAG}_pro@example.com`, password: 'x', role: Role.PRO },
    select: { id: true },
  })
  const professional = await db.professionalProfile.create({
    data: {
      userId: proUser.id,
      homeTenantId: tenant.id,
      firstName: 'Div',
      lastName: 'Pro',
      businessName: `${TAG} Studio`,
      timeZone: 'America/Los_Angeles',
      verificationStatus: VerificationStatus.APPROVED,
    },
    select: { id: true },
  })
  proId = professional.id

  async function makeCategoryService(kind: string) {
    const category = await db.serviceCategory.create({
      data: { name: `${TAG} ${kind}`, slug: `${TAG}-${kind}`, isActive: true },
      select: { id: true, slug: true },
    })
    const service = await db.service.create({
      data: {
        name: `${TAG} ${kind} svc`,
        categoryId: category.id,
        defaultDurationMinutes: 60,
        minPrice: new Prisma.Decimal('100.00'),
        isActive: true,
      },
      select: { id: true },
    })
    return { categorySlug: category.slug, serviceId: service.id }
  }

  const affinity = await makeCategoryService('affinity')
  const offGraph = await makeCategoryService('offgraph')
  affinityCatSlug = affinity.categorySlug

  // MediaAsset.primaryServiceId is required (media is always anchored to a
  // bookable service); only the LookPost.serviceId varies — a null there is what
  // makes a look "service-less" for the exploration filter.
  async function createLook(args: {
    suffix: string
    mediaServiceId: string
    lookServiceId: string | null
  }): Promise<string> {
    const media = await db.mediaAsset.create({
      data: {
        professionalId: proId,
        proTenantId: tenantId,
        primaryServiceId: args.mediaServiceId,
        mediaType: MediaType.IMAGE,
        storageBucket: 'media-public',
        storagePath: `${TAG}/${args.suffix}.jpg`,
      },
      select: { id: true },
    })
    const look = await db.lookPost.create({
      data: {
        professionalId: proId,
        primaryMediaAssetId: media.id,
        serviceId: args.lookServiceId,
        status: LookPostStatus.PUBLISHED,
        moderationStatus: ModerationStatus.APPROVED,
        publishedAt: NOW,
        rankScore: 10,
      },
      select: { id: true },
    })
    return look.id
  }

  affinityLookId = await createLook({
    suffix: 'affinity',
    mediaServiceId: affinity.serviceId,
    lookServiceId: affinity.serviceId,
  })
  offGraphLookId = await createLook({
    suffix: 'offgraph',
    mediaServiceId: offGraph.serviceId,
    lookServiceId: offGraph.serviceId,
  })
  noServiceLookId = await createLook({
    suffix: 'noservice',
    mediaServiceId: offGraph.serviceId,
    lookServiceId: null,
  })
})

afterAll(async () => {
  await db.lookPost.deleteMany({
    where: { id: { in: [affinityLookId, offGraphLookId, noServiceLookId] } },
  })
  await db.mediaAsset.deleteMany({ where: { storagePath: { startsWith: TAG } } })
  await db.service.deleteMany({ where: { name: { startsWith: `${TAG} ` } } })
  await db.serviceCategory.deleteMany({ where: { slug: { startsWith: `${TAG}-` } } })
  await db.professionalProfile.deleteMany({ where: { businessName: `${TAG} Studio` } })
  await db.user.deleteMany({ where: { email: { startsWith: TAG } } })
  await db.$disconnect()
})

describe('§4.3.1 diversity injection exclusion predicate (real Postgres)', () => {
  it('excludes affinity-category and service-less looks; keeps off-graph looks', async () => {
    const baseWhere = buildLooksFeedWhere({
      kind: 'ALL',
      tenant: rootTenantContext(tenantId),
    })

    const rows = await db.lookPost.findMany({
      where: {
        AND: [
          baseWhere,
          // Scope to this fixture's pro so the shared corpus can't perturb it.
          { professionalId: proId },
          { service: { category: { slug: { notIn: [affinityCatSlug] } } } },
        ],
      },
      orderBy: buildLooksFeedOrderBy({ kind: 'ALL', sort: 'RANKED' }),
      select: { id: true },
    })

    const ids = rows.map((r) => r.id)
    expect(ids).toContain(offGraphLookId)
    expect(ids).not.toContain(affinityLookId)
    // A look with no service/category doesn't satisfy the nested to-one filter,
    // so exploration never surfaces uncategorized content.
    expect(ids).not.toContain(noServiceLookId)
  })
})
